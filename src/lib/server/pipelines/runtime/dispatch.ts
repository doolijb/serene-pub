/**
 * Sending a prompt that was built somewhere else.
 *
 * The legacy path builds and sends in one call, so there is no moment between
 * "the payload exists" and "the payload was sent" — which is the entire debug
 * preview, and also the reason a review gate has nothing to show. The pipeline
 * splits them: a Task assembles, this dispatches.
 *
 * It reaches the **same seven adapters** through the same `generateText()`. There is
 * no second HTTP client here and no second request shape; `withCompiledPrompt`
 * makes `compilePrompt()` return the supplied payload instead of building one,
 * and everything after that is untouched legacy code. That is what makes parity
 * checkable rather than asserted — a pipeline run and a legacy run differ only
 * in who built the prompt.
 *
 * ## What does not cross this line
 *
 * The connection — its URL, its key, its headers, its model id — is resolved
 * here and **never returned**. A binding asks for text and receives text. This
 * is not a convention that could be relaxed later for a plugin that "just needs
 * the base URL": a Provider that could read connection material would be a
 * plugin that can exfiltrate an API key by describing an effect, and the review
 * gate would show a perfectly innocent-looking node.
 *
 * What comes back is the completion, whether it was aborted, and token counts —
 * plus, under the key `wire`, the exchange the adapter recorded. That one field
 * IS connection material: a request cannot be described without naming where it
 * went. It is safe on the same terms `connection` on a node output is safe —
 * `withoutConnectionIdentity` removes the key at every egress, so only an
 * administrator reads it, and no out-port declares it, so no node downstream can
 * take it off the port and write it somewhere durable.
 *
 * ## Attachments: references in, bytes out, resolved HERE
 *
 * A file travels the graph as a `MediaRef` — a uuid — because bytes on a port
 * would be copied into the receipt, the review payload and every node in
 * between (media.ts: "a reference, never bytes"). An adapter needs the opposite:
 * the bytes, in order, with a mime. Something has to be the seam, and it is this
 * module, for three reasons that all point the same way:
 *
 *  - **The database.** Loading a ref needs `$lib/server/media`, which needs the
 *    db and the image codecs. Adapters are lazily imported so that graph never
 *    reaches server boot (`importBoundary.test.ts`), and `BaseConnectionAdapter`
 *    is imported freely by ordinary server modules — putting the media module in
 *    its import graph would drag the db behind every one of them.
 *  - **Which database.** `dispatchGeneration` is handed a `db` on purpose (see
 *    `DispatchRequest.db`): an adapter has no db handle at all and would have to
 *    reach for the global one, which is exactly the bug that param exists to
 *    prevent. Resolution belongs where the run's own database is known.
 *  - **Access.** A uuid is unguessable, but "unguessable" is not an access rule.
 *    A spec that could name any uuid could send another user's private image to
 *    a third-party API — so every reference is checked against the run's session
 *    and user, the same rule the host applies when posting media into a message.
 *    An adapter knows nothing about users and could not make that check.
 *
 * The symmetry with `dispatchImage` is deliberate: that one takes bytes from a
 * backend and puts a reference on the port; this one takes a reference off the
 * port and gives bytes to a backend. Neither lets bytes travel the graph.
 */

import type { TaskType } from "$lib/server/utils/resolveTaskConfig"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import {
	isQueueCancellation,
	llmQueue,
	type LLMQueueStatus
} from "$lib/server/utils/llmQueue"
import { contextWindowFrom } from "$lib/server/pipelines/runtime/contextWindow"
import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import {
	capabilityRefusal,
	storedCapabilities
} from "$lib/server/pipelines/runtime/capabilityGuard"
import type { AttachmentInput } from "$lib/server/adapters/attachments"
import type { ToolCall, ToolDeclaration } from "$lib/server/adapters/actions"
import type { MediaRef } from "@serene-pub/sdk"
import {
	ComposedError,
	connectionIdentity
} from "$lib/server/connections/visibility"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import {
	composeStopsFor,
	trimAtSpeakerBoundary,
	type CompiledMessagesProbe,
	type ComposedStops,
	type ReplyTrim
} from "$lib/server/connections/stops"
import type { StreamingMode } from "$lib/server/connections/streaming"
import {
	chooseStructuredMode,
	JSON_INSTRUCTION,
	type StructuredChoice
} from "$lib/server/connections/structuredOutput"
import type { JsonSchemaNode } from "$lib/server/connectionAdapters/jsonSchemaToGbnf"
import type { WireExchange } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import { resolveThinking } from "$lib/shared/utils/thinkingDelimiters"

/**
 * A dispatch failure, and a marker: this sentence is ours.
 *
 * `ComposedError` is what tells `persistGenerationErrorRow` that the message may
 * be stored and shown to anybody — it names no connection. An adapter's own
 * error, which names the base URL and the model file, is a plain `Error` and is
 * replaced there instead. The optional second argument is the identity the
 * failure was about, carried as a field so the projection can remove it for
 * everyone who is not an administrator.
 */
export class DispatchError extends ComposedError {}

