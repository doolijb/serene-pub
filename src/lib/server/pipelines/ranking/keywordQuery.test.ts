/**
 * The keyword arm.
 *
 * The assertions to read are the ones about `skipped`. A retrieval stage that
 * returns only its hits cannot distinguish "nothing matched" from "your entry
 * is disabled" from "this entry is set to rag" — three different user problems
 * with three different fixes, and today all three present identically as
 * missing lore.
 */

import { describe, it, expect } from "vitest"
import { keywordQuery, normaliseTfidf, type LoreRow } from "./keywordQuery"
import { DEFAULT_RETRIEVAL } from "./weights"

const entry = (over: Partial<LoreRow> = {}): LoreRow => ({
	id: 1,
	source: "worldLore",
	name: "The Ashguard",
	content: "An order of oathbound riders.",
	keys: "ashguard",
	...over
})

const run = (
	entries: LoreRow[],
	contents: string[],
	over: Partial<Parameters<typeof keywordQuery>[0]> = {}
) =>
	keywordQuery({
		entries,
		messages: contents.map((content, i) => ({ id: i + 1, content })),
		entityNames: [],
		retrieval: DEFAULT_RETRIEVAL,
		availability: { vectorSearchAvailable: false },
		countTokens: (text) => Math.ceil(text.length / 4),
		...over
	})

describe("keyword query", () => {
	it("returns entries whose keys matched", () => {
		const r = run([entry()], ["the ashguard rode north"])
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.candidates[0]!.signals.keyword).toBe(1)
	})

	it("an entry whose name matched counts, even with no key hit", () => {
		const r = run(
			[entry({ keys: "nothing" })],
			["I saw the Ashguard today"]
		)
		expect(r.candidates).toHaveLength(1)
		expect(r.candidates[0]!.signals.nameMatch).toBe(1)
	})

	it("counts tokens once, up front", () => {
		const r = run([entry()], ["ashguard"])
		expect(r.candidates[0]!.tokens).toBe(
			Math.ceil(entry().content.length / 4)
		)
	})

	it("respects the configured scan depth", () => {
		const messages = [
			"ashguard was here",
			...Array.from({ length: 20 }, () => "quiet")
		]
		const shallow = run([entry()], messages)
		expect(shallow.candidates).toHaveLength(0)

		const deep = run([entry()], messages, {
			retrieval: { ...DEFAULT_RETRIEVAL, scanDepth: 50 }
		})
		expect(deep.candidates).toHaveLength(1)
	})

	it("honours per-entry match mode", () => {
		const hearth = ["she warmed her hands by the hearth"]
		expect(run([entry({ keys: "art" })], hearth).candidates).toHaveLength(1)
		expect(
			run([entry({ keys: "art", matchMode: "word" })], hearth).candidates
		).toHaveLength(0)
	})
})

describe("what it declines, and why", () => {
	it("a disabled entry is reported, not silently absent", () => {
		const r = run([entry({ enabled: false })], ["ashguard"])
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped[0]!.reason).toMatch(/disabled/)
	})

	it("a no-match says how far it looked", () => {
		const r = run([entry()], ["nothing relevant here"])
		expect(r.skipped[0]!.reason).toMatch(
			/no key matched in the last 10 messages/
		)
	})

	it("an entry belonging to the other arm says so rather than looking absent", () => {
		const r = run([entry({ retrievalStrategy: "rag" })], ["ashguard"], {
			availability: { vectorSearchAvailable: true }
		})
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped[0]!.reason).toMatch(/vector search/)
	})

	it("a rag entry falls back to this arm when there are no embeddings", () => {
		const r = run([entry({ retrievalStrategy: "rag" })], ["ashguard"], {
			availability: { vectorSearchAvailable: false }
		})
		expect(r.candidates).toHaveLength(1)
	})

	it("a keyword-only entry is considered whether or not vectors exist", () => {
		for (const vectorSearchAvailable of [true, false]) {
			const r = run(
				[entry({ retrievalStrategy: "keyword" })],
				["ashguard"],
				{
					availability: { vectorSearchAvailable }
				}
			)
			expect(r.candidates).toHaveLength(1)
		}
	})
})

describe("constant entries", () => {
	it("are candidates with no match at all, and marked pinned", () => {
		const r = run([entry({ constant: true, keys: "" })], ["unrelated"])
		expect(r.candidates[0]!.pinned).toBe(true)
	})

	it("still pass through this arm, so the receipt shows where they came from", () => {
		// Rather than being injected downstream from nowhere, which is what makes
		// a pinned entry look like a bug to whoever is reading the run.
		const r = run([entry({ constant: true, keys: "" })], ["unrelated"])
		expect(r.diagnostics.considered).toBe(1)
	})

	it("a disabled constant entry is still disabled", () => {
		const r = run([entry({ constant: true, enabled: false })], ["x"])
		expect(r.candidates).toHaveLength(0)
	})
})

describe("tf-idf normalisation", () => {
	it("is deferred to the pool, because two arms share it", () => {
		// Normalising inside one arm would normalise against that arm alone and
		// make the two incomparable — the engine scores twice for this reason.
		const r = run(
			[
				entry({ id: 1, keys: "ashguard" }),
				entry({ id: 2, keys: "banner" })
			],
			["ashguard banner"]
		)
		const normalised = normaliseTfidf(r.candidates)
		const max = Math.max(...normalised.map((c) => c.signals.tfidf ?? 0))
		expect(max).toBeLessThanOrEqual(1)
	})

	it("an all-zero pool does not divide by zero", () => {
		const normalised = normaliseTfidf([
			{ id: 1, source: "worldLore", tokens: 1, signals: { tfidf: 0 } }
		])
		expect(normalised[0]!.signals.tfidf).toBe(0)
	})
})
