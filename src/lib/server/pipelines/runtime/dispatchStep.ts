/**
 * One prompt, one model call, one string back.
 *
 * Every step in the summarize and graph-build pipelines is the same shape: a
 * system prompt from the node's `prompts` slot, a user prompt built from its
 * input, and text out. `dispatch.ts` handles the *session* generation, which is a
 * different thing — it carries a compiled context, a streaming sink and a
 * speaking character. This is the simpler call the other eleven Providers make.
 *
 * ## It is the summarizer's own call, not a second implementation
 *
 * The adapter construction below mirrors `utils/summarizer/index.ts`'s
 * `runGeneration` deliberately, down to the minimal session it builds and the
 * `runQueuedLLMCall` it goes through. A near-miss would produce summaries that
 * differ from today's for reasons nobody could locate, which is exactly the
 * failure the parity discipline exists to prevent — so the same queue, the same
 * adapter, the same token counter.
 *
 * ## What the binding never sees
 *
 * The connection row, its URL, its key, its headers. A step binding hands over
 * an *id* and gets text back; resolving that id to credentials happens here, in
 * the substrate. Same line `dispatch.ts` draws, and for the same reason: a node
 * that could read a connection could exfiltrate one.
 */

import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import {
	ComposedError,
	connectionIdentity,
	type ConnectionIdentity
} from "$lib/server/connections/visibility"
import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { composeStopsFor } from "$lib/server/connections/stops"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { runQueuedLLMCall } from "$lib/server/utils/runQueuedLLMCall"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"

// db is the global Db — see db/types.d.ts

export interface StepCall {
	systemPrompt: string
	userPrompt: string
	/** The `connection` slot's resolved value — a `connections` row id. */
	connectionId?: number | null
	/**
	 * The MODEL half of the `connection` slot's pair (0114). Null means the
	 * endpoint's default model, which is what every slot authored before the
	 * split says and what every registration the backfill left behind means.
	 */
	connectionModelId?: number | null
	/** The `sampling` slot's resolved value — a `sampling_configs` row id. */
	samplingId?: number | null
	label?: string
	signal?: AbortSignal
}

/**
 * The session an adapter needs but this call does not have.
 *
 * Summarization has no conversation — it has a block of text and a question
 * about it. The adapters are written against a session, so one is fabricated with
 * the user prompt as its only message, exactly as the summarizer does today.
 * `sessionType: SUMMARIZE` is what keeps this out of the roleplay code paths.
 */
function minimalSession(userPrompt: string): any {
	const now = new Date().toISOString()
	return {
		id: 0,
		userId: 0,
		name: null,
		createdAt: now,
		updatedAt: now,
		scenario: null,
		metadata: null,
		lorebookId: null,
		isGroup: false,
		sessionType: SessionTypes.SUMMARIZE,
		groupReplyStrategy: null,
		sessionMessages: [
			{
				id: 1,
				sessionId: 0,
				role: "user",
				content: userPrompt,
				createdAt: now,
				isHidden: false,
				isGenerating: false,
				metadata: null
			}
		],
		lorebook: {
			id: 0,
			userId: 0,
			name: "",
			description: null,
			createdAt: now,
			updatedAt: now,
			lorebookBindings: []
		}
	}
}

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
export class StepDispatchError extends ComposedError {}

