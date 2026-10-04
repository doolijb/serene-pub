/**
 * The transcript fit (B2, 2026-10-03): cut in chunks, and hold the cut.
 *
 * The property that matters is not "it fits" — any cut fits — but that the
 * START of the prompt stays where it was for several turns at a time, because
 * a backend that reuses its cache only on an exact prefix loses all of it the
 * moment the first kept line changes.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	HISTORY_READ_MAX_ROWS,
	MESSAGE_SCAFFOLD_TOKENS,
	TRANSCRIPT_CUT_FREES,
	historyReadRowCount,
	historyReadTokens,
	holdCut,
	planTranscriptCut,
	promptTokens,
	resetHeldCuts
} from "$lib/server/pipelines/prompt/transcriptFit"

beforeEach(() => resetHeldCuts())

describe("planTranscriptCut", () => {
	it("cuts nothing when the prompt fits", () => {
		expect(
			planTranscriptCut({ ids: [1, 2, 3], tokens: [10, 10, 10], total: 90, budget: 100 })
		).toBeNull()
	})

	it("a fresh cut frees about a quarter of the budget, not one line", () => {
		const ids = Array.from({ length: 40 }, (_, i) => i + 1)
		const tokens = ids.map(() => 50)
		// 40 × 50 = 2000 of transcript + 500 of system: 2500 against 2000.
		const cut = planTranscriptCut({ ids, tokens, total: 2500, budget: 2000 })!
		expect(cut.held).toBe(false)
		expect(cut.estimate).toBeLessThanOrEqual(2000 * (1 - TRANSCRIPT_CUT_FREES))
		// One line at the edge would have been from: 10 (2500 - 10×50 = 2000).
		expect(cut.from).toBeGreaterThan(10)
	})

	it("keeps at least the newest line", () => {
		const cut = planTranscriptCut({ ids: [1, 2], tokens: [900, 900], total: 2000, budget: 100 })!
		expect(cut.from).toBe(1)
	})

	it("prefers the oldest held cut the prompt still fits from", () => {
		const ids = [1, 2, 3, 4, 5, 6]
		const tokens = ids.map(() => 100)
		holdCut(3)
		holdCut(5)
		// 600 + 200 = 800 against 650: from line 3 (index 2) it is 600 — fits.
		const cut = planTranscriptCut({ ids, tokens, total: 800, budget: 650 })!
		expect(cut).toEqual({ from: 2, held: true, estimate: 600 })
	})

	it("ignores held cuts on a fresh re-cut", () => {
		holdCut(2)
		const cut = planTranscriptCut({
			ids: [1, 2, 3, 4],
			tokens: [100, 100, 100, 100],
			total: 500,
			budget: 450,
			fresh: true
		})!
		expect(cut.held).toBe(false)
	})
})

describe("the start of the prompt holds across turns", () => {
	/**
	 * Twenty turns of a growing conversation against a small window: a
	 * fixed system block, two 60-token lines a turn. Every turn must fit,
	 * and the first kept line must change only a handful of times — once per
	 * quarter of the budget the conversation grows by — never once a turn.
	 */
	it("moves the cut in chunks, a few times over twenty turns", () => {
		const SYSTEM = 600
		const LINE = 60
		const BUDGET = 2000
		const firsts: number[] = []
		let ids: number[] = []
		for (let turn = 0; turn < 20; turn++) {
			ids = [...ids, ids.length + 1, ids.length + 2]
			const tokens = ids.map(() => LINE)
			const total = SYSTEM + ids.length * LINE
			const cut = planTranscriptCut({ ids, tokens, total, budget: BUDGET })
			const from = cut?.from ?? 0
			if (cut) holdCut(ids[from])
			const kept = SYSTEM + (ids.length - from) * LINE
			expect(kept).toBeLessThanOrEqual(BUDGET)
			firsts.push(ids[from])
		}
		const changes = firsts.filter((id, i) => i > 0 && id !== firsts[i - 1]).length
		// The overflow starts around turn 12; one line per turn at the edge
		// would change the start on every turn after it (8 changes). A
		// quarter of 2000 is ~8 lines, so the cut moves every ~4 turns.
		expect(changes).toBeGreaterThan(0)
		expect(changes).toBeLessThanOrEqual(3)
	})
})

describe("promptTokens", () => {
	it("counts each chat message with its scaffolding, plus the open turn", () => {
		const n = promptTokens(
			{ messages: [{ content: "abcd" }, { content: "efgh" }] },
			(t) => t.length
		)
		expect(n).toBe(8 + 3 * MESSAGE_SCAFFOLD_TOKENS)
	})

	it("counts the flat string on the completion wire", () => {
		expect(promptTokens({ rendered: "abcdef" }, (t) => t.length)).toBe(6)
	})
})

describe("the history read sized by the window (history window, 2026-10-03)", () => {
	it("reads twice the budget, and nothing for no budget", () => {
		expect(historyReadTokens(1000)).toBe(2000)
		expect(historyReadTokens(0)).toBe(0)
		expect(historyReadTokens(undefined)).toBe(0)
		expect(historyReadTokens("x")).toBe(0)
	})

	it("takes the newest rows until the estimate reaches it, the crossing row included", () => {
		// 100 characters a row is 25 estimated tokens: 2000 tokens is 80 rows.
		const lengths = Array.from({ length: 150 }, () => 100)
		expect(historyReadRowCount(lengths, 2000)).toBe(80)
		expect(historyReadRowCount(lengths, 2001)).toBe(81)
	})

	it("takes every row when they never reach it — more than the old 100", () => {
		const lengths = Array.from({ length: 150 }, () => 100)
		expect(historyReadRowCount(lengths, 200_000)).toBe(150)
		expect(historyReadRowCount([], 2000)).toBe(0)
	})

	it("never takes more than the safety cap", () => {
		const lengths = Array.from({ length: HISTORY_READ_MAX_ROWS + 50 }, () => 1)
		expect(historyReadRowCount(lengths, 1e9)).toBe(HISTORY_READ_MAX_ROWS)
		expect(historyReadRowCount(lengths, 0)).toBe(HISTORY_READ_MAX_ROWS)
	})
})
