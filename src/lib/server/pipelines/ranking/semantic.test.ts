/**
 * The semantic arm's stages, pinned one at a time.
 *
 * Each test names the property rather than the function, because the property
 * is what has to survive a rewrite. The constants are the legacy ones and are
 * asserted as such: these are parameters now, and the point of making them
 * parameters was that the defaults stay exactly where they were.
 */

import { describe, it, expect } from "vitest"
import {
	rrfMerge,
	normaliseToTop,
	recencyBoost,
	priorityBoost,
	adaptiveThreshold,
	mmrRerank,
	perSourceBudget,
	rankSemantic,
	mergeWindows,
	type RagCandidate
} from "./semantic"
import { DEFAULT_SEMANTIC } from "./weights"

const c = (id: number, over: Partial<RagCandidate> = {}): RagCandidate => ({
	id,
	source: "worldLore",
	score: 1,
	name: `Entry ${id}`,
	...over
})

describe("the defaults are the legacy constants", () => {
	it("carries every RagInfillEngine number unchanged", () => {
		// Making a constant configurable must not change it. A default that
		// drifted during the extraction would show up as "RAG got worse in
		// 0.6.0" with nothing in a changelog to point at.
		expect(DEFAULT_SEMANTIC).toEqual({
			currentWindow: 2,
			recentWindow: 3,
			rrfK: 60,
			recencyBoost: 0.15,
			recencyDecay: 0.01,
			thresholdMin: 0.3,
			relativeThreshold: 0.7,
			mmrLambda: 0.7,
			sourceBudget: {
				message: 12,
				worldLore: 8,
				characterLore: 6,
				historyEntry: 6,
				narrativeRelationship: 5
			},
			defaultSourceBudget: 20
		})
	})
})

describe("rank fusion", () => {
	it("an item both queries found outranks one either found alone", () => {
		// The property fusion exists for: agreement between independent queries
		// is evidence, and averaging two similarity scores would lose it.
		const fused = rrfMerge(
			[
				[c(1), c(2)],
				[c(3), c(2)]
			],
			60
		)
		expect(fused.sort((a, b) => b.score - a.score)[0]!.id).toBe(2)
	})

	it("discards the incoming score entirely and fuses on rank", () => {
		// Two queries' raw similarities are not on one scale — one query can be
		// systematically more generous, and nobody downstream could tell. So the
		// score a candidate arrives with is **not used at all**: position in the
		// list is the whole input. Worth pinning explicitly, because the first
		// version of these tests assumed the opposite and built three fixtures
		// on it.
		const generous = [c(1, { score: 0.99 })]
		const modest = [c(2, { score: 0.11 })]
		const fused = rrfMerge([generous, modest], 60)
		expect(fused.map((f) => f.score)).toEqual([1 / 60, 1 / 60])
	})

	it("keeps one entry per source-and-id, not per id", () => {
		// A message and a lore entry can share an id; merging them would drop
		// one of two unrelated things.
		const fused = rrfMerge([[c(1), c(1, { source: "message" })]], 60)
		expect(fused).toHaveLength(2)
	})
})

describe("normalisation", () => {
	it("scales to the best result, because the threshold is a fraction of it", () => {
		const out = normaliseToTop([c(1, { score: 4 }), c(2, { score: 1 })])
		expect(out.map((o) => o.score)).toEqual([1, 0.25])
	})

	it("survives an all-zero set rather than dividing by it", () => {
		const out = normaliseToTop([c(1, { score: 0 })])
		expect(out[0]!.score).toBe(0)
	})
})

describe("the recency boost", () => {
	const params = DEFAULT_SEMANTIC

	it("lifts a recent message above an equally similar old one", () => {
		const order = [10, 11, 12, 13]
		const out = recencyBoost(
			[c(13, { source: "message" }), c(10, { source: "message" })],
			order,
			params
		)
		expect(out[0]!.score).toBeGreaterThan(out[1]!.score)
	})

	it("leaves lore alone, having no position to be recent to", () => {
		const out = recencyBoost([c(1)], [10, 11], params)
		expect(out[0]!.score).toBe(1)
	})

	it("treats a message outside the window as old rather than dropping it", () => {
		// It was retrieved, so it is relevant; it is only not recent.
		const out = recencyBoost([c(99, { source: "message" })], [1, 2], params)
		expect(out[0]!.score).toBeGreaterThan(0)
		expect(out[0]!.score).toBeLessThan(1 + params.recencyBoost)
	})
})

