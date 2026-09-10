/**
 * What it costs to widen retrieval's gazetteer from the session cast to the
 * lorebook's whole binding roster — priced, rather than assumed free.
 *
 * ## The change being priced
 *
 * `castEntityRefs` built retrieval's tier-one vocabulary out of `session_cast`
 * alone while `annotations/loadVocabulary` built the same vocabulary out of
 * every `lorebook_bindings` row. Both read bindings now. That is a correctness
 * fix — two subsystems had two alphabets for one book — but it is **not a free
 * one**, and §13.9 is why: a gazetteer name matches case-insensitively on word
 * boundaries and contributes its distinctive tokens as keys. That is what lets
 * *"the warden"* in lower case resolve to a row at all, and equally what lets it
 * resolve inside *"the warden was four days up the road"*, a sentence whose
 * whole content is that she is **not** here. Bindings for people the session
 * never seated are the ones most likely to be spoken of in the abstract, so one
 * change loads the recall side and the false-positive side of the same
 * mechanism.
 *
 * ## The three findings
 *
 * **1. The widening's reach is narrower than it looks, because entry titles are
 * already in the gazetteer.** `keywordQuery` compiles `entityRefs` **plus every
 * entry title**, so a bound character who also has an entry named after her was
 * always resolvable by the second route. What the roster actually adds is
 * bindings whose names are *not* entry titles: unentried characters, and
 * aliases — which is exactly the graph-merge case `absorbedAliases` exists for.
 * A first attempt at this corpus titled its entries after its characters and
 * measured a change of precisely zero, in every window, for that reason.
 *
 * **2. At shipped defaults the change is inert, and provably so.**
 * `keywordQuery` admits on `pinned ∨ keyword > 0 ∨ nameMatch > 0` and only then
 * falls through to `evidence ≥ admitThreshold`, which ships at **0**. The
 * gazetteer therefore cannot bring in anything the keyword scan did not; it can
 * only reorder a pool that matched keys already. Measured over all twelve
 * windows below: **the admitted set is identical in every one**, under either
 * labelling. An install at defaults retrieves today what it retrieved
 * yesterday.
 *
 * **3. With the gate on, the trade is real and its sign depends on what you
 * count as relevant.** Two of the twelve windows move, and both are windows that
 * name someone who is off-scene — which is the predicted failure mode arriving
 * exactly as predicted. Micro-averaged over the corpus at `admitThreshold` 0.3:
 *
 * | labelling | precision | recall |
 * |---|---|---|
 * | strict — the scene's own subjects | 65.0% → **63.4%** | 100% → 100% |
 * | lenient — those, plus anyone the window named | 70.0% → **73.2%** | 73.7% → **78.9%** |
 *
 * So under the strict reading the widening costs 1.6 points of precision and
 * buys no recall; under the lenient reading it buys 3.2 points of precision and
 * 5.2 of recall. Both readings are defensible — "she is four days up the road"
 * is a wrong answer to *where is this scene* and a right answer to *who was just
 * named* — and neither is established as the one users want. The change shipped
 * on finding 2: it is free where it is not measured, and priced where it is.
 *
 * ## Why the trade cannot be scoped away
 *
 * The obvious narrowing — *"only bindings actually named in the window"* — is
 * what the gazetteer already computes; a binding reaches the profile only when
 * its name occurs. It would exclude nothing here. The cost does not come from
 * *which* bindings are in the vocabulary but from tier one being unable to read
 * the clause a name sits in, which it shares with the seated cast: a character
 * in the room who is mentioned as being elsewhere has always scored the same
 * way. Fixing it is a negation/coreference problem (design §13.7), not a
 * question of where the names came from.
 *
 * ## This corpus's honest limitation
 *
 * Twelve windows in matched pairs: for each unseated character, one window that
 * genuinely concerns her and one that names her while the scene is elsewhere.
 * The 6/6 split is **an assumption, not a measurement** — nothing here
 * establishes that off-scene mentions are as common as on-scene ones, and the
 * aggregate moves with that ratio. The two windows that actually move are named
 * individually below so a reader who disagrees can reweight without re-deriving
 * anything.
 */

import { describe, it, expect } from "vitest"
import {
	runWorld,
	type CorpusEntry,
	type CorpusWorld,
	type Dial
} from "./corpus"
import {
	buildGazetteer,
	extractEntities,
	type Gazetteer,
	type GazetteerName
} from "$lib/server/pipelines/ranking/entities"
import type { MessageRow } from "$lib/server/pipelines/ranking/keywordQuery"

