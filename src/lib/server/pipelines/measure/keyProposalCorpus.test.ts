/**
 * What generated keys actually do — measured in both directions.
 *
 * **Read `keyProposalWorld.ts` first** — it holds the world and the argument
 * for its shape. This file runs it.
 *
 * ## Why a measurement and not a unit test
 *
 * `keyProposal.test.ts` asserts the rules: that a cast name is refused, that a
 * key round-trips, that a guard removed changes the output. Every one of those
 * can pass on a mechanism that is useless, because none of them asks the only
 * question that matters — *does a history entry now come in when it should, and
 * stay out when it should not*.
 *
 * The parity gate cannot answer it either. Parity is structurally blind to lore
 * ranking (see `corpus.ts`: with every lore signal weight at zero, all eleven
 * gate fixtures stay byte-identical), and it is doubly blind here, because
 * `keys: []` is what every history entry in every parity fixture already has.
 *
 * ## The two numbers this file exists to produce
 *
 * 1. **Recall.** Against today's `keys: []` baseline, which is asserted here
 *    rather than assumed: with no keys, no history entry is reachable by any
 *    conversation at all.
 * 2. **⚠ Over-firing, on two probes designed to produce it.** The shared-name
 *    probe names two cast members and no subject; the prose probe is ten
 *    messages of ordinary narrative English. Both should fire nothing, and
 *    "how many history entries fire together" is the number that decides
 *    whether this mechanism is worth wiring.
 *
 * ## ⚠ Every assertion here is a range with a perturbation beside it
 *
 * `corpus.ts`'s acceptance criterion: *a green suite is evidence only if the
 * thing under test can move it*. So each fixture states the number **and** the
 * ablation that moves it — the cast guard off, the corroboration gate on, the
 * key budget widened — because a bare number could be an accident of a fixture
 * and a number that moves the right way under the right perturbation cannot.
 *
 * The numbers are exact where the mechanism is deterministic and they are
 * asserted as bounds where a bound is what is actually being claimed. What is
 * *not* claimed anywhere is that these values generalise to a book of four
 * hundred entries; the world is thirty, and its own header says what that
 * does and does not license.
 */

import { describe, it, expect } from "vitest"
import {
	proposeKeys,
	roundTrip,
	MAX_KEYS,
	type KeyProposalOptions
} from "$lib/server/pipelines/ranking/keyProposal"
import {
	keywordQuery,
	type LoreRow
} from "$lib/server/pipelines/ranking/keywordQuery"
import { DEFAULT_RETRIEVAL } from "$lib/server/pipelines/ranking/weights"
import {
	CAST,
	ENTRIES,
	HISTORY_IDS,
	PROBES,
	type Probe
} from "$lib/server/pipelines/measure/keyProposalWorld"

/** The corpus's usual counter — a pure function of the string. */
const countTokens = (text: string): number => Math.ceil(text.length / 4)

/** One entry as a document: what a key would be matched against. */
const documentOf = (entry: (typeof ENTRIES)[number]) =>
	`${entry.name ?? ""} ${entry.content}`.trim()

/** Entry titles, as the gazetteer's second tier — `keywordQuery`'s own order. */
const ENTRY_NAMES = ENTRIES.flatMap((entry) =>
	entry.name
		? [{ name: entry.name, ref: { kind: "entry" as const, id: entry.id } }]
		: []
)

/**
 * Propose keys for every history entry, each against the rest of the book.
 *
 * The subject is excluded from its own corpus for the reason the binding
 * excludes it: its own text would put a guaranteed hit into every key's
 * footprint, which is the count the ceiling is measured against.
 */
function proposeAll(
	options: Partial<KeyProposalOptions> = {},
	cast = CAST
): Map<number, string[]> {
	const out = new Map<number, string[]>()
	for (const id of HISTORY_IDS) {
		const subject = ENTRIES.find((e) => e.id === id)!
		out.set(
			id,
			proposeKeys({
				text: subject.content,
				corpus: ENTRIES.filter((e) => e.id !== id).map(documentOf),
				cast,
				entryNames: ENTRY_NAMES,
				options
			}).keys.map((k) => k.key)
		)
	}
	return out
}

