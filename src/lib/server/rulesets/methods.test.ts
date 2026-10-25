/**
 * 🚧 The ruleset handler's **check methods** (PLAN-rulesets-authoring D2,
 * lane M2, 2026-10-22): one resolver per kind — a die against a target, a
 * pool of dice, cards from the scene's deck, a comparison, a spend, a
 * judgement — each writing its **outcome block**; a package's own kind
 * refused politely; the script phases a check asks (`pre-roll`,
 * `post-roll`) and the `effects` laid on before anything is derived; the
 * turn economy line; amounts that are numbers.
 */

import { describe, expect, test } from "vitest"
import { defineAttributeSlot, defineRepertoire, defineRuleset, getRuleset, type RulesetDecl } from "@serene-pub/sdk"
import { seededRandom } from "$lib/server/state/expressions"
import { applySteps, runApply, runApplyAsync, runResolve, turnEconomyLine } from "./engine"
import { deckOrder, drawFromDeck, priceOfSuccess } from "./methods"
import type { EngineAsk, EngineInput, HeldPiece, OwnerView, ProposedDelta } from "./types"

const ID = "test:ruleset/methods@1"
const NERVE = "test:slot/mt-nerve@1"
const WITS = "test:slot/mt-wits@1"
const WILL = "test:slot/mt-will@1"
const HP = "test:slot/mt-hp@1"
const KIT = "test:slot/mt-kit@1"

const DEGREES = {
	bands: [
		{ id: "miss", label: { en: "Miss" }, five: "fail" as const },
		{ id: "graze", label: { en: "Graze" }, five: "partial" as const, from: -2 },
		{ id: "hit", label: { en: "Hit" }, five: "success" as const, from: 0 },
		{ id: "triumph", label: { en: "Triumph" }, five: "crit" as const, from: 5 }
	]
}

function declare(): RulesetDecl {
	const existing = getRuleset(ID)
	if (existing) return existing
	const int = (id: string, label: string, def: number) =>
		defineAttributeSlot(id, { type: "integer", label: { en: label }, descriptor: `${label}.`, appliesTo: ["cast"], config: { min: 0, max: 20 }, default: def })
	int(NERVE, "Nerve", 3)
	int(WITS, "Wits", 3)
	int(WILL, "Will", 2)
	int(HP, "Health", 10)
	const blades = defineRepertoire("blades", {
		label: { en: "Blades" },
		prose: "Blades: what cuts.",
		tags: ["weapon"],
		mechanics: [{ verb: "harm", on: "hit", amount: 2, stat: "mt-hp" }]
	})
	defineAttributeSlot(KIT, { type: "list", label: { en: "Kit" }, descriptor: "What they carry.", appliesTo: ["cast"], config: { repertoire: `${ID}#blades` } })
	return defineRuleset(ID, {
		name: { en: "Methods" },
		voice: { prose: "Methods, in words.", mechanics: "Methods decide checks in every way.", scripts: "Methods decide." },
		conventions: {
			methods: {
				d20: { kind: "die-target", sides: 20, bands: [{ id: "fair", label: { en: "Fair" }, target: 10, default: true }] },
				pool: { kind: "dice-pool", sides: 6, successOn: 5, countToDegree: [{ from: 0, band: "miss" }, { from: 1, band: "graze" }, { from: 2, band: "hit" }, { from: 4, band: "triumph" }] },
				cards: { kind: "card-draw", ranks: 13, suits: 4, draw: 1, bands: [{ id: "fair", label: { en: "Fair" }, target: 10, default: true }] },
				versus: { kind: "compare", opposedBy: "mt-will", bands: [{ id: "even", label: { en: "Even" }, target: 5, default: true }] },
				spend: { kind: "bid", resource: "mt-nerve", costs: [{ spend: 0, band: "miss" }, { spend: 1, band: "graze" }, { spend: 2, band: "hit" }, { spend: 4, band: "triumph" }] },
				judge: { kind: "none" },
				omen: { kind: "acme:tarot" }
			},
			defaultMethod: "d20",
			degrees: DEGREES,
			time: { unit: "round" },
			actions: { perTurn: 2, reaction: true }
		},
		stats: [{ id: NERVE }, { id: WITS }, { id: WILL }, { id: HP }],
		selectors: {
			strike: { kind: "check", base: "mt-wits" },
			sneak: { kind: "check", base: "mt-wits", method: "pool" },
			read: { kind: "check", base: "mt-wits", method: "cards" },
			contest: { kind: "check", base: "mt-will", method: "versus" },
			risk: { kind: "check", method: "spend" },
			talk: { kind: "check", method: "judge" },
			portent: { kind: "check", method: "omen" }
		},
		repertoires: [blades]
	})
}

