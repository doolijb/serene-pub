import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"
import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { getConnectionAdapter } from "./getConnectionAdapter"
import type { BaseConnectionAdapter } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { getUserConfigurations } from "./getUserConfigurations"
import { resolveSampling } from "./resolveSampling"
import { broadcastToSessionUsers } from "../sockets/utils/broadcastHelpers"
import { ComposedError } from "$lib/server/connections/visibility"
import { buildGraphContext } from "./graphContextFormatter"
import { llmQueue, isQueueCancellation } from "./llmQueue"
import {
	persistGenerationStage,
	persistGenerationErrorRow
} from "./generationStatus"
import { resolveTaskConfig } from "./resolveTaskConfig"
import { resolveNarratorPromptConfig } from "./resolveNarratorPromptConfig"
import {
	autoEnqueueSession,
	ensureSessionMessageEmbedded
} from "$lib/server/embedding/vectorizationQueue"
import { buildThinkingMetadata } from "$lib/server/messages/thinkingMetadata"
import { joinContinuation } from "$lib/server/messages/continuation"
import { resolveThinking } from "$lib/shared/utils/thinkingDelimiters"
import {
	trimAtSpeakerBoundary,
	type ComposedStops,
	type ReplyTrim
} from "$lib/server/connections/stops"
import { streamingModeFrom } from "$lib/server/connections/streaming"
import type { Receipt } from "@serene-pub/sdk"
import type { ReplyOutcome } from "$lib/server/pipelines/runtime/receipts"

/**
 * The `params` slot as the run resolved it for the generate node.
 *
 * ⚠ Read off the RECEIPT, and only this path has to. A reply on the adapter
 * road halts at the pre-call substrate (`preview: true`), so
 * `core:provider/generate-text@1`'s binding — the reader of
 * `params.stopSequences` on every other path, the multi-stage road included —
 * never runs. What does happen before the halt is `resolveInput`, whose output the
 * executor records as the node's `input`; so the value an author set is on the
 * receipt even though nothing consumed it there.
 *
 * Undefined is not a failure: `resolveInput` resolves only the config keys a
 * spec NAMES, so a spec that does not name this node's `params` slot leaves
 * nothing here to read (`paramsSlotWiring.test.ts` is what keeps the shipped
 * ones honest about it).
 */
function generateNodeParams(receipt: Receipt): Record<string, unknown> | null {
	const node = receipt.nodes?.find((n) =>
		n.typeId?.startsWith("core:provider/generate-text")
	)
	const params = (node?.input as { params?: unknown } | undefined)?.params
	return params && typeof params === "object"
		? (params as Record<string, unknown>)
		: null
}

/** What the adapter reported about the call it just made. Absent stays absent — see `recordGenerateCacheUsage`. */
interface GenerateCacheUsage {
	tokensPrompt?: number
	tokensCached?: number
	tokensCacheWrite?: number
	/**
	 * What the model wrote, as the service counted it — the other half of what
	 * a reply cost, and the only one the prompt-cache row has no place for. It
	 * rides here because one read (`usageToRecord`) answers for both patches.
	 */
	tokensCompletion?: number
	/**
	 * How much of that the model spent reasoning, where the service breaks it
	 * out. A BREAKDOWN of `tokensCompletion` and never an addition to it, so
	 * nothing sums the two.
	 */
	tokensReasoning?: number
}

type GenerateExecuteResult = (
	| { kind: "silentFail" }
	| { kind: "normal"; isAborted: boolean }
) & {
	usage?: GenerateCacheUsage
	/** The reply as it reached the row, for the receipt's record of it. */
	text?: string
}