/**
 * Which history entries this conversation admits, with those keys written on.
 *
 * `keywordQuery` directly and not through a spec: the claim is about the
 * mechanism, and a failure has to be attributable to it rather than to a
 * template, a config layer or a database. Admission (`candidates`) rather than
 * final selection, because admission is what keys decide — what fits afterwards
 * is the budget's business and is measured in `rankingCorpus.test.ts`.
 */
function fired(probe: Probe, keysById: Map<number, string[]>): number[] {
	const rows: LoreRow[] = ENTRIES.map((entry, index) => ({
		id: entry.id,
		source: entry.source,
		name: entry.name,
		content: entry.content,
		keys: (keysById.get(entry.id) ?? []).join(", "),
		position: index,
		bindingCharacterId: entry.bindingCharacterId ?? null
	}))
	return keywordQuery({
		entries: rows,
		messages: probe.messages,
		entityRefs: CAST,
		retrieval: DEFAULT_RETRIEVAL,
		countTokens
	})
		.candidates.filter((c) => c.source === "history")
		.map((c) => c.id as number)
}

const probe = (id: string): Probe => PROBES.find((p) => p.id.startsWith(id))!

/** The subject probes — the ones with a scene to find. */
const SUBJECT_PROBES = PROBES.filter((p) => p.targets.length > 0)

interface Measured {
	/** Scenes found, of scenes looked for. */
	recall: [found: number, wanted: number]
	/**
	 * Every history entry admitted across the six subject probes, related ones
	 * included — the raw co-firing number, before any judgement about what
	 * counts as legitimate.
	 */
	coFires: number
	/** Fires on an entry that is neither the target nor declared related. */
	stray: number
	/** History entries firing on ordinary narrative prose. */
	prose: number
	/** History entries firing on two cast names and nothing else. */
	sharedName: number
	/** History entries the proposer could find no key for at all. */
	keyless: number
}

function measure(
	options: Partial<KeyProposalOptions> = {},
	cast = CAST
): Measured {
	const keys = proposeAll(options, cast)
	let found = 0
	let wanted = 0
	let stray = 0
	let coFires = 0
	for (const p of SUBJECT_PROBES) {
		const hits = fired(p, keys)
		coFires += hits.length
		found += p.targets.filter((t) => hits.includes(t)).length
		wanted += p.targets.length
		const allowed = new Set([...p.targets, ...(p.related ?? [])])
		stray += hits.filter((h) => !allowed.has(h)).length
	}
	return {
		recall: [found, wanted],
		coFires,
		stray,
		prose: fired(probe("N"), keys).length,
		sharedName: fired(probe("S"), keys).length,
		keyless: HISTORY_IDS.filter((id) => (keys.get(id) ?? []).length === 0)
			.length
	}
}