const piece = (props: Record<string, unknown>): HeldPiece => ({
	key: String(props.name).toLowerCase(),
	props: { description: "", ...props } as HeldPiece["props"],
	count: 1,
	form: "inline",
	item: { kind: "inline", description: "", ...props } as HeldPiece["item"]
})

function person(id: number, name: string, values: { nerve?: number; wits?: number; will?: number; hp?: number } = {}): OwnerView {
	const decl = declare()
	return {
		key: `character:${id}`,
		owner: { kind: "session_cast", id },
		name,
		stats: [
			{ slotId: NERVE, selector: "mt-nerve", type: "integer", value: values.nerve ?? 3, label: "Nerve" },
			{ slotId: WITS, selector: "mt-wits", type: "integer", value: values.wits ?? 3, label: "Wits" },
			{ slotId: WILL, selector: "mt-will", type: "integer", value: values.will ?? 2, label: "Will" },
			{ slotId: HP, selector: "mt-hp", type: "integer", value: values.hp ?? 10, label: "Health" }
		],
		repertoires: [{ slotId: KIT, repertoire: decl.repertoires.find((r) => r.id === "blades")!, pieces: [piece({ name: "Knife" })] }],
		custom: [],
		bag: {}
	}
}

/** A random source whose next d20 is `face` (and a d6 the face's sixth, rounded up). */
const d20 = (...faces: number[]) => {
	let i = 0
	return () => (faces[i++ % faces.length]! - 1) / 20 + 0.001
}
const d6 = (...faces: number[]) => {
	let i = 0
	return () => (faces[i++ % faces.length]! - 1) / 6 + 0.001
}

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
	ruleset: declare(),
	rigour: "mechanics",
	owners: [person(1, "Ann", { will: 4 }), person(2, "Bram")],
	actions: {},
	deltas: [],
	elapsed: 0,
	ties: [],
	turn: 1,
	...over
})

const one = (delta: ProposedDelta, over: Partial<EngineInput> = {}) => runApply(input({ deltas: [delta], ...over }))

describe("die-target — one die against a target", () => {
	test("the ruleset's default method: d20 + Wits against the target, its outcome block", () => {
		const out = one({ owner: "character:1", op: "use", check: "strike", against: 10 }, { random: d20(9) })
		expect(out.outcomes[0]!.text).toBe("Ann — use (Strike): Hit")
		expect(out.outcomes[0]!.check).toMatchObject({ selector: "strike", natural: 9, total: 12, against: 10, band: "hit", method: "die-target", methodKey: "d20" })
		expect(out.outcomes[0]!.block).toEqual({
			kind: "dice",
			method: "die-target",
			stat: "Strike",
			rolled: 12,
			faces: [9],
			against: 10,
			outcome: "Hit",
			five: "success",
			explain: "d20 9 + 3 (Wits) = 12 vs 10",
			by: "character:1"
		})
		expect(out.explain[out.explain.length - 1]!.text).toBe("d20 9 + 3 (Wits) = 12 vs 10")
	})
})

