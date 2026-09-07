/**
 * Rank fusion, and the case fusion cannot do anything with.
 *
 * ⚠ **A `describe("strategy")` block of seven tests stood above this and is
 * deleted, not rewritten.** It tested `strategyOf` / `eligibleFor` / `armNote`
 * over `lorebook_entries.retrieval_strategy`, and migration 0204 dropped both
 * the column and those functions: an entry can no longer be kept out of a mechanism,
 * so there is no eligibility left to assert.
 *
 * Four of those seven were governing-rule tests — *adding a model may only add
 * matches* — and it is worth saying where the rule went rather than letting it
 * look abandoned. They asserted that availability could not take a mechanism away
 * from an entry; the property they were defending is now structural, because
 * neither keyword mechanism is handed availability at all and the vector mechanism's only
 * exclusion is visibility. Where it is still observable it is still asserted:
 * `keywordQuery.test.ts` holds it over the scan's own output,
 * `runtime/semanticArm.int.test.ts` over the shipped spec across all three
 * availability states, and `runtime/vector.int.test.ts` over the vector mechanism's
 * skip list. Deleting a test whose subject is gone is right; deleting the rule
 * with it would not have been.
 */

import { describe, it, expect } from "vitest"
import {
	fuseRanks,
	rrf,
	disjointOrderings,
	RRF_K
} from "$lib/server/pipelines/ranking/strategy"
import { rrfMerge } from "$lib/server/pipelines/ranking/semantic"

describe("rank fusion", () => {
	const item = (id: number) => ({ id, source: "worldLore" })

	it("agreement between the mechanisms beats a single mechanism's top hit", () => {
		// Two independent signals agreeing is itself evidence, so an entry
		// ranked 2nd by both outranks one ranked 1st by only one. The same
		// argument the additive score makes a layer up.
		const keyword = [item(1), item(2)]
		const vector = [item(3), item(2)]
		const fused = fuseRanks([keyword, vector])
		expect(fused[0]!.item.id).toBe(2)
	})

	it("is scale-free — only ordering matters, never the scores", () => {
		// The reason it is not an average: keyword scores live in ~[0, 1.5] and
		// RAG scores in [0, 1], so averaging would let the more generous mechanism win
		// on every turn without anyone being able to tell.
		const a = fuseRanks([
			[item(1), item(2)],
			[item(2), item(1)]
		])
		const b = fuseRanks([
			[item(1), item(2)],
			[item(2), item(1)]
		])
		expect(a.map((x) => x.item.id)).toEqual(b.map((x) => x.item.id))
	})

	it("keeps the rank each mechanism gave, so a receipt can show both", () => {
		const fused = fuseRanks([[item(1)], [item(2), item(1)]])
		const one = fused.find((f) => f.item.id === 1)!
		expect(one.ranks[0]).toBe(0)
		expect(one.ranks[1]).toBe(1)
	})

	it("treats the same id from different sources as different items", () => {
		const fused = fuseRanks([
			[{ id: 1, source: "worldLore" }],
			[{ id: 1, source: "characterLore" }]
		])
		expect(fused).toHaveLength(2)
	})

	it("one empty mechanism degrades to the other's ordering", () => {
		const fused = fuseRanks([[item(1), item(2)], []])
		expect(fused.map((f) => f.item.id)).toEqual([1, 2])
	})

	it("is one implementation with one k, shared with the semantic mechanism", () => {
		// ⚠ There were two, and they disagreed by exactly one in the
		// denominator: this one computed `1/(k + rank + 1)` and the semantic
		// mechanism's `rrfMerge` computed `1/(k + rank)`, so the same top hit was
		// worth 1/61 in one and 1/60 in the other. Same algorithm, two answers,
		// and nothing anywhere said which was meant.
		//
		// The 0-based form is the one kept, because it is what 0.5's
		// `RagInfillEngine` computed and therefore what the frozen RAG parity
		// goldens record — the convention is settled by the gate rather than by
		// preference. This asserts the number, not just that the two agree, so
		// moving either one is a deliberate act.
		expect(RRF_K).toBe(60)
		const one = fuseRanks([[item(1)]])[0]!
		expect(one.score).toBe(1 / 60)
		expect(
			rrfMerge([[{ id: 1, source: "worldLore", score: 0.99 }]], RRF_K)[0]!
				.score
		).toBe(one.score)
	})

	it("fuses in insertion order and sorts only at the top level", () => {
		// `rankSemantic` indexes its similarity matrix against the fused set, so
		// a fusion that sorted would diversify against the wrong candidates.
		// `rrf` is therefore the unsorted primitive and `fuseRanks` is the
		// sorted view of it.
		const orderings = [[item(3), item(1)], [item(1)]]
		expect(rrf(orderings).map((f) => f.item.id)).toEqual([3, 1])
		expect(fuseRanks(orderings).map((f) => f.item.id)).toEqual([1, 3])
	})
})

describe("disjoint orderings", () => {
	const item = (id: number, source = "worldLore") => ({ id, source })

	it("names the case fusion cannot do anything with", () => {
		// Three lore lanes: an entry is world lore or character lore or
		// history, never two. Fused, every score is that entry's position in
		// its own list and the `presetScore` stamped on the way out overrides
		// every signal weight downstream — which is what the shipped reply
		// pipeline did until spec 1.17.0.
		expect(
			disjointOrderings([
				[item(1), item(2)],
				[item(3, "characterLore")],
				[item(4, "history")]
			])
		).toBe(true)
	})

	it("is false the moment one entry is in two of them", () => {
		expect(disjointOrderings([[item(1), item(2)], [item(2)]])).toBe(false)
	})

	it("is false for fewer than two non-empty orderings", () => {
		// A mechanism returning nothing is an ordinary turn — no embedding model, no
		// keyword match — and complaining about it would train the reader to
		// ignore the complaint.
		expect(disjointOrderings([[item(1), item(2)], []])).toBe(false)
		expect(disjointOrderings([[item(1)]])).toBe(false)
		expect(disjointOrderings([])).toBe(false)
	})

	it("keys on source and id together, like the fusion it guards", () => {
		// Same id, different table: two unrelated entries, so two orderings
		// carrying them are still disjoint.
		expect(
			disjointOrderings([[item(1, "worldLore")], [item(1, "history")]])
		).toBe(true)
	})
})
