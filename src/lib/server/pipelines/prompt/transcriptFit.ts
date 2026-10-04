/**
 * Fitting the conversation into the window — and cutting it so the cut point
 * HOLDS (B2, 2026-10-03).
 *
 * ## Why Assemble does this
 *
 * The ranker decides what lore fits (`rank-hybrid`'s `select`, per band). The
 * transcript is not ranked on any shipped spec: `session-history` reads the
 * newest `limit` rows, its `messages` band only reserves the conversation's
 * share of the window, and nothing ever checked that the rows fit in it. A
 * long session therefore went out larger than the window, and the backend
 * trimmed it — KoboldCPP from the FRONT, by its own count, on every turn.
 *
 * Only this node knows the finished prompt's size: the system block, the
 * placed reminder, the lore the ranker admitted, the scaffolding the wire adds.
 * So it measures what it rendered and, when that is over the budget, leaves
 * out the oldest lines and renders again. The lore stays the ranker's
 * decision; the transcript's fit is this node's because nobody else can make
 * it.
 *
 * ## Why in chunks, and why the cut is remembered
 *
 * A backend that reuses its prompt cache only on an exact token prefix (a
 * hybrid model on KoboldCPP's SmartCache) loses the whole cache whenever the
 * START of the prompt moves. Dropping one line per turn at the edge moves it
 * on every turn — the slowest possible shape. So a cut frees about a quarter
 * of the budget at once ({@link TRANSCRIPT_CUT_FREES}), and the line it starts
 * at is remembered ({@link holdCut}): the next turn starts from that same line
 * for as long as the prompt still fits, and only cuts again when it does not.
 * The start of the prompt then stays put for several turns at a time.
 *
 * ⚠ The memory is a hint and nothing else. It holds message ids — unique
 * across every session, so no key is needed — and a held line is used only
 * while the prompt from it still fits. Lose it (a restart) and the next cut is
 * computed fresh; the prompt always fits either way. The preview and the send
 * read the same memory, so a preview still describes the request that follows.
 *
 * ## Reading enough to cut from (history window, 2026-10-03)
 *
 * A held cut only holds if the rows it is made in arrive. `session-history`
 * read a fixed 100, so once a session passed 100 messages on a window that
 * held more, the read itself dropped one line off the front every turn and
 * the cut never came into it. A history read wired to the run's `budget` is
 * sized by the window instead ({@link historyReadTokens},
 * {@link historyReadRowCount}): the newest rows until a deliberately generous
 * estimate reaches twice the budget — so the rows always reach past wherever
 * a cut can fall, and this node, not a row count, decides where the
 * conversation starts. Rows beyond what the window could ever hold are never
 * read, which keeps a preview on a long session cheap.
 */

/**
 * How many budgets' worth of conversation a budget-sized history read takes.
 *
 * Two: a cut keeps at most one budget's worth, so a read of two always holds
 * the line a cut starts at — the held one included — with a whole budget of
 * slack for an estimate that ran low.
 */
export const HISTORY_READ_BUDGETS = 2

/**
 * Characters per token, for the read's estimate — deliberately generous.
 *
 * Four characters is about one English token; names, scaffolding and attached
 * text are not counted at all. Erring low on tokens errs toward reading MORE
 * rows, which is the safe direction: an over-read costs a few rows the cut
 * leaves out, an under-read moves the prompt's first line.
 */
export const HISTORY_READ_CHARS_PER_TOKEN = 4

/**
 * The most rows a budget-sized read ever takes — the safety cap, far above
 * what any window holds at a normal line length (2000 lines of 60 tokens is
 * 120 000 tokens).
 */
export const HISTORY_READ_MAX_ROWS = 2000

/** The estimate a budget-sized history read stops at, for a budget of `total` tokens — 0 for none. */
export function historyReadTokens(total: unknown): number {
	const n = Number(total)
	return Number.isFinite(n) && n > 0 ? Math.floor(n * HISTORY_READ_BUDGETS) : 0
}

/**
 * How many of the newest rows a budget-sized read takes: rows are added
 * newest first until the estimate reaches `tokens` (the row that crosses it
 * included), or every row when they never do — never more than
 * {@link HISTORY_READ_MAX_ROWS}.
 */
export function historyReadRowCount(
	/**
	 * Each row's length, newest first — in bytes as the host reads it
	 * (`octet_length`, which Postgres answers without unpacking a stored
	 * text). A non-English character is two to four bytes, which brings the
	 * estimate up to about a token a character — still not above it.
	 */
	lengths: readonly number[],
	tokens: number
): number {
	const rows = Math.min(lengths.length, HISTORY_READ_MAX_ROWS)
	if (!(tokens > 0)) return rows
	let est = 0
	for (let i = 0; i < rows; i++) {
		est += Math.max(0, Number(lengths[i]) || 0) / HISTORY_READ_CHARS_PER_TOKEN
		if (est >= tokens) return i + 1
	}
	return rows
}

