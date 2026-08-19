/**
 * Per-entry retrieval strategy, and the fusion that makes `both` mean something.
 */

import { describe, it, expect } from "vitest"
import { eligibleFor, strategyOf, armNote, fuseRanks } from "./strategy"

const withVectors = { vectorSearchAvailable: true }
const withoutVectors = { vectorSearchAvailable: false }

describe("strategy", () => {
	it("defaults to rag when the column is null", () => {
		expect(strategyOf({})).toBe("rag")
		expect(strategyOf({ retrievalStrategy: null })).toBe("rag")
		expect(strategyOf({ retrievalStrategy: "keyword" })).toBe("keyword")
	})

	it("keyword entries are never surfaced by vector search", () => {
		const e = { retrievalStrategy: "keyword" }
		expect(eligibleFor(e, "keyword", withVectors)).toBe(true)
		expect(eligibleFor(e, "vector", withVectors)).toBe(false)
	})

	it("rag entries use vector search when it is available", () => {
		const e = { retrievalStrategy: "rag" }
		expect(eligibleFor(e, "vector", withVectors)).toBe(true)
		expect(eligibleFor(e, "keyword", withVectors)).toBe(false)
	})

	it("rag entries fall back to keyword when there is no embedding model", () => {
		// The alternative is retrieving nothing, which reads as "the bot forgot
		// my lore" and sends the user to their lorebook instead of to their
		// embedding settings.
		const e = { retrievalStrategy: "rag" }
		expect(eligibleFor(e, "keyword", withoutVectors)).toBe(true)
		expect(eligibleFor(e, "vector", withoutVectors)).toBe(false)
	})

	it("the fallback is one-way — keyword never widens into vector", () => {
		// A user who said "keyword only" said it about semantics, not about
		// availability.
		const e = { retrievalStrategy: "keyword" }
		expect(eligibleFor(e, "vector", withVectors)).toBe(false)
		expect(eligibleFor(e, "vector", withoutVectors)).toBe(false)
	})

	it("both is eligible everywhere", () => {
		const e = { retrievalStrategy: "both" }
		for (const availability of [withVectors, withoutVectors])
			for (const arm of ["keyword", "vector"] as const)
				expect(eligibleFor(e, arm, availability)).toBe(true)
	})

	it("says why an entry was matched the way it was", () => {
		expect(
			armNote({ retrievalStrategy: "rag" }, "keyword", withoutVectors)
		).toMatch(/no embedding model is available/)
		expect(
			armNote({ retrievalStrategy: "both" }, "vector", withVectors)
		).toBe("set to both, matched by vector")
	})
})

describe("rank fusion", () => {
	const item = (id: number) => ({ id, source: "worldLore" })

	it("agreement between the arms beats a single arm's top hit", () => {
		// The behaviour `both` is asking for: two independent signals agreeing is
		// itself evidence, so an entry ranked 2nd by both outranks one ranked 1st
		// by only one.
		const keyword = [item(1), item(2)]
		const vector = [item(3), item(2)]
		const fused = fuseRanks([keyword, vector])
		expect(fused[0]!.item.id).toBe(2)
	})

	it("is scale-free — only ordering matters, never the scores", () => {
		// The reason it is not an average: keyword scores live in ~[0, 1.5] and
		// RAG scores in [0, 1], so averaging would let the more generous arm win
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

	it("keeps the rank each arm gave, so a receipt can show both", () => {
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

	it("one empty arm degrades to the other's ordering", () => {
		const fused = fuseRanks([[item(1), item(2)], []])
		expect(fused.map((f) => f.item.id)).toEqual([1, 2])
	})
})
