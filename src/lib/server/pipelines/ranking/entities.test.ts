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

/**
 * D1 — a contraction is not a name.
 *
 * Found by a prototype run against real prose, not by inspection: `I'm`, `I've`,
 * `I'll` and `I'd` were open-tier entities, so **every first-person line**
 * contributed junk — and `I` is the one word English capitalises
 * unconditionally, so the shape occurs constantly.
 *
 * The cause is a mismatch between two halves of one design. `WORD` keeps the
 * apostrophe inside a token, while `SENTENCE_OPENERS` is a list of *stems* —
 * `don`, `isn`, `haven`, `won`, `couldn` are not English words, they are what
 * splitting a contraction leaves behind. So `i'm` was asked about and `i` was
 * never consulted. `stopwordForm` is the join.
 */
describe("a contraction is not a name", () => {
	it("drops the defect as reported", () => {
		// `open:i'm` before this fix, with the surface "I'm".
		expect(names("He said I'm fine.")).toEqual([])
	})

	it("drops it however many times the passage corroborates it", () => {
		/**
		 * ⚠ The reported example — a bare `I'm going to the market.` — already
		 * extracted nothing, because rule 1 drops an uncorroborated one-word
		 * sentence opener. That is *not* the stoplist working; it is a
		 * different rule masking the defect, and the mask comes off the moment
		 * the same contraction appears mid-sentence anywhere in the passage,
		 * because that is exactly what `corroborated` is. Two mentions, one
		 * junk entity, counted twice.
		 */
		expect(names("He said I'm fine. I'm leaving.")).toEqual([])
	})

	it("never lets one glue itself to the name after it", () => {
		// `open:i'm kaelen` before — a real name, unfindable, inside a key
		// nothing will ever match.
		expect(names("I'm Kaelen, and I ride north.")).toEqual(["Kaelen"])
	})

	it("handles the class, not the four first-person cases", () => {
		/**
		 * The stems are all already in `SENTENCE_OPENERS`, which is the whole
		 * point: the list was written for this lookup and was never given it.
		 * Each word sits mid-sentence after an opening quote, which is where a
		 * capitalised contraction actually occurs in prose.
		 */
		for (const word of [
			"I'm",
			"I've",
			"I'll",
			"I'd",
			"Don't",
			"We're",
			"They'll",
			"Can't",
			"Won't",
			"That's",
			"You're",
			"He'd",
			"She'll",
			"There's",
			"Isn't",
			"Wasn't",
			"Couldn't"
		])
			expect(names(`She heard "${word} coming" through the door.`)).toEqual(
				[]
			)
	})

	it("still names somebody whose name contains an apostrophe", () => {
		/**
		 * ⚠ The guard on the clitic rule, and the reason it is anchored to the
		 * end with a closed alternation rather than cutting at the first
		 * apostrophe. Cut there and `D'Angelo` becomes `d` and `O'Brien`
		 * becomes `o`, both below `MIN_ALIAS_LENGTH` — which would delete the
		 * Irish and Norman half of most fantasy casts from the open tier. A
		 * false negative bought with a false positive is not a fix.
		 */
		expect(names("He met D'Angelo at the gate.")).toEqual(["D'Angelo"])
		expect(names("The letter was for O'Brien. He met O'Brien later.")).toEqual(
			["O'Brien"]
		)
		/**
		 * ⚠ The cases that actually kill the loose rule, and the reason the two
		 * above are not enough on their own: over-stripping only costs a name
		 * when what is left is *in the stoplist*, and `d` and `o` are not. A
		 * fantasy name apostrophised on a function word is, and that shape is
		 * everywhere in the genre this extractor reads.
		 */
		expect(names("He met Do'Urden at the gate.")).toEqual(["Do'Urden"])
		expect(names("He met An'she at the gate.")).toEqual(["An'she"])
		expect(names("He met We'lan at the gate.")).toEqual(["We'lan"])
		/**
		 * ⚠ And the `$`, which is what makes the rule *trailing* clitic rather
		 * than *any* clitic. Constructed, and said plainly: killing this one
		 * needs a name whose **internal** fragment is itself a function word,
		 * and no ordinary English name is. It is here because an untested guard
		 * is one a later reader deletes as redundant — `He'ver` becomes `her`
		 * without it, and `her` is in the stoplist.
		 */
		expect(names("He met He'ver at the gate.")).toEqual(["He'ver"])
	})

	it("still strips a possessive rather than reading it as a clitic", () => {
		// `'s` is in both rules; the possessive one runs first and wins, so the
		// name survives instead of being cut back to a stem.
		expect(names("I carried Kaelen's sword.")).toEqual(["Kaelen"])
	})
})