describe("generated keys — recall", () => {
	/**
	 * The baseline, asserted rather than assumed.
	 *
	 * ⚠ This is the defect, stated as a number: **no conversation about any of
	 * these twelve scenes reaches the entry that records it.** Not "rarely" and
	 * not "less often than it should" — never, on any probe, including the ones
	 * that name the scene's place and its object outright.
	 */
	it("today: a history entry with no keys is unreachable, always", () => {
		const none = new Map<number, string[]>()
		for (const p of PROBES) expect(fired(p, none)).toEqual([])
	})

	/**
	 * And the perturbation that shows the harness is not simply broken: the same
	 * probes against the same rows, with keys, do reach the entries. If this
	 * failed, the assertion above would be measuring a mistake in `fired`.
	 */
	/**
	 * And the perturbation showing the harness is not simply broken: the same
	 * probes against the same rows, with keys, reach every scene they were
	 * written about. If this failed, the assertion above would be measuring a
	 * mistake in `fired` rather than a defect in the product.
	 *
	 * ⚠ **Six of six is this world's number and not a claim about yours.** The
	 * probes are paraphrases and none of them repeats a sentence from the summary
	 * it targets, which is what makes the number mean anything — but six probes
	 * is six probes.
	 */
	it("with generated keys, every scene is reached", () => {
		const m = measure()
		expect(m.recall).toEqual([6, 6])
		expect(m.keyless).toBe(0)
	})

	/**
	 * ⚠ **What it costs to refuse ordinary words entirely**, kept as a fact.
	 *
	 * With names-only proposals the world's cleanest over-firing numbers arrive
	 * — nothing fires on prose at all — and a scene goes missing with two
	 * summaries left unkeyable, because two of the twelve name nothing proper.
	 * That is the trade `maxOrdinaryWords` exposes to a user, measured on both
	 * sides rather than asserted on one.
	 */
	it("names-only costs a scene and leaves two summaries with no keys", () => {
		const namesOnly = measure({ maxTermKeys: 0 })
		expect(namesOnly.recall).toEqual([5, 6])
		expect(namesOnly.keyless).toBe(2)
		expect(namesOnly.prose).toBe(0)
	})
})

