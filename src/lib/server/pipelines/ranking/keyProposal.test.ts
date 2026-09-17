/**
 * The rules `proposeKeys` runs on, each asserted with the mutation that breaks it.
 *
 * ⚠ **This file asserts rules; it does not establish that the mechanism is
 * useful.** Every test here can pass on a proposer nobody should wire in —
 * a guard is only evidence that a particular bad key is impossible, never that
 * the good ones arrive. What the mechanism actually does to recall and to
 * over-firing is `measure/keyProposalCorpus.test.ts`, and the two files are
 * deliberately not merged: a guard proved here and a number measured there are
 * different kinds of claim.
 *
 * Every guard below is written as a pair — the fixture where the rule holds, and
 * the same fixture with the rule's input withheld or its bound opened, showing
 * the bad key arriving. A guard whose removal changes nothing is not a guard,
 * and the pairing is what stops one being added.
 */

import { describe, it, expect } from "vitest"
import {
	proposeKeys,
	footprint,
	ridesInsideWords,
	roundTrip,
	KEY_PROPOSER_VERSION,
	MAX_KEYS,
	MAX_TERM_KEYS,
	MIN_KEY_LENGTH
} from "$lib/server/pipelines/ranking/keyProposal"
import type { GazetteerName } from "$lib/server/pipelines/ranking/entities"

const CAST: GazetteerName[] = [
	{ name: "Cade", ref: { kind: "character", id: 1 } },
	{ name: "Captain Vell", ref: { kind: "character", id: 2 } },
	// Nix stands in for a persona cast member — since the 0133 merge a persona
	// IS a character row, so its ref carries the same "character" kind.
	{ name: "Nix", ref: { kind: "character", id: 7 } }
]

const keysOf = (input: Parameters<typeof proposeKeys>[0]) =>
	proposeKeys(input).keys.map((k) => k.key)

const reasonFor = (
	input: Parameters<typeof proposeKeys>[0],
	candidate: string
) => proposeKeys(input).rejected.find((r) => r.candidate === candidate)?.reason

describe("proposeKeys — nothing invented", () => {
	/**
	 * ⚠ The property the whole file rests on. A mechanism that cannot
	 * hallucinate needs no review for hallucination, which is the entire reason
	 * this is worth doing without a model.
	 */
	it("every key is a substring of the source, lowercased", () => {
		const text =
			"Cade left the sealed writ beneath the cistern grate at Lowmarket, where the Ashguard Riders would not think to look before the bells."
		const corpus = [
			"Lowmarket is the lower ward's market square, over an old cistern.",
			"The Ashguard Riders patrol the ward gates and read proclamations.",
			"A writ carries a guild seal and the seal is worth more than the writ.",
			"The bells of the ward gate can be heard from the tanners' yards."
		]
		for (const key of keysOf({ text, corpus, cast: CAST })) {
			expect(text.toLowerCase()).toContain(key)
			expect(roundTrip(key, text)).toBe(true)
		}
	})

	it("blank text proposes nothing and says nothing was considered", () => {
		expect(proposeKeys({ text: "   \n  " })).toEqual({
			proposerVersion: KEY_PROPOSER_VERSION,
			keys: [],
			rejected: [],
			corpusSize: 0
		})
	})

	it("is deterministic — two runs over one passage agree", () => {
		const args = {
			text: "The Ashguard Riders mustered at the ward gates and read the proclamation aloud to the crowd.",
			corpus: ["The Order of the Ward keeps the gates.", "A crowd gathers."],
			cast: CAST
		}
		expect(keysOf(args)).toEqual(keysOf(args))
	})
})

