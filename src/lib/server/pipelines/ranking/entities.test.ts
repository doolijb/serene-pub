/**
 * The entity extractor.
 *
 * Read the `the three caveats` block first: those are the plan's own complaints
 * about `entityCooccurrenceSignal`, and each has an assertion here that fails if
 * the fix is undone. The rest is the sentence-start rule, which is the only
 * thing standing between "capitalised words" and "entities" without a model.
 */

import { describe, it, expect } from "vitest"
import {
	EXTRACTOR_VERSION,
	buildEvidenceProfile,
	buildGazetteer,
	entityKey,
	evidence,
	extractEntities,
	rarity
} from "$lib/server/pipelines/ranking/entities"

const names = (text: string, gaz = buildGazetteer([])) =>
	extractEntities(text, gaz).entities.map((e) => e.text)

const keys = (text: string, gaz = buildGazetteer([])) =>
	extractEntities(text, gaz).entities.map((e) => e.key)

describe("open extraction", () => {
	it("finds a capitalised name mid-sentence", () => {
		expect(names("I saw Kaelen at the gate.")).toEqual(["Kaelen"])
	})

	it("joins a run into one name", () => {
		expect(names("The Ashguard Riders passed at dawn.")).toEqual([
			"Ashguard Riders"
		])
	})

	it("joins across a particle", () => {
		expect(names("He answers to the Order of the Ashguard now.")).toEqual([
			"Order of the Ashguard"
		])
	})

	it("does not join across a sentence end", () => {
		/**
		 * ⚠ Found by the acceptance corpus, not by inspection. Without the
		 * boundary check the two capitals either side of a full stop merged and
		 * "Shut. The draught…" produced the entity *"Shut. The"* — which
		 * matched nothing, cost a slot in the cap, and made the receipt look
		 * like the extractor was broken, because it was.
		 */
		expect(names("Shut. The draught gets under the door.")).toEqual([])
	})

	it("drops a sentence opener nothing corroborates", () => {
		expect(names("Well met. And you.")).toEqual([])
	})

	it("keeps a sentence-opening name the passage uses again", () => {
		// "Vell" opens the second sentence and appears mid-sentence in the
		// third, which is the corroboration the rule is looking for.
		expect(
			names("What about your commander? Vell, is it? I met Vell once.")
		).toEqual(["Vell"])
	})

	it("judges a run on what is left after the leading article", () => {
		// "The" opens the sentence; "Ashguard" does not, so it needs no
		// corroboration of its own.
		expect(names("The Ashguard keep the wastes.")).toEqual(["Ashguard"])
	})

	it("strips a possessive", () => {
		expect(names("I carried Kaelen's sword.")).toEqual(["Kaelen"])
	})

	it("ignores a bare number and a single letter", () => {
		expect(names("She counted 40 of them. R was not among them.")).toEqual(
			[]
		)
	})

	it("records where each mention was, for an annotation to keep", () => {
		const [entity] = extractEntities(
			"Kaelen rode north. Nobody followed Kaelen."
		).entities
		expect(entity!.count).toBe(2)
		expect(entity!.spans).toHaveLength(2)
		expect(
			"Kaelen rode north. Nobody followed Kaelen.".slice(
				entity!.spans[1]!.start,
				entity!.spans[1]!.end
			)
		).toBe("Kaelen")
	})

	it("carries the extractor's identity", () => {
		// Persisted annotations are only valid for the extractor that produced
		// them, so the identity travels with the result rather than being
		// looked up later.
		expect(extractEntities("Kaelen.").extractorVersion).toBe(
			EXTRACTOR_VERSION
		)
	})
})

