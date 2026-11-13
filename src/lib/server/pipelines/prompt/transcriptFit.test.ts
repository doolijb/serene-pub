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
	EARLIER_SCENES_BLOCK_TOKENS,
	HISTORY_READ_MAX_ROWS,
	MESSAGE_SCAFFOLD_TOKENS,
	TRANSCRIPT_CUT_FREES,
	earlierBlockTokens,
	earlierScenesShown,
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

describe("earlierScenesShown (🚧 earlier in the story)", () => {
	const scene = (firstLineId: number, tokens: number) => ({
		firstLineId,
		tokens
	})
	const tokensOf = (s: { tokens: number }) => s.tokens

	it("shows only scenes starting before the first kept line, one that lost only its opening line included", () => {
		const scenes = [scene(1, 10), scene(11, 10), scene(21, 10)]
		expect(earlierScenesShown(scenes, 11, null, tokensOf)).toEqual([scenes[0]])
		// The second scene lost only line 11, its opening one.
		expect(earlierScenesShown(scenes, 12, null, tokensOf)).toEqual([
			scenes[0],
			scenes[1]
		])
		expect(earlierScenesShown(scenes, 1, null, tokensOf)).toEqual([])
	})

	it("keeps the newest under the cap, and skips one that does not fit while older ones that do still show", () => {
		const scenes = [scene(1, 10), scene(11, 100), scene(21, 20), scene(31, 20)]
		// 31 and 21 fit (40); 11 (100) does not and is skipped; 1 (10) still fits.
		expect(
			earlierScenesShown(scenes, Infinity, EARLIER_SCENES_BLOCK_TOKENS + 50, tokensOf)
		).toEqual([scenes[0], scenes[2], scenes[3]])
		// With no room left for it, the oldest is the one dropped.
		expect(
			earlierScenesShown(scenes, Infinity, EARLIER_SCENES_BLOCK_TOKENS + 40, tokensOf)
		).toEqual([scenes[2], scenes[3]])
		// One oversized newest summary does not empty the block.
		const big = [scene(1, 10), scene(11, 10), scene(21, 500)]
		expect(
			earlierScenesShown(big, Infinity, EARLIER_SCENES_BLOCK_TOKENS + 30, tokensOf)
		).toEqual([big[0], big[1]])
		expect(earlierScenesShown(scenes, Infinity, 5, tokensOf)).toEqual([])
	})

	it("keeps every qualifying scene with no cap, returns oldest first, and nothing for nothing", () => {
		const scenes = [scene(1, 1000), scene(5, 1000), scene(9, 1000)]
		expect(earlierScenesShown(scenes, Infinity, null, tokensOf)).toEqual(scenes)
		expect(earlierScenesShown([], 10, 100, tokensOf)).toEqual([])
		expect(earlierScenesShown([], Infinity, null, tokensOf)).toEqual([])
	})

	it("sizes the block as the shown tokens plus the heading, 0 when none show", () => {
		expect(earlierBlockTokens([], tokensOf)).toBe(0)
		expect(earlierBlockTokens([scene(1, 7), scene(2, 8)], tokensOf)).toBe(
			15 + EARLIER_SCENES_BLOCK_TOKENS
		)
	})
})