/**
 * D2 — a dialogue tag names a speaker, not a place-and-a-speaker.
 *
 * `"Lowmarket," Cade said` produced the single entity `Lowmarket," Cade`.
 * Measured at 3–8% of open-tier extractions, and it matters far more than that
 * rate suggests: quote-then-tag is the commonest sentence shape in roleplay
 * prose, and it fires on exactly the **names** the open tier exists to catch. A
 * key with a quote and a comma inside it matches nothing in any entry, costs a
 * slot in `MAX_ENTITIES`, and loses *both* real names.
 *
 * The cause is not dialogue. `SENTENCE_END` has no comma in it — correctly, a
 * comma does not end a sentence — so the run builder saw two capitals with
 * nothing between them. `JOIN_GAP` is the missing half of that answer: a run
 * joins across whitespace and nothing else.
 */
describe("a run never crosses punctuation", () => {
	it("splits the defect as reported", () => {
		expect(names('"Lowmarket," Cade said.')).toEqual(["Cade"])
		expect(keys('"Lowmarket," Cade said.')).not.toContain(
			'open:lowmarket," cade'
		)
	})

	it("keeps the quoted name too when the quote does not open on it", () => {
		// Both names, from the sentence that used to yield neither. "Now" is a
		// sentence opener and "Go" is one as well, so what is left is what was
		// named.
		expect(names('"Go to Lowmarket," Cade said. "Now."')).toEqual([
			"Lowmarket",
			"Cade"
		])
	})

	it("handles the whole tag class", () => {
		for (const line of [
			'"Lowmarket," Cade said.',
			'"Lowmarket," said Cade.',
			'"Run!" Cade shouted.',
			'"Where?" Cade asked.',
			'"Go." Cade said.',
			'"Cade said nothing," Vell noted.'
		])
			expect(names(line)).toContain("Cade")
	})

	it("splits every separator, not only the one in a dialogue tag", () => {
		/**
		 * The defect is a rule about separators, so the class is separators.
		 * Each of these was one entity before — `Kaelen, Vell`, `Kaelen (Vell`,
		 * `Kaelen - Vell` — and each is two names.
		 */
		expect(names("He met Kaelen, Vell and Bram.")).toEqual([
			"Kaelen",
			"Vell",
			"Bram"
		])
		expect(names("He met Kaelen (Vell was late).")).toEqual([
			"Kaelen",
			"Vell"
		])
		expect(names("He met Kaelen - Vell rode on.")).toEqual([
			"Kaelen",
			"Vell"
		])
	})

	it("still joins the multi-word names that whitespace holds together", () => {
		/**
		 * ⚠ The false-negative direction of the same guard, and the reason it
		 * is whitespace rather than "no punctuation anywhere". A fix that split
		 * these would trade a junk key that ranks low for a real name that is
		 * never extracted at all, which is the worse of the two.
		 */
		expect(names("The Ashguard Riders passed at dawn.")).toEqual([
			"Ashguard Riders"
		])
		expect(names("He answers to the Order of the Ashguard now.")).toEqual([
			"Order of the Ashguard"
		])
		expect(names('"Run!" Commander Vell shouted.')).toEqual([
			"Commander Vell"
		])
		// `WORD` keeps a hyphen inside a token, so only a *spaced* dash is a
		// separator. A hyphenated name is one word and never saw this rule.
		expect(names("He met Ash-Guard at dawn.")).toEqual(["Ash-Guard"])
	})

	it("does not let a particle bridge a run across punctuation", () => {
		/**
		 * The bridge that admits "Order **of the** Ashguard" has to hold to the
		 * same rule at every step, or a run crosses on a particle what it may
		 * not cross directly. Both halves are load-bearing: the first line
		 * mutation-tests the check inside the walk, the second the check after
		 * it.
		 */
		expect(names("He answers to the Order of, the Ashguard now.")).toEqual([
			"Order",
			"Ashguard"
		])
		expect(names('He answers to the Order of "Ashguard" now.')).toEqual([
			"Order",
			"Ashguard"
		])
	})
})

