import { llmQueue } from "./llmQueue"
import type { TaskType } from "./resolveTaskConfig"
import type { BaseConnectionAdapter } from "../connectionAdapters/BaseConnectionAdapter"
import { resolveReasoning } from "$lib/shared/utils/reasoningDelimiters"

export interface RunQueuedLLMCallParams {
	adapter: BaseConnectionAdapter
	taskType: TaskType
	connectionName: string
	samplingName: string
	sessionId?: number
	lorebookId?: number
	label?: string
	/** External cancellation signal — bridged to llmQueue.cancel() so
	 * cancelling stops THIS run via the adapter's own abort() (every adapter
	 * implements it — sets an internal flag polled by its streaming loop and
	 * aborts its own fetch/request controller), not just prevents a future
	 * call from starting. */
	signal?: AbortSignal
}

export interface RunQueuedLLMCallResult {
	text: string
	reasoningContent?: string
	isAborted: boolean
}

/**
 * Shared wrapper for the common "construct adapter, generate, buffer the
 * response (streaming or not) into a string" pattern used by summarization,
 * narrative graph building, session-title generation, and field generation.
 * Session message generation has its own live-streaming needs and builds its
 * LLMQueueItem directly instead of using this helper.
 *
 * ## Reasoning is lifted out of `text` here
 *
 * Every caller of this wrapper writes its answer somewhere durable — a lore
 * entry's summary, a graph node, a session title, a generated field — and none
 * of them has any use for a `<think>` block. It was reaching them: the only
 * inline parser lived inside `generateResponse` and was private to it, so a
 * backend without a reasoning parser of its own handed the delimiters straight
 * through into the stored text. `reasoningContent` is where it belongs and the
 * shape of this result already has that field, so the trace is moved rather
 * than dropped. See `$lib/shared/utils/reasoningDelimiters` for the rules.
 */
export async function runQueuedLLMCall({
	adapter,
	taskType,
	connectionName,
	samplingName,
	sessionId,
	lorebookId,
	label,
	signal
}: RunQueuedLLMCallParams): Promise<RunQueuedLLMCallResult> {
	if (signal?.aborted) return { text: "", isAborted: true }

	const { id, done } = llmQueue.enqueue<RunQueuedLLMCallResult>({
		taskType,
		connectionName,
		samplingName,
		sessionId,
		lorebookId,
		label,
		preflight: (signal) => adapter.preflight(signal),
		execute: async (signal) => {
			const { completionResult, isAborted, reasoningContent } =
				await adapter.generateText()

			if (typeof completionResult === "string") {
				const resolved = resolveReasoning(
					completionResult.trim(),
					reasoningContent
				)
				return {
					text: resolved.content.trim(),
					reasoningContent: resolved.reasoning,
					isAborted
				}
			}

			let text = ""
			let reasoning = ""
			await completionResult(
				(chunk) => {
					if (signal.aborted) return
					text += chunk
				},
				(reasoningChunk) => {
					if (signal.aborted) return
					reasoning += reasoningChunk
				}
			)
			const resolved = resolveReasoning(
				text.trim(),
				reasoning.trim() || reasoningContent
			)
			return {
				text: resolved.content.trim(),
				reasoningContent: resolved.reasoning,
				isAborted
			}
		},
		onCancel: () => adapter.abort()
	})

	const onAbort = () => {
		// Runs as an AbortSignal listener — an exception here escapes via
		// dispatchEvent, not this function's own try/catch below, and can
		// crash the process. llmQueue.cancel() is exception-safe today (it
		// no-ops on an unknown/already-settled id, and its only
		// side-effecting call is already wrapped in its own try/catch), but
		// that's its implementation, not its contract — wrapped anyway as
		// cheap insurance.
		try {
			llmQueue.cancel(id)
		} catch {}
	}
	signal?.addEventListener("abort", onAbort)
	try {
		return await done
	} finally {
		signal?.removeEventListener("abort", onAbort)
	}
}