describe("the priority boost", () => {
	it("gives an author's High tier the same weight it has in keyword mode", () => {
		// Otherwise a tier the author set means something in one mode and
		// nothing in the other, which is indistinguishable from it being broken.
		const out = priorityBoost([c(1, { priority: 2 }), c(2)], 0.3)
		expect(out[0]!.score - out[1]!.score).toBeCloseTo(0.3, 10)
	})

	it("skips history, which has no priority column in either mode", () => {
		const out = priorityBoost(
			[c(1, { source: "historyEntry", priority: 3 })],
			0.3
		)
		expect(out[0]!.score).toBe(1)
	})
})

describe("the adaptive threshold", () => {
	it("takes the floor when nothing is very relevant", () => {
		// The case the relative clause alone gets wrong: every candidate is
		// weak, so 70% of the top is still weak.
		const { kept, threshold } = adaptiveThreshold(
			[c(1, { score: 0.2 }), c(2, { score: 0.15 })],
			DEFAULT_SEMANTIC
		)
		expect(threshold).toBe(0.3)
		expect(kept).toHaveLength(0)
	})

	it("takes the relative clause when something is", () => {
		// The case the floor alone gets wrong: everything clears 0.3, including
		// a long tail nobody wants.
		const { kept, threshold } = adaptiveThreshold(
			[c(1, { score: 1 }), c(2, { score: 0.5 })],
			DEFAULT_SEMANTIC
		)
		expect(threshold).toBeCloseTo(0.7, 10)
		expect(kept.map((k) => k.id)).toEqual([1])
	})
})

describe("MMR", () => {
	it("prefers a novel result over a near-duplicate of what is already in", () => {
		// The failure this exists to prevent: five paraphrases of one fact,
		// returned as five results.
		const candidates = [
			c(1, { score: 1 }),
			c(2, { score: 0.9 }),
			c(3, { score: 0.8 })
		]
		// 2 is nearly identical to 1; 3 is unrelated to both.
		const sim = [
			[1, 0.99, 0.0],
			[0.99, 1, 0.0],
			[0.0, 0.0, 1]
		]
		const out = mmrRerank(candidates, sim, DEFAULT_SEMANTIC.mmrLambda)
		expect(out.map((o) => o.id)).toEqual([1, 3, 2])
	})

	it("is pure relevance at lambda 1", () => {
		const candidates = [c(1, { score: 0.5 }), c(2, { score: 0.9 })]
		const sim = [
			[1, 0.99],
			[0.99, 1]
		]
		expect(mmrRerank(candidates, sim, 1).map((o) => o.id)).toEqual([2, 1])
	})

	it("returns a single candidate untouched", () => {
		expect(mmrRerank([c(1)], [[1]], 0.7).map((o) => o.id)).toEqual([1])
	})
})

describe("per-source budgets", () => {
	it("caps each source separately, and reports what it dropped", () => {
		const many = Array.from({ length: 10 }, (_, i) => c(i))
		const { kept, dropped } = perSourceBudget(many, DEFAULT_SEMANTIC)
		expect(kept).toHaveLength(8)
		expect(dropped).toHaveLength(2)
	})

	it("takes the best of each source, because it runs after reranking", () => {
		const ordered = [c(1), c(2), c(3)]
		const { kept } = perSourceBudget(ordered, {
			sourceBudget: { worldLore: 2 },
			defaultSourceBudget: 20
		})
		expect(kept.map((k) => k.id)).toEqual([1, 2])
	})

	it("falls back to a default budget for a source nobody named", () => {
		const odd = Array.from({ length: 25 }, (_, i) => c(i, { source: "x" }))
		const { kept } = perSourceBudget(odd, DEFAULT_SEMANTIC)
		expect(kept).toHaveLength(20)
	})
})