describe("dice-pool — count the dice that come up high", () => {
	test("as many d6 as Wits; fives and sixes succeed; the count reads as a degree", () => {
		const out = one({ owner: "character:1", op: "use", check: "sneak", against: 99 }, { random: d6(5, 2, 6) })
		const o = out.outcomes[0]!
		expect(o.check).toMatchObject({ selector: "sneak", total: 2, band: "hit", method: "dice-pool", methodKey: "pool" })
		expect(o.check!.against).toBeUndefined()
		expect(o.block).toMatchObject({ method: "dice-pool", rolled: 2, faces: [5, 2, 6], pool: { size: 3, successes: 2, successOn: 5 }, outcome: "Hit" })
		expect(o.block!.against).toBeUndefined()
		expect(o.block!.explain).toBe("pool 3 — 3d6 (5, 2, 6): 2 successes at 5+")
	})

	test("no success under the first step reads as the miss; the map's top step a triumph", () => {
		expect(one({ owner: "character:1", op: "use", check: "sneak" }, { random: d6(1, 2, 3) }).outcomes[0]!.check!.band).toBe("miss")
		const many = person(1, "Ann", { wits: 5 })
		expect(one({ owner: "character:1", op: "use", check: "sneak" }, { owners: [many], random: d6(6, 6, 5, 5, 1) }).outcomes[0]!.check!.band).toBe("triumph")
	})
})

describe("card-draw — the scene's deck", () => {
	test("a seeded deck per scene: the same deck whoever draws, the next card next time, a new scene shuffles anew", () => {
		const first = one({ owner: "character:1", op: "use", check: "read", against: 10 }, { scene: 7, deckSeed: "deck:1" })
		expect(first.decks).toEqual({ cards: { scene: 7, shuffle: 0, drawn: 1 } })
		const order = deckOrder("deck:1:cards:7:0", 52)
		const rank = (order[0]! % 13) + 1
		const o = first.outcomes[0]!
		expect(o.block).toMatchObject({ method: "card-draw", rolled: rank + 3, against: 10 })
		expect(o.block!.cards).toEqual([{ label: expect.any(String), rank }])
		expect(o.block!.faces).toBeUndefined()
		const second = one({ owner: "character:1", op: "use", check: "read", against: 10 }, { scene: 7, deckSeed: "deck:1", decks: first.decks })
		expect(second.decks).toEqual({ cards: { scene: 7, shuffle: 0, drawn: 2 } })
		expect(second.outcomes[0]!.block!.cards![0]!.rank).toBe((order[1]! % 13) + 1)
		const elsewhere = one({ owner: "character:1", op: "use", check: "read", against: 10 }, { scene: 8, deckSeed: "deck:1", decks: second.decks })
		expect(elsewhere.decks).toEqual({ cards: { scene: 8, shuffle: 0, drawn: 1 } })
	})

	test("a deck that runs out is shuffled again; when-empty keeps it across scenes", () => {
		const m = { kind: "card-draw" as const, ranks: 2, suits: 1, reshuffle: "when-empty" as const }
		const drawn = drawFromDeck(m, "small", { scene: 1, shuffle: 0, drawn: 1 }, 2, "s", 2)
		expect(drawn.state).toEqual({ scene: 1, shuffle: 1, drawn: 1 })
		expect(drawn.cards).toHaveLength(2)
	})

	test("a common deck reads its cards in words", () => {
		const out = one({ owner: "character:1", op: "use", check: "read", against: 10 }, { scene: null, deckSeed: "deck:words" })
		expect(out.outcomes[0]!.block!.cards![0]!.label).toMatch(/^(Ace|[2-9]|10|Jack|Queen|King) of (hearts|diamonds|clubs|spades)$/)
		expect(out.outcomes[0]!.block!.explain).toMatch(/^drew .+ \d+ \+ 3 \(Wits\) = \d+ vs 10$/)
	})
})