describe("⚠ gate 1 — a name the cast answers to is never a key", () => {
	const text =
		"Cade met Captain Vell at the Thornfield granary. Vell would not say what Nix had told her."
	// ⚠ Five documents, not two. On a very small book a *share* ceiling is
	// strict — one hit of two is half — so a two-entry corpus would refuse
	// `thornfield` and the fixture would be measuring the corpus size rather
	// than the cast guard. `MAX_CORPUS_FRACTION` carries that finding.
	const corpus = [
		"Thornfield lies a day north of the walls and its granary takes the tithe.",
		"The granary loft collapsed in the fire.",
		"The mill race is the only fast water inside the walls.",
		"Saltgate is the harbour quarter and the wharves run its length.",
		"The Order of the Ward keeps the gates and reads proclamations."
	]

	it("refuses the name, the alias and the words of a multi-word name", () => {
		const keys = keysOf({ text, corpus, cast: CAST })
		expect(keys).not.toContain("cade")
		expect(keys).not.toContain("vell")
		expect(keys).not.toContain("captain vell")
		// The distinctive word of a multi-word cast name goes with it: an entry
		// keyed `captain` fires on every scene with an officer in it.
		expect(keys).not.toContain("captain")
	})

	it("refuses a persona as readily as a character", () => {
		expect(keysOf({ text, corpus, cast: CAST })).not.toContain("nix")
	})

	it("keeps what the passage is about", () => {
		expect(keysOf({ text, corpus, cast: CAST })).toContain("thornfield")
	})

	/**
	 * ⚠ The mutation. With the cast withheld and nothing else changed, exactly
	 * the refused names come back — so the guard is what removed them and not
	 * some other bound doing it incidentally.
	 */
	it("withheld, the cast names become keys", () => {
		const keys = keysOf({ text, corpus, cast: [] })
		expect(keys).toContain("cade")
		expect(keys.some((k) => k.includes("vell"))).toBe(true)
	})

	it("names the reason, so a reviewer is not sent to read the code", () => {
		expect(reasonFor({ text, corpus, cast: CAST }, "cade")).toBe(
			"names a character in the cast"
		)
	})

	/**
	 * ⚠ **The second reading of the gazetteer, and the hole it closes.**
	 *
	 * `extractEntities` keeps only `MAX_ENTITIES` (32) of what it finds, most
	 * mentioned first — so on a passage naming more things than that, a cast
	 * member mentioned once falls off the end and reaches the gate as an
	 * ordinary *word* rather than as a resolved entity. Checking `entity.ref`
	 * alone would let it straight through.
	 *
	 * The fixture is synthetic because the situation is: forty proper nouns each
	 * named twice, and Vell named once.
	 */
	it("refuses a cast name that fell off the entity cap and arrived as a word", () => {
		const crowd = Array.from({ length: 40 }, (_, i) => {
			const name = `Zephyrite${String.fromCharCode(65 + (i % 26))}${i}`
			return `the ${name} and the ${name} again`
		}).join(", and ")
		const text = `The muster listed ${crowd}, and vell was not among them.`
		// A corpus, because a bare word on an empty one is refused by gate 3
		// before gate 1 is ever asked — see the cold-start fixture below.
		const corpus = [
			"The muster is read at the ward gates every quarter.",
			"The Order of the Ward keeps a list of who answered.",
			"A courier missed the last muster and was not asked why.",
			"The gates are closed at the third bell.",
			"Nobody has held the harbour turn for a season."
		]
		// The cap is lifted on both halves so the *guard* is what is being
		// observed: at five keys the forty invented names fill the list and
		// `vell`'s absence would prove only that it ranked last.
		const wide = { maxKeys: 50, maxTermKeys: 50 }
		expect(keysOf({ text, corpus, cast: CAST, options: wide })).not.toContain(
			"vell"
		)
		// The mutation: with no cast the same word is proposed, which is what
		// says the entity cap really did drop it and `byName` really did catch it.
		expect(keysOf({ text, corpus, cast: [], options: wide })).toContain("vell")
	})

	/**
	 * An entry title is **not** refused. A thing the lorebook has a row for is a
	 * subject, not a participant, and a scene about the Ashguard Riders should be
	 * reachable by saying so.
	 */
	it("does not refuse a name that resolves to an entry", () => {
		const keys = keysOf({
			text: "The Ashguard Riders read the proclamation at the ward gates.",
			corpus: ["The Order of the Ward keeps the gates."],
			cast: CAST,
			entryNames: [
				{
					name: "The Ashguard Riders",
					ref: { kind: "entry", id: 40 }
				}
			]
		})
		expect(keys.some((k) => k.includes("ashguard"))).toBe(true)
	})
})