describe("the gazetteer tier", () => {
	const gaz = buildGazetteer([
		{ name: "Alice", ref: { kind: "character", id: 7 } },
		{ name: "Al", ref: { kind: "character", id: 7 } },
		{ name: "The Ashguard", ref: { kind: "entry", id: 41 } }
	])

	it("resolves a hit to the row it names", () => {
		const [entity] = extractEntities("alice went north.", gaz).entities
		expect(entity!.tier).toBe("gazetteer")
		expect(entity!.ref).toEqual({ kind: "character", id: 7 })
	})

	it("matches whatever the passage did with its shift key", () => {
		// The tier-two rules are about telling a name from a noun. A name the
		// world already knows needs no telling.
		expect(keys("the ashguard rode north.", gaz)).toEqual(["entry:41"])
	})

	it("makes a name and a nickname one entity, not two", () => {
		// The whole value of resolving: "Alice" and "Al" are one person, so a
		// count of distinct shared entities counts her once.
		expect(keys("Alice waited. Al did not.", gaz)).toEqual(["character:7"])
	})

	it("does not fire on a longer word — the substring caveat", () => {
		// ⚠ The plan's second complaint: matching was substring, so "Al" fired
		// on "Alchemy". A word boundary is the fix, and a two-letter name still
		// works, which is why there is no minimum length beyond one character.
		expect(keys("Alchemy is not her subject.", gaz)).toEqual([])
		expect(keys("Al is not.", gaz)).toEqual(["character:7"])
	})

	it("prefers the longer name when two overlap", () => {
		expect(keys("The Ashguard answered.", gaz)).toEqual(["entry:41"])
	})

	it("lets the first writer of a name keep it", () => {
		// The cast is supplied first, so a character called Vell resolves to
		// the character rather than to an entry titled after her.
		const g = buildGazetteer([
			{ name: "Vell", ref: { kind: "character", id: 3 } },
			{ name: "Vell", ref: { kind: "entry", id: 9 } }
		])
		expect(keys("Vell answered.", g)).toEqual([
			entityKey({ kind: "character", id: 3 })
		])
	})
})

/**
 * Design §13.9 — the correction that makes tier one work at all.
 *
 * The failure was measured on the parity corpus rather than reasoned about:
 * against a gazetteer of `alice`, `bob`, `the ashguard riders`,
 * `alice keeps vigil`, the window *"Well met. And you. Have you seen the
 * ashguard?"* extracted **nothing**. Two causes, both ordinary in written prose
 * — the reference is lower case, and it is not the whole authored title.
 */
describe("a title contributes its distinctive tokens, not only its full string", () => {
	/** The `session/entity-cooccurrence` fixture's own vocabulary, verbatim. */
	const corpus = buildGazetteer([
		{ name: "Alice", ref: { kind: "character", id: 1 } },
		{ name: "Bob", ref: { kind: "character", id: 2 } },
		{ name: "The Ashguard Riders", ref: { kind: "entry", id: 10 } },
		{ name: "Alice Keeps Vigil", ref: { kind: "entry", id: 11 } }
	])
	const window = "Well met. And you. Have you seen the ashguard?"

	it("finds the reference the fixture actually contains", () => {
		// The measurement this fix exists for: `[]` before, the entry now.
		expect(keys(window, corpus)).toEqual(["entry:10"])
	})

	it("still refuses a substring — looser keys, not looser matching", () => {
		// §4's second named caveat, and the guard that must survive the fix:
		// "Al" may not fire on "Alchemy", so recall is bought by widening what
		// counts as a *name*, never by relaxing how one is recognised.
		const g = buildGazetteer([
			{ name: "Al", ref: { kind: "character", id: 7 } },
			{ name: "The Ashguard Riders", ref: { kind: "entry", id: 10 } }
		])
		expect(keys("Alchemy and ashguarding are not it.", g)).toEqual([])
		expect(keys("Al rode with the ashguard.", g)).toEqual([
			"character:7",
			"entry:10"
		])
	})

	it("does not index the words a title is glued together with", () => {
		// "The" and "of" are keys nothing should resolve on, and "keeps" is the
		// verb the stoplist already holds — indexed, it would fire on "she
		// keeps her sword" in every entry of the book.
		for (const token of ["the", "of", "keeps"])
			expect([...corpus.byName.keys()]).not.toContain(token)
		expect([...corpus.byName.keys()]).toContain("ashguard")
		expect([...corpus.byName.keys()]).toContain("vigil")
	})

	it("keeps a whole name ahead of another name's token", () => {
		// Two passes, full names first: a token pulled out of a title can never
		// take a key some other row's whole name wanted.
		const g = buildGazetteer([
			{ name: "The Vigil Riders", ref: { kind: "entry", id: 10 } },
			{ name: "Vigil", ref: { kind: "character", id: 4 } }
		])
		expect(g.byName.get("vigil")).toEqual({ kind: "character", id: 4 })
	})

	it("gives a shared name to the cast and still resolves the entry titled after her", () => {
		// "Alice" is claimed by the character, because the cast is supplied
		// first — so a scene saying her name is about *her*. The entry titled
		// after her is not cut off by that: its own title still resolves to
		// itself, because the alternation prefers the longest match.
		expect(corpus.byName.get("alice")).toEqual({
			kind: "character",
			id: 1
		})
		expect(keys("Alice waited at the gate.", corpus)).toEqual([
			"character:1"
		])
		expect(keys("Alice Keeps Vigil is the third chapter.", corpus)).toEqual(
			["entry:11"]
		)
	})

	it("reports the fullest surface form a passage used", () => {
		// One identity described by its least specific mention makes a receipt
		// read like a bug. Length decides; the key is the same either way.
		const g = buildGazetteer([
			{ name: "Commander Vell", ref: { kind: "entry", id: 5 } }
		])
		const [entity] = extractEntities(
			"What about your commander? Commander Vell, is it?",
			g
		).entities
		expect(entity!.text).toBe("Commander Vell")
		expect(entity!.count).toBe(2)
	})
})