export interface DispatchRequest {
	/** The payload an adapter would otherwise have built for itself. */
	compiledPrompt: unknown
	/**
	 * The database the run is against — handed in, not imported.
	 *
	 * This started as an `import("$lib/server/db")` and the end-to-end test
	 * caught it: the pipeline ran against a test database and the dispatch
	 * quietly read from the application's, reporting the session as deleted. A
	 * module that reaches for the global connection is one that cannot be run
	 * against anything else, which includes every future case where "anything
	 * else" matters — a dry run, a replay, a second instance.
	 */
	db: Db
	sessionId: number
	userId?: number
	/** Null in narrator mode, matching the legacy adapter's own convention. */
	currentCharacterId?: number | null
	/** Forwarded verbatim; carries `isNarratorResponse` among other things. */
	generatingMessageMetadata?: Record<string, unknown>
	/**
	 * The run's resolution — what the executor's `resolveSlot` settled the
	 * calling node's `connection` and `sampling` slots to (R-8).
	 *
	 * ⚠ **Consumed, never re-walked.** This used to be tier 2 of a second walk
	 * (`resolveTaskConfig`: session sampling → prompt-config override → these →
	 * the capability default), so the request could go out against a
	 * connection and a window the budget and the render had resolved
	 * differently. The world the executor resolves against carries every tier
	 * now (`config/world.ts`), so what arrives here is the one answer, and the
	 * resolver below only loads the pair, checks the model and attaches the
	 * template — it selects nothing. Null means the run resolved nothing, and
	 * the resolver's own sentence says what to set and where.
	 */
	connectionId?: number | null
	/**
	 * The MODEL half of the `connection` slot's pair (0114). Null means the
	 * endpoint's default model, which is what every slot authored before the
	 * split says and what every registration the backfill left behind means.
	 */
	connectionModelId?: number | null
	/**
	 * The files travelling with this request, as the graph carries them:
	 * references, in the order they are to be sent. Resolved to bytes below —
	 * see the header for why that happens here and nowhere lower.
	 */
	attachments?: readonly (MediaRef | string)[]
	samplingId?: number | null
	/**
	 * The author's own stop sequences — `generate-text.params.stopSequences`,
	 * forwarded verbatim from the node's params slot.
	 *
	 * ⚠ Only the EXPLICIT kind travels here. The format and speaker kinds are
	 * derived from the connection's completion template and the session's cast,
	 * both of which this module resolves for itself below, so passing them in
	 * would be a second reading of the same facts — the shape
	 * `connections/stops.ts` exists to remove. See `composeStops`.
	 */
	stopSequences?: readonly string[] | null
	/**
	 * How the author wants this step sent — the `streaming` parameter off the
	 * provider node's `params` slot.
	 *
	 * Absent and `auto` are the same request: the connection decides, which is
	 * what it has always done. `off` is the only value that reaches the adapter,
	 * and it reaches it as `withStreaming('off')` rather than as a flag on the
	 * payload, because the per-service default it overrides lives in the adapter
	 * class and must not be resolved twice.
	 */
	streaming?: StreamingMode | null
	/**
	 * The tool declarations this request offers the model — `advertise-tools`'
	 * `native` port, normalized (20 §9).
	 *
	 * Empty or absent on every request that is not a tool loop's, which is
	 * almost all of them. When present it is REFUSED rather than dropped if
	 * the connection may not use tools or its adapter has no code that sends
	 * them: a model that was never offered a tool and a model that declined
	 * one return the same empty answer, so a silently stripped request reads
	 * as the model choosing not to call.
	 */
	tools?: readonly ToolDeclaration[]
	/**
	 * A request for STRUCTURE rather than prose — `core:oracle/generate-json@1`
	 * and nothing else sets it.
	 *
	 * Present means "constrain the answer as far as this connection can", and
	 * how far that is is decided HERE rather than by the binding, for the reason
	 * the header gives about the connection: a binding never sees one, so it
	 * cannot know whether the row takes a schema, takes plain JSON mode, or takes
	 * neither. `chooseStructuredMode` walks that ladder and the door it chose
	 * comes back on the result, because a step that asked for a schema and got a
	 * sentence produced its answer by a different route and a reader has to be
	 * able to tell.
	 *
	 * Absent on every other request, so `generate-text`'s wire is byte-identical
	 * to what it always was.
	 */
	structured?: { schema?: unknown } | null
	/** Called with each chunk when the adapter streams. */
	onChunk?: (chunk: string) => void
	onThinking?: (chunk: string) => void
	signal?: AbortSignal
	/**
	 * Send through the LLM queue — one model call at a time across the
	 * application — rather than directly.
	 *
	 * The host passes this for every generating node of a run, which is the
	 * same lane `dispatchStep` and `runQueuedLLMCall` already take. The
	 * status is what a live row shows as its `generationStatus` while the call
	 * waits or a managed backend loads; `queueItemId` is the id the row
	 * already carries, so the client's Stop can cancel by it. Absent, the call
	 * is made directly — a test poking the dispatch, or a caller that queues
	 * for itself.
	 */
	queue?: {
		taskType: TaskType
		sessionId?: number
		messageId?: number
		userId?: number
		label?: string
		queueItemId?: string
		onStatusChange?: (status: LLMQueueStatus) => void
	}
}