describe("compare — no chance at all", () => {
	test("against the other side's value: Ann's Will 4 against Bram's Will 2", () => {
		const out = one({ owner: "character:1", op: "use", check: "contest", aimedAt: "Bram" })
		const o = out.outcomes[0]!
		expect(o.check).toMatchObject({ total: 4, against: 2, band: "hit", method: "compare" })
		expect(o.block).toMatchObject({ method: "compare", rolled: 4, against: 2, compare: { versus: "Bram's Will" }, outcome: "Hit" })
		expect(o.block!.faces).toBeUndefined()
	})

	test("against a target when nobody is opposed; no randomness asked for", () => {
		const out = one({ owner: "character:1", op: "use", check: "contest", against: 5 })
		expect(out.outcomes[0]!.check).toMatchObject({ total: 4, against: 5, band: "graze" })
	})
})

describe("bid — spend to succeed", () => {
	test("what is spent buys the degree, and is spent", () => {
		const out = one({ owner: "character:1", op: "use", check: "risk", value: 2 })
		expect(out.outcomes[0]!.check).toMatchObject({ total: 2, band: "hit", method: "bid" })
		expect(out.outcomes[0]!.block).toMatchObject({ method: "bid", rolled: 2, outcome: "Hit" })
		expect(out.changes).toContainEqual(expect.objectContaining({ slotId: NERVE, op: "add", value: -2 }))
		expect(out.outcomes[0]!.block!.explain).toBe("spent 2 of 3 Nerve (1 left)")
	})

	test("nobody spends what they do not have: refused, nothing spent", () => {
		const out = one({ owner: "character:1", op: "use", check: "risk", value: 5 })
		expect(out.rejected).toEqual([expect.objectContaining({ reason: "not-enough", why: "Ann has 3 Nerve, not the 5 use would spend." })])
		expect(out.changes).toEqual([])
		expect(out.outcomes).toEqual([])
	})

	test("no amount said: the price of success", () => {
		expect(priceOfSuccess([{ spend: 0, band: "miss" }, { spend: 1, band: "graze" }, { spend: 2, band: "hit" }, { spend: 4, band: "triumph" }], DEGREES)).toBe(2)
		const out = one({ owner: "character:1", op: "use", check: "risk" })
		expect(out.outcomes[0]!.check).toMatchObject({ total: 2, band: "hit" })
	})

	test("two bids in one moment read what the first left", () => {
		const out = runApply(input({ deltas: [{ owner: "character:1", op: "use", check: "risk", value: 2 }, { owner: "character:1", op: "use", check: "risk", value: 2 }] }))
		expect(out.rejected.map((r) => r.why)).toEqual(["Ann has 1 Nerve, not the 2 use would spend."])
	})
})

describe("none — the game master judges", () => {
	test("a degree named by id or by its words; else the judgement's own words; else as the story tells", () => {
		const byId = one({ owner: "character:1", op: "use", check: "talk", value: "triumph" })
		expect(byId.outcomes[0]!.check).toMatchObject({ band: "triumph", five: "crit", method: "none", label: "Triumph" })
		expect(byId.outcomes[0]!.check!.total).toBeUndefined()
		expect(byId.outcomes[0]!.block).toEqual({ kind: "dice", method: "none", stat: "Talk", outcome: "Triumph", five: "crit", by: "character:1" })
		expect(one({ owner: "character:1", op: "use", check: "talk", value: "graze" }).outcomes[0]!.check!.band).toBe("graze")
		expect(one({ owner: "character:1", op: "use", check: "talk", value: "Hit" }).outcomes[0]!.check!.band).toBe("hit")
		const words = one({ owner: "character:1", op: "use", check: "talk", value: "She talks her way in" })
		expect(words.outcomes[0]!.text).toBe("Ann — use (Talk): She talks her way in")
		expect(words.outcomes[0]!.block).toMatchObject({ outcome: "She talks her way in" })
		const told = one({ owner: "character:1", op: "use", check: "talk" })
		expect(told.outcomes[0]!.text).toBe("Ann — use (Talk): as the story tells")
		expect(told.outcomes[0]!.block!.rolled).toBeUndefined()
		expect(told.explain).toEqual([])
	})

	test("a ruleset that names no check method judges every check — a hit with no check named lands, its amount dealt", () => {
		const decl = declare()
		const plain = { ...decl.conventions, methods: undefined, defaultMethod: undefined }
		const out = one({ owner: "character:1", op: "hit", piece: "Knife", aimedAt: "Bram" }, { conventions: plain as never })
		expect(out.outcomes[0]!.check).toMatchObject({ method: "none", selector: "" })
		expect(out.outcomes[0]!.text).toBe("Ann — hit Knife: as the story tells")
		expect(out.changes).toContainEqual(expect.objectContaining({ owner: { kind: "session_cast", id: 2 }, slotId: HP, op: "add", value: -2 }))
	})
})