/**
 * The half of the tag class that failed in the other direction.
 *
 * `"Run!" Cade shouted` never merged — `!` is a sentence end, so the run broke
 * cleanly — and it extracted **nothing at all**, because `Cade` then looked like
 * a one-word sentence-initial capital that the passage never repeats. The
 * terminator belongs to the *quoted* sentence; `Cade shouted` is the outer one
 * and `Cade` is its subject.
 *
 * So the same defect class was silent on the speaker in its most-used half. A
 * fix for the merge alone would leave that silence in place, and a name that is
 * never extracted is worse than a junk token that ranks low.
 */
describe("a speech tag corroborates the name in it", () => {
	it("recovers the speaker the sentence-start rule was dropping", () => {
		expect(names('"Run!" Cade shouted.')).toEqual(["Cade"])
		expect(names('"Where?" Cade asked.')).toEqual(["Cade"])
		expect(names('"Go." Cade said.')).toEqual(["Cade"])
	})

	it("reads the quote whatever shape the client typed it in", () => {
		// Curly quotes are what most editors and phone keyboards produce, and a
		// straight-only test would pass while the fix reached almost nobody.
		expect(names("\u201cRun!\u201d Cade shouted.")).toEqual(["Cade"])
		expect(names("\u00abRun!\u00bb Cade shouted.")).toEqual(["Cade"])
	})

	it("needs the quote — a verb of speaking alone is not a tag", () => {
		/**
		 * ⚠ Mutation test for the first guard, and the deliberate limit at the
		 * same time: a paragraph-initial *"Cade said nothing"* is **out of
		 * scope** and stays silent. Drop the quote requirement to reach it and
		 * *"Silence answered."* becomes an entity — the quote is what says a
		 * speaker is being named rather than a subject described.
		 */
		expect(names("Cade said nothing at all.")).toEqual([])
		expect(names("Silence answered.")).toEqual([])
	})

	it("needs the verb — a capital after a quote is not a speaker", () => {
		// ⚠ Mutation test for the second guard. Without `SPEECH_VERBS` every
		// capitalised word opening the sentence after a closed quote is an
		// entity, which is most narration.
		expect(names('"Go home." Silence fell.')).toEqual([])
		expect(names('"Go home." Rain hammered the roof.')).toEqual([])
	})

	it("needs the verb against the name, with only whitespace between", () => {
		// ⚠ Mutation test for the third guard. Same principle as `JOIN_GAP`:
		// punctuation separates, so the verb after a comma is somebody else's.
		expect(names('"Go home." Silence, said the man.')).toEqual([])
	})

	it("does not read a verb on the next line as this name's tag", () => {
		/**
		 * ⚠ Mutation test for the fourth guard, and the one case the third does
		 * not cover: a newline is whitespace *and* a sentence end, so it joins
		 * by `JOIN_GAP` and separates by `SENTENCE_END`. Action and dialogue
		 * lines in roleplay are newline-separated far more often than they are
		 * punctuated, which is why `SENTENCE_END` lists `\n` in the first place.
		 */
		expect(names('"Go home." Silence\nsaid the man.')).toEqual([])
	})

	it("keeps the open tier open around the fix", () => {
		/**
		 * The whole point of tier two: a name the gazetteer does not know is
		 * still found. `Alice` resolves to her row, and the two the world has
		 * never heard of are still extracted — one from inside the quote, one
		 * from the tag.
		 */
		const gaz = buildGazetteer([
			{ name: "Alice", ref: { kind: "character", id: 1 } }
		])
		expect(keys('"Alice, this is Emberfall," Cade said.', gaz)).toEqual([
			"character:1",
			"open:emberfall",
			"open:cade"
		])
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