describe("⚠ gate 2 — a key may not already fire on most of the lorebook", () => {
	const text =
		"The watch held the cistern road all night, and the tanners went on working."
	/**
	 * ⚠ Eight documents, `watch` in three of them.
	 *
	 * Sized so that this gate is the *only* one that can refuse it: three of
	 * eight is 0.375, past the quarter ceiling, while its idf over the nine
	 * documents the ranker counts is comfortably above `MIN_DISTINCTIVENESS`. On
	 * a four-document corpus both gates refuse it and the fixture would prove
	 * nothing about which.
	 */
	const corpus = [
		"The night watch keeps a rota of four turns between the bells.",
		"Vell commands the watch and keeps the ledger.",
		"The watch has never held the harbour quarter for a season.",
		"The tanners work the water that comes off the old cistern.",
		"Anvil Row runs behind the yards and six forges work it.",
		"Thornfield lies a day north and its granary takes the tithe.",
		"Saltgate is the harbour quarter and most smuggling comes through it.",
		"The mill race is the only fast water inside the walls."
	]

	it("refuses the word three of four entries already carry", () => {
		expect(keysOf({ text, corpus, cast: CAST })).not.toContain("watch")
		expect(reasonFor({ text, corpus, cast: CAST }, "watch")).toBe(
			"already matches 3 of 8 other entries"
		)
	})

	/**
	 * The mutation, and the budgets are opened on **both** halves of it.
	 *
	 * `watch` is the *least* distinctive word in the passage — that is the whole
	 * point of the fixture — so at five keys the rarer words fill the list and
	 * its absence would prove nothing about the ceiling. With the budget wide on
	 * both runs, the ceiling is the only thing that differs.
	 */
	it("opened to 1.0, the same word is proposed", () => {
		const wide = { maxKeys: 12, maxTermKeys: 12 }
		expect(
			keysOf({
				text,
				corpus,
				cast: CAST,
				options: { ...wide, maxCorpusFraction: 1 }
			})
		).toContain("watch")
		expect(keysOf({ text, corpus, cast: CAST, options: wide })).not.toContain(
			"watch"
		)
	})

	/** The count is over the *other* entries — the subject is never its own evidence. */
	it("counts the rest of the book and not the passage itself", () => {
		expect(footprint("watch", corpus)).toBe(3)
		expect(footprint("watch", [])).toBe(0)
	})
})

describe("⚠ gate 3 — a bare word must be distinctive; a name need not be", () => {
	/**
	 * The cold start: the first entry a lorebook ever gets. There is no
	 * collection to measure a share against, so `MAX_CORPUS_FRACTION` has
	 * nothing to say and this is the only thing standing between the proposal and
	 * five ordinary words.
	 */
	it("with no corpus at all, proposes names and refuses every bare word", () => {
		const keys = keysOf({
			text: "Cade hid the writ beneath the cistern grate at Lowmarket before the bells.",
			corpus: [],
			cast: CAST
		})
		expect(keys).toEqual(["lowmarket"])
		expect(keys).not.toContain("writ")
		expect(keys).not.toContain("grate")
	})

	it("the floor removed, the bare words arrive", () => {
		const keys = keysOf({
			text: "Cade hid the writ beneath the cistern grate at Lowmarket before the bells.",
			corpus: [],
			cast: CAST,
			options: { minDistinctiveness: 0 }
		})
		expect(keys).toContain("writ")
	})
})

