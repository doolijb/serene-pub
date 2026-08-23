/**
 * Shared Post-History block positioning/gating logic, used by both
 * RagInfillEngine and KeywordInfillEngine so the math can't drift between
 * them — mirrors NarrativeGraphContext.ts's role as a single shared module
 * for behavior both engines need to agree on.
 *
 * Returns the fully-assembled `postHistory` template object rather than
 * loose fields — `targetIndex`/`hasContent` are decisions the template has
 * no business making (no variadic `or` helper to check "any of 3 fields
 * populated", and the index math depends on the final message array), so
 * they're computed here and handed to the template as data, not logic.
 */

import type { ProcessedChatMessage } from "$lib/server/pipelines/prompt/contentProcessors"
import type { PostHistoryDiag, PostHistoryTemplateContext } from "$lib/server/pipelines/prompt/promptTypes"

export async function resolvePostHistoryContext({
	renderMessages,
	instructions,
	charInstructions,
	exampleDialogue,
	postHistoryDepth,
	postHistoryTokenTrigger,
	tokenCounter
}: {
	/** [...chatMessages].reverse() — oldest-first, seed placeholder last. */
	renderMessages: ProcessedChatMessage[]
	/** Prompt config's own reinforcement text — gated by postHistoryTokenTrigger below. */
	instructions: string | undefined
	/** Character's own authored reinforcement text — always rendered when populated. */
	charInstructions: string | undefined
	/** Character's example dialogue — always rendered when populated. */
	exampleDialogue: string | undefined
	postHistoryDepth: number
	postHistoryTokenTrigger: number
	tokenCounter: { countTokens(text: string): Promise<number> | number }
}): Promise<{
	postHistory: PostHistoryTemplateContext
	diagnostics: PostHistoryDiag
}> {
	// depth 0 = the placeholder's own iteration (today's `@last` position,
	// i.e. right after the newest real message). depth N = N real messages
	// earlier. Clamped to 0 so a depth larger than the available history
	// still renders (at the oldest position) instead of vanishing.
	const targetIndex = Math.max(
		0,
		renderMessages.length - 1 - postHistoryDepth
	)

	let effectiveInstructions = instructions
	let diagnostics: PostHistoryDiag = { included: true, reason: "included" }

	if (!effectiveInstructions) {
		diagnostics = { included: false, reason: "empty" }
	} else if (postHistoryTokenTrigger > 0) {
		const historyText = renderMessages
			.filter((m) => m.id !== -2)
			.map((m) => m.message ?? "")
			.join("\n")
		const historyTokens = await tokenCounter.countTokens(historyText)
		if (historyTokens < postHistoryTokenTrigger) {
			effectiveInstructions = undefined
			diagnostics = { included: false, reason: "below_token_trigger" }
		}
	}

	const hasContent = Boolean(
		effectiveInstructions || charInstructions || exampleDialogue
	)

	return {
		postHistory: {
			targetIndex,
			instructions: effectiveInstructions,
			charInstructions,
			exampleDialogue,
			hasContent
		},
		diagnostics
	}
}