describe("⚠ generated keys — over-firing", () => {
	/**
	 * **The number that decides it.**
	 *
	 * Every one of the twelve summaries has Cade in it and nine have Vell, so
	 * an extractor that keys on who was present makes the whole lane fire on any
	 * exchange between them. The probe is exactly that exchange and nothing else:
	 * two names, an ordinary evening, no place, no object, no faction.
	 */
	it("names alone fire nothing — 0 of 12", () => {
		expect(measure().sharedName).toBe(0)
	})

	/**
	 * ⚠ **The failure mode, reproduced on demand.**
	 *
	 * With *both* guards withheld — the cast not refused and the corpus-footprint
	 * ceiling opened to 1.0 — the same twelve passages yield `cade` and `vell` as
	 * keys and **11 of 12** history entries fire on that exchange. That is
	 * "all history entries fire together", measured, in the world this mechanism
	 * is judged in.
	 *
	 * It takes both guards off because on a book this shape they overlap: see the
	 * two fixtures below, which take one off at a time and show that each alone
	 * still holds the line — and then show the case where only one can.
	 */
	it("...and 11 of 12 fire with both guards withheld", () => {
		const unguarded = measure({ maxCorpusFraction: 1 }, [])
		expect(unguarded.sharedName).toBeGreaterThanOrEqual(10)
		expect(unguarded.stray).toBeGreaterThan(measure().stray)
	})

	/**
	 * Guard 2 alone holds, on a book of this size.
	 *
	 * The cast is withheld and nothing fires anyway, because a name in every
	 * scene has a corpus footprint far past a quarter and the ceiling refuses it
	 * without ever being told who is a person. Worth pinning: it is the reason
	 * the two guards are *not* redundant in the direction people assume.
	 */
	it("the footprint ceiling alone refuses the cast, on a book this size", () => {
		expect(measure({}, []).sharedName).toBe(0)
	})

	/**
	 * ⚠ **And guard 1 alone is the only one that can, on a small book.**
	 *
	 * The case the fixture above cannot show. One entry, two documents to measure
	 * against, which is what a lorebook looks like when somebody starts using
	 * summaries — the ceiling has almost nothing to count and the cast is in
	 * enough of it to look distinctive. With the cast refused, no cast name is
	 * proposed; with it withheld, `captain` is a key on two documents and `vell`
	 * is a key on none at all.
	 *
	 * This is why "a name the cast answers to is never a key" is a structural
	 * rule and not a statistic.
	 */
	it("the cast guard alone is what holds on a young lorebook", () => {
		const subject = ENTRIES.find((e) => e.id === 301)!
		const keysWith = (corpus: string[], cast: typeof CAST) =>
			proposeKeys({ text: subject.content, corpus, cast }).keys.map(
				(k) => k.key
			)
		const twoDocuments = [101, 302].map(
			(id) => documentOf(ENTRIES.find((e) => e.id === id)!)
		)

		expect(keysWith(twoDocuments, [])).toContain("captain")
		expect(keysWith(twoDocuments, CAST)).not.toContain("captain")
		// And the youngest book there is: the very first entry, nothing to
		// measure against at all.
		expect(keysWith([], [])).toContain("vell")
		expect(keysWith([], CAST)).not.toContain("vell")
	})

	/**
	 * The second over-firing probe, and the one that caught a design error.
	 *
	 * Ten messages of ordinary English — handed, found, left, came back, went
	 * down — naming no place, faction or object from any scene. A scan window is
	 * ten messages deep by default, so this is the *size* a real one is, which
	 * the short subject probes are not.
	 */
	it("ordinary narrative prose fires at most one entry of twelve", () => {
		expect(measure().prose).toBeLessThanOrEqual(1)
	})

	/**
	 * ⚠ **The rejected gate 5, kept as a live counter-measurement.**
	 *
	 * `requireCorroboration` demanded that a bare-word key occur somewhere else
	 * in the lorebook, on the reasoning that a word this passage uses and the
	 * book never does is prose rather than subject. It selects for exactly the
	 * wrong thing: a word is corroborated *because it is common*, so it admitted
	 * `watch`, `gave`, `found` and `left`, and refused `undercroft`, `silt` and
	 * `storm`.
	 *
	 * Eight of twelve entries fire on ordinary prose with it on, against one with
	 * it off, at identical recall. This is why the gate is off and why it is
	 * still reachable — a rejected design with a live measurement beside it is
	 * worth more than a comment saying it was tried.
	 */
	it("...and eight of twelve when the rejected corroboration gate is on", () => {
		const rejected = measure({ requireCorroboration: true })
		expect(rejected.prose).toBeGreaterThanOrEqual(6)
		// At no gain: the recall it was supposed to protect is unchanged.
		expect(rejected.recall).toEqual(measure().recall)
	})

	/**
	 * The cardinality bound, doing what it is for.
	 *
	 * Each key is an independent firing opportunity, so the budget is the width
	 * of the entry's door. Opened to eight with the ordinary-word cap opened
	 * alongside it, prose firing goes from one entry to six and the shared-name
	 * probe stops being clean — which is the shipped bound's justification,
	 * measured rather than argued.
	 */
	it("a wider key budget costs the clean shared-name result", () => {
		const wide = measure({ maxKeys: 8, maxTermKeys: 8 })
		expect(wide.prose).toBeGreaterThan(measure().prose)
		expect(wide.stray).toBeGreaterThan(measure().stray)
		expect(wide.sharedName).toBeGreaterThan(0)
	})

	/**
	 * The footprint ceiling, doing its *other* job.
	 *
	 * Turned off with the cast still refused, `watch` — which three separate
	 * scenes would want — comes back, and conversations using the word start
	 * pulling in entries they are not about.
	 */
	it("the corpus-footprint ceiling removes cross-entry keys", () => {
		expect(measure({ maxCorpusFraction: 1 }).stray).toBeGreaterThan(
			measure().stray
		)
	})

	/**
	 * The raw co-firing number, pinned without any judgement applied to it.
	 *
	 * `stray` excludes entries a probe declared itself legitimately related to,
	 * which is a judgement somebody made when writing the world. This is the
	 * number underneath it: how many history entries in total the six subject
	 * probes admit, out of twelve available on each. Ten — an average of 1.7 —
	 * and it is here so a later reader can re-decide the judgement without
	 * re-deriving the measurement.
	 */
	it("ten history admissions across six subject probes, of twelve available", () => {
		expect(measure().coFires).toBe(10)
	})
})

