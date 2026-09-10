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
 * What comes back is the completion, whether it was aborted, and token counts.
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

import { resolveTaskConfig } from "$lib/server/utils/resolveTaskConfig"
import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import type { AttachmentInput } from "$lib/server/adapters/attachments"
import type { MediaRef } from "@serene-pub/sdk"
import {
	ComposedError,
	connectionIdentity
} from "$lib/server/connections/visibility"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import {
	composeStopsFor,
	type ComposedStops
} from "$lib/server/connections/stops"
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
	 * Tier 2 — what the pipeline's configuration selected for THIS node.
	 *
	 * Forwarded from the `connection` and `sampling` slots on the calling
	 * provider node, exactly as `generate-image` already forwards them. Without
	 * these the chat path resolved from the capability default alone, so the
	 * panel's own Connection and Sampling pickers on the reply node changed
	 * nothing an admin could observe — the middle tier of
	 * `capability default → pipeline config → session override` simply was not
	 * there for the primary path.
	 */
	connectionId?: number | null
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
	/** Called with each chunk when the adapter streams. */
	onChunk?: (chunk: string) => void
	onThinking?: (chunk: string) => void
	signal?: AbortSignal
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
	 */
	stops: ComposedStops & { hit?: string }
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

export async function dispatchGeneration(
	request: DispatchRequest
): Promise<DispatchResult> {
	if (!request.compiledPrompt)
		throw new DispatchError(
			"dispatch was given no prompt to send. A Provider with an empty payload would " +
				"generate from nothing and return something that reads like a model problem."
		)

	const isNarrator = Boolean(
		request.generatingMessageMetadata?.isNarratorResponse
	)

	const session = await loadAdapterSession(request.db, request.sessionId)
	// Context and prompt only. This used to also take `sampling` and pass it
	// below as `resolved.sampling ?? defaultSampling` — an undeclared FOURTH
	// tier, and a no-op only for as long as both sides read
	// `system_settings.default_sampling_id`. `resolveTaskConfig` walks the whole
	// chain now, so a second opinion here could only ever disagree with it.
	const { contextConfig, promptConfig } = await getUserConfigurations(
		request.userId as number
	)

	// The same resolver the legacy path uses, so a session-level connection
	// override or a per-config one applies identically on both paths. Resolving
	// it again here rather than threading it through the pipeline is deliberate:
	// see the header.
	const resolved = await resolveTaskConfig({
		taskType: isNarrator ? "narratorPrompt" : "session",
		promptConfigId: promptConfig?.id,
		sessionId: request.sessionId,
		// Tier 2, forwarded from the calling node's own slots. `resolveTaskConfig`
		// hands these to `resolveCapabilityTarget` so all three tiers are walked
		// by the one resolver rather than two of them here and one elsewhere.
		pipelineConnectionId: request.connectionId ?? null,
		pipelineSamplingId: request.samplingId ?? null
	})

	const connection = resolved.connection
	// The sentence comes from the resolver, which knows which tier failed and
	// what to do about it. The one that used to be here — "Set one up under
	// Connections" — was the same words for four different situations: nothing
	// registered, a default cleared by a deleted connection, a dangling id, and
	// a connection that cannot do chat. `resolveTaskConfig` carries the right
	// one forward; the fallback is only for a caller that never set `problem`.
	//
	// The `capabilityRefusal` that used to sit under this is inside the resolver
	// too, so a session override pointing at an image connection is refused by
	// name rather than by `getConnectionAdapter` saying the type has no adapter.
	if (!connection)
		throw new DispatchError(
			resolved.problem?.message ??
				"no AI connection is configured, so there is nothing to send this prompt to.",
			resolved.problem?.connection
		)

	const { Adapter } = await getConnectionAdapter(connection.type)
	const adapter = new Adapter({
		session: session as any,
		connection,
		// Both of these are rows. An adapter takes the parameters, not the row —
		// only the keys switched on, with the shape's defaults filled in — and
		// `resolveSampling` is the one path between the two.
		sampling: resolveSampling(resolved.sampling),
		contextConfig,
		promptConfig,
		currentCharacterId: request.currentCharacterId ?? null,
		tokenCounter: new TokenCounters(
			(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
		),
		tokenLimit: 4096,
		contextThresholdPercent: 0.8,
		generatingMessageMetadata: request.generatingMessageMetadata ?? {}
	})

	// The stop sequences, composed ONCE and handed over (ruling 2026-09-10).
	//
	// ⚠ Composed HERE rather than in the adapter, and the difference is the
	// whole of the ruling: five adapters each built their own list and applied
	// their own wire rule, so a completion template's role labels went out on
	// Ollama's CHAT request — where they override the model's native
	// `<|im_end|>` and truncate the reply — while OpenAI and llama.cpp
	// deliberately withheld them and KoboldCPP sent nothing at all. One
	// composition point cannot disagree with itself.
	//
	// The template is dereferenced the same way `BaseConnectionAdapter`
	// dereferences it, so the markers the prompt is wrapped in and the strings
	// it stops on cannot come from two different resolutions.
	const stops = composeStopsFor(connection, session, {
		currentCharacterId: request.currentCharacterId ?? null,
		explicit: request.stopSequences
	})
	adapter.withStops(stops)

	// After this line the adapter builds nothing. Everything below is the same
	// code the legacy path runs.
	adapter.withCompiledPrompt(
		toCompiledPrompt(request.compiledPrompt, connection, {
			currentCharacterId: request.currentCharacterId ?? null
		})
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

	// An abort has to reach the adapter's own flag; the signal alone would stop
	// this function while the request kept running against the provider.
	const onAbort = () => adapter.abort()
	request.signal?.addEventListener("abort", onAbort, { once: true })

	try {
		const result = await adapter.generateText()
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

		return {
			text: resolved.content,
			thinking: resolved.thinking,
			isAborted: Boolean(result.isAborted),
			via: connection.type,
			// Read AFTER the stream has been drained, which is why the hit is a
			// property on the adapter rather than a field on `TextGenResult`:
			// a streaming adapter only learns which sequence matched while the
			// loop above is running, long after `generateText()` returned.
			stops: {
				...stops,
				...(adapter.stopHit ? { hit: adapter.stopHit } : {})
			}
		}
	} finally {
		request.signal?.removeEventListener("abort", onAbort)
	}
}