describe("⚠ gate 4 — a key may not be a fragment of a longer word", () => {
	const text =
		"Marek recognised the Pewterers' mark on the seal and refused the work."
	const corpus = [
		"Lowmarket is the lower ward's market square, raised over an old cistern.",
		"The Pewterers' Guild keeps a hall on the cistern road."
	]

	/**
	 * ⚠ The measured case. `mark` cleared every other ceiling — it is a rare
	 * token and sits in a small share of the book — and fired a forge scene on a
	 * conversation that said **Low**mark**et**. Neither count can see it, because
	 * the defect is not how many documents it hits but what it hits inside them.
	 */
	it("refuses a key that sits inside a longer word the book uses", () => {
		expect(keysOf({ text, corpus, cast: CAST })).not.toContain("mark")
		expect(reasonFor({ text, corpus, cast: CAST }, "mark")).toBe(
			"it sits inside longer words this lorebook already uses"
		)
	})

	it("with no such word in the book, the same key is fine", () => {
		expect(
			keysOf({
				text,
				corpus: ["The Pewterers' Guild keeps a hall on the cistern road."],
				cast: CAST
			})
		).toContain("mark")
	})

	/**
	 * ⚠ **The left boundary only, and the asymmetry is the design.** Requiring a
	 * boundary on both sides would throw away the one thing substring matching is
	 * good at — inflection — while keeping the fragment problem solved. So a key
	 * that is a *prefix* of a longer word is allowed and one that is *embedded*
	 * is not.
	 */
	it("allows a key that other words merely extend", () => {
		expect(ridesInsideWords("rider", ["The riders patrol the gates."])).toBe(
			false
		)
		expect(ridesInsideWords("art", ["He sat by the hearth."])).toBe(true)
		expect(ridesInsideWords("mark", ["Lowmarket, and the market."])).toBe(true)
	})
})

describe("the shape a key has to be in for the matcher to find it", () => {
	/**
	 * ⚠ `normalise` collapses whitespace and a scan window does not, so a
	 * two-word name written with a double space normalises to a key `indexOf`
	 * can never find — not in the source, and therefore not in any window. Better
	 * refused than stored as a key that silently never fires.
	 */
	it("refuses a phrase whose normalised form is not in the source", () => {
		const text =
			"The Ashguard  Riders mustered at the gates and read the proclamation."
		const keys = keysOf({
			text,
			corpus: ["The Order of the Ward keeps the gates."],
			cast: CAST
		})
		expect(keys).not.toContain("ashguard riders")
		for (const key of keys) expect(roundTrip(key, text)).toBe(true)
	})

	it("`roundTrip` reads the row a machine actually writes", () => {
		// `entryInsert` stores `matchMode: null` and `caseSensitive: false`, so
		// the round trip is substring on lowercased text.
		expect(roundTrip("ashguard", "The ASHGUARD rode out.")).toBe(true)
		expect(roundTrip("ashguard riders", "The Ashguard\nRiders rode.")).toBe(
			false
		)
	})

	it("refuses keys shorter than the minimum, a bare number, and a function word", () => {
		const text =
			"The Ash and the Elk met on Pier 7 with the writ, because Vell said so."
		const proposal = proposeKeys({ text, corpus: [], cast: CAST })
		for (const key of proposal.keys) {
			expect(key.key.length).toBeGreaterThanOrEqual(MIN_KEY_LENGTH)
			expect(key.key).not.toMatch(/^\d+$/)
		}
		expect(proposal.keys.map((k) => k.key)).not.toContain("because")
		expect(reasonFor({ text, corpus: [], cast: CAST }, "because")).toBe(
			"a function word, not a subject"
		)
	})
})