/** Tokens a chat template wraps one message in — `<|im_start|>user\n` … `<|im_end|>\n`. */
export const MESSAGE_SCAFFOLD_TOKENS = 5

/**
 * The share of the budget one cut frees.
 *
 * A quarter: a new cut is needed only after roughly that much conversation
 * has been added, so on a small window the start of the prompt holds for
 * several turns, and the window never loses more than a quarter of itself to
 * headroom.
 */
export const TRANSCRIPT_CUT_FREES = 0.25

/** Lines remembered as cut points, newest last. */
const HELD = new Set<number>()
const HELD_LIMIT = 4096

/** Remember a line as a cut point (and refresh it if it already is one). */
export function holdCut(id: number): void {
	HELD.delete(id)
	HELD.add(id)
	if (HELD.size > HELD_LIMIT) HELD.delete(HELD.values().next().value!)
}

/** Forget every held cut — tests only. */
export function resetHeldCuts(): void {
	HELD.clear()
}

/**
 * The size of a rendered prompt, in the run's units.
 *
 * Per message on the chat wire — each content counted, plus the scaffolding a
 * chat template wraps it in, plus the open assistant turn — so the counts are
 * of texts that recur turn after turn (a counter that caches by text then
 * answers most of them without asking anyone). The whole string on the
 * completion wire, where the delimiters are already in it.
 */
export function promptTokens(
	out: {
		rendered?: string
		messages?: ReadonlyArray<{ content?: unknown }>
	},
	count: (text: string) => number
): number {
	if (out.messages)
		return (
			out.messages.reduce(
				(n, m) =>
					n +
					count(typeof m.content === "string" ? m.content : "") +
					MESSAGE_SCAFFOLD_TOKENS,
				0
			) + MESSAGE_SCAFFOLD_TOKENS
		)
	return count(out.rendered ?? "")
}

export interface TranscriptCutInput {
	/** The lines that may be left out, oldest first — their message ids. */
	ids: readonly number[]
	/** What each of those lines costs, in the same order. */
	tokens: readonly number[]
	/** The prompt's measured size with every line in. */
	total: number
	/** What it may occupy. */
	budget: number
	/** Skip the held cuts — a re-cut after a render that still did not fit. */
	fresh?: boolean
}

export interface TranscriptCut {
	/** Index into `ids`: the first line kept. */
	from: number
	/** True when the cut is one an earlier turn made and this one kept. */
	held: boolean
	/** The estimated size after the cut. */
	estimate: number
}

/**
 * Where to cut, or `null` when everything fits.
 *
 * The OLDEST held cut the prompt fits from, when there is one — the start of
 * the prompt stays where an earlier turn put it. Otherwise a fresh cut that
 * brings the estimate down to `(1 − TRANSCRIPT_CUT_FREES) × budget`. At least
 * one line is always kept: the newest line is what the reply answers.
 */
export function planTranscriptCut(
	input: TranscriptCutInput
): TranscriptCut | null {
	const { ids, tokens, total, budget } = input
	if (!(budget > 0) || total <= budget || ids.length < 2) return null
	if (!input.fresh) {
		let est = total
		for (let p = 1; p < ids.length; p++) {
			est -= tokens[p - 1] ?? 0
			if (HELD.has(ids[p]) && est <= budget)
				return { from: p, held: true, estimate: est }
		}
	}
	const target = Math.floor(budget * (1 - TRANSCRIPT_CUT_FREES))
	let p = 0
	let est = total
	while (p < ids.length - 1 && est > target) {
		est -= tokens[p] ?? 0
		p++
	}
	return { from: p, held: false, estimate: est }
}

/** A line the cut may leave out: a real row. Folio blocks, the draft and the seed line are kept. */
export const isCuttableLine = (m: { id?: unknown }): boolean =>
	typeof m?.id === "number" && m.id > 0

/**
 * The receipt's sentence for a cut, so "why does the model not remember the
 * start of the conversation" has an answer with numbers in it.
 */
export function transcriptCutNote(fit: {
	dropped: number
	measured: number
	budget: number
	heldAt: number
	held: boolean
}): string {
	return (
		`the conversation was cut to fit the context window: the oldest ${fit.dropped} ` +
		`line${fit.dropped === 1 ? " was" : "s were"} left out (the prompt measured ` +
		`${fit.measured} tokens against a budget of ${fit.budget}). ` +
		(fit.held
			? `The cut is the one an earlier turn made, at line ${fit.heldAt}, kept so the prompt starts the same way it did.`
			: `The cut frees about a quarter of the budget and is held at line ${fit.heldAt}, so the next turns start the same way until the conversation outgrows it again.`)
	)
}