describe("a package's own kind", () => {
	test("refused politely: this pub has no resolver for it", () => {
		const out = one({ owner: "character:1", op: "use", check: "portent" })
		expect(out.rejected).toEqual([
			expect.objectContaining({ reason: "no-resolver", why: "Ann — use (Portent): this pub has no resolver for 'acme:tarot', the check method this check is decided by — tell it in words instead." })
		])
		expect(out.outcomes).toEqual([])
	})
})

describe("amounts that are numbers", () => {
	test("a harm of 2 on a hit: no dice thrown for it", () => {
		const out = one({ owner: "character:1", op: "hit", piece: "Knife", check: "strike", against: 5, aimedAt: "Bram" }, { random: d20(10) })
		expect(out.outcomes.map((o) => o.text)).toContain("Ann's Knife deals 2 damage to Bram: Health −2")
		expect(out.explain.find((e) => e.target.startsWith("character:1.harm"))!.text).toBe("2 (Knife) = 2")
	})
})

describe("the turn economy line", () => {
	test("perTurn read into the voice block where numbers show", () => {
		expect(turnEconomyLine({ actions: { perTurn: 2, reaction: true } })).toBe("A turn holds 2 actions and a reaction.")
		expect(turnEconomyLine({ actions: { perTurn: 1 } })).toBe("A turn holds 1 action.")
		expect(turnEconomyLine({})).toBe("")
		expect(runResolve(input()).blocks.voice!.text).toBe("Methods decide checks in every way.\nA turn holds 2 actions and a reaction.")
		expect(runResolve(input({ rigour: "prose" })).blocks.voice!.text).toBe("Methods, in words.")
	})
})