describe("planTranscriptCut with the earlier-scenes block (🚧)", () => {
	const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
	const tokens = ids.map(() => 100)
	// A system block of 100 and ten lines of 100; one scene (50 tokens) from line 1.
	const base = { ids, tokens, total: 1100, budget: 800 }
	const earlier = {
		scenes: [{ firstLineId: 1, tokens: 50 }],
		maxTokens: null,
		measured: 0
	}
	const blockCost = 50 + EARLIER_SCENES_BLOCK_TOKENS

	it("does not take a held cut that fits only without the block", () => {
		holdCut(4)
		expect(planTranscriptCut(base)).toMatchObject({
			from: 3,
			held: true,
			estimate: 800
		})
		const cut = planTranscriptCut({ ...base, earlier })!
		expect(cut.held).toBe(false)
		expect(cut.from).toBe(6)
		expect(cut.estimate).toBe(1100 - 600 + blockCost)
	})

	it("takes a held cut that fits with the block", () => {
		holdCut(5)
		const cut = planTranscriptCut({ ...base, earlier })!
		expect(cut).toMatchObject({
			from: 4,
			held: true,
			estimate: 1100 - 400 + blockCost
		})
	})

	it("is today's result when `earlier` is absent", () => {
		const fresh = planTranscriptCut(base)!
		expect(fresh).toEqual({ from: 5, held: false, estimate: 600 })
		expect(
			planTranscriptCut({
				...base,
				earlier: { scenes: [], maxTokens: null, measured: 0 }
			})
		).toEqual(fresh)
	})

	it("cuts more than without the block by at most the block's cap plus the largest line", () => {
		const maxTokens = 200
		const lines = [90, 120, 60, 100, 80, 110, 70, 100, 100, 100, 60, 90]
		const lineIds = lines.map((_, i) => i + 1)
		const scenes = [1, 4, 7, 10].map((firstLineId) => ({
			firstLineId,
			tokens: 70
		}))
		const largest = Math.max(...lines)
		for (const total of [1500, 1800, 2400, 3000]) {
			for (const budget of [900, 1200, 1500]) {
				const input = {
					ids: lineIds,
					tokens: lines,
					total,
					budget,
					fresh: true
				}
				const without = planTranscriptCut(input)
				const withBlock = planTranscriptCut({
					...input,
					earlier: { scenes, maxTokens, measured: 0 }
				})
				if (!without || !withBlock) continue
				const cutOf = (from: number) =>
					lines.slice(0, from).reduce((n, t) => n + t, 0)
				expect(cutOf(withBlock.from) - cutOf(without.from)).toBeLessThanOrEqual(
					maxTokens + largest
				)
			}
		}
	})

	/**
	 * Twenty turns, two 60-token lines a turn, scenes of ten lines closing as
	 * the conversation passes them. The first render reads every line and
	 * measures the block at the first read line (nearly empty); the cut is
	 * planned, applied, and the block re-measured at the kept line.
	 */
	describe("over twenty turns", () => {
		const SYSTEM = 600
		const LINE = 60
		const BUDGET = 2000
		const SCENE = 40
		const CAP = EARLIER_SCENES_BLOCK_TOKENS + 3 * SCENE
		const cost = (s: { tokens: number }) => s.tokens

		function run(planWithEarlier: boolean) {
			resetHeldCuts()
			const firsts: number[] = []
			let over = 0
			let all: number[] = []
			for (let turn = 0; turn < 20; turn++) {
				all = [...all, all.length + 1, all.length + 2]
				const scenes = Array.from(
					{ length: Math.floor(all.length / 10) },
					(_, k) => ({ firstLineId: k * 10 + 1, tokens: SCENE })
				)
				const blockAt = (first: number) =>
					earlierBlockTokens(
						earlierScenesShown(scenes, first, CAP, cost),
						cost
					)
				const measured = blockAt(all[0])
				const total = SYSTEM + all.length * LINE + measured
				const cut = planTranscriptCut({
					ids: all,
					tokens: all.map(() => LINE),
					total,
					budget: BUDGET,
					...(planWithEarlier
						? { earlier: { scenes, maxTokens: CAP, measured } }
						: {})
				})
				const from = cut?.from ?? 0
				if (cut) holdCut(all[from])
				const real = SYSTEM + (all.length - from) * LINE + blockAt(all[from])
				if (real > BUDGET) over++
				firsts.push(all[from])
			}
			const changed = firsts.map((id, i) => i > 0 && id !== firsts[i - 1])
			return {
				over,
				changes: changed.filter(Boolean).length,
				twiceRunning: changed.some((c, i) => c && changed[i - 1])
			}
		}

		it("holds the first line and always fits when the block is counted", () => {
			const r = run(true)
			expect(r.over).toBe(0)
			expect(r.changes).toBeGreaterThan(0)
			expect(r.changes).toBeLessThanOrEqual(3)
			expect(r.twiceRunning).toBe(false)
		})

		it("goes over the budget or moves more when the block is not counted", () => {
			const counted = run(true)
			const blind = run(false)
			expect(
				blind.over > 0 ||
					blind.changes > counted.changes ||
					blind.twiceRunning
			).toBe(true)
		})
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
