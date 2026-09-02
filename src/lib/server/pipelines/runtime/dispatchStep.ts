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

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { resolveSampling } from "$lib/server/utils/resolveSampling"
import { runQueuedLLMCall } from "$lib/server/utils/runQueuedLLMCall"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"

export interface StepCall {
	systemPrompt: string
	userPrompt: string
	/** The `connection` slot's resolved value — a `connections` row id. */
	connectionId?: number | null
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
 * Resolve a step's connection and sampling config.
 *
 * The slot value where the config selected one, and the instance default
 * otherwise. Falling back rather than failing is deliberate: a namespace whose
 * connection has never been chosen should run on whatever the instance runs on,
 * which is what every user expects the first time they press Summarize.
 */
async function resolveTarget(
	db: any,
	connectionId?: number | null,
	samplingId?: number | null
) {
	const [system] = await db.select().from(schema.systemSettings).limit(1)

	const connId = connectionId ?? system?.defaultConnectionId
	const sampId = samplingId ?? system?.defaultSamplingConfigId

	const [connection] = connId
		? await db
				.select()
				.from(schema.connections)
				.where(eq(schema.connections.id, connId))
				.limit(1)
		: []

	const [sampling] = sampId
		? await db
				.select()
				.from(schema.samplingConfigs)
				.where(eq(schema.samplingConfigs.id, sampId))
				.limit(1)
		: []

	return { connection, sampling }
}

export class StepDispatchError extends Error {}

/** Run one step. Throws with a sentence a person can act on. */
export async function dispatchStep(
	db: any,
	call: StepCall
): Promise<{ text: string; via?: string }> {
	call.signal?.throwIfAborted()

	const { connection, sampling } = await resolveTarget(
		db,
		call.connectionId,
		call.samplingId
	)

	if (!connection)
		throw new StepDispatchError(
			"no connection is set for this step and the instance has no default " +
				"connection either. Choose one in the pipeline's configuration, or " +
				"set an instance default in system settings."
		)

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
	const tokenLimit =
		(connection as any).tokenLimit ??
		(connection as any).contextSize ??
		values.contextTokens ??
		4096
	const maxTokens = values.responseTokens ?? 512

	// The connection's own configured tokenizer, not a global default — the
	// identical fix `generateResponse.ts` and `graphBuilder.ts` both carry. A
	// mismatched counter makes the budget wrong in the direction that truncates.
	const tokenCounter = new TokenCounters(
		(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
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
			"the model call stopped unexpectedly — it reported being aborted with no matching cancellation"
		)
	}

	return { text: result.text, via: connection.type }
}