export interface DispatchResult {
	text: string
	thinking?: string
	isAborted: boolean
	/**
	 * Which adapter answered, by connection type — a label, not a handle.
	 *
	 * ⚠ Server-side only. The connection type names the administrator's compute,
	 * so it may not be emitted as a bare string: the binding that consumes this
	 * puts it on the node output under `connection`, which
	 * `withoutConnectionIdentity` removes for everyone who is not an
	 * administrator. A caller that interpolates it into a sentence has written a
	 * leak no projection can find.
	 */
	via: string
	/**
	 * What this request stopped on, and what it was not allowed to stop on.
	 *
	 * On the receipt rather than only on the wire, because the failure this
	 * whole area exists to stop being silent has no error attached to it: a stop
	 * sequence the model never sees means a reply that runs on, and one that
	 * matches at position zero means an empty reply. Both read as a bad model.
	 * `dropped` is the half that answers "why is my stop sequence not working" —
	 * it names the entries the wire rule held back, with the kind that decided.
	 *
	 * `trimmedAt` is the other half of the same answer: where the reply was cut
	 * at a speaker boundary the backend ran past. Absent when nothing was cut,
	 * so a truncation is never silent.
	 */
	stops: ComposedStops & { hit?: string; trimmedAt?: ReplyTrim }
	/**
	 * The tool the model called, read off the structured field its API
	 * answered in — never parsed out of the prose. Null when it called none,
	 * and on every request that carried no tools.
	 */
	toolCall?: ToolCall | null
	/**
	 * Which structured-output door this request went out through, when it asked
	 * for one at all.
	 *
	 * On the receipt for the same reason `stops` is: the failure it explains has
	 * no error attached to it. A reply that ignored a schema and a reply that was
	 * never sent one read identically from the text alone.
	 *
	 * Names no connection — a door and a capability id, both of which the
	 * `wire` beside it is already precedent for.
	 */
	structured?: {
		mode: StructuredChoice["mode"]
		capability: StructuredChoice["capability"]
	}
	/**
	 * What the adapter actually put on the wire, and what came back.
	 *
	 * ⚠ **The one piece of connection material this returns**, and the
	 * exception is deliberate rather than a relaxation of the rule above: a
	 * request cannot be described without naming where it went. It rides under
	 * `wire` on the node's OUTPUT — a key `withoutConnectionIdentity` removes
	 * at every egress, the same arrangement `connection` has, and no declared
	 * out-port — so a receipt reader who is an administrator sees the request
	 * body and the raw reply, and nobody else sees either.
	 *
	 * `calls[]` where a node made more than one call; the exchange itself where
	 * it made one. Absent on an adapter that recorded nothing.
	 */
	wire?: WireExchange | { calls: WireExchange[] }
	/**
	 * What the prompt cost and how much of it the service reused, where it says.
	 *
	 * ⚠ **Recorded and nothing else** (ruled "later, non-disruptive"). No
	 * request is reordered, no prefix is placed and no cache control is sent on
	 * account of these numbers; they exist so a reader can find out whether the
	 * caching they are paying for is happening.
	 *
	 * Absent is not zero — see `TextGenResult.tokensCached`. KoboldCPP reports
	 * nothing at all and Ollama reports the total only, and both must read as
	 * "this connection does not say" rather than "nothing was reused".
	 */
	tokensPrompt?: number
	tokensCached?: number
	tokensCacheWrite?: number
	/**
	 * What this request carried of the sampling config, and what it could not.
	 *
	 * The same `applied`/`ignored` channel an image render already reports, for
	 * the same reason: a sampler a person switched ON and a request that does
	 * not carry it is a silence with no error attached to it. The config
	 * panel's "not sent to this backend" note answers the question one level
	 * up, per connection TYPE, before anything is sent; these are the ones only
	 * the send knows — a reasoning level a model does not take in words,
	 * temperature on an Anthropic request that turned thinking on.
	 *
	 * Both absent when the adapter left nothing out, so a result from one is
	 * identical to what it always was.
	 */
	samplingApplied?: Record<string, unknown>
	samplingIgnored?: string[]
}

/**
 * The hydrated session an adapter's constructor needs.
 *
 * Read here rather than passed along a data edge. It is a large object with a
 * user's whole cast in it, and a pipeline value is a thing that lands in the
 * receipt and in every downstream node's input — the prompt text is what the
 * pipeline is carrying, not the rows it came from.
 */
async function loadAdapterSession(db: Db, sessionId: number) {
	const session = await db.query.sessions.findFirst({
		where: (c: any, { eq }: any) => eq(c.id, sessionId),
		with: {
			sessionCharacters: { with: { character: true } },
			sessionPersonas: { with: { persona: true } },
			lorebook: { with: { lorebookBindings: true } }
		}
	})
	if (!session)
		throw new DispatchError(
			`there is no session ${sessionId} to generate in — it was deleted while the run was in flight`
		)

	// Same filter the legacy path applies: these FKs are nullable with
	// `onDelete: "set null"`, so a deleted character leaves a row with nothing
	// to prompt from, and `BasePromptSession` requires the relation to be present
	// on the rows it does list.
	return {
		...session,
		sessionCharacters: (session.sessionCharacters ?? []).filter(
			(cc: any) => cc.character !== null
		),
		sessionPersonas: (session.sessionPersonas ?? []).filter(
			(cp: any) => cp.persona !== null
		)
	}
}

/**
 * Turn Assemble's allocated context into the payload an adapter expects.
 *
 * Assemble publishes **blocks plus a rendered string**, deliberately — that is
 * the shape the budget panel and the `why` trail need (16 §7). An adapter wants
 * `{prompt, messages, meta}`. Something has to bridge the two, and it is here
 * rather than in a Task because the bridge needs the connection's prompt format,
 * and a Task is handed no connection at all.
 *
 * This gap was invisible until a parity run: the spine test passed because its
 * fake adapter accepted whatever it was given, so the pipeline was handing a
 * real adapter an object with no `prompt` and no `messages` on it — which would
 * have generated from an empty string and read as a model fault.
 *
 * A payload that already looks compiled passes through untouched, so a plugin
 * that assembles its own wire format is not forced back through core's.
 */
