/**
 * How much chat one summarizing batch holds — declared, and clamped to the
 * window the batch is actually sent against.
 *
 * ## The two halves of one number
 *
 * A batch prompt is the chat **plus** the template around it plus room for the
 * draft written back. `BATCH_RESERVE_TOKENS` is that second half, and it is why
 * a batch sized to the whole window cannot work: there would be nowhere for the
 * answer to go. So the rule this module exists to enforce is
 *
 *     batch + BATCH_RESERVE_TOKENS <= the sampling config's contextTokens
 *
 * ## Why it is a ceiling and not a target
 *
 * Nothing here scales the batch *up* to fill a large window, and that is the
 * design rather than an omission: long-context models degrade in the middle, so
 * a batch sized to a 128k window buys a worse summary than one sized to a few
 * thousand tokens. The declared `batchTokens` is a quality knob an admin turns;
 * the window is only ever a ceiling on it.
 *
 * ## One implementation
 *
 * `core:task/batch-messages@1` computes this budget. A legacy batcher in
 * `summarizer/index.ts` once carried its own copy of
 * `Math.max(tokenLimit - 1500, 500)` against a limit neither clamped — two
 * copies of one arithmetic is how they came to disagree about what the number
 * meant. That batcher is gone; keep it to one.
 */

/**
 * Headroom for the batch prompt's template and the draft written back.
 *
 * 1500 is 0.5's number, kept deliberately rather than re-derived. A better
 * reserve would read the sampling config's own `responseTokens` for the draft
 * half — the argument `core:task/context-budget@1` makes about its late
 * `reserveForReply` — but that is a re-tune of every summarization run, and
 * this change is the clamp, not the reserve.
 */
export const BATCH_RESERVE_TOKENS = 1500

/**
 * The declared default for `batchTokens`.
 *
 * 0.5 batched at `4096 - 1500 = 2596` tokens of chat, and that is a defensible
 * quality point — the bug was never the size, it was that the size neither
 * scaled with the admin's intent nor clamped to the model's window. 2560 is
 * that same point at a round 2.5 Ki; the 1.4% difference is far inside the
 * error of a characters/3.5 estimate, so nobody's summaries are re-tuned by
 * arriving here.
 */
export const DEFAULT_BATCH_TOKENS = 2560

/**
 * The smallest batch worth drafting.
 *
 * Below this the *window* is the problem and no clamp can rescue it: a batch
 * floored at some minimum would still push the prompt past the window it has to
 * fit in, which is the overflow this module exists to stop. A window under
 * `BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS` is told so, rather than being sent
 * a prompt it cannot hold.
 */
export const MIN_BATCH_TOKENS = 256

/**
 * The sampling config's context window, as a number, or `null` for "not stated".
 *
 * ⚠ `ResolvedSampling` is `Record<string, unknown>` and is **not** coerced on
 * read — `resolveSamplingValues` passes stored values through untouched and the
 * coercion lives on the write path (`normalizeSamplingRow`) — so a row holding
 * `"8192"` yields the *string*. A numeric string is therefore a legitimate
 * shape here and is read as the number it spells.
 *
 * ⚠ Anything else — absent (the parameter is switched off), or present and
 * unreadable — returns `null`, which means **no clamp applies** and the admin's
 * declared batch size stands. It deliberately does not fall back to 4096: that
 * would silently shrink batches for every install whose row holds something
 * this cannot parse, with nothing anywhere saying so. A window nobody stated is
 * a window nothing can be clamped to.
 */
export function contextWindowOf(sampling: unknown): number | null {
	const raw = (sampling as Record<string, unknown> | null | undefined)
		?.contextTokens
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && raw.trim() !== ""
				? Number(raw)
				: NaN
	if (!Number.isFinite(n) || n <= 0) return null
	return Math.floor(n)
}

/** A configured `batchTokens`, or the declared default when it is unusable. */
export function declaredBatchTokens(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value)
	if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_TOKENS
	return Math.floor(n)
}

export type BatchBudget =
	/** `tokens` of chat per batch. `window` is what clamped it, when one did. */
	| { fits: true; tokens: number; window: number | null; clamped: boolean }
	/** The window cannot hold the reserve and a batch worth drafting. */
	| { fits: false; window: number; reason: string }

/**
 * Resolve the effective per-batch chat budget.
 *
 * `batchTokens` arrives through the node's `params` slot — the executor applies
 * the declared default before a binding ever sees it — and `sampling` is the
 * config's switched-on values, resolved from the slot the drafting step uses.
 */
export function resolveBatchBudget(input: {
	batchTokens?: unknown
	sampling?: unknown
}): BatchBudget {
	const declared = declaredBatchTokens(input.batchTokens)
	const window = contextWindowOf(input.sampling)
	if (window === null)
		return { fits: true, tokens: declared, window: null, clamped: false }

	const ceiling = window - BATCH_RESERVE_TOKENS
	if (ceiling < MIN_BATCH_TOKENS)
		return {
			fits: false,
			window,
			reason:
				`this step's sampling config sets a context window of ${window} tokens, ` +
				`which leaves ${ceiling} for the chat after the ${BATCH_RESERVE_TOKENS} ` +
				`tokens a batch prompt and its draft need — raise Context Tokens to at ` +
				`least ${BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS}, or point this pipeline ` +
				`at a config that does`
		}

	return {
		fits: true,
		tokens: Math.min(declared, ceiling),
		window,
		clamped: declared > ceiling
	}
}