// ── the roster ──────────────────────────────────────────────────────────────

/** Seated this session. Both vocabularies have these. */
const SEATED: GazetteerName[] = [
	{ name: "Vell", ref: { kind: "character", id: 7 } },
	{ name: "Cade", ref: { kind: "character", id: 8 } }
]

/**
 * Bound to the book, absent from the session — what the widening adds.
 *
 * Each carries a lower-case definite description beside her name, which is the
 * shape `narrativeGraph:mergeNode` writes into `absorbedAliases` and the shape
 * no capitalised-run extractor can reach. It is the hardest case in both
 * directions at once.
 */
const UNSEATED: GazetteerName[] = [
	{ name: "Ceyla", ref: { kind: "character", id: 3 } },
	{ name: "the warden", ref: { kind: "character", id: 3 } },
	{ name: "Mero Sarn", ref: { kind: "character", id: 4 } },
	{ name: "the tallyman", ref: { kind: "character", id: 4 } },
	{ name: "Anse Rill", ref: { kind: "character", id: 5 } },
	{ name: "the smith", ref: { kind: "character", id: 5 } }
]

/** Today's retrieval vocabulary. */
const NARROW: GazetteerName[] = SEATED
/** The annotation lane's, which is what the widening adopts. */
const WIDE: GazetteerName[] = [...SEATED, ...UNSEATED]

// ── the lorebook ────────────────────────────────────────────────────────────

/**
 * Ten entries titled after **places and institutions, never after people**.
 *
 * That is finding 1 made structural: an entry titled "Warden Ceyla" would put
 * `warden` and `ceyla` into the gazetteer through `keywordQuery`'s entry-title
 * tier, the narrow vocabulary would resolve them anyway, and the corpus would
 * measure nothing. Each unseated character is named in the *body* of the entries
 * about her domain instead, so the binding is the only route from a window that
 * says "the warden" to an entry that says "Ceyla".
 *
 * Keys are drawn from the same vocabulary the windows use — corpus trap 4 run
 * the other way — so four to six entries are key-admitted on every window and
 * the budget really decides.
 */
const ENTRIES: CorpusEntry[] = [
	{
		id: 1,
		name: "The Sluice Gate",
		keys: "sluice, winch",
		content:
			"Iron doors under the wall that let the tide in and out. Ceyla holds the only keys and the winch wants two hands."
	},
	{
		id: 2,
		name: "Lowmarket",
		keys: "market, stalls",
		content:
			"Stalls under oiled canvas three deep along the water. Mero Sarn keeps the ledger of what each of them owes."
	},
	{
		id: 3,
		name: "The Ashguard Riders",
		keys: "riders, wastes",
		content:
			"Riders out of the wastes who answer to nobody in the city and take their pay in salt."
	},
	{
		id: 4,
		name: "The Ford",
		keys: "ford, crossing",
		content:
			"The crossing above the town, passable at low water. Anse Rill keeps a forge on the near bank."
	},
	{
		id: 5,
		name: "Lanternwrights",
		keys: "lantern, glass",
		content:
			"The guild that hangs and mends the lanterns along the wall, and cuts its own glass."
	},
	{
		id: 6,
		name: "The Salt Road",
		keys: "salt, road",
		content:
			"The caravan road up out of the wastes. Salt comes down it and very little else does."
	},
	{
		id: 7,
		name: "The Flood Year",
		keys: "flood, waterline",
		content:
			"The year the water came over the wall. Ceyla was given the sluice after it and has kept it since."
	},
	{
		id: 8,
		name: "The Tide Tables",
		keys: "tide, tables",
		content:
			"Cut into a board by the sluice, the tables say when the water turns and by how much."
	},
	{
		id: 9,
		name: "The Town Wall",
		keys: "wall, stone",
		content:
			"Grey stone the whole way round, older than the town and mended in a dozen hands."
	},
	{
		id: 10,
		name: "The Winter Tithe",
		keys: "tithe, winter",
		content:
			"What every stall owes the town before the cold. Mero Sarn reads the tally out at the gate."
	}
]

/**
 * The budget that makes this world contend — a literal, not a figure derived
 * from the entries, for the reason `rankingCorpus`'s `FITS_FIVE` is one:
 * editing the world is supposed to be visible.
 */