export function toCompiledPrompt(
	payload: any,
	connection: { promptFormat?: string | null },
	meta: { currentCharacterId?: number | null; messageCount?: number } = {}
): any {
	/**
	 * ⚠ **`blocks` is what tells Assemble's output apart from a compiled one**,
	 * and without it the split path silently loses its whole `meta`.
	 *
	 * Assemble publishes `{blocks, budget, rendered, messages, …}` — and in
	 * split-session format `messages` is a real array, so the "already looks
	 * compiled" test below matched Assemble's OWN payload and returned it
	 * untouched. The caller then got an allocation record where it expected
	 * `{prompt, messages, meta}`: `sessions.ts`'s token count reads
	 * `meta.tokenCounts` off it, `generateResponse.ts` hands it to an adapter.
	 * Both would have read `undefined` and reported it as a model fault.
	 *
	 * It was unreachable while nothing ever produced `messages` — the prompt
	 * format never reached the render, so every payload was a flat string.
	 * Restoring that wire is what makes this line load-bearing.
	 *
	 * An allocation record is exactly what carries a `blocks` ARRAY (the SDK
	 * spells the same test `isAllocatedContext`), and a plugin handing over its
	 * own finished wire format carries none — so the escape hatch this test
	 * exists for is untouched.
	 */
	const isAllocation = Array.isArray(payload?.blocks)
	if (
		payload &&
		!isAllocation &&
		(payload.prompt !== undefined || payload.messages !== undefined)
	)
		return payload

	const rendered = payload?.rendered
	const messages = payload?.messages
	if (rendered === undefined && messages === undefined)
		throw new DispatchError(
			"the assembled context carried neither a rendered prompt nor a message array. " +
				"Assemble produces one or the other depending on the connection's prompt " +
				"format; receiving neither means the render step did not run."
		)

	return {
		prompt: rendered,
		messages,
		meta: {
			/**
			 * What the render ACTUALLY used, and only then what the connection
			 * says.
			 *
			 * This read `connection.promptFormat ?? "vicuna"` — a second
			 * resolution of a question Assemble had already answered, and for
			 * the whole of 0.6 to date an outright lie: nothing supplied the
			 * format to the render, so every prompt went out Vicuna while this
			 * line stamped the receipt with the connection's real format. A
			 * reader debugging a ChatML model saw "chatml" on a prompt wrapped
			 * in `### Assistant:`.
			 *
			 * Assemble now puts the value it rendered with on its own payload,
			 * so the receipt reports a fact rather than re-deriving one. The
			 * connection stays as the fallback for a payload that carries no
			 * such field — a plugin's own assembler, or a stored receipt
			 * replayed from before this existed.
			 *
			 * `promptFormatOf`, not `??`, at both ends: see its note.
			 */
			promptFormat: promptFormatOf(
				payload?.promptFormat || connection.promptFormat
			),
			// Null rather than invented. The pipeline knows which template *engine*
			// rendered this but not the config's display name, and a plausible-looking
			// wrong name in the debug panel is worse than an honest blank.
			templateName: null,
			timestamp: new Date().toISOString(),
			// The pipeline does not truncate by dropping text off the end; it allocates
			// a budget and records per block why each one was included or not. That
			// trail is in the receipt, which is strictly more than this field held.
			truncationReason: null,
			currentTurnCharacterId: meta.currentCharacterId ?? null,
			tokenCounts: {
				total: payload?.totalTokens ?? 0,
				limit: payload?.budget?.total ?? 0
			},
			sessionMessages: {
				included: countIncluded(payload, "history"),
				total: meta.messageCount ?? countIncluded(payload, "history"),
				includedIds: idsOf(payload, true),
				excludedIds: idsOf(payload, false)
			},
			sources: payload?.groups ?? {},
			/**
			 * What retrieval actually did, in the pipeline's own terms.
			 *
			 * This replaces the legacy `meta.rag` rather than reproducing it.
			 * Those fields — `messages.guaranteed`, `messages.ragOlder`,
			 * `messages.filledIn`, `lore.*.pinned` vs `.rag` — are counters for
			 * the *infill engine's internal phases*: a guaranteed window, then a
			 * RAG pass over older messages, then a fill pass. The pipeline has no
			 * such phases. It scores candidates, allocates a budget, and records
			 * per block why that block is in or out. Reporting the old numbers
			 * would mean inventing values for stages that do not run.
			 *
			 * What is here is strictly more than the counters were: every block
			 * considered, whether it made it, what it cost, and the reasoning
			 * trail that produced the decision — which is the question the panel
			 * existed to answer ("why isn't my lore showing up") rather than the
			 * aggregate it happened to display.
			 *
			 * `content` is deliberately omitted. It is already in the prompt this
			 * object carries, and a debug panel does not need a second copy of
			 * every lore entry travelling to the client.
			 */
			retrieval: {
				budget: payload?.budget ?? null,
				blocks: (payload?.blocks ?? []).map((b: any) => ({
					id: b.id,
					source: b.source,
					name: b.name ?? null,
					tokens: b.tokens,
					included: b.included,
					why: b.why ?? []
				}))
			}
		}
	}
}

const countIncluded = (payload: any, source: string): number =>
	(payload?.blocks ?? []).filter(
		(b: any) => b.included && b.source === source
	).length

const idsOf = (payload: any, included: boolean): number[] =>
	(payload?.blocks ?? [])
		.filter(
			(b: any) =>
				Boolean(b.included) === included && b.source === "history"
		)
		.map((b: any) => b.id)
		.filter((id: unknown): id is number => typeof id === "number")

/**
 * The instruction door: say it in words, because the connection has no field.
 *
 * The last thing in the prompt, on either wire, because the last thing is what a
 * model is answering. On a chat wire it is a `system` turn, which is the shape
 * the post-history reminder already takes; on a completion wire it is a line at
 * the end of the rendered string, where the model continues from.
 *
 * Applied to the COMPILED payload rather than to the assembled context, so the
 * two wires are one branch on a shape this module has already normalised.
 */
export function withJsonInstruction(compiled: any, instruction: string): any {
	if (Array.isArray(compiled?.messages))
		return {
			...compiled,
			messages: [
				...compiled.messages,
				{ role: "system", content: instruction }
			]
		}
	if (typeof compiled?.prompt === "string")
		return {
			...compiled,
			prompt: `${compiled.prompt.replace(/\s+$/, "")}\n\n${instruction}\n`
		}
	return compiled
}

/**
 * Media references → the bytes an adapter can put on a wire, in order.
 *
 * The read is the ORIGINAL (falling back to the display form when the original
 * has been culled — `readMedia`'s own default). The original is the highest
 * fidelity there is, and whether the provider will take that format is the
 * attachment engine's question to answer: it negotiates against what the
 * connection's type declares and converts only if it must. Asking for the
 * display variant instead would hand every backend a re-encode nobody asked
 * for, including the ones that would have taken the file as it is.
 *
 * ⚠ A reference that does not resolve is FATAL here, unlike the host's
 * `mediaParts`, which skips one. The difference is what is at stake at each
 * point: there, the images were already rendered and stored and failing the
 * write would throw the message away; here, nothing has been sent yet, and a
 * request that quietly went out without one of its files is indistinguishable
 * from a model ignoring it — the failure the whole attachment path is arranged
 * to prevent.
 *
 * Takes the handle as a parameter, the same posture `mediaParts` keeps next
 * door: `$lib/server/media` is imported lazily below, so no importer of the
 * dispatch path ends up with a live PGlite handle behind it.
 */
