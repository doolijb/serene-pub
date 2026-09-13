/**
 * Shared Post-History block positioning/gating logic, used by both
 * RagInfillEngine and KeywordInfillEngine so the math can't drift between
 * them — mirrors NarrativeGraphContext.ts's role as a single shared module
 * for behavior both engines need to agree on.
 *
 * **The block is one unit.** `postHistoryTokenTrigger` is the reader's ceiling
 * on reminders of every kind, not a gate on the config's text alone: below it
 * the config's reminder, the card's reminder and the card's example dialogue
 * all stay out and `hasContent` is false; at or above it all three render
 * together at `targetIndex`. `postHistoryDepth` places that one block.
 *
 * Returns the fully-assembled `postHistory` template object rather than
 * loose fields — `targetIndex`/`hasContent` are decisions the template has
 * no business making (no variadic `or` helper to check "any of 3 fields
 * populated", and the index math depends on the final message array), so
 * they're computed here and handed to the template as data, not logic.
 */

import type { ProcessedSessionMessage } from "$lib/server/pipelines/prompt/contentProcessors"
import type {
	PostHistoryDiag,
	PostHistoryTemplateContext
} from "$lib/server/pipelines/prompt/promptTypes"

export async function resolvePostHistoryContext({
	renderMessages,
	instructions,
	charInstructions,
	exampleDialogue,
	postHistoryDepth,
	postHistoryTokenTrigger,
	tokenCounter
}: {
	/** [...sessionMessages].reverse() — oldest-first, seed placeholder last. */
	renderMessages: ProcessedSessionMessage[]
	/** Prompt config's own reinforcement text. */
	instructions: string | undefined
	/** Character's own authored reinforcement text. */
	charInstructions: string | undefined
	/** Character's example dialogue. */
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

	let included = Boolean(instructions || charInstructions || exampleDialogue)
	// The decision's own record, carrying the numbers it was made from — a
	// receipt that says "suppressed" without them is a claim nobody can check.
	let diagnostics: PostHistoryDiag = {
		included: true,
		reason: "included",
		trigger: postHistoryTokenTrigger,
		depth: postHistoryDepth,
		targetIndex,
		// Facts about what the block would carry, so a reader knows what the
		// trigger held back and not only that it held.
		hasCharInstructions: Boolean(charInstructions),
		hasExampleDialogue: Boolean(exampleDialogue)
	}

	if (!included) {
		diagnostics = { ...diagnostics, included: false, reason: "empty" }
	} else if (postHistoryTokenTrigger > 0) {
		const historyText = renderMessages
			.filter((m) => m.id !== -2)
			.map((m) => m.message ?? "")
			.join("\n")
		const historyTokens = await tokenCounter.countTokens(historyText)
		diagnostics = { ...diagnostics, historyTokens }
		if (historyTokens < postHistoryTokenTrigger) {
			included = false
			diagnostics = {
				...diagnostics,
				included: false,
				reason: "below_token_trigger"
			}
		}
	}

	return {
		postHistory: {
			targetIndex,
			instructions: included ? instructions : undefined,
			charInstructions: included ? charInstructions : undefined,
			exampleDialogue: included ? exampleDialogue : undefined,
			hasContent: included
		},
		diagnostics
	}
}
