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
import {
	keywordQuery,
	normaliseTfidf,
	type LoreRow
} from "$lib/server/pipelines/ranking/keywordQuery"
import { DEFAULT_RETRIEVAL } from "$lib/server/pipelines/ranking/weights"

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

/**
 * Recursion: an entry's content is the next pass's scan window.
 *
 * The case this exists for is a lorebook that describes a place, and separately
 * the person who runs it. One pass can only bring in whichever of the two was
 * named out loud; the other is exactly the context the model needed.
 */
describe("recursive triggering", () => {
	const place = entry({
		id: 1,
		name: "The Ashguard",
		keys: "ashguard",
		content: "An order of oathbound riders, led by Commander Vell."
	})
	const person = entry({
		id: 2,
		name: "Vell",
		keys: "vell",
		content: "A commander who never removes her helm."
	})

	const deep = (n: number) => ({ ...DEFAULT_RETRIEVAL, maxRecursionDepth: n })

	it("does not recurse at all by default, which is every release before this", () => {
		const r = run([place, person], ["the ashguard rode north"])
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.diagnostics.recursionDepth).toBe(0)
	})

	it("pulls in an entry named only by another entry's content", () => {
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(1)
		})
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])
		expect(r.diagnostics.recursionDepth).toBe(1)
	})

	it("stops at the ceiling", () => {
		// A three-link chain against a ceiling of one reaches the second and
		// not the third.
		const third = entry({
			id: 3,
			name: "The Helm",
			keys: "helm",
			content: "Iron."
		})
		const r = run([place, person, third], ["the ashguard rode north"], {
			retrieval: deep(1)
		})
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])

		const deeper = run(
			[place, person, third],
			["the ashguard rode north"],
			{
				retrieval: deep(2)
			}
		)
		expect(deeper.candidates.map((c) => c.id).sort()).toEqual([1, 2, 3])
		expect(deeper.diagnostics.recursionDepth).toBe(2)
	})

	it("stops early when a pass finds nothing, rather than walking to the ceiling", () => {
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(9)
		})
		expect(r.diagnostics.recursionDepth).toBe(1)
	})

	it("honours an entry that asked to be reachable from the conversation only", () => {
		const r = run(
			[place, { ...person, recursionDepth: 0 }],
			["the ashguard rode north"],
			{ retrieval: deep(3) }
		)
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		// And it is reported as unmatched rather than quietly absent.
		expect(r.skipped.find((s) => s.id === 2)).toBeTruthy()
	})

	it("terminates on a cycle instead of scanning forever", () => {
		// Two entries naming each other. Nothing may be matched twice, which is
		// what makes this terminate — not a visited-pair check bolted on top.
		const a = entry({
			id: 1,
			name: "A",
			keys: "alpha",
			content: "See beta."
		})
		const b = entry({
			id: 2,
			name: "B",
			keys: "beta",
			content: "See alpha."
		})
		const r = run([a, b], ["alpha"], { retrieval: deep(50) })
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])
		expect(r.diagnostics.matched).toBe(2)
	})

	it("does not report an entry as unmatched that a later pass went on to find", () => {
		// The receipt contradicting the prompt is the failure this orders
		// against: `skipped` is written after the last pass, not during each.
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(1)
		})
		expect(r.skipped.map((s) => s.id)).not.toContain(2)
	})

	it("still reports a disabled entry once, not once per pass", () => {
		const off = entry({ id: 2, enabled: false, keys: "vell" })
		const r = run([place, off], ["the ashguard rode north"], {
			retrieval: deep(3)
		})
		expect(r.skipped.filter((s) => s.id === 2)).toHaveLength(1)
	})

	it("reads a negative ceiling as none, not as unlimited", () => {
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(-1)
		})
		expect(r.candidates.map((c) => c.id)).toEqual([1])
	})
})

/**
 * The three lore tables have independent identity sequences.
 *
 * ⚠ A world-lore entry and a history entry both being row 1 is the *normal*
 * case on a young lorebook, and for one commit the recursion pass keyed its
 * "already handled" set on `entry.id` alone — so the first one settled the
 * second, which then disappeared without turning up in `skipped` either.
 * Silent, and indistinguishable from "no key matched".
 */
describe("entries from different tables can share an id", () => {
	const rows: LoreRow[] = [
		{
			id: 1,
			source: "worldLore",
			name: "The Ashguard",
			content: "An order of oathbound riders.",
			keys: "ashguard"
		},
		{
			id: 1,
			source: "history",
			name: "The Siege",
			content: "The siege broke in the spring.",
			keys: "ashguard"
		},
		{
			id: 1,
			source: "characterLore",
			name: "Vell's oath",
			content: "She swore it twice.",
			keys: "ashguard"
		}
	]

	it("matches all three rather than only the first", () => {
		const r = run(rows, ["the ashguard rode north"])
		expect(r.candidates.map((c) => c.source).sort()).toEqual([
			"characterLore",
			"history",
			"worldLore"
		])
	})

	it("accounts for all three when none of them match", () => {
		// The other half: a settled-set collision would also hide an entry from
		// `skipped`, so "nothing matched" and "we never looked" read alike.
		const r = run(rows, ["nothing relevant here"])
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped.map((s) => s.source).sort()).toEqual([
			"characterLore",
			"history",
			"worldLore"
		])
	})

	it("settles them separately across a recursion pass", () => {
		const r = run(rows, ["the ashguard rode north"], {
			retrieval: { ...DEFAULT_RETRIEVAL, maxRecursionDepth: 2 }
		})
		expect(r.candidates).toHaveLength(3)
		// Each exactly once — a set keyed only by source would collide the
		// other way and re-add an entry on every level.
		expect(
			new Set(r.candidates.map((c) => `${c.source}:${c.id}`)).size
		).toBe(3)
	})
})