export async function resolveAttachments(
	db: Db,
	refs: readonly unknown[],
	scope: { sessionId: number; userId?: number }
): Promise<AttachmentInput[]> {
	if (!refs.length) return []

	// Imported HERE rather than at the top of the file: `$lib/server/media`
	// carries the db and the image codecs, and a run with no attachments — which
	// is every run until something puts refs on the port — should pay nothing
	// for them. Same shape the host uses for its own occasional imports.
	const { getMediaByUuid, readMedia } = await import("$lib/server/media")

	const inputs: AttachmentInput[] = []
	// Sequential and in list order, deliberately: the order is the contract, the
	// first bad reference is the one worth reporting, and thirty attachments are
	// not thirty concurrent disk reads.
	for (const [index, ref] of refs.entries()) {
		const at = `attachment ${index + 1}`
		const uuid =
			typeof ref === "string"
				? ref
				: typeof (ref as Record<string, unknown>)?.uuid === "string"
					? ((ref as Record<string, string>).uuid as string)
					: null
		if (!uuid)
			throw new DispatchError(
				`${at} is not a media reference — it carries no uuid, so there is nothing to load and ` +
					`nothing to send. A media port carries references; bytes never travel the graph.`
			)

		const file = await getMediaByUuid(db, uuid)
		if (!file)
			throw new DispatchError(
				`${at} names media ${uuid}, which this instance no longer has. It was deleted, or it was ` +
					`never here. The request is not sent without it.`
			)

		// The same ownership rule the host applies to media it posts into a
		// message, and for a sharper reason: this file is about to leave the
		// instance for a third-party API.
		const ownedHere =
			(file.sessionId != null && file.sessionId === scope.sessionId) ||
			(scope.userId != null && file.userId === scope.userId)
		if (!ownedHere)
			throw new DispatchError(
				`${at} names media ${uuid}, which belongs to neither this session nor the user this run is ` +
					`acting as, so it is not sent to a model on their behalf.`
			)

		const read = await readMedia(db, file.id)
		if (!read)
			throw new DispatchError(
				`${at} names media ${uuid}, whose row exists but whose bytes could not be read. The request is ` +
					`not sent without it.`
			)

		inputs.push({
			bytes: read.bytes,
			// What the stored representation ACTUALLY is, from the variant that
			// was read — not the file row's guess and not the ref's `mime` hint,
			// which describes the display variant and may not be what came back.
			mime: read.mime,
			...(file.filename ? { filename: file.filename } : {})
		})
	}

	return inputs
}

/**
 * The token accounting this generation reported, from whichever branch had it.
 *
 * ⚠ **Absent stays absent.** Only the keys a service actually named are put on
 * the result, so "this connection does not report reuse" never becomes a zero on
 * a receipt — the one way this number could actively mislead (see
 * `TextGenResult.tokensCached`).
 *
 * The non-streaming branch reports on the result object; a stream reports on its
 * last chunks and so lands on the adapter, the same seam `stopHit` uses. Result
 * first: an adapter that somehow filled both is answering about the request it
 * returned from.
 */
function usageOf(
	result: {
		tokensPrompt?: number
		tokensCached?: number
		tokensCacheWrite?: number
	},
	adapter: {
		streamedUsage?: {
			tokensPrompt?: number
			tokensCached?: number
			tokensCacheWrite?: number
		}
	}
): {
	tokensPrompt?: number
	tokensCached?: number
	tokensCacheWrite?: number
} {
	const streamed = adapter.streamedUsage ?? {}
	const out: Record<string, number> = {}
	for (const key of [
		"tokensPrompt",
		"tokensCached",
		"tokensCacheWrite"
	] as const) {
		// Named one at a time rather than merged wholesale: `result` is the
		// whole `TextGenResult`, and spreading it would carry the compiled
		// prompt and the completion into a field set that is meant to hold
		// three integers.
		const value = result[key] ?? streamed[key]
		if (typeof value === "number" && Number.isFinite(value))
			out[key] = value
	}
	return out
}

/**
 * The exchanges an adapter recorded, in the shape a receipt carries.
 *
 * One call answers as itself so the overwhelming case reads plainly; two or
 * more answer as a list, because a node that called twice and kept only the
 * last would report the second as the whole of what it did. An adapter that
 * recorded nothing answers with nothing, which is not the same as an empty
 * list.
 */
export function recordedWire(adapter: {
	exchanges?: readonly WireExchange[]
	lastExchange?: WireExchange
}): WireExchange | { calls: WireExchange[] } | undefined {
	const calls = adapter.exchanges ?? []
	if (calls.length > 1) return { calls: [...calls] }
	return calls[0] ?? adapter.lastExchange
}

/**
 * What the adapter carried of the sampling config, and what it could not.
 *
 * Read STRUCTURALLY and defensively, exactly like `recordedWire` above: a test
 * fake standing in for a model implements `generateText` and nothing else, and
 * a dispatch that required a base-class getter would fail on every one of them
 * for a reason that has nothing to do with what they are standing in for.
 *
 * Undefined when the adapter left nothing out, so a result from one that
 * carried everything is identical to what it always was.
 */
function samplingReportOf(adapter: {
	ignoredSamplers?: readonly string[]
	samplingReport?: { applied: Record<string, unknown>; ignored: string[] }
}):
	| { samplingApplied: Record<string, unknown>; samplingIgnored: string[] }
	| undefined {
	if (!adapter.ignoredSamplers?.length) return undefined
	const report = adapter.samplingReport
	return {
		samplingApplied: report?.applied ?? {},
		samplingIgnored: report?.ignored ?? [...adapter.ignoredSamplers]
	}
}