describe("the arm end to end", () => {
	const run = (over: Partial<Parameters<typeof rankSemantic>[0]> = {}) =>
		rankSemantic({
			lists: [[c(1, { score: 1 }), c(2, { score: 0.5 })]],
			params: DEFAULT_SEMANTIC,
			priorityBonus: 0.3,
			...over
		})

	it("reports what each stage did, not just what survived", () => {
		// "Why did my entry not make it" is a question about a stage. A single
		// number cannot answer it.
		const r = run()
		expect(Object.keys(r.diagnostics).sort()).toEqual([
			"belowThreshold",
			"fused",
			"kept",
			"overBudget",
			"threshold"
		])
	})

	it("boosts before it thresholds, so a recent message can survive the cut", () => {
		// Order matters: thresholding first would drop the message before the
		// thing that would have saved it ever applied.
		const lists = [
			[c(1, { score: 1 }), c(2, { source: "message", score: 0.9 })]
		]
		const r = rankSemantic({
			lists,
			messageOrder: [2],
			params: { ...DEFAULT_SEMANTIC, relativeThreshold: 0.99 },
			priorityBonus: 0.3
		})
		expect(r.candidates.map((x) => x.id)).toContain(2)
	})

	it("orders by fused score when no similarity matrix is supplied", () => {
		// MMR needs pairwise similarity; without it the arm degrades to plain
		// relevance rather than failing or silently reordering. "Relevance"
		// here is the *fused* score, so the list order is what decides it.
		const r = run({ lists: [[c(2), c(1)]] })
		expect(r.candidates.map((x) => x.id)).toEqual([2, 1])
	})

	it("projects the similarity matrix onto what survived the threshold", () => {
		// The matrix is built over the fused set; thresholding removes rows
		// from under it. Indexing it with post-threshold positions would
		// compare the wrong pairs — quietly, and only when something was cut.
		//
		// Two lists rather than one, because a single list's RRF scores decay
		// far too slowly to put anything under the threshold: 60/(60+rank)
		// stays above 0.7 until rank 25.
		const lists = [
			[c(1), c(3)],
			[
				c(1),
				c(3),
				...Array.from({ length: 19 }, (_, i) => c(50 + i)),
				c(2)
			]
		]
		// Index in the fused set: 1 → 0, 3 → 1, then the filler, then 2 last.
		const sim: number[][] = Array.from({ length: 22 }, (_, r) =>
			Array.from({ length: 22 }, (_, c2) => (r === c2 ? 1 : 0))
		)
		sim[0]![1] = 0.99
		sim[1]![0] = 0.99

		const r = rankSemantic({
			lists,
			similarity: sim,
			params: DEFAULT_SEMANTIC,
			priorityBonus: 0.3
		})
		// The tail is below the threshold and gone; 1 and 3 remain, and are
		// near-duplicates of each other — which the matrix only says if it was
		// remapped onto the survivors rather than read at their new positions.
		expect(r.candidates.map((x) => x.id)).toEqual([1, 3])
		expect(r.diagnostics.belowThreshold).toBeGreaterThan(0)
	})
})

describe("merging windows", () => {
	it("keeps the current window's copy when both found the same thing", () => {
		// The windows are ranked against each other by construction: what is
		// being said now outranks what was being said a moment ago. Fusing them
		// would let a strong second-window match displace a weaker current one.
		const current = [c(1, { score: 0.4 })]
		const recent = [c(1, { score: 0.9 }), c(2)]
		const merged = mergeWindows([current, recent])
		expect(merged.map((m) => m.id)).toEqual([1, 2])
		expect(merged[0]!.score).toBe(0.4)
	})

	it("appends rather than reorders", () => {
		const merged = mergeWindows([[c(3), c(1)], [c(2)]])
		expect(merged.map((m) => m.id)).toEqual([3, 1, 2])
	})

	it("dedups across sources separately", () => {
		const merged = mergeWindows([[c(1)], [c(1, { source: "message" })]])
		expect(merged).toHaveLength(2)
	})
})