describe("🚧 the check phases a driver answers", () => {
	const answering = (answers: Partial<Record<EngineAsk["phase"], unknown>>, seen: EngineAsk[] = []) => async (ask: EngineAsk) => {
		seen.push(ask)
		return answers[ask.phase] ?? null
	}

	test("nothing is asked unless asked for: runApply and an apply with no asks run straight through", () => {
		const steps = applySteps(input({ deltas: [{ owner: "character:1", op: "use", check: "strike", against: 10 }], random: d20(9) }))
		const first = steps.next()
		expect(first.done).toBe(true)
	})

	test("pre-roll: the check as it stands — its method, terms, target — and a new target", async () => {
		const seen: EngineAsk[] = []
		const out = await runApplyAsync(
			input({ deltas: [{ owner: "character:1", op: "use", check: "strike", against: 10 }], random: d20(9), checkAsks: { preRoll: true } }),
			answering({ "pre-roll": { against: 14 } }, seen)
		)
		expect(seen).toHaveLength(1)
		expect(seen[0]).toMatchObject({
			phase: "pre-roll",
			owner: "character:1",
			check: { op: "use", by: "character:1", selector: "strike", label: "Strike", method: { key: "d20", kind: "die-target", options: { sides: 20 } }, against: 10, base: { selector: "mt-wits", value: 3 }, edge: 0 }
		})
		expect(seen[0]!.values["mt-wits"]).toBe(3)
		expect(out.outcomes[0]!.check).toMatchObject({ total: 12, against: 14, band: "graze" })
	})

	test("pre-roll: another of the ruleset's methods, options laid over, dice added, a bonus", async () => {
		const out = await runApplyAsync(
			input({ deltas: [{ owner: "character:1", op: "use", check: "strike" }], random: d6(4, 4, 4, 4, 4), checkAsks: { preRoll: true } }),
			answering({ "pre-roll": { method: "pool", options: { successOn: 4, kind: "bid" }, pool: 1, modifies: [{ value: 1, label: "Help" }] } })
		)
		expect(out.outcomes[0]!.check).toMatchObject({ method: "dice-pool", methodKey: "pool" })
		// Wits 3 + Help 1 + 1 more = 5 dice, each a 4, each a success at 4+.
		expect(out.outcomes[0]!.block!.pool).toEqual({ size: 5, successes: 5, successOn: 4 })
	})

	test("post-roll: how it came out, then a step up and a rider", async () => {
		const seen: EngineAsk[] = []
		const out = await runApplyAsync(
			input({ deltas: [{ owner: "character:1", op: "use", check: "strike", against: 10 }], random: d20(9), checkAsks: { postRoll: true } }),
			answering({ "post-roll": { shift: 1, riders: ["The crowd gasps."] } }, seen)
		)
		expect(seen[0]).toMatchObject({ phase: "post-roll", check: { rolled: 12, natural: 9, faces: [9], margin: 2, degree: { id: "hit", label: "Hit", five: "success" } } })
		expect(out.outcomes[0]!.check).toMatchObject({ band: "triumph", five: "crit" })
		expect(out.outcomes[1]!.text).toBe("The crowd gasps.")
	})

	test("post-roll: a degree set by id; one the ruleset does not have is ignored", async () => {
		const set = await runApplyAsync(
			input({ deltas: [{ owner: "character:1", op: "use", check: "strike", against: 10 }], random: d20(9), checkAsks: { postRoll: true } }),
			answering({ "post-roll": { degree: "miss" } })
		)
		expect(set.outcomes[0]!.check!.band).toBe("miss")
		const unknown = await runApplyAsync(
			input({ deltas: [{ owner: "character:1", op: "use", check: "strike", against: 10 }], random: d20(9), checkAsks: { postRoll: true } }),
			answering({ "post-roll": { degree: "glorious" } })
		)
		expect(unknown.outcomes[0]!.check!.band).toBe("hit")
	})

	test("the same seed and answers decide the same", async () => {
		const run = () =>
			runApplyAsync(
				input({ deltas: [{ owner: "character:1", op: "use", check: "strike", against: 10 }, { owner: "character:2", op: "use", check: "sneak" }], random: seededRandom("same"), checkAsks: { preRoll: true, postRoll: true } }),
				answering({})
			)
		expect(JSON.stringify((await run()).outcomes)).toBe(JSON.stringify((await run()).outcomes))
	})
})

describe("🚧 effects laid on before anything is derived", () => {
	test("an effects script's bonus counts on the check, its rider reads on the sheet", () => {
		const effects = {
			"character:1": {
				modifies: [{ target: "strike", value: 2, label: "Blessed", seedKey: "test:fx" }],
				adjust: [],
				riders: [{ text: "Blessed: the light is with her.", seedKey: "test:fx" }],
				explain: [{ seedKey: "test:fx", text: "blessing applied" }],
				failed: []
			}
		}
		const out = one({ owner: "character:1", op: "use", check: "strike", against: 10 }, { random: d20(9), effects })
		expect(out.outcomes[0]!.check).toMatchObject({ total: 14 })
		expect(out.outcomes[0]!.block!.explain).toBe("d20 9 + 3 (Wits) + 2 (Blessed) = 14 vs 10")
		expect(out.explain.map((e) => e.text)).toContain("test:fx: blessing applied")
		const read = runResolve(input({ effects }))
		expect(read.blocks.sheet!.depths.summary).toContain("Blessed: the light is with her.")
		expect(runResolve(input({ effects, rigour: "prose" })).blocks.sheet!.depths.summary ?? "").not.toContain("Blessed")
	})
})