export async function dispatchGeneration(
	request: DispatchRequest
): Promise<DispatchResult> {
	if (!request.compiledPrompt)
		throw new DispatchError(
			"dispatch was given no prompt to send. A Provider with an empty payload would " +
				"generate from nothing and return something that reads like a model problem."
		)

	const session = await loadAdapterSession(request.db, request.sessionId)
	// Context and prompt only — the two legacy rows an adapter's constructor
	// still wants. Neither is a resolution tier: the prompt config's own
	// sampling column reaches the run through the world (`config/world.ts`)
	// and arrives here already resolved, and its connection column is read by
	// nothing (see the ⏳ note there).
	const { contextConfig, promptConfig } = await getUserConfigurations(
		request.userId as number
	)

	/**
	 * One resolution per run (R-8). The ids are the executor's answer; what
	 * the resolver adds is what only a database can — the rows, the model
	 * merged onto its endpoint, the capability check, the completion template
	 * and the wire mode — and the sentence naming the fix when the run
	 * resolved nothing. No session tier, no prompt-config tier: what is live
	 * of both is in the world now, and a second walk of them here is what let
	 * the request go to a connection the budget never saw.
	 */
	const target = await resolveCapabilityTarget(request.db, {
		capability: TEXT_CAPABILITY,
		pipelineConfig:
			request.connectionId != null || request.samplingId != null
				? {
						connectionId: request.connectionId ?? null,
						connectionModelId: request.connectionModelId ?? null,
						samplingConfigId: request.samplingId ?? null
					}
				: null,
		// Wording only (08 wording pass): "Chat" is `text->text`'s generic
		// label, which misnames this session's own genre when it is not the
		// standard one — see `CapabilityTargetRequest.genreId`.
		genreId: session.genreId
	})
	// The sentence comes from the resolver, which knows which tier failed and
	// what to do about it: nothing registered, a default cleared by a deleted
	// connection, a dangling id, a model that is switched off, a connection
	// that cannot do chat. It names no connection — the identity rides in
	// `problem.connection`, which the projection removes for everyone who may
	// not see it.
	if (!target.ok)
		throw new DispatchError(
			target.problem.message,
			target.problem.connection
		)
	const { connection } = target

	// The row is `{shape, values, enabled}`; an adapter takes the parameters
	// actually switched on, defaults applied — `resolveSampling` is the one
	// path between the two.
	const values = resolveSampling(target.sampling)
	const { Adapter } = await getConnectionAdapter(connection.type)
	const adapter = new Adapter({
		session: session as any,
		connection,
		sampling: values,
		contextConfig,
		promptConfig,
		currentCharacterId: request.currentCharacterId ?? null,
		tokenCounter: new TokenCounters(
			(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
		),
		// THE window (R-8): the same computation `core:task/context-budget@1`
		// sized the prompt with, off the same pair — the model's own window
		// where it states one, else the sampling config's. It was a literal
		// 4096 here, so LM Studio loaded every model at 4k whatever the config
		// said.
		tokenLimit: contextWindowFrom(values, connection),
		contextThresholdPercent: 0.8,
		generatingMessageMetadata: request.generatingMessageMetadata ?? {}
	})

	// The stop sequences, composed by the host and handed over (ruling
	// 2026-09-10).
	//
	// ⚠ Composed OUTSIDE the adapter, and that is the whole of the ruling: five
	// adapters each built their own list and applied their own wire rule, so a
	// completion template's role labels went out on Ollama's CHAT request —
	// where they override the model's native `<|im_end|>` and truncate the
	// reply — while OpenAI and llama.cpp deliberately withheld them and
	// KoboldCPP sent nothing at all. One composer cannot disagree with itself.
	//
	// `composeStopsFor` reads the connection's template and wire mode with the
	// same two expressions `BaseConnectionAdapter` evaluates for the RENDER, so
	// the markers a prompt is wrapped in and the strings it stops on cannot come
	// from two different resolutions.
	//
	// The payload rides along for the one question the chat wire asks of it: does
	// the message CONTENT carry `Name:` labels? `toCompiledPrompt` passes
	// `messages` through untouched on both of its branches, so reading it here —
	// before the conversion below — is the same array the adapter sends.
	const stops = composeStopsFor(connection, session, {
		currentCharacterId: request.currentCharacterId ?? null,
		explicit: request.stopSequences,
		messages:
			(
				request.compiledPrompt as {
					messages?: CompiledMessagesProbe
				} | null
			)?.messages ?? null
	})
	adapter.withStops(stops)

	// How this step is sent, when the author said. Handed over only for `off`:
	// `auto` is the adapter's own answer, so telling it to decide as it already
	// decides would be a second spelling of the same thing and a second place
	// for the per-service default to be re-litigated.
	if (request.streaming === "off") adapter.withStreaming("off")

	/**
	 * Structure, as far as this connection can carry it.
	 *
	 * Decided here because this is where the connection is — see
	 * `DispatchRequest.structured`. Three doors, and the weakest of them is a
	 * sentence in the prompt, which is why an absence costs fidelity rather than
	 * the step: every backend there is can be asked in words.
	 *
	 * The adapters already translate `responseFormat`/`responseSchema` into
	 * whatever their service calls it and ignore what it cannot express, so
	 * nothing below branches per backend.
	 */
	const structured: StructuredChoice | undefined = request.structured
		? chooseStructuredMode(storedCapabilities(connection), {
				schema: request.structured.schema
			})
		: undefined
	if (structured && structured.mode !== "instruction") {
		adapter.responseFormat = "json"
		// ⚠ Only on the schema door. On the `json_object` door the shape was
		// never asked for, and handing the adapter a schema it would then send
		// is the difference between the two doors.
		if (structured.mode === "schema")
			// The port carries arbitrary JSON and the adapters take a narrower
			// node: the llama.cpp family REFUSES what it cannot compile, and the
			// services that take a schema natively judge it themselves. Neither
			// answer is improved by this module pre-judging the document.
			adapter.responseSchema = request.structured!
				.schema as JsonSchemaNode
	}

	// After this line the adapter builds nothing. Everything below is the same
	// code the legacy path runs.
	const compiled = toCompiledPrompt(request.compiledPrompt, connection, {
		currentCharacterId: request.currentCharacterId ?? null
	})
	adapter.withCompiledPrompt(
		structured?.mode === "instruction"
			? withJsonInstruction(compiled, JSON_INSTRUCTION)
			: compiled
	)

	// The files this request carries, references turned into bytes — see the
	// header for why that is this module's job.
	const attachments = await resolveAttachments(
		request.db,
		request.attachments ?? [],
		{ sessionId: request.sessionId, userId: request.userId }
	)
	if (attachments.length) {
		// Two different questions, asked in the order they matter. First: has
		// somebody switched vision OFF for this connection? That is the user's
		// own setting, and `capabilityRefusal` is the app's single answer to it —
		// permissive on a row nobody has determined yet, so an untested
		// connection is not refused, and phrased in the words the connection
		// screen showed rather than in a transform id.
		const refusal = capabilityRefusal(connection, "text+image->text")
		if (refusal)
			throw new DispatchError(
				`${refusal} This request carries ${attachments.length} file${attachments.length === 1 ? "" : "s"}, ` +
					`which would have gone out unseen.`,
				connectionIdentity(connection)
			)

		// ⚠ Refused, never sent anyway. Most connection types whose API format
		// has vision have no adapter code that sends it, so handing the files
		// over would drop them silently — and a reply about files the model
		// never saw reads as the model ignoring them, not as this app losing
		// them. `consumesAttachments` is the adapter's own answer to "would I
		// send these", which is a different question from what the manifest
		// declares a connection may do.
		if (!adapter.consumesAttachments)
			// The connection TYPE is identity too (it names the administrator's
			// compute), so it rides in the field rather than in the sentence —
			// same rule, same key, one place that removes it.
			throw new DispatchError(
				`this request carries ${attachments.length} file${attachments.length === 1 ? "" : "s"}, and the ` +
					`configured adapter has no code that sends them. It would go out as text alone, and a reply ` +
					`about files the model never received is indistinguishable from a model ignoring them — so it is ` +
					`refused instead. Bind a connection whose adapter sends attachments.`,
				connectionIdentity(connection)
			)
		adapter.withAttachments(attachments)
	}

	/**
	 * The tools, handed over under the same two questions attachments are —
	 * and in the same order, for the same reason.
	 *
	 * First the user's own setting: `capabilityRefusal` is the app's single
	 * answer to "may this connection do that", permissive on a row nobody has
	 * determined yet so an untested connection is not refused. Then the purely
	 * mechanical one: is there code in this adapter class that would send
	 * them? A KoboldCPP connection grades `tools` as `emulated` — which is the
	 * PROMPT door, supplied by this app over a backend that never heard of
	 * tools and needing no adapter code at all — so a spec wiring native
	 * declarations at it is a wiring mistake worth reporting rather than a
	 * request to send stripped.
	 */
	const tools = request.tools ?? []
	if (tools.length) {
		const refusal = capabilityRefusal(connection, "tools")
		if (refusal)
			throw new DispatchError(
				`${refusal} This request offers ${tools.length} tool${tools.length === 1 ? "" : "s"}, ` +
					`which would have gone out unseen.`,
				connectionIdentity(connection)
			)

		if (!adapter.consumesTools)
			throw new DispatchError(
				`this request offers ${tools.length} tool${tools.length === 1 ? "" : "s"}, and the ` +
					`configured adapter has no code that sends them. The model would answer as if it had none, ` +
					`which is indistinguishable from it choosing not to call one — so it is refused instead. ` +
					`Wire the advertisement's prompt door instead, or bind a connection whose adapter sends tools.`,
				connectionIdentity(connection)
			)
		adapter.withTools(tools)
	}

	// An abort has to reach the adapter's own flag; the signal alone would stop
	// this function while the request kept running against the provider.
	const onAbort = () => adapter.abort()
	request.signal?.addEventListener("abort", onAbort, { once: true })

	/**
	 * The call itself, on the queue when the caller asked for it.
	 *
	 * The queue's own signal is deliberately unused: the run's abort reaches
	 * the adapter through `onAbort` above, and a stop that arrives while the
	 * item is still waiting reaches the queue as a cancel — one source, two
	 * shapes, the same rule `runQueuedLLMCall` follows.
	 */
	const generate = async () => {
		const queue = request.queue
		if (!queue) return await adapter.generateText()
		if (request.signal?.aborted)
			return { completionResult: "", isAborted: true } as Awaited<
				ReturnType<typeof adapter.generateText>
			>
		const { id, done } = llmQueue.enqueue(
			{
				taskType: queue.taskType,
				connectionName: connection.name ?? "connection",
				samplingName: target.sampling?.name ?? "default",
				sessionId: queue.sessionId,
				messageId: queue.messageId,
				userId: queue.userId,
				label: queue.label,
				// Both lifecycle hooks the base class always has, read
				// structurally like `recordedWire` reads its getters: a test
				// fake standing in for a model implements `generateText` and
				// nothing else, and a queue item that demanded the rest would
				// fail every one of them for a reason unrelated to the send.
				preflight:
					typeof adapter.preflight === "function"
						? (signal) => adapter.preflight(signal)
						: undefined,
				execute: () => adapter.generateText(),
				onCancel: () => {
					if (typeof adapter.abort === "function") adapter.abort()
				},
				onStatusChange: queue.onStatusChange
			},
			queue.queueItemId
		)
		const cancelQueued = () => llmQueue.cancel(id)
		request.signal?.addEventListener("abort", cancelQueued, { once: true })
		try {
			return await done
		} catch (err) {
			// The queue's own way of saying "stopped" — an item cancelled
			// while it waited, or force-detached after it ignored its abort.
			// A stop is an aborted call, never a service error.
			if (isQueueCancellation(err))
				return { completionResult: "", isAborted: true } as Awaited<
					ReturnType<typeof adapter.generateText>
				>
			throw err
		} finally {
			request.signal?.removeEventListener("abort", cancelQueued)
		}
	}

	try {
		const result = await generate()
		let text = ""
		let thinking = ""

		if (typeof result.completionResult === "function") {
			// Streaming. The chunks are forwarded *and* accumulated: the caller
			// may be driving a socket, and the pipeline still needs one value to
			// put on the port. Accumulating only would make the pipeline path
			// feel slower than the legacy one for the same model.
			await result.completionResult(
				(chunk: string) => {
					text += chunk
					request.onChunk?.(chunk)
				},
				(chunk: string) => {
					thinking += chunk
					request.onThinking?.(chunk)
				}
			)
			// `TextGenResult.thinkingContent` is documented as non-streaming
			// only — a streaming adapter delivers reasoning through the callback
			// above. Read anyway, as a fallback the contract says should never
			// fire: an adapter that populated both would otherwise have its
			// streamed half silently dropped here while the non-streaming branch
			// below reads the field. Note what this can and cannot be: the value
			// was captured when `generateText()` returned, i.e. before the stream
			// ran, so it can only ever carry a trace the adapter had in hand up
			// front.
			if (!thinking) thinking = result.thinkingContent ?? ""
		} else {
			text = result.completionResult ?? ""
			thinking = result.thinkingContent ?? ""
			// Non-streaming adapters return thinking in one piece rather than
			// through the callback, so it is forwarded here instead.
			if (thinking) request.onThinking?.(thinking)
			if (text) request.onChunk?.(text)
		}

		// The pipeline's own strip, and the reason no consumer of this function
		// has to have one. `text` goes on a port and from there into a lore
		// entry, a scene, a summary, a session message — durable records, every
		// one of them, with no later stage that could tell reasoning from what
		// the model meant to say. Reasoning already has a home on this result,
		// so nothing is lost by moving it there.
		//
		// The chunks forwarded above are deliberately NOT filtered: a sink is a
		// live view of the stream and the caller re-parses the accumulated
		// buffer anyway (see generateResponse). Filtering deltas would mean
		// parsing across chunk boundaries, which is the one thing the
		// accumulate-then-parse shape exists to avoid.
		const resolved = resolveThinking(text, thinking)

		/**
		 * The speaker boundary, held whatever the backend honoured.
		 *
		 * Several services ignore a stop list on their chat leg, and a model
		 * handed a labelled transcript continues it — the reply carries the next
		 * participant's line, which reads as this app writing both sides of the
		 * conversation. The labels come off `stops.sent`, so a request that asked
		 * for no speaker stop is cut by nothing.
		 *
		 * ⚠ After `resolveThinking`, never before: a reasoning trace is prose a
		 * model talks to itself in, and a `Name:` line inside one would otherwise
		 * take the real reply with it.
		 */
		const bounded = trimAtSpeakerBoundary(resolved.content, stops)

		return {
			text: bounded.text,
			thinking: resolved.thinking,
			// A streaming adapter reports `isAborted` as of the moment
			// `generateText()` returned — BEFORE the stream ran — so a stop
			// that landed mid-stream ends the stream early and reads as a
			// complete reply. The signal and the adapter's own flag know
			// better, and an aborted stream is an aborted call: the binding
			// halts on it, and the executor files the run as cancelled.
			isAborted:
				Boolean(result.isAborted) ||
				Boolean(request.signal?.aborted) ||
				Boolean((adapter as { isAborting?: boolean }).isAborting),
			via: connection.type,
			// Read AFTER the stream has been drained, which is why the hit is a
			// property on the adapter rather than a field on `TextGenResult`:
			// a streaming adapter only learns which sequence matched while the
			// loop above is running, long after `generateText()` returned.
			stops: {
				...stops,
				...(adapter.stopHit ? { hit: adapter.stopHit } : {}),
				...(bounded.trimmedAt ? { trimmedAt: bounded.trimmedAt } : {})
			},
			// Whatever the adapter read out of its own structured field. Absent
			// on every adapter with no tool code, which is what makes it safe
			// to read unconditionally.
			//
			// `streamedToolCall` is the SAME fact off the other branch, and it
			// is read here for the same reason `stopHit` is read here: a
			// streaming adapter only learns of the call while the loop above is
			// running, long after `generateText()` returned. Without it a
			// connection with `extraJson.stream` surfaced no call, the loop's
			// predicate never fired, and the loop ran to its ceiling.
			toolCall: result.toolCall ?? adapter.streamedToolCall ?? null,
			// What the adapter rendered this request into, and what the service
			// answered — absent on an adapter that recorded nothing, so a
			// result from one is byte-identical to what it always was.
			...(recordedWire(adapter) ? { wire: recordedWire(adapter) } : {}),
			// Which door, for a reader diagnosing an answer that did not keep
			// its shape. Absent on every request that asked for no structure.
			...(structured
				? {
						structured: {
							mode: structured.mode,
							capability: structured.capability
						}
					}
				: {}),
			// Read AFTER the send, like `stopHit` above: an adapter only learns
			// what it could not carry while it is building the request, and a
			// streaming one while the loop above is running. Omitted entirely
			// when nothing was left out.
			...(samplingReportOf(adapter) ?? {}),
			// Same seam, same reason: the accounting a stream reports arrives
			// on its last chunks. Recorded only — see `DispatchResult` above.
			...usageOf(result, adapter)
		}
	} finally {
		request.signal?.removeEventListener("abort", onAbort)
	}
}