const BUDGET = 96

// ── the windows ─────────────────────────────────────────────────────────────

interface Scenario {
	name: string
	/** `presence` — the scene is in her domain; `absence` — it is elsewhere. */
	kind: "presence" | "absence"
	/** Which unseated character this window names. */
	who: "ceyla" | "mero" | "anse"
	messages: MessageRow[]
	/** The entries the scene is about — the strict labelling. */
	relevant: number[]
}

/** Which entries name each unseated character — the lenient labelling's other half. */
const MENTIONED_IN: Record<Scenario["who"], number[]> = {
	ceyla: [1, 7],
	mero: [2, 10],
	anse: [4]
}

const msgs = (...contents: string[]): MessageRow[] =>
	contents.map((content, i) => ({ id: i + 1, content }))

const SCENARIOS: Scenario[] = [
	{
		name: "warden present at the sluice",
		kind: "presence",
		who: "ceyla",
		relevant: [1, 8],
		messages: msgs(
			"We came down to the sluice before the tide turned.",
			"The warden was already there with the winch half up.",
			"She would not raise the doors until the water dropped.",
			"Vell asked how long and got no answer worth having.",
			"The tide runs wrong twice a month by all accounts."
		)
	},
	{
		name: "warden elsewhere, scene at the ford",
		kind: "absence",
		who: "ceyla",
		relevant: [3, 4, 6],
		messages: msgs(
			"We were at the ford waiting on the crossing to clear.",
			"The warden was four days up the road and would not be back.",
			"The riders came down out of the wastes before dark.",
			"Cade said they take their pay in salt and nothing else.",
			"The water was low enough to see the stones."
		)
	},
	{
		name: "ceyla present at the sluice, named outright",
		kind: "presence",
		who: "ceyla",
		relevant: [1, 8],
		messages: msgs(
			"Ceyla came up from the sluice with the keys on her belt.",
			"She said the tide had run wrong twice this month.",
			"Ceyla wanted somebody on the winch through the night.",
			"Vell said he would take the first half of it.",
			"The tables by the doors had been cut over twice."
		)
	},
	{
		name: "ceyla named in passing, scene in the market",
		kind: "absence",
		who: "ceyla",
		relevant: [2, 5],
		messages: msgs(
			"The market was three deep in stalls by the middle of the morning.",
			"Somebody asked whether Ceyla had ever been out to the wastes.",
			"Cade counted the lanterns along the wall and found four dark.",
			"The glass had gone black with salt again over the winter.",
			"Nobody would cut new on credit."
		)
	},
	{
		name: "tallyman present in the market",
		kind: "presence",
		who: "mero",
		relevant: [2, 10],
		messages: msgs(
			"The tallyman had the ledger open on a barrel in the market.",
			"He read the tithe back to every stall in turn.",
			"Two of them argued and the tallyman read it again.",
			"Cade said the stalls have run this way for thirty years.",
			"Nobody paid until it had been said out loud."
		)
	},
	{
		name: "tallyman elsewhere, scene on the road",
		kind: "absence",
		who: "mero",
		relevant: [3, 4, 6],
		messages: msgs(
			"We took the road up out of the wastes at first light.",
			"The tallyman had gone to the ford a week ago and stayed.",
			"The riders were on the crossing before us and would not move.",
			"Cade said they take their pay in salt and always have.",
			"The water was low and we waited on them anyway."
		)
	},
	{
		name: "sarn present, named by surname alone",
		kind: "presence",
		who: "mero",
		relevant: [2, 10],
		messages: msgs(
			"Sarn had the market ledger under his arm all morning.",
			"The tithe was short by the weight of two stalls.",
			"He would not open the stalls until it came right.",
			"Vell said that is how the man has always been.",
			"It came right before winter and the market opened."
		)
	},
	{
		name: "sarn named in passing, scene at the sluice",
		kind: "absence",
		who: "mero",
		relevant: [1, 8],
		messages: msgs(
			"The sluice was half up and the tide was coming on.",
			"Sarn has not been down to the winch since the flood year.",
			"The tables say the water turns before noon and it did.",
			"Vell put his shoulder to it and it moved a hand's width.",
			"The doors are older than anyone still working them."
		)
	},
	{
		name: "anse present at the ford",
		kind: "presence",
		who: "anse",
		relevant: [4, 6],
		messages: msgs(
			"Anse Rill had the forge lit before we reached the crossing.",
			"The mule had thrown a shoe on the far side of the ford.",
			"Anse Rill set it and would take nothing for it.",
			"Vell watched the road while the work was done.",
			"The water was low enough to count the stones."
		)
	},
	{
		name: "smith elsewhere, scene in the market",
		kind: "absence",
		who: "anse",
		relevant: [2, 5],
		messages: msgs(
			"The market was three deep in stalls by the middle of the morning.",
			"The smith had been called out to the wastes and left the forge banked.",
			"Cade counted the lanterns along the wall and found four dark.",
			"The glass had gone black with salt again over the winter.",
			"Nobody would cut new on credit."
		)
	},
	{
		name: "smith present at the crossing",
		kind: "presence",
		who: "anse",
		relevant: [4, 6],
		messages: msgs(
			"The smith came down to the crossing with us at low water.",
			"The ford was clear and the road above it was not.",
			"He said the salt carts had cut the bank to pieces.",
			"Cade agreed and said nobody mends it any more.",
			"We went over and left the mule on the near side."
		)
	},
	{
		name: "smith named in passing, scene at the wall",
		kind: "absence",
		who: "anse",
		relevant: [5, 9],
		messages: msgs(
			"The wall was wet the whole way round and the stone was dark.",
			"The smith was up in the wastes and had been for a week.",
			"Cade said four of the lanterns had gone out in the night.",
			"The glass wants cutting and nobody will do it on credit.",
			"It has been mended in a dozen hands and shows it."
		)
	}
]