describe("bounded cardinality — every key is another firing opportunity", () => {
	const text =
		"Cade crossed Lowmarket to Saltgate, past the Thornfield wagons and the Anvil Row forges, carrying a writ for the Pewterers' Guild and a message for the Ashguard Riders about the mill race."
	const corpus = [
		"Lowmarket is the lower ward's market square over an old cistern.",
		"Saltgate is the harbour quarter and most smuggling comes through it.",
		"Thornfield lies a day north and its granary takes the tithe barley.",
		"Anvil Row runs behind the tanners' yards and six forges work it.",
		"The Pewterers' Guild holds most of the debt paper in the lower wards.",
		"The Ashguard Riders answer to the Order of the Ward.",
		"The mill race is the only fast water inside the walls."
	]

	it("never more than the bound, however much the passage names", () => {
		const proposal = proposeKeys({ text, corpus, cast: CAST })
		expect(proposal.keys.length).toBe(MAX_KEYS)
		expect(proposal.rejected.some((r) => r.reason.includes("key limit"))).toBe(
			true
		)
	})

	it("never more ordinary words than their own smaller bound", () => {
		const proposal = proposeKeys({ text, corpus, cast: CAST })
		expect(proposal.keys.filter((k) => k.kind === "term").length).toBe(0)
		const wordy = proposeKeys({
			text: "The watch held the cistern road all night while the tanners worked and the bells rang.",
			corpus,
			cast: CAST
		})
		expect(wordy.keys.filter((k) => k.kind === "term").length).toBeLessThanOrEqual(
			MAX_TERM_KEYS
		)
	})

	/**
	 * ⚠ Under substring matching a longer key can only fire where its substring
	 * already did, so emitting both spends two slots on one opportunity.
	 */
	it("no key contains another, in either direction", () => {
		for (const options of [{}, { maxKeys: 12, maxTermKeys: 12 }]) {
			const keys = keysOf({ text, corpus, cast: CAST, options })
			for (const a of keys)
				for (const b of keys) if (a !== b) expect(a.includes(b)).toBe(false)
		}
	})

	/**
	 * The corpus decides which word of a name is the specific half; on a tie the
	 * whole name stands, because guessing from word order gets "Order of the
	 * Ashguard" exactly backwards.
	 */
	it("narrows a name to its distinctive word only when the corpus says which", () => {
		// `riders` is everywhere, `ashguard` is not — so the name narrows.
		const decided = keysOf({
			text: "The Ashguard Riders read the proclamation.",
			corpus: [
				"The riders of the north keep their own counsel.",
				"Two riders came down the mill race road.",
				"The riders at the gate would not say who sent them.",
				"The Ashguard answer to the Order of the Ward."
			],
			cast: CAST
		})
		expect(decided).toContain("ashguard")
		expect(decided).not.toContain("ashguard riders")

		// Neither word is rarer than the other, so the whole name stands. Eight
		// documents again, so the share ceiling is not what decides it.
		const tied = keysOf({
			text: "The Ashguard Riders read the proclamation.",
			corpus: [
				"The Ashguard Riders answer to the Order of the Ward.",
				"Nobody has seen the Ashguard Riders since the muster.",
				"The mill race is the only fast water inside the walls.",
				"Saltgate is the harbour quarter.",
				"Thornfield lies a day north of the walls.",
				"Anvil Row runs behind the tanners' yards.",
				"The night watch keeps a rota of four turns.",
				"A writ carries a guild seal."
			],
			cast: CAST
		})
		// `extractEntities` drops the leading opener, so the whole name here is
		// `ashguard riders` — "The" is not part of what it found.
		expect(tied).toContain("ashguard riders")
		expect(tied).not.toContain("ashguard")
	})
})