export async function generateResponse({
	socket,
	emitToUser,
	sessionId,
	userId,
	generatingMessage
}: {
	socket: any
	emitToUser: (event: string, data: any) => void
	sessionId: number
	userId: number
	generatingMessage: SelectSessionMessage
}): Promise<boolean> {
	// A session whose mode disappeared is read-only (19 §6): every generation
	// path — trigger, continue, regenerate, swipe, narrator — funnels through
	// here, so this one guard is the whole rule. The standard mode is the F29
	// floor, so ordinary sessions can never trip it. Checked before the "queued"
	// write so the message row never flips to generating.
	{
		const { sessionGenreAvailable } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const modeCheck = await sessionGenreAvailable(db, sessionId)
		if (!modeCheck.available) {
			await persistGenerationErrorRow(
				socket.io,
				generatingMessage.sessionId,
				generatingMessage.id,
				new ComposedError(modeCheck.reason)
			)
			return false
		}
	}

	// Get the current message content before updating
	const currentMessage = await db.query.sessionMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
	})
	const preservedContent = currentMessage?.content || ""

	// Build cleared metadata: wipe thinking for the current swipe slot so the
	// client doesn't show stale thinking from a previous generation.
	const existingMeta = (currentMessage?.metadata as any) || {}
	const existingSwipes = existingMeta?.swipes
	let clearedMeta: any = { ...existingMeta, thinking: null }
	if (existingSwipes && Array.isArray(existingSwipes.history)) {
		const idx = existingSwipes.currentIdx ?? 0
		const thinkingHistory: (string | null)[] = [
			...(existingSwipes.thinkingHistory || [])
		]
		while (thinkingHistory.length < existingSwipes.history.length)
			thinkingHistory.push(null)
		thinkingHistory[idx] = null
		clearedMeta = {
			...clearedMeta,
			swipes: { ...existingSwipes, thinkingHistory }
		}
	}

	// Initial write: enter the pipeline as "queued" — no queue item exists yet.
	await updateLegacyWhere(
		db,
		eq(schema.sessionMessages.id, generatingMessage.id),
		{
			isGenerating: true,
			generationStage: "queued",
			error: null,
			content: preservedContent, // Preserve existing content for continue
			queueItemId: null,
			metadata: clearedMeta
		}
	)

	const req: Sockets.SessionMessage.Call = {
		sessionMessage: {
			...generatingMessage,
			isGenerating: true,
			generationStage: "queued",
			error: null,
			content: preservedContent, // Use existing content
			queueItemId: null,
			metadata: clearedMeta
		}
	}

	await broadcastToSessionUsers(
		socket.io,
		generatingMessage.sessionId,
		"sessionMessage",
		req
	)

	// Update local reference so buildThinkingMetadata works from the cleared state
	generatingMessage = { ...generatingMessage, metadata: clearedMeta }

	// Determine if we're continuing an existing message
	const isContinuing = preservedContent.length > 0

	const session = await db.query.sessions.findFirst({
		where: (c, { eq }) => eq(c.id, sessionId),
		with: {
			sessionCharacters: {
				with: {
					character: true
				}
			},
			sessionPersonas: {
				with: {
					persona: true
				}
			},
			sessionMessages: {
				// Always exclude the generating message from history
				where: (cm, { ne }) => ne(cm.id, generatingMessage.id),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			lorebook: {
				with: {
					lorebookBindings: {
						with: { character: true, persona: true }
					}
					// The three entry lists used to be loaded here and are
					// not any more: `BasePromptSession.lorebook` never
					// declared them, and nothing read them — every lore read
					// goes through the host's `lorebook_entries` query, which
					// applies the character-lore privacy rule the raw lists
					// never did.
				}
			}
		}
	})

	if (!session) {
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.sessionId,
			generatingMessage.id,
			new ComposedError("Session not found.")
		)
		return false
	}

	/**
	 * ⚠ `(session as any)._continuationPrefill = preservedContent` stood here,
	 * and **nothing read it** — not the legacy builder, not the pipeline, not
	 * anything. So the reasoning it carried (use the partial as the seed's
	 * prefill rather than as a duplicate message; a second assistant entry means
	 * two consecutive assistant turns on a chat endpoint and a wrongly-closed
	 * block on a completion one) was correct and had no implementation behind
	 * it: a continue sent an EMPTY seed line, got a fresh reply, and the join
	 * below glued the partial on afterwards.
	 *
	 * It is a real port now — `runTurn`'s `continuationPrefill`, wired below —
	 * so the reasoning lives where the value travels.
	 */

	// Context/prompt config from user settings. Connection and sampling come from
	// resolveTaskConfig alone (session override → prompt config override → the
	// instance's text->text default) — this used to also take a `defaultSampling`
	// off the same instance row and `??` it in below, which was a fourth tier
	// that agreed with the third only because both read one column.
	const { contextConfig, promptConfig } = await getUserConfigurations(userId)

	// Narrator response: a manually-triggered, non-character narration/environment
	// message — uses its own "Session Prompts: Narrator" config instead of the
	// session's normal prompt config. The session's own override (set via Edit Session)
	// wins over the user's active/system-default pick — see
	// resolveNarratorPromptConfig.ts.
	const isNarratorResponseMode = !!generatingMessage.isNarratorResponse
	/**
	 * The side character speaking this turn, if the trigger named one (ruling
	 * 2026-09-07). Read off the row rather than recomputed: the trigger
	 * resolved it — including whether the lorebook knows them — before this
	 * message existed, and a second resolution here would be free to disagree
	 * with the name already snapshotted on the row.
	 *
	 * ⚠ It changes which pipeline runs and nothing about the rotation. The row
	 * is still `isNarratorResponse` with a null `characterId`, which is what
	 * keeps it out of `getNextCharacterTurn`.
	 */
	const sideCharacter =
		(isNarratorResponseMode &&
			((generatingMessage.metadata as any)?.speaker as
				| {
						name: string
						characterId: number | null
						known: boolean
						character?: Record<string, unknown> | null
				  }
				| undefined)) ||
		null
	const narratorPromptConfig = isNarratorResponseMode
		? await resolveNarratorPromptConfig(session, userId)
		: null

	if (isNarratorResponseMode && !narratorPromptConfig) {
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.sessionId,
			generatingMessage.id,
			new ComposedError(
				"No Narrator prompt config configured. Set one up under Session Prompts: Narrator in Settings."
			)
		)
		return false
	}

	/**
	 * Which spec serves this turn, and which of the two reply roads it takes.
	 *
	 * Resolved HERE, above the connection, because the road is the spec's
	 * property and the second road resolves its connections per stage — each
	 * Provider owns its own `connection` and `sampling` slots, which is the whole
	 * point of a genre being able to put a small model on the planner and a large
	 * one on the prose. Resolving one connection first and then discarding it
	 * would be this function asserting a single-model turn.
	 */
	const { NARRATE_SPEC_ID, NARRATE_CHARACTER_SPEC_ID } = await import(
		"$lib/server/pipelines/specs/narrate"
	)
	const { RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	// Function routing (19 §3, U-C3): the trigger names a function, the
	// mode's contributors answer it — respond from the bucket, narrate
	// from the narrate spec's own contributed trigger. The hardcoded
	// spec choice is gone; what remains hardcoded is the *flag* naming
	// the function, which dies with the trigger-driven UI (U-C5). A null
	// resolution (registry never synced) falls to the F29 floor — routing
	// failing degrades to built-in behaviour, never blocks the turn.
	const { resolveFunctionVerdict, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	// Three functions now (ruling 2026-09-07): the narrator split into
	// world narration and side-character narration, and which one this
	// turn is comes from the row the trigger wrote — a named speaker means
	// the second. Still routed through `resolveFunctionSpec`, so a genre
	// that binds its own spec to either function still wins.
	//
	// ⚠ **Four now**, and the fourth is a message verb rather than a
	// button. Continue is its own trigger identity (ruling 2026-09-08,
	// D-2): it is not a resume point in the `respond` turn, it is a turn of
	// its own that happens to start from text. Keying it separately is what
	// lets a genre bind `continue` to a spec of its own — the floor stays
	// `respond`, because respond is the spec carrying the
	// `continuationPrefill` port, so a genre that says nothing gets exactly
	// today's behaviour.
	const functionKey = isNarratorResponseMode
		? sideCharacter
			? "narrate-character"
			: "narrate"
		: isContinuing
			? "continue"
			: "respond"
	const floorSpecId = isNarratorResponseMode
		? sideCharacter
			? NARRATE_CHARACTER_SPEC_ID
			: NARRATE_SPEC_ID
		: RESPOND_SPEC_ID
	/**
	 * The verdict, not the slug (ruled 2026-09-10): a preset binding that
	 * stopped resolving must not refuse the reply, and the run it falls
	 * back to must be able to say what it substituted. Anything else stays
	 * exactly as it was — the slug still wins, the floor still catches a
	 * null.
	 */
	const routed = await resolveFunctionVerdict(
		db,
		(session as any).genreId ?? STANDARD_GENRE_ID,
		functionKey,
		// The binding selects (19 §3, simplified 2026-08-24): this
		// session's choice among the eligible, else the instance's,
		// before the companion default.
		{ sessionId }
	)
	const specId = routed.spec ?? floorSpecId
	const runMeta = routed.fallback
		? { meta: { preset: { via: "fallback" as const, ...routed.fallback } } }
		: {}

	/**
	 * The second road (see `runReplyToCompletion`), taken on the shape of the
	 * document and never on the genre id.
	 *
	 * A document that will not load is not a routing decision: the run below
	 * raises the sentence that names which pipeline is missing and what to check,
	 * which is a better answer than this branch inventing one.
	 */
	{
		const { loadPublished } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const { runsToCompletion } = await import(
			"$lib/server/pipelines/runtime/specShape"
		)
		const doc = await loadPublished(db, specId).catch(() => null)
		if (doc && runsToCompletion(doc)) {
			const { runReplyToCompletion } = await import(
				"$lib/server/utils/runReplyToCompletion"
			)
			return await runReplyToCompletion({
				socket,
				emitToUser,
				sessionId,
				userId,
				generatingMessage,
				specId,
				doc,
				// Narrator mode keeps a null speaker here for the same reason the
				// adapter path does: the row is narration, and only the RUN's
				// scope learns who is talking.
				currentCharacterId: isNarratorResponseMode
					? (sideCharacter?.characterId ?? null)
					: (generatingMessage.characterId ?? null),
				speaker: sideCharacter,
				continuationPrefill: isContinuing
					? preservedContent
					: undefined,
				label: functionKey,
				...runMeta
			})
		}
	}

	const resolved = isNarratorResponseMode
		? await resolveTaskConfig({
				taskType: "narratorPrompt",
				narratorPromptConfigId: narratorPromptConfig!.id,
				sessionId
			})
		: await resolveTaskConfig({
				taskType: "session",
				promptConfigId: promptConfig?.id,
				sessionId
			})
	const connection = resolved.connection
	// The adapter takes VALUES, not the row: resolveSampling() keeps only the
	// keys `enabled` names, fills them from the shape's declared defaults, and
	// hands over a flat object — so a key being present is the switch being on.
	// The row stays behind in `resolved`, which is where the queue's
	// samplingName label comes from.
	const sampling = resolveSampling(resolved.sampling)

	if (!connection) {
		// The resolver's own sentence, which names WHICH way it failed —
		// nothing registered, a default cleared by a deleted connection, a
		// dangling id, or a connection that cannot do chat — and which screen
		// fixes it. The old line said "Please set up a connection first" for all
		// four, including to people who plainly had one set up.
		// `ComposedError`, so the sentence survives to the row rather than being
		// replaced by the opaque one: it is ours, and it names no connection —
		// `resolveCapabilityTarget` puts the identity in `problem.connection`,
		// which the projection removes for everyone who may not see it.
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.sessionId,
			generatingMessage.id,
			new ComposedError(
				resolved.problem?.message ??
					"No AI connection configured. Please set up a connection first.",
				resolved.problem?.connection
			)
		)
		return false
	}

	const { Adapter } = await getConnectionAdapter(connection.type)

	// Honor the connection's own configured tokenizer (set in the connection
	// form) rather than always forcing the crude length-based estimate —
	// every adapter constructor already has a `tokenCounter ||
	// connection.tokenCounter` fallback for exactly this, but passing a
	// truthy value here unconditionally short-circuited it, so a user who
	// picked a precise tokenizer to size context correctly never actually
	// got it for a real generation (only for the prompt-preview path, which
	// already resolves this correctly — see sessions.ts's
	// `sessions:promptTokenCount` handler for the same pattern).
	const tokenCounter = new TokenCounters(
		(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
	)
	const tokenLimit = 4096
	const contextThresholdPercent = 0.8

	// Fetch contextDebuggingEnabled from system settings
	const sysSettings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { contextDebuggingEnabled: true }
	})
	const contextDebuggingEnabled =
		sysSettings?.contextDebuggingEnabled ?? false

	// Get fresh metadata from the generating message — isNarratorResponse
	// rides along here rather than as a separate adapter constructor param;
	// see the comment on isNarratorResponseMode in BaseConnectionAdapter.ts
	// for why.
	const generatingMessageMetadata = {
		...((generatingMessage.metadata as any) || {}),
		isNarratorResponse: isNarratorResponseMode
	}

	// sessionCharacters/sessionPersonas rows can have a null character/persona when
	// the linked row was deleted (the FK is nullable, onDelete: "set null") —
	// filter those out since there's nothing left to prompt-build from, and
	// BasePromptSession (shared by every adapter) requires the relation to be
	// populated for the rows it does list.
	const adapterSession = {
		...session,
		sessionCharacters: (session.sessionCharacters ?? []).filter(
			(cc): cc is typeof cc & { character: SelectCharacter } =>
				cc.character !== null
		),
		sessionPersonas: (session.sessionPersonas ?? []).filter(
			(cp): cp is typeof cp & { persona: SelectPersona } =>
				cp.persona !== null
		)
	}

	const adapter = new Adapter({
		session: adapterSession,
		connection: connection,
		sampling: sampling,
		contextConfig: contextConfig,
		promptConfig: isNarratorResponseMode
			? narratorPromptConfig!
			: promptConfig,
		currentCharacterId: isNarratorResponseMode
			? null
			: generatingMessage.characterId!,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		generatingMessageMetadata
	})
	// The context-debugging flag used to switch on the legacy builder's own
	// diagnostics. The pipeline records a decision per block unconditionally —
	// it is in the receipt whether anyone is looking or not — so there is
	// nothing to toggle here any more. The setting still gates the *panel*,
	// client-side, which is where it was always visible from.
	void contextDebuggingEnabled

	/**
	 * The run this turn compiled under, and the stop list it composed — kept out
	 * here so the `hit` can be added once the generation has actually happened.
	 * Null only if the pipeline block below somehow did not reach the compose.
	 */
	let stopsRecord: {
		runId: string
		stops: import("$lib/server/connections/stops").ComposedStops
	} | null = null

	/**
	 * The pipeline compiles every reply. There is no toggle and no fallback
	 * (ruling 2026-08-19): a failure here fails the turn the same way any other
	 * generation error does, with the receipt saying where it stopped. Falling
	 * back to the legacy builder would mean a user with a configured pipeline
	 * silently getting a reply built by something else — the one bug in this
	 * area nobody can see. The legacy builder below survives only as dispatch
	 * scaffolding and as `pipeline:compare`'s second arm.
	 *
	 * Only the *prompt* changes hands. The run compiles a payload and injects it
	 * at `withCompiledPrompt` — the one seam every adapter funnels through — so
	 * queueing, streaming, persistence, swipes and thinking extraction below are
	 * untouched legacy code. That is the whole reason the switch is one call
	 * rather than a rewrite of this file.
	 *
	 * ⚠ This is the road for a spec with ONE Provider on the spine, which is
	 * every reply this product shipped before Adventure. A spec with several
	 * left above, at `runsToCompletion`: the halt below would stop at its FIRST
	 * stage and send the planner's prompt as the reply.
	 */
	{
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runTurn({
			db,
			sessionId,
			userId,
			/**
			 * ⚠ The side character's id reaches the RUN but never the row.
			 *
			 * It is what makes character lore bound to them visible: the
			 * host's `lorebook_entries` read gates character lore on the run's
			 * scope, so naming the speaker here is the whole of "a route for
			 * perspective into the chat session". The *name and the card* take
			 * a different road — the `speaker` port below — because a free-form
			 * name has no id to travel on at all.
			 *
			 * `adapter.currentCharacterId` stays null in narrator mode, so the
			 * legacy stop-string exclusion and the stored message are
			 * unchanged; only the pipeline's scope learns who is speaking.
			 */
			currentCharacterId:
				sideCharacter?.characterId ?? adapter.currentCharacterId,
			speaker: sideCharacter,
			/**
			 * ⚠ Was `preservedContent || ""`, which on a **continue** made the
			 * partial reply the turn's triggering text — the one thing the
			 * ruling of 2026-09-08 (D-2) says it must never be.
			 *
			 * It is now what an ordinary turn passes, which is the empty string:
			 * every other entry to this function clears the row's content before
			 * calling (send, regenerate, swipe), so `preservedContent` was
			 * non-empty exactly when `isContinuing` was true and this expression
			 * only ever meant "the partial, on a continue". A session turn has no
			 * separate triggering text on this path at all — the user's message
			 * is a row, read from history like every other row — so the honest
			 * value is the one a fresh reply already passes.
			 */
			text: "",
			// The partial, on the port that carries it to the seed line the
			// model continues from. Absent on every other turn.
			continuationPrefill: isContinuing ? preservedContent : undefined,
			specId,
			/**
			 * The row this turn is writing into — created by the trigger,
			 * filled in by the adapter below.
			 *
			 * ⚠ Without it the run recorded **no output at all for every reply
			 * this product has ever generated**: the run halts at the pre-call
			 * substrate (see `preview` below), so no Consumer commits and the
			 * host writes nothing down. It also decides `is_preview` — a run
			 * that produced something is not a preview, whatever the executor
			 * was asked to do — which is what `pipelines:sessionEntryUsage` and
			 * `lastRunFor` both filter on and both saw nothing through.
			 *
			 * `created` even though the row already exists as a placeholder:
			 * the artifact says which message THIS run produced, and an empty
			 * generating row is not a message anyone has read.
			 */
			artifacts: [
				{
					kind: "message" as const,
					entityId: generatingMessage.id,
					action: "created" as const
				}
			],
			// Stops at the pre-call substrate with the real payload: the
			// adapter below is what actually sends it.
			preview: true,
			// A reply reached through a substitution says so on its own
			// receipt — the one place the run inspector already reads.
			...runMeta
		})

		// `PreviewReport.context.rendered` is Assemble's allocation record; the
		// unwrap accepts either the record or its rendered string, and
		// `toCompiledPrompt` bridges both to the adapter's shape.
		const rendered = receipt.preview?.context.rendered as
			| { rendered?: unknown }
			| undefined
		const compiled = rendered?.rendered ?? rendered
		// A preview *halts* at the pre-call substrate by design, so a non-ok
		// outcome only means failure when it arrived without a payload.
		if (!compiled)
			// Composed here, from a receipt whose `haltReason` is composed too —
			// every sentence that can reach it names no connection by
			// construction (`capabilityRefusal`, the three dispatchers).
			throw new ComposedError(
				`the pipeline could not compile this turn: ${receipt.outcome}` +
					(receipt.haltNodeKey
						? ` at '${receipt.haltNodeKey}'`
						: "") +
					(receipt.haltReason ? ` — ${receipt.haltReason}` : "")
			)

		const { toCompiledPrompt } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		const payload = toCompiledPrompt(rendered, connection, {
			currentCharacterId: adapter.currentCharacterId
		})
		adapter.withCompiledPrompt(payload)

		/**
		 * The stop sequences, composed ONCE and handed to the adapter (ruling
		 * 2026-09-10).
		 *
		 * ⚠ **This path needs its own call, and that is not a second
		 * composition point.** `dispatchGeneration` composes for every run whose
		 * Provider node actually fires; a REPLY halts at the pre-call substrate
		 * (`preview: true` above) and the adapter below is what sends. All five
		 * adapter-construction sites in this app call the ONE composer — one
		 * function, one wire rule — rather than the adapters composing for
		 * themselves, which is what five of THEM used to do and disagree about.
		 * `connections/stopsWiring.test.ts` is what keeps the five honest.
		 * Without this call the primary path would send no stop sequences at
		 * all.
		 *
		 * The author's own list comes off the run that just halted: the
		 * executor resolves a node's input BEFORE the preview halt and records
		 * it, so `params.stopSequences` is on the receipt even though the
		 * binding never ran.
		 */
		const { composeStopsFor } = await import(
			"$lib/server/connections/stops"
		)
		const stops = composeStopsFor(connection, adapterSession, {
			currentCharacterId: adapter.currentCharacterId,
			explicit: generateNodeParams(receipt)?.stopSequences,
			// The payload about to be sent, for the chat wire's inline-label
			// question: the context template renders `{{{name}}}: {{{message}}}`
			// into the message CONTENT, and a transcript labelled that way is one
			// a model continues for both sides unless the labels stop it.
			messages: payload?.messages
		})
		adapter.withStops(stops)

		// How the author wants this step sent, off the same slot the stop
		// sequences came from. Handed over only for `off`, because `auto` is the
		// adapter's own answer — see `withStreaming`.
		if (streamingModeFrom(generateNodeParams(receipt)?.streaming) === "off")
			adapter.withStreaming("off")

		// The receipt was written by `runTurn` before this function composed
		// anything, so the stops are patched onto the generate node afterwards
		// — see `recordGenerateStops` for why that is honest rather than a
		// rewrite of history. Never allowed to fail the turn, like every other
		// receipt write.
		const { recordGenerateStops } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		stopsRecord = { runId: receipt.runId, stops }
		await recordGenerateStops(db, receipt.runId, stops)
	}

	// Inject narrative graph context into system instructions (if lorebook + node
	// present) — skipped for Narrator response, which has no character perspective
	// of its own to build graph context from.
	//
	// This used to append directly to adapter.promptBuilder.instructions,
	// but that field is only ever set inside PromptBuilder.buildContextData(),
	// which runs later — inside compilePrompt(), called from within
	// adapter.generateText() — so it was always undefined here and this
	// injection silently never reached the model. Setting
	// graphContextInstructions on the adapter instead lets
	// BaseConnectionAdapter.compilePrompt() merge it into extraInstructions
	// once instructions actually exists, the same mechanism
	// narratorInstructions already uses for the equivalent per-trigger-note
	// case.
	if (!isNarratorResponseMode && session?.lorebookId) {
		try {
			const graphCtx = await buildGraphContext({
				sessionId,
				lorebookId: session.lorebookId,
				speakerCharacterId: generatingMessage.characterId ?? null,
				speakerPersonaId: null
			})
			if (graphCtx) {
				adapter.graphContextInstructions = graphCtx
			}
		} catch (err) {
			console.warn(
				"[generateResponse] graph context injection failed:",
				err
			)
		}
	}

	const currentCharacter = session?.sessionCharacters?.find(
		(cc) => cc.character?.id === adapter.currentCharacterId
	)

	const charName = isNarratorResponseMode
		? (generatingMessage.metadata as any)?.narratorName ||
			narratorPromptConfig?.narratorName ||
			"Narrator"
		: currentCharacter?.character?.nickname ||
			currentCharacter?.character?.name ||
			""

	// If message already has content, we're continuing it
	// Include the existing content in the startString so LLM continues from there
	// Use preservedContent which was fetched from the database earlier
	const existingContent = preservedContent || ""
	const startString = existingContent
		? charName
			? `${charName}: ${existingContent}`
			: existingContent
		: charName
			? `${charName}:`
			: ""

	/**
	 * Where this reply is allowed to end, carried into the queue item and back.
	 *
	 * The composed list is what decides — `trimAtSpeakerBoundary` reads the
	 * `speaker` entries off it — so a turn whose stops were held back is cut by
	 * nothing, and the two halves of one rule cannot disagree about who is in the
	 * scene.
	 */
	const boundary: {
		stops: ComposedStops | null
		speakerName: string
		trimmedAt?: ReplyTrim
	} = { stops: stopsRecord?.stops ?? null, speakerName: charName }

	/**
	 * What the adapter did with the payload, onto the receipt the run stored
	 * before the send.
	 *
	 * ⚠ Called on every road out of the queue below, and on the one that never
	 * reaches it. The stored receipt says `halt` at the pre-call substrate until
	 * this states what happened after it — see `recordReplyOutcome`.
	 */
	const recordReply = async (outcome: ReplyOutcome) => {
		if (!stopsRecord) return
		const { recordReplyOutcome } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		await recordReplyOutcome(db, stopsRecord.runId, {
			finishReason: adapter.finishReason,
			elapsedMs: adapter.lastExchange?.response.durationMs,
			...outcome
		})
	}

	// Persist the queue item id BEFORE enqueueing so it's never possible for a
	// run to be active/started while the row still shows queueItemId: null —
	// closes the race where a very-fast Stop click finds nothing to cancel.
	const queueItemId = uuidv4()
	/**
	 * ⚠ Fenced on `isGenerating`, and a failed claim ends the turn.
	 *
	 * A Stop can land while the pipeline above is still compiling, which is a
	 * stretch of seconds. `sessionMessages:cancel` releases the ROW first and
	 * cancels the queue item second — and there is no queue item yet, so the row
	 * is the only thing carrying that decision. A write that cannot claim it is
	 * a turn nobody wants any more: sending anyway produces a generation nothing
	 * in this app can reach or abort, whose eventual failure lands on whatever
	 * the row is doing by then.
	 */
	const [claimed] = await updateLegacyWhere(
		db,
		and(
			eq(schema.sessionMessages.id, generatingMessage.id),
			eq(schema.sessionMessages.isGenerating, true)
		),
		{ queueItemId }
	)
	if (!claimed) {
		await recordReply({
			result: "cancelled",
			reason: "stopped before the request went out"
		})
		return false
	}

	const { done } = llmQueue.enqueue<GenerateExecuteResult>(
		{
			taskType: isNarratorResponseMode ? "narratorPrompt" : "session",
			connectionName: resolved.connectionName,
			samplingName: resolved.samplingName,
			sessionId,
			messageId: generatingMessage.id,
			label: isNarratorResponseMode ? "Narrator" : charName || undefined,
			userId,
			preflight: (signal) => adapter.preflight(signal),
			execute: (signal) =>
				runGenerateAndPersist({
					signal,
					adapter,
					socket,
					sessionId,
					generatingMessage,
					startString,
					isContinuing,
					preservedContent,
					contextDebuggingEnabled,
					queueItemId,
					boundary
				}),
			onCancel: () => adapter.abort(),
			onStatusChange: (status) =>
				persistGenerationStage(
					generatingMessage.id,
					generatingMessage.sessionId,
					socket.io,
					status
				)
		},
		queueItemId
	)

	/**
	 * What the adapter put on the wire, patched onto the receipt once the send
	 * has happened.
	 *
	 * ⚠ Called on both roads out of the queue. A request that failed is the one
	 * a reader most wants to see, and the record exists from the moment the
	 * adapter built it — an adapter that never sent anything recorded nothing,
	 * and the patch is a no-op on that.
	 */
	const recordWire = async () => {
		if (!stopsRecord) return
		const { recordedWire } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		// The same shaping the pipeline road uses, so one call reads as itself
		// and several read as a list wherever the receipt is read from.
		const wire = recordedWire(adapter)
		if (!wire) return
		const { recordGenerateWire } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		await recordGenerateWire(db, stopsRecord.runId, wire)
	}

	try {
		const result = await done
		await recordWire()

		/**
		 * What actually ended the reply, once there is something to name.
		 *
		 * ⚠ A SECOND write, and only when there is something new to say. The
		 * list itself was recorded before the request went out, because a turn
		 * that fails mid-generation is exactly the turn whose stop list somebody
		 * wants to read. Neither of these can be known until afterwards: the hit
		 * comes from the one service that reports the word rather than a reason
		 * code (llama.cpp's `stopping_word` — see
		 * `BaseConnectionAdapter.stopHit`), and `trimmedAt` says where this app
		 * had to cut a reply the backend ran past. So the common case stays one
		 * write.
		 */
		if ((adapter.stopHit || boundary.trimmedAt) && stopsRecord) {
			const { recordGenerateStops } = await import(
				"$lib/server/pipelines/runtime/receipts"
			)
			await recordGenerateStops(db, stopsRecord.runId, {
				...stopsRecord.stops,
				...(adapter.stopHit ? { hit: adapter.stopHit } : {}),
				...(boundary.trimmedAt ? { trimmedAt: boundary.trimmedAt } : {})
			})
		}

		/**
		 * Prompt-cache usage, patched on for the same reason `stopHit` above is:
		 * the receipt was stored before the adapter sent anything, so nothing has
		 * reported what this call cost until now. `result.usage` is already
		 * "absent stays absent" from `usageToRecord`, so a service that said
		 * nothing makes no write at all rather than a write of undefined.
		 */
		if (result.usage && stopsRecord) {
			const { recordGenerateCacheUsage } = await import(
				"$lib/server/pipelines/runtime/receipts"
			)
			await recordGenerateCacheUsage(db, stopsRecord.runId, result.usage)
		}

		if (result.kind === "silentFail") {
			await recordReply({
				result: "err",
				reason: "the message row moved on before the reply could be written"
			})
			return false
		}

		const { isAborted } = result
		await recordReply(
			isAborted
				? {
						result: "cancelled",
						reason: "stopped while the adapter was sending"
					}
				: {
						result: "ok",
						text: result.text,
						tokensPrompt: result.usage?.tokensPrompt,
						tokensCompletion: result.usage?.tokensCompletion,
						tokensReasoning: result.usage?.tokensReasoning
					}
		)

		// Fetch the updated message for the response
		const updatedMsg = await db.query.sessionMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
		})
		// `personaMessageReceived` used to be emitted here as well. Nothing has
		// ever listened for it: it appears nowhere else in the tree, it is in
		// neither `types.ts` nor `typedSocket.ts`, and `Layout.svelte`'s
		// `onAny` catch-all returns early on any event that does not end in
		// `:error`. The broadcast below carries the same row to the same
		// person, so the emit was a second copy nobody read.
		await broadcastToSessionUsers(
			socket.io,
			updatedMsg!.sessionId,
			"sessionMessage",
			{
				sessionMessage: updatedMsg!
			}
		)

		return !isAborted // Whether there were no interruptions
	} catch (err) {
		await recordWire()
		/**
		 * ⚠ The ADAPTER's own flag counts as a cancellation too, not just the
		 * queue's error class. A stop reaches the adapter first (`onCancel` →
		 * `abort()`), and the stream it was reading can fail on the way down
		 * from that abort — a service that closes a stream without its final
		 * frame raises inside the client rather than resolving. That failure is
		 * the stop, and a stop is never written up as a service error.
		 */
		if (isQueueCancellation(err) || adapter.isAborting) {
			// The cancel handler already flipped isGenerating/queueItemId/error on
			// the row — a user-initiated stop isn't a failure worth reporting.
			await recordReply({
				result: "cancelled",
				reason: "stopped while the adapter was sending"
			})
			return false
		}
		/**
		 * The receipt's reason obeys the rule `persistGenerationErrorRow`
		 * states: our own words are shown as written, and a service's are not.
		 * A run row is served to whoever owns it, admin or not, and a service
		 * message carries the base URL it failed against. The whole diagnostic
		 * is on the message row's `connection.detail` and in the recorded wire,
		 * both administrator-only.
		 */
		await recordReply({
			result: "err",
			reason:
				err instanceof ComposedError
					? err.message
					: "the service reported an error"
		})
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.sessionId,
			generatingMessage.id,
			err,
			queueItemId
		)
		return false
	}
}