// ── measurement ─────────────────────────────────────────────────────────────

const worldFor = (s: Scenario, cast: GazetteerName[]): CorpusWorld => ({
	about: s.name,
	cast,
	entries: ENTRIES,
	messages: s.messages
})

/** Shipped: the gate off, so the gazetteer can only reorder. */
const SHIPPED: Dial = { budget: BUDGET }
/** The gate on, where the gazetteer can also admit. */
const GATED: Dial = { budget: BUDGET, retrieval: { admitThreshold: 0.3 } }

type Labelling = "strict" | "lenient"

const wanted = (s: Scenario, labelling: Labelling): number[] =>
	labelling === "strict"
		? s.relevant
		: [...new Set([...s.relevant, ...MENTIONED_IN[s.who]])]

const admittedUnder = (s: Scenario, cast: GazetteerName[], dial: Dial) =>
	runWorld(worldFor(s, cast), dial).admitted

/**
 * Micro-averaged over the corpus — hits, admitted and wanted summed across
 * windows before the division, so a window with more relevant entries counts
 * for more rather than every window counting for one.
 */
const score = (
	cast: GazetteerName[],
	dial: Dial,
	labelling: Labelling,
	only?: Scenario["kind"]
) => {
	let hits = 0
	let admitted = 0
	let want = 0
	for (const s of SCENARIOS.filter((x) => !only || x.kind === only)) {
		const rel = wanted(s, labelling)
		const got = admittedUnder(s, cast, dial)
		hits += got.filter((id) => rel.includes(id)).length
		admitted += got.length
		want += rel.length
	}
	return {
		precision: round(admitted ? hits / admitted : 0),
		recall: round(want ? hits / want : 0)
	}
}

/** One decimal place of a percentage — the resolution the findings are quoted at. */
const round = (n: number) => Math.round(n * 1000) / 10

// ── what the vocabulary itself reaches ──────────────────────────────────────