describe("the receipt — evidence per key, and a reason per refusal", () => {
	const text =
		"Cade hid the writ beneath the cistern grate at Lowmarket before the bells."
	const corpus = [
		"Lowmarket is the lower ward's market square over an old cistern.",
		"The Pewterers' Guild holds most of the debt paper.",
		"A writ carries a guild seal.",
		"The bells of the ward gate carry as far as the tanners' yards."
	]

	it("each key carries where it is, what it reads like, and how it scored", () => {
		const proposal = proposeKeys({ text, corpus, cast: CAST })
		expect(proposal.keys.length).toBeGreaterThan(0)
		for (const key of proposal.keys) {
			expect(text.slice(key.span.start, key.span.end).toLowerCase()).toBe(
				key.key
			)
			expect(key.quote).toContain(text.slice(key.span.start, key.span.end))
			expect(key.distinctiveness).toBeGreaterThan(0)
			expect(key.corpusFraction).toBeLessThanOrEqual(0.25)
			expect(key.occurrences).toBeGreaterThanOrEqual(1)
		}
		expect(proposal.corpusSize).toBe(4)
		expect(proposal.proposerVersion).toBe(KEY_PROPOSER_VERSION)
	})

	it("every candidate turned away is named, with the rule that turned it away", () => {
		const proposal = proposeKeys({ text, corpus, cast: CAST })
		expect(proposal.rejected.length).toBeGreaterThan(0)
		for (const rejected of proposal.rejected) {
			expect(rejected.candidate).toBeTruthy()
			expect(rejected.reason).toBeTruthy()
			expect(["name", "term"]).toContain(rejected.kind)
		}
	})

	/**
	 * ⚠ **Never secondary keys.** They carry a user's `selectiveLogic` — *"fire
	 * on dragon, but not when statue is present"* — which is an author saying
	 * *not here*, and nothing that guesses is entitled to say it. Asserted on
	 * the result's shape rather than trusted: there is no field to put one in.
	 */
	it("proposes primary keys only", () => {
		expect(Object.keys(proposeKeys({ text, corpus, cast: CAST })).sort()).toEqual(
			["corpusSize", "keys", "proposerVersion", "rejected"]
		)
	})
})

describe("the scripts this cannot serve, stated rather than discovered", () => {
	/**
	 * ⚠ `tokenize` splits on `\W+`, which is ASCII, so an unsegmented script
	 * yields no bare-word candidates; and the open tier keys on `\p{Lu}`, which
	 * those scripts do not have, so it yields no proper nouns either. The honest
	 * outcome is **no keys**, and it must be a visible nothing rather than an
	 * invented something.
	 */
	it("a Japanese passage proposes nothing rather than something wrong", () => {
		const proposal = proposeKeys({
			text: "私は灰の衛兵を見た。夜明け前に低market の貯水池で会った。",
			corpus: ["灰の衛兵は門を守っている。"],
			cast: CAST
		})
		for (const key of proposal.keys)
			expect(proposal.rejected.map((r) => r.candidate)).not.toContain(key.key)
		// What it does emit, it can still match — the one guarantee that holds in
		// every script.
		for (const key of proposal.keys)
			expect(roundTrip(key.key, proposal.keys.length ? key.quote : "")).toBe(
				true
			)
	})

	/**
	 * ⚠ **And the gazetteer tier does not rescue it either.** Measured here
	 * rather than assumed, because "the world already has a row for this name"
	 * sounds like it should be enough and is not.
	 *
	 * `compileMatcher` wraps every gazetteer name in
	 * `(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`. In a script that writes no
	 * spaces the character after a name is another letter — 灰の衛兵 followed by
	 * は — so the lookahead fails and the name is not found. The assertions are
	 * right for scripts that write boundaries; there is no boundary to assert
	 * here.
	 *
	 * So the answer for an unsegmented script is **nothing at all**, and it is
	 * pinned so that a later reader looking to fix it can see exactly where the
	 * mechanism stops.
	 */
	it("...and not even a name the world has a row for, in an unsegmented script", () => {
		const keys = keysOf({
			text: "灰の衛兵は門の前に立っていた。",
			corpus: [
				"門は毎晩閉じられる。",
				"夜明け前に貯水池で会った。",
				"低い塔の影に立っていた。",
				"川沿いの道を歩いた。",
				"彼は何も言わなかった。"
			],
			entryNames: [{ name: "灰の衛兵", ref: { kind: "entry", id: 1 } }]
		})
		expect(keys).toEqual([])

		// The same name with a space after it — a boundary the assertion can
		// see — is found, which is what says the boundary is the cause.
		expect(
			keysOf({
				text: "灰の衛兵 stood before the gate at dawn.",
				corpus: [
					"The gate is closed each night.",
					"Dawn came late that season.",
					"The tower threw a long shadow.",
					"He walked the river road.",
					"He said nothing at all."
				],
				entryNames: [{ name: "灰の衛兵", ref: { kind: "entry", id: 1 } }]
			})
		).toContain("灰の衛兵")
	})
})