/**
 * Runs adapter.generateText(), consumes streaming or non-streaming output, and
 * persists it to the message row — this is the LLM queue item's execute()
 * body. Errors thrown here are caught by llmQueue and surfaced to the
 * caller's `done` promise.
 */
async function runGenerateAndPersist({
	signal,
	adapter,
	socket,
	sessionId,
	generatingMessage,
	startString,
	isContinuing,
	preservedContent,
	contextDebuggingEnabled,
	queueItemId,
	boundary
}: {
	signal: AbortSignal
	/**
	 * Typed, not `any`.
	 *
	 * It was `any`, which is how `adapter.generate()` below survived the rename
	 * to `generateText()` without a single compile error — the one call site in
	 * the app that would have failed at runtime, in the middle of a user's turn,
	 * with "adapter.generate is not a function". Every other caller was caught by
	 * the compiler. The class is abstract and the action is abstract on it, so
	 * this costs nothing and closes that hole permanently.
	 */
	adapter: BaseConnectionAdapter
	socket: any
	sessionId: number
	generatingMessage: SelectSessionMessage
	startString: string
	isContinuing: boolean
	preservedContent: string
	contextDebuggingEnabled: boolean
	// Fences every write this run makes: a user-initiated stop nulls
	// queueItemId on the row immediately and unconditionally (see
	// sessionMessagesCancelHandler). Streaming adapters invoke their per-chunk
	// callback fire-and-forget, so several writes from this run can still be
	// in flight after cancellation — gating every write on this exact id
	// guarantees none of them can resurrect isGenerating:true after the row
	// has moved on, regardless of timing. Message-stop status must never be
	// contingent on whether the upstream LLM actually stops in time.
	queueItemId: string
	/**
	 * Where this reply ends, and where it reports having ended.
	 *
	 * ⚠ In AND out. `stops` and `speakerName` decide the cut; `trimmedAt` is
	 * written back for the receipt patch the caller makes once the turn is over —
	 * the same seam `adapter.stopHit` uses, and for the same reason: the receipt
	 * was stored before the adapter sent anything, so nothing has reported this
	 * until now.
	 */
	boundary: {
		stops: ComposedStops | null
		speakerName: string
		trimmedAt?: ReplyTrim
	}
}): Promise<GenerateExecuteResult> {
	// Generate completion
	let {
		completionResult,
		compiledPrompt,
		isAborted,
		thinkingContent: adapterThinking,
		tokensPrompt,
		tokensCached,
		tokensCacheWrite,
		tokensCompletion,
		tokensReasoning
	} = await adapter.generateText() // TODO: save compiledPrompt to sessionMessages
	/**
	 * The non-streaming result's own numbers, merged with what a STREAMING
	 * request reported — `adapter.streamedUsage` only finishes filling once the
	 * stream below has drained, so this is read lazily at each return rather
	 * than once here. Result first, same order `dispatch.ts`'s `usageOf` uses:
	 * an adapter that filled both is answering about the request it returned
	 * from.
	 */
	function usageToRecord(): GenerateCacheUsage | undefined {
		const streamed = adapter.streamedUsage ?? {}
		const usage: GenerateCacheUsage = {}
		const prompt = tokensPrompt ?? streamed.tokensPrompt
		const cached = tokensCached ?? streamed.tokensCached
		const cacheWrite = tokensCacheWrite ?? streamed.tokensCacheWrite
		const completion = tokensCompletion ?? streamed.tokensCompletion
		const reasoning = tokensReasoning ?? streamed.tokensReasoning
		if (typeof prompt === "number") usage.tokensPrompt = prompt
		if (typeof cached === "number") usage.tokensCached = cached
		if (typeof cacheWrite === "number") usage.tokensCacheWrite = cacheWrite
		if (typeof completion === "number") usage.tokensCompletion = completion
		if (typeof reasoning === "number") usage.tokensReasoning = reasoning
		return Object.keys(usage).length ? usage : undefined
	}
	let content = ""
	/**
	 * Reasoning the ADAPTER separated for us, via `thinkingCb`. Named for its
	 * source on purpose: the inline parser must never write here, or the two
	 * questions "did we get native reasoning" and "is the buffer clean" collapse
	 * back into one variable and the strip starts skipping frames again.
	 */
	let nativeThinking = ""

	/**
	 * The speaker boundary, applied to the model's own text and nothing else.
	 *
	 * ⚠ Always AFTER `resolveThinking`. A reasoning trace is prose a model talks
	 * to itself in, and a `Name:` line inside one would otherwise take the real
	 * reply with it. Always BEFORE `joinContinuation`, because the preserved half
	 * is the user's text rather than this generation's.
	 *
	 * The last frame wins: a stream is cut at the same place on every frame it is
	 * visible, so the row never grows past the boundary and the reader never
	 * watches a runaway arrive and then vanish.
	 */
	const bound = (text: string): string => {
		if (!boundary.stops) return text
		const cut = trimAtSpeakerBoundary(
			text,
			boundary.stops,
			boundary.speakerName
		)
		// Assigned rather than accumulated, absent included: the row's content
		// and the receipt's account of it are the SAME pass, and a frame that
		// cut inside an unclosed reasoning block must not outlive the closed
		// one that does not.
		boundary.trimmedAt = cut.trimmedAt
		return cut.text
	}

	if (typeof completionResult === "function") {
		let ok = true
		// Without this, every single streamed chunk (often several per
		// second, sometimes per token) did its own DB UPDATE...RETURNING plus
		// a socket broadcast to every user in the session — for a 200-500 token
		// response that's 200-500 round trips of both. A ~120ms cadence is
		// well below what's perceptible as "smooth streaming" to a reader,
		// so this only cuts wasted work, not visible responsiveness. The
		// unconditional final persist after the stream ends (below) always
		// flushes the last chunk's content regardless of this throttle, so
		// nothing streamed is ever lost — only some *intermediate* frames
		// are skipped.
		const STREAM_PERSIST_THROTTLE_MS = 120
		let lastPersistedAt = 0
		await completionResult(
			async (chunk: string) => {
				if (!ok || signal.aborted) {
					return
				}
				content += chunk
				const now = Date.now()
				if (now - lastPersistedAt < STREAM_PERSIST_THROTTLE_MS) {
					return
				}
				lastPersistedAt = now

				let stagedContent = content.replace(startString, "")
				// If stagedContent length is <= startString, remove partial startString
				if (stagedContent.length <= startString.length) {
					// Check if content starts with startString substring
					if (
						content.startsWith(
							startString.substring(0, stagedContent.length)
						)
					) {
						stagedContent = ""
					}
				}

				// When continuing, the LLM sees the partial message in history
				// and generates a continuation. We should append the new content
				// to the existing partial content.
				let stagedForDisplay = stagedContent.trim()

				// Runs on EVERY frame, whatever `nativeThinking` holds. The
				// guard that used to stand here asked "did we get native
				// reasoning yet" and used the answer to decide whether to clean
				// the buffer — two different questions, and the inline path
				// wrote its result into the very variable being tested. So the
				// first frame carrying a closed block disabled the strip for
				// every frame after it, and the raw markup rode the last frame
				// into the `content` column. `resolveThinking` separates them:
				// the buffer is always cleaned, native reasoning only wins the
				// trace.
				const resolved = resolveThinking(
					stagedForDisplay,
					nativeThinking
				)
				stagedForDisplay = bound(resolved.content)

				// One seam, and only one — `joinContinuation` states what each
				// wire mode actually does with the prefill and why the model
				// echoing it is a normal outcome rather than a fault.
				const finalContent = isContinuing
					? joinContinuation(preservedContent, stagedForDisplay)
					: stagedForDisplay

				// --- SWIPE HISTORY + THINKING LOGIC (mid-stream) ---
				// Through the same builder the final write uses, with the same
				// content the `content` column is about to get. Mid-stream used
				// to hand the raw buffer to `history[idx]` while the column got
				// the stripped text; on abort the mid-stream write is the last
				// one to land (the final write is fenced out by the
				// isGenerating/queueItemId predicate), so swiping away and back
				// reintroduced markup the column had already lost.
				const currentThinking = resolved.thinking
				let updateData: any = {
					content: finalContent,
					isGenerating: true
				}
				const midStreamMeta = buildThinkingMetadata(
					generatingMessage.metadata,
					finalContent,
					currentThinking,
					true
				)
				if (midStreamMeta !== null) {
					updateData = { ...updateData, metadata: midStreamMeta }
				}

				const [updatedSessionMsg] = await updateLegacyWhere(
					db,
					and(
						eq(schema.sessionMessages.id, generatingMessage.id),
						eq(schema.sessionMessages.isGenerating, true),
						eq(schema.sessionMessages.queueItemId, queueItemId)
					),
					updateData
				)
				if (!!updatedSessionMsg) {
					// Removed verbose streaming log
					const sessionMsgReq: Sockets.SessionMessage.Call = {
						sessionMessage: updatedSessionMsg
					}
					await broadcastToSessionUsers(
						socket.io,
						generatingMessage.sessionId,
						"sessionMessage",
						sessionMsgReq
					)
				} else if (signal.aborted) {
					// Fenced out by a user-initiated stop — the cancel handler already
					// reset and owns this row's state. Not an error; stay quiet.
					ok = false
				} else {
					const sessionMsgReq: Sockets.SessionMessage.Call = {
						id: generatingMessage.id
					}
					await broadcastToSessionUsers(
						socket.io,
						generatingMessage.sessionId,
						"sessionMessage",
						sessionMsgReq
					)
					console.warn(
						"[generateResponse] Generating terminated early",
						generatingMessage.id
					)
					ok = false
				}
			},
			(thinkingChunk: string) => {
				nativeThinking += thinkingChunk
			}
		)

		// Final update: mark as not generating, clear queueItemId
		content = content.replace(startString, "").trim()

		// Stripped BEFORE the continue-prefix is applied, exactly as the
		// mid-stream frames do it. The order matters for the prefilled-close
		// shape: joined first, a bare `</think>` in the model's new text would
		// read the user's existing message as the preamble and move it into the
		// thinking pane. The model's own output is the only thing the parser
		// should ever see.
		const finalResolved = resolveThinking(content, nativeThinking)
		content = bound(finalResolved.content)

		// When continuing, append to existing content — through the same seam
		// the mid-stream frames above use, so the last frame and the final write
		// cannot disagree about the join.
		if (isContinuing) {
			content = joinContinuation(preservedContent, content)
		}

		// Build final metadata with thinking + swipe history in sync
		const finalThinking = finalResolved.thinking
		let finalMetadata: any = buildThinkingMetadata(
			generatingMessage.metadata,
			content,
			finalThinking,
			true // write content to swipe history
		)
		// debugMeta persists the actual compiled prompt/messages alongside the
		// stats meta — without them, "Prompt Details" has nothing to browse
		// after the fact (only the aggregate counts survive), since the raw
		// compiledPrompt otherwise only lives in memory for this one request.
		const streamingDebugMetaValue =
			contextDebuggingEnabled && compiledPrompt?.meta
				? {
						...compiledPrompt.meta,
						prompt: compiledPrompt.prompt,
						messages: compiledPrompt.messages
					}
				: null
		const streamingDebugMeta = streamingDebugMetaValue
			? { debugMeta: streamingDebugMetaValue }
			: {}
		const ret = await updateLegacyWhere(
			db,
			and(
				eq(schema.sessionMessages.id, generatingMessage.id),
				eq(schema.sessionMessages.isGenerating, true),
				eq(schema.sessionMessages.queueItemId, queueItemId)
			),
			{
				content,
				isGenerating: false,
				generationStage: null,
				queueItemId: null,
				error: null,
				...(finalMetadata !== null ? { metadata: finalMetadata } : {}),
				...streamingDebugMeta
			}
		)
		if (!ret || ret.length === 0) {
			if (signal.aborted) {
				// Cancelled — the cancel handler already reset this row; this run's
				// own completion write is stale and correctly a no-op.
				return {
					kind: "normal",
					isAborted: true,
					usage: usageToRecord()
				}
			}
			console.error(
				"[generateResponse] Failed to update generating message:",
				generatingMessage.id
			)
			return { kind: "silentFail", usage: usageToRecord() }
		}
		// Broadcast the sessionMessage to all session participants
		await broadcastToSessionUsers(
			socket.io,
			generatingMessage.sessionId,
			"sessionMessage",
			{
				sessionMessage: {
					...generatingMessage,
					content,
					isGenerating: false,
					generationStage: null,
					queueItemId: null,
					error: null,
					...(finalMetadata !== null
						? { metadata: finalMetadata }
						: {}),
					debugMeta: streamingDebugMetaValue
				}
			}
		)
		try {
			await ensureSessionMessageEmbedded(generatingMessage.id)
		} catch (err) {
			// Swallowing here is load-bearing, not decorative: autoEnqueueSession()
			// below must still run even if the inline embed failed or timed out —
			// it's the fallback that eventually catches this message up via the
			// background queue either way.
			console.error(
				"[vectorization] Inline embed of new message failed:",
				err
			)
		}
		autoEnqueueSession(sessionId).catch(console.error)
		return {
			kind: "normal",
			isAborted,
			usage: usageToRecord(),
			text: content
		}
	} else {
		content = completionResult.replace(startString, "").trim()

		// Stripped unconditionally and before the continue-prefix, for the same
		// two reasons as the streaming branch above: `adapterThinking` answers
		// where the trace came from, never whether the text needs cleaning, and
		// the parser must only ever see the model's own output.
		const nonStreamResolved = resolveThinking(content, adapterThinking)

		// When continuing, append to existing content — the same seam again.
		const nonStreamBounded = bound(nonStreamResolved.content)
		const nonStreamContent = isContinuing
			? joinContinuation(preservedContent, nonStreamBounded)
			: nonStreamBounded

		// --- SWIPE HISTORY + THINKING LOGIC (non-streamed) ---
		const nonStreamThinking = nonStreamResolved.thinking
		const nonStreamMeta = buildThinkingMetadata(
			generatingMessage.metadata,
			nonStreamContent,
			nonStreamThinking,
			true // write content to swipe history
		)
		const nonStreamDebugMetaValue =
			contextDebuggingEnabled && compiledPrompt?.meta
				? {
						...compiledPrompt.meta,
						prompt: compiledPrompt.prompt,
						messages: compiledPrompt.messages
					}
				: null
		const nonStreamDebugMeta = nonStreamDebugMetaValue
			? { debugMeta: nonStreamDebugMetaValue }
			: {}
		let updateData: any = {
			content: nonStreamContent,
			isGenerating: false,
			generationStage: null,
			queueItemId: null,
			error: null,
			...(nonStreamMeta !== null ? { metadata: nonStreamMeta } : {}),
			...nonStreamDebugMeta
		}

		const ret = await updateLegacyWhere(
			db,
			and(
				eq(schema.sessionMessages.id, generatingMessage.id),
				eq(schema.sessionMessages.isGenerating, true),
				eq(schema.sessionMessages.queueItemId, queueItemId)
			),
			updateData
		)
		if (!ret || ret.length === 0) {
			if (signal.aborted) {
				// Cancelled — the cancel handler already reset this row; this run's
				// own completion write is stale and correctly a no-op.
				return {
					kind: "normal",
					isAborted: true,
					usage: usageToRecord()
				}
			}
			console.error(
				"[generateResponse] Failed to update generating message:",
				generatingMessage.id
			)
			return { kind: "silentFail", usage: usageToRecord() }
		}
		await broadcastToSessionUsers(
			socket.io,
			generatingMessage.sessionId,
			"sessionMessage",
			{
				sessionMessage: {
					...generatingMessage,
					content: nonStreamContent,
					isGenerating: false,
					generationStage: null,
					queueItemId: null,
					error: null,
					...(updateData.metadata
						? { metadata: updateData.metadata }
						: {}),
					debugMeta: nonStreamDebugMetaValue
				}
			}
		)
		try {
			await ensureSessionMessageEmbedded(generatingMessage.id)
		} catch (err) {
			// Swallowing here is load-bearing, not decorative: autoEnqueueSession()
			// below must still run even if the inline embed failed or timed out —
			// it's the fallback that eventually catches this message up via the
			// background queue either way.
			console.error(
				"[vectorization] Inline embed of new message failed:",
				err
			)
		}
		autoEnqueueSession(sessionId).catch(console.error)
		return {
			kind: "normal",
			isAborted,
			usage: usageToRecord(),
			text: nonStreamContent
		}
	}
}