describe("the widened vocabulary reaches names the narrow one cannot", () => {
	const narrow = buildGazetteer(NARROW)
	const wide = buildGazetteer(WIDE)
	const extracted = (window: string, g: Gazetteer) =>
		extractEntities(window, g).entities.map((e) => `${e.tier}:${e.text}`)

	it("resolves a lower-case definite description tier two cannot see", () => {
		const w = "The warden was already there with the winch half up."
		expect(extracted(w, narrow)).toEqual([])
		expect(extracted(w, wide)).toEqual(["gazetteer:The warden"])
	})

	it("resolves a sentence-initial name tier two drops for want of corroboration", () => {
		const w = "Ceyla came up from the sluice with the keys on her belt."
		expect(extracted(w, narrow)).toEqual([])
		expect(extracted(w, wide)).toEqual(["gazetteer:Ceyla"])
	})

	it("promotes an open-tier capitalised run to a resolved identity", () => {
		const w = "Mero Sarn had the ledger open on a barrel in the market."
		expect(extracted(w, narrow)).toEqual(["open:Mero Sarn"])
		expect(extracted(w, wide)).toEqual(["gazetteer:Mero Sarn"])
	})

	it("resolves a bare surname through the distinctive-token rule", () => {
		const w = "Sarn has not been down to the winch since the flood year."
		expect(extracted(w, narrow)).toEqual([])
		expect(extracted(w, wide)).toEqual(["gazetteer:Sarn"])
	})

	/**
	 * The same mechanism, in the sentence that makes it a hazard. Nothing in
	 * tier one reads the clause a name sits in, so *"was four days up the
	 * road"* resolves exactly as *"was already there"* does — byte for byte the
	 * same entity, from a sentence asserting the opposite.
	 */
	it("cannot tell presence from absence, and resolves both alike", () => {
		const here = "The warden was already there with the winch half up."
		const gone =
			"The warden was four days up the road and would not be back."
		expect(extracted(gone, wide)).toEqual(extracted(here, wide))
		expect(extracted(gone, narrow)).toEqual([])
	})
})

// ── the priced trade ────────────────────────────────────────────────────────

describe("what the widening costs and buys", () => {
	/**
	 * ⚠ **The finding the change shipped on.** With `admitThreshold` at its
	 * shipped 0 the admission disjunction never reaches the evidence term, so
	 * the gazetteer cannot bring in an entry the keyword scan did not — it can
	 * only reorder, and here it never reorders across the budget line. An
	 * install at defaults sees no difference at all.
	 */
	it("is inert at shipped defaults, in all twelve windows", () => {
		for (const s of SCENARIOS)
			expect(
				admittedUnder(s, WIDE, SHIPPED),
				`${s.name}: the widening moved a result at admitThreshold 0, ` +
					`where the gate cannot admit anything`
			).toEqual(admittedUnder(s, NARROW, SHIPPED))
	})

	/**
	 * And the mirror assertion, so the one above cannot pass because the corpus
	 * is blind: the same vocabularies over the same worlds *do* diverge once
	 * the gate is on. Without this, a corpus in which the widening did nothing
	 * anywhere would read as a clean bill of health.
	 */
	it("moves the result once the gate is on, and only on absence windows", () => {
		const moved = SCENARIOS.filter(
			(s) =>
				String(admittedUnder(s, NARROW, GATED)) !==
				String(admittedUnder(s, WIDE, GATED))
		)
		expect(moved.map((s) => s.name)).toEqual([
			"tallyman elsewhere, scene on the road",
			"smith named in passing, scene at the wall"
		])
		expect(moved.every((s) => s.kind === "absence")).toBe(true)
	})

	/**
	 * The prices, quoted. Exact figures rather than inequalities, on the same
	 * reasoning as the budget literal: these numbers are the finding, and an
	 * edit to the corpus that moves them should have to say so.
	 */
	it("costs 1.6 points of strict precision at admitThreshold 0.3, and buys no recall", () => {
		expect(score(NARROW, GATED, "strict")).toEqual({
			precision: 65,
			recall: 100
		})
		expect(score(WIDE, GATED, "strict")).toEqual({
			precision: 63.4,
			recall: 100
		})
	})

	it("buys 3.2 points of lenient precision and 5.2 of lenient recall at the same setting", () => {
		expect(score(NARROW, GATED, "lenient")).toEqual({
			precision: 70,
			recall: 73.7
		})
		expect(score(WIDE, GATED, "lenient")).toEqual({
			precision: 73.2,
			recall: 78.9
		})
	})

	/**
	 * Where the whole trade lives. Presence windows are untouched under either
	 * labelling — the widening neither helps nor harms a scene that is already
	 * where the named character is — so every point moved above was moved by a
	 * window naming somebody off-scene. That is the predicted failure mode, and
	 * it is also the predicted gain; they are one mechanism seen from two sides.
	 */
	it("changes nothing on a presence window, under either labelling", () => {
		for (const labelling of ["strict", "lenient"] as const)
			expect(score(WIDE, GATED, labelling, "presence")).toEqual(
				score(NARROW, GATED, labelling, "presence")
			)
	})
})
