import { llmQueue } from "./llmQueue"
import type { TaskType } from "./resolveTaskConfig"
import type { BaseConnectionAdapter } from "../connectionAdapters/BaseConnectionAdapter"

export interface RunQueuedLLMCallParams {
	adapter: BaseConnectionAdapter
	taskType: TaskType
	connectionName: string
	samplingName: string
	chatId?: number
	lorebookId?: number
	label?: string
}

export interface RunQueuedLLMCallResult {
	text: string
	thinkingContent?: string
	isAborted: boolean
}

/**
 * Shared wrapper for the common "construct adapter, generate, buffer the
 * response (streaming or not) into a string" pattern used by summarization,
 * narrative graph building, chat-title generation, and field generation.
 * Chat message generation has its own live-streaming needs and builds its
 * LLMQueueItem directly instead of using this helper.
 */
export async function runQueuedLLMCall({
	adapter,
	taskType,
	connectionName,
	samplingName,
	chatId,
	lorebookId,
	label
}: RunQueuedLLMCallParams): Promise<RunQueuedLLMCallResult> {
	const { done } = llmQueue.enqueue<RunQueuedLLMCallResult>({
		taskType,
		connectionName,
		samplingName,
		chatId,
		lorebookId,
		label,
		preflight: (signal) => adapter.preflight(signal),
		execute: async (signal) => {
			const { completionResult, isAborted, thinkingContent } =
				await adapter.generate()

			if (typeof completionResult === "string") {
				return {
					text: completionResult.trim(),
					thinkingContent,
					isAborted
				}
			}

			let text = ""
			let thinking = ""
			await completionResult(
				(chunk) => {
					if (signal.aborted) return
					text += chunk
				},
				(thinkChunk) => {
					if (signal.aborted) return
					thinking += thinkChunk
				}
			)
			return {
				text: text.trim(),
				thinkingContent: thinking.trim() || thinkingContent,
				isAborted
			}
		},
		onCancel: () => adapter.abort()
	})

	return await done
}