describe("the evidence", () => {
	const entries = [
		"The Ashguard An order of oathbound riders who answer to Commander Vell.",
		"Commander Vell The Ashguard's commander, who never removes her helm.",
		"Feast of Lanterns A midwinter festival of paper lanterns."
	]
	const gaz = buildGazetteer([
		{ name: "The Ashguard", ref: { kind: "entry", id: 1 } },
		{ name: "Commander Vell", ref: { kind: "entry", id: 2 } },
		{ name: "Feast of Lanterns", ref: { kind: "entry", id: 3 } }
	])
	const profile = (window: string) =>
		buildEvidenceProfile({ window, entryTexts: entries, gazetteer: gaz })
	const full = { entity: 1, vocabulary: 1 }

	it("grades on how many distinct entities are shared — the binary caveat", () => {
		// ⚠ The plan's first complaint: the old signal returned 1 on the first
		// hit, so an entry sharing one entity and an entry sharing twelve were
		// indistinguishable.
		const p = profile("Commander Vell rode out past the Feast of Lanterns.")
		const one = evidence(entries[1]!, p, full)
		const two = evidence(
			"An entry naming Commander Vell and the Feast of Lanterns both.",
			p,
			full
		)
		expect(two.entity).toBeGreaterThan(one.entity)
		expect(one.entity).toBeGreaterThan(0)
	})

	it("weighs an entity every entry names at almost nothing", () => {
		// An entity that is everywhere says nothing about which entry to pick —
		// which is bug 16's complaint about character lore, answered by the
		// rarity weight rather than by dropping the question.
		const everywhere = [
			"a The Ashguard",
			"b The Ashguard",
			"c The Ashguard"
		]
		const p = buildEvidenceProfile({
			window: "Tell me about the Ashguard.",
			entryTexts: everywhere,
			gazetteer: gaz
		})
		expect(evidence(everywhere[0]!, p, full).entity).toBeLessThan(0.25)
	})

	it("scores both sides — an entry naming what the conversation names", () => {
		// ⚠ The plan's third complaint is that the signal was one-sided. The
		// intersection is what is scored: entities are extracted from the
		// conversation and matched into the entry, so an entry that never says
		// "Ashguard" but does say "Commander Vell" still shares one.
		const p = profile("Who is in charge out there? Commander Vell, still?")
		expect(evidence(entries[0]!, p, full).shared).toContain("entry:2")
	})

	it("a strength of zero switches one kind of evidence off", () => {
		const p = profile("Commander Vell rode out.")
		const namesOnly = evidence(entries[0]!, p, {
			entity: 1,
			vocabulary: 0
		})
		expect(namesOnly.vocabulary).toBeGreaterThan(0)
		expect(namesOnly.total).toBe(namesOnly.entity)
	})

	it("presence multiplies, so an absent source scores nothing", () => {
		const p = profile("Commander Vell rode out.")
		expect(evidence(entries[0]!, p, full, 0).total).toBe(0)
	})
})

describe("smoothed rarity", () => {
	it("stays positive for a term in every document", () => {
		// The reason this is not `buildIdf`: `log(N / (1 + df))` is zero or
		// negative for every term on a two-message session and for anything
		// common on a long one, which is fine as a tf multiplier and wrong as a
		// weight inside an absolute threshold.
		expect(rarity(5, 5)).toBeGreaterThan(0)
		expect(rarity(1, 1)).toBeGreaterThan(0)
	})

	it("falls as a term spreads", () => {
		expect(rarity(1, 20)).toBeGreaterThan(rarity(10, 20))
		expect(rarity(10, 20)).toBeGreaterThan(rarity(20, 20))
	})
})