describe("generated keys — properties that must hold on every proposal", () => {
	/**
	 * ⚠ **The round trip, across the whole world.**
	 *
	 * A generated key the matcher cannot match is worse than no key: it looks
	 * like an entry with an index and behaves like one without. Asserted with
	 * `matchesKey` against the entry's own text, on the row shape a machine
	 * actually writes.
	 */
	it("every key the matcher can find in its own source", () => {
		for (const id of HISTORY_IDS) {
			const subject = ENTRIES.find((e) => e.id === id)!
			const proposal = proposeKeys({
				text: subject.content,
				corpus: ENTRIES.filter((e) => e.id !== id).map(documentOf),
				cast: CAST,
				entryNames: ENTRY_NAMES
			})
			for (const key of proposal.keys) {
				expect(roundTrip(key.key, subject.content)).toBe(true)
				// Never invented — the stronger statement the round trip implies
				// and which is the whole reason this is worth doing modelless.
				expect(subject.content.toLowerCase()).toContain(key.key)
			}
		}
	})

	it("never more keys than the bound, on any entry", () => {
		for (const keys of proposeAll().values())
			expect(keys.length).toBeLessThanOrEqual(MAX_KEYS)
	})

	/**
	 * No key contains another, so every key is an independent way in.
	 *
	 * Under substring matching `ashguard riders` can only fire where `ashguard`
	 * already did, so emitting both spends two of five slots on one opportunity.
	 */
	it("no key subsumes another on the same entry", () => {
		for (const keys of proposeAll().values())
			for (const a of keys)
				for (const b of keys)
					if (a !== b) expect(a.includes(b)).toBe(false)
	})

	/**
	 * ⚠ Nothing here ever proposes a **secondary** key.
	 *
	 * They carry a user's `selectiveLogic` — *"fire on dragon, but not when
	 * statue is present"* — which is an author saying *not here*, and a
	 * mechanism that guesses is not entitled to say it. Asserted on the shape of
	 * the result rather than trusted: the proposal has no field for one.
	 */
	it("proposes no secondary keys", () => {
		const proposal = proposeKeys({
			text: ENTRIES.find((e) => e.id === 301)!.content,
			corpus: ENTRIES.filter((e) => e.id !== 301).map(documentOf),
			cast: CAST
		})
		expect(Object.keys(proposal)).toEqual([
			"proposerVersion",
			"keys",
			"rejected",
			"corpusSize"
		])
	})

	/**
	 * Every proposal carries its evidence, because a reviewer who has to hunt
	 * for the reason approves without reading.
	 */
	it("every key carries where it came from and how it scored", () => {
		const subject = ENTRIES.find((e) => e.id === 301)!
		const proposal = proposeKeys({
			text: subject.content,
			corpus: ENTRIES.filter((e) => e.id !== 301).map(documentOf),
			cast: CAST,
			entryNames: ENTRY_NAMES
		})
		for (const key of proposal.keys) {
			expect(key.quote).toContain(
				subject.content.slice(key.span.start, key.span.end)
			)
			expect(key.distinctiveness).toBeGreaterThan(0)
			expect(key.occurrences).toBeGreaterThan(0)
			expect(key.corpusFraction).toBeLessThanOrEqual(0.25)
		}
		// And the receipt half: what was turned away, with the rule that did it.
		expect(proposal.rejected.length).toBeGreaterThan(0)
		for (const r of proposal.rejected) expect(r.reason).toBeTruthy()
	})

	/**
	 * ⚠ **A worked example, pinned.** One real summary and the keys it produces
	 * — the thing a reader of the report should be able to check by eye.
	 *
	 * It is a snapshot in the sense `registryHashes.test.ts` is: it may only
	 * change deliberately. If a gate moves, this is what says what it cost.
	 */
	it("the worked example: the writ at the Lowmarket cistern", () => {
		expect(proposeAll().get(301)).toEqual([
			"lowmarket",
			"pewterers",
			"the ashguard riders",
			"debt",
			"bells"
		])
		// ⚠ And what it does *not* contain, which is the point of the file:
		// three cast members are in that sentence and none of them is a key.
		expect(proposeAll().get(301)).not.toContain("cade")
		expect(proposeAll().get(301)).not.toContain("vell")
	})
})
