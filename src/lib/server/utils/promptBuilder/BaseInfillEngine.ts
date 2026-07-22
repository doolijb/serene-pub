import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import {
	ChatMessageProcessor,
	type ProcessedChatMessage
} from "./ContentProcessors"
import { parseSplitChatPrompt } from "./utils"
import type { InfillContentOptions, InfillResult } from "./types"

export abstract class BaseInfillEngine {
	protected static readonly MIN_GUARANTEED_MESSAGES = 10
	/** Fraction of available content budget reserved for chat-message fill. */
	protected static readonly MESSAGE_FILL_FRACTION = 0.5
	/** Minimum tokens reserved for message fill even on very small budgets. */
	protected static readonly MIN_MESSAGE_FILL_TOKENS = 512
	protected chatMessageProcessor: ChatMessageProcessor

	constructor(
		protected chat: BasePromptChat,
		protected interpolationEngine: any,
		protected populateLorebookEntryBindings: (
			entry: any,
			chat: BasePromptChat
		) => any
	) {
		this.chatMessageProcessor = new ChatMessageProcessor(
			chat,
			interpolationEngine
		)
	}

	abstract infillContent(options: InfillContentOptions): Promise<InfillResult>

	/**
	 * Build the countTokens closure that reads chatMessages and lore by reference
	 * on every call, so any mutations to those arrays are reflected automatically.
	 */
	protected makeCountTokens(
		handlebars: any,
		template: string,
		useChatFormat: boolean,
		tokenCounter: any,
		chatMessages: ProcessedChatMessage[],
		buildCtx: () => any
	): () => Promise<number> {
		return async () => {
			const rendered = handlebars.compile(template)({
				...buildCtx(),
				chatMessages: [...chatMessages].reverse()
			})
			const final = useChatFormat
				? JSON.stringify(parseSplitChatPrompt(rendered))
				: rendered
			return typeof tokenCounter.countTokens === "function"
				? await tokenCounter.countTokens(final)
				: 0
		}
	}

	/**
	 * Enforce the token budget by trimming content in two phases:
	 *
	 * Phase A — Lore trim: for each array in `trimmableArrays` (in order), pop
	 *   entries from the back until the budget is satisfied or the array is empty.
	 *   The back of each array holds the lowest-priority entries (RAG-added,
	 *   lowest-scored). Pinned entries are never placed in these arrays.
	 *
	 * Phase B — Message trim: if still over budget after lore trimming, pop
	 *   chatMessages (oldest entries sit at the back in newest-first order) down
	 *   to MIN_GUARANTEED_MESSAGES + 1 (the +1 is the assistant placeholder).
	 *
	 * Returns the final token count after enforcement.
	 */
	protected async enforceTokenBudget(
		trimmableArrays: any[][],
		chatMessages: ProcessedChatMessage[],
		tokenLimit: number,
		countTokens: () => Promise<number>
	): Promise<number> {
		let total = await countTokens()
		if (total <= tokenLimit) return total

		// Phase A: trim lore arrays in priority order
		for (const arr of trimmableArrays) {
			while (total > tokenLimit && arr.length > 0) {
				arr.pop()
				total = await countTokens()
			}
			if (total <= tokenLimit) return total
		}

		// Phase B: trim messages down to the guaranteed floor
		const minMessages = Math.min(
			BaseInfillEngine.MIN_GUARANTEED_MESSAGES + 1,
			chatMessages.length
		)
		while (total > tokenLimit && chatMessages.length > minMessages) {
			chatMessages.pop()
			total = await countTokens()
		}

		return total
	}

	/**
	 * Fill chatMessages from a sorted candidate pool up to tokenLimit.
	 *
	 * For each candidate: tentatively push, recount. If over tokenLimit, pop and
	 * continue to the next candidate (do NOT break — a later, shorter message may
	 * still fit). Stops early only when the threshold is already met.
	 *
	 * Returns the final token count.
	 */
	protected async fillFromPool(
		candidates: SelectChatMessage[],
		chatMessages: ProcessedChatMessage[],
		tokenLimit: number,
		threshold: number,
		currentTokens: number,
		processMsg: (msg: SelectChatMessage) => ProcessedChatMessage | null,
		countTokens: () => Promise<number>
	): Promise<number> {
		if (currentTokens >= threshold || candidates.length === 0)
			return currentTokens
		let total = currentTokens
		for (const msg of candidates) {
			// Re-check saturation each iteration (not just before the loop): once total
			// reaches threshold, no further candidate can add value, so stop evaluating
			// (and re-tokenizing) the rest of the pool instead of exhausting it.
			if (total >= threshold) break
			const p = processMsg(msg)
			if (!p) continue
			chatMessages.push(p)
			const next = await countTokens()
			if (next > tokenLimit) {
				chatMessages.pop()
				// continue — don't break; a shorter candidate may still fit
				continue
			}
			total = next
		}
		return total
	}
}