/** Run one step. Throws with a sentence a person can act on. */
export async function dispatchStep(
	db: Db,
	call: StepCall
): Promise<{ text: string; connection: ConnectionIdentity }> {
	call.signal?.throwIfAborted()

	// The one chain, not a fourth one of this file's own.
	//
	// This used to resolve its own fallback — `connectionId ?? system
	// .defaultConnectionId`, the column that no longer exists — and then ask
	// `capabilityRefusal` separately. Both moved into `resolveCapabilityTarget`,
	// which walks `capability default → pipeline config → session override` and
	// hands back either a row or the sentence. The slot value arrives here
	// already collapsed by the executor's scope chain, so it enters as the
	// pipelineConfig tier; the capability default underneath it is read from
	// `connection_defaults` in there, never here.
	//
	// A step whose connection was never chosen therefore no longer silently
	// borrows whatever the instance happens to hold: the instance default IS a
	// tier, and where nobody registered one the step refuses by name.
	const target = await resolveCapabilityTarget(db, {
		capability: TEXT_CAPABILITY,
		pipelineConfig: {
			connectionId: call.connectionId,
			connectionModelId: call.connectionModelId,
			samplingConfigId: call.samplingId
		}
	})
	if (!target.ok)
		throw new StepDispatchError(
			target.problem.message,
			target.problem.connection
		)
	const { connection, sampling } = target

	const AdapterClass = await getConnectionAdapter(connection.type)

	// The row is `{shape, values, enabled}`; what an adapter takes is the
	// parameters actually switched on, defaults applied. Everything below reads
	// those, so a key being present here *is* its switch being on — the row
	// itself is only good for identity (`name`, below).
	const values = resolveSampling(sampling)

	// The context window comes with the sampling config — it is a parameter of
	// the config, never a knob on the node (17 §1a). A step pointed at a config
	// with a different Context Tokens than its neighbours makes a local backend
	// reload the model between steps, which is why the shipped configs point
	// every step at the same one.
	//
	// ⚠ It used to read `(connection as any).tokenLimit ?? (connection as
	// any).contextSize` first. `connections` has never had either column, so
	// both were `undefined` on every row and the expression always fell through
	// to exactly the two terms left here — the reads were dead, and the cast is
	// what let them survive. Removing them changes nothing at runtime.
	// `summarizer/index.ts` and `graphBuilder.ts` carried the same dead pair
	// and have since had it removed too. What's left is why THIS file still
	// needs the fallback at all: `dispatchStep` injects a compiled prompt, and
	// `compilePrompt` returns early on `injectedPrompt` before it overwrites
	// `this.tokenLimit` with `getContextTokenLimit()` — so `dispatchStep` must
	// supply the real limit itself, whereas the summarizer's value is
	// superseded before any prompt is built.
	//
	// ⚠ The cast is what the dead reads were hiding, not something they fixed:
	// `ResolvedSampling` is `Record<string, unknown>` because
	// `resolveSamplingValues` passes stored values through untouched (coercion
	// is the WRITE path's, in `normalizeSamplingRow`), so this key is only a
	// number by the write path's convention. Asserted rather than guarded, to
	// keep behaviour byte-identical: a `typeof` test would send 4096 where a
	// row storing "8192" used to send the string on, which is a different
	// prompt budget and a decision for the sampling contract to make — the same
	// laundering `summarizer/index.ts` does with `: number` on the same value.
	//
	// ⚠ And ABOVE it, the MODEL's own window (0114) where one is set. That is
	// not a fourth knob on the node — 17 §1a's rule is that a step does not get
	// its own window, and a model having one is a fact about the model. It is
	// null on every row the 0114 backfill created, so this is byte-identical
	// until somebody sets one, and it is the ONE place the column is read:
	// `summarizer/index.ts` and `graphBuilder.ts` pin 4096 outright and their
	// own comments say widening them is a decision for those contracts.
	const tokenLimit: number = (connection.contextWindow ??
		values.contextTokens ??
		4096) as number
	const maxTokens = values.responseTokens ?? 512

	// The connection's own configured tokenizer, not a global default — the
	// identical fix `generateResponse.ts` and `graphBuilder.ts` both carry. A
	// mismatched counter makes the budget wrong in the direction that truncates.
	const tokenCounter = new TokenCounters(
		connection.tokenCounter || TokenCounterOptions.ESTIMATE
	)

	const adapter = new AdapterClass.Adapter({
		connection,
		sampling: { ...values, maxTokens },
		// Cast rather than filled in: the adapter's types want whole rows, and a
		// step has neither a context config nor a prompt config — it has one
		// system prompt. The summarizer passes real rows here only because it
		// happens to have them; nothing in this call path reads any other field.
		contextConfig: {} as any,
		promptConfig: { systemPrompt: call.systemPrompt } as any,
		session: minimalSession(call.userPrompt),
		currentCharacterId: null,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent: 0.9
	})

	// Composed once and handed over — an adapter builds none of its own (ruling
	// 2026-09-10). A step's session is minimal and has no cast, so this is the
	// connection's completion template alone.
	adapter.withStops(
		composeStopsFor(connection, minimalSession(call.userPrompt))
	)

	const result = await runQueuedLLMCall({
		adapter,
		taskType: "summarize_batch",
		connectionName: connection.name,
		samplingName: sampling?.name ?? "default",
		label: call.label,
		signal: call.signal
	})

	if (result.isAborted) {
		// The expected path — our own signal really was aborted.
		call.signal?.throwIfAborted()
		// Aborted without a matching cancellation is the queue or adapter
		// stopping for a reason of its own. Not dressed up as a cancellation:
		// that label means "the user stopped this", and callers key on it.
		throw new StepDispatchError(
			"the model call stopped unexpectedly — it reported being aborted with no matching cancellation",
			connectionIdentity(connection)
		)
	}

	// The connection TYPE, under the key the projection removes. It used to be a
	// bare `via` string, which landed in the node's receipt output and answered
	// "which provider ran this" for anyone who could read their own run — a
	// non-admin included. A field can be taken away; a string in a receipt
	// cannot.
	return { text: result.text, connection: connectionIdentity(connection) }
}
