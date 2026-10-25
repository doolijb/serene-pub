/**
 * The ruleset handler's pure half: phases, blocks per rigour, checks with
 * seeded dice, typed stacking, refusals, time triggers, and the budget's
 * degrade-before-drop.
 */

import { describe, expect, test } from "vitest"
import { getRepertoire, type Rigour } from "@serene-pub/sdk"
import { seededRandom } from "$lib/server/state/expressions"
import { runApply, runResolve } from "./engine"
import { degreeOf, rollDice } from "./dice"
import { fitRulesetBlocks } from "./budget"
import { AILS, DEFENSE, GEAR, HP, OATH, STR, TRIAL, declareTrial } from "./trialRuleset.testkit"
import type { EngineInput, HeldPiece, OwnerView, ProposedDelta, RulesetMode } from "./types"

const { decl } = declareTrial()

const piece = (props: Record<string, unknown>): HeldPiece => ({
	key: String(props.name).toLowerCase(),
	props: { description: "", ...props } as HeldPiece["props"],
	count: 1,
	form: "inline",
	item: { kind: "inline", description: "", ...props } as HeldPiece["item"]
})

function ann(extra: { pieces?: HeldPiece[]; ails?: HeldPiece[] } = {}): OwnerView {
	return {
		key: "character:1",
		owner: { kind: "session_cast", id: 1 },
		name: "Ann",
		stats: [
			{ slotId: STR, selector: "str", type: "integer", value: 3, label: "Strength" },
			{ slotId: HP, selector: "hp", type: "integer", value: 20, label: "Health" },
			{ slotId: DEFENSE, selector: "defense", type: "derived", value: undefined, derive: "owner.str | plus: 10", label: "Defense" }
		],
		repertoires: [
			{
				slotId: GEAR,
				repertoire: getRepertoire(`${TRIAL}#weapons`)!,
				pieces: extra.pieces ?? [piece({ name: "Longsword", description: "A long blade.", equipped: true })]
			},
			{ slotId: AILS, repertoire: getRepertoire(`${TRIAL}#conditions`)!, pieces: extra.ails ?? [] }
		],
		custom: [{ slotId: OATH, label: "Oath", value: "Protect the weak" }],
		bag: { str: 3, hp: 20 }
	}
}

function bram(): OwnerView {
	return {
		...ann({ pieces: [piece({ name: "Club", description: "Heavy." })] }),
		key: "character:2",
		owner: { kind: "session_cast", id: 2 },
		name: "Bram",
		custom: []
	}
}

type Moment = EngineInput & { mode?: RulesetMode }

const base = (over: Partial<Moment> = {}): Moment => ({
	ruleset: decl,
	rigour: "mechanics",
	mode: "resolve",
	owners: [ann()],
	actions: {},
	deltas: [],
	elapsed: 0,
	ties: [],
	turn: 3,
	...over
})

/** The moment a test names: resolve, apply, or advance (apply with no deltas). */
const runEngine = ({ mode = "resolve", ...input }: Moment) =>
	mode === "resolve" ? runResolve(input) : runApply(mode === "advance" ? { ...input, deltas: [] } : input)

/** A random source whose next d20 is `face`. */
const face = (...faces: number[]) => {
	let i = 0
	return () => (faces[i++ % faces.length]! - 1) / 20 + 0.001
}

describe("resolve: blocks per rigour", () => {
	test("prose — voice, sheet at index, no numbers anywhere", () => {
		const out = runEngine(base({ rigour: "prose", owners: [ann()] }))
		expect(Object.keys(out.blocks)).toEqual(["voice", "sheet", "pieces", "custom"])
		expect(out.blocks.voice!.text).toBe(decl.voice!.prose)
		expect(out.blocks.sheet!.depth).toBe("index")
		for (const b of Object.values(out.blocks)) expect(b!.text).not.toMatch(/\d/)
		expect(out.blocks.sheet!.text).toBe("Ann — weapons: Longsword")
		expect(out.blocks.custom!.text).toBe("Ann — Oath: Protect the weak")
		expect(out.explain).toEqual([])
	})

	test("mechanics — numbers, derived stats, sheet at summary, explained", () => {
		const out = runEngine(base())
		expect(out.blocks.voice!.text).toBe(decl.voice!.mechanics)
		expect(out.blocks.sheet!.depth).toBe("summary")
		expect(out.blocks.sheet!.text).toContain("Strength: 3; Health: 20; Defense: 13; weapons: Longsword")
		expect(out.blocks.sheet!.depths.index).toBe("Ann — Strength: 3; Health: 20; Defense: 13; weapons: Longsword")
		expect(out.explain.map((e) => e.text)).toContain("13 = owner.str | plus: 10")
		expect((out.facts.values as any)["character:1"]).toMatchObject({ str: 3, hp: 20, defense: 13, attack: 2 })
	})

	test("scripts — index depth by default", () => {
		const out = runEngine(base({ rigour: "scripts" }))
		expect(out.blocks.sheet!.depth).toBe("index")
		expect(out.blocks.pieces!.depth).toBe("index")
	})

	test("byte-stable: the same state renders the same bytes, whatever order owners arrive in", () => {
		for (const rigour of ["prose", "mechanics", "scripts"] as Rigour[]) {
			const a = runEngine(base({ rigour, owners: [ann(), bram()] }))
			const b = runEngine(base({ rigour, owners: [bram(), ann()] }))
			expect(JSON.stringify(b.blocks)).toBe(JSON.stringify(a.blocks))
			expect(Object.keys(a.blocks).indexOf("voice")).toBe(0)
		}
	})

	test("pieces in play: named in the actions, equipped, or firing on an event in play", () => {
		const dagger = piece({ name: "Dagger", description: "Short." })
		const owners = [ann({ pieces: [piece({ name: "Longsword", equipped: true }), dagger] })]
		const quiet = runEngine(base({ owners }))
		expect(quiet.blocks.pieces!.text).toContain("Longsword")
		expect(quiet.blocks.pieces!.text).not.toContain("Dagger")
		const named = runEngine(base({ owners, actions: { "character:1": "Ann draws her dagger" } }))
		expect(named.blocks.pieces!.text).toContain("Dagger")
		const hit = runEngine(base({ owners, actions: { "*": "she tries to hit him" } }))
		expect(hit.blocks.pieces!.text).toContain("Dagger")
	})

	test("riders read as prose at every rigour", () => {
		const owners = [ann({ ails: [piece({ name: "Poisoned", traits: ["poison"] })] })]
		expect(runEngine(base({ rigour: "prose", owners })).blocks.sheet!.depths.summary).toContain("Poisoned: Feels it in every step.")
		expect(runEngine(base({ owners })).blocks.sheet!.text).toContain("Poisoned: Feels it in every step.")
	})

	test("ties render between owners present; relational decoration absent here", () => {
		const out = runEngine(
			base({
				owners: [ann(), bram()],
				ties: [{ id: 7, from: "character:1", to: "character:2", type: "rival", description: "Old grudge." }, { id: 8, from: "character:1", to: "character:9", type: "ally" }]
			})
		)
		expect(out.blocks.ties!.text).toBe("Ann → Bram: rival — Old grudge.")
		expect(out.blocks.ties!.depths.index).toBe("Ann → Bram: rival")
	})
})

describe("apply: checks, stacking, refusals", () => {
	const hit = (against: number, ...faces: number[]): ReturnType<typeof runEngine> =>
		runEngine(
			base({
				mode: "apply",
				random: face(...faces),
				deltas: [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack", against, reason: "swing" }]
			})
		)

	test("typed bonuses: highest per type, untyped add — and the explain line says so", () => {
		const out = hit(15, 11)
		// d20 11 + str 3 + item 2 (the passive one; the item +1 on hit loses) + untyped 1 = 17
		const line = out.explain.find((e) => e.target === "character:1.attack")!
		expect(line.total).toBe(17)
		expect(line.text).toBe("d20 11 + 3 (Strength) + 1 (Longsword) + 2 (Longsword) = 17 vs 15")
	})

	test("the session's bonus stacking: `sum` adds typed terms; an edge type rolls twice", () => {
		const deltas: ProposedDelta[] = [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack", against: 15 }]
		const sum = runEngine(base({ mode: "apply", random: face(11), deltas, conventions: { ...decl.conventions!, bonuses: { types: ["item"], stacking: "sum" } } }))
		expect(sum.explain.find((e) => e.target === "character:1.attack")!.text).toBe("d20 11 + 3 (Strength) + 2 (Longsword) + 1 (Longsword) + 1 (Longsword) = 18 vs 15")
		const edge = runEngine(base({ mode: "apply", random: face(4, 13), deltas, conventions: { ...decl.conventions!, bonuses: { types: ["gear"], stacking: "highest-per-type", edge: "gear" } } }))
		expect(edge.explain.find((e) => e.target === "character:1.attack")!.text).toBe("d20 (4, 13, edge) 13 + 3 (Strength) + 1 (Longsword) = 17 vs 15")
	})

	test("success, failure and crit by the crosswalk; natural faces shift a band", () => {
		expect(hit(15, 11).outcomes[0]!.check).toMatchObject({ band: "hit", five: "success", natural: 11, total: 17 })
		expect(hit(15, 5).outcomes[0]!.check).toMatchObject({ band: "miss", five: "fail" })
		expect(hit(15, 1).outcomes[0]!.check).toMatchObject({ band: "fumble", five: "crit-fail" })
		expect(hit(15, 20).outcomes[0]!.check).toMatchObject({ band: "great", five: "crit" })
		expect(hit(5, 15).outcomes[0]!.check).toMatchObject({ band: "great", five: "crit" })
	})

	test("seeded: the same seed rolls the same dice", () => {
		const roll = (seed: string) => hit(12, ...[]) && runEngine(
			base({
				mode: "apply",
				random: seededRandom(seed),
				deltas: [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack", against: 12 }]
			})
		)
		expect(roll("run-a").explain).toEqual(roll("run-a").explain)
		const naturals = new Set(["a", "b", "c", "d", "e", "f"].map((s) => roll(s).outcomes[0]!.check!.natural))
		expect(naturals.size).toBeGreaterThan(1)
	})

	test("the outcomes block tells the check in words", () => {
		expect(hit(15, 11).blocks.outcomes!.text).toContain("Ann — hit Longsword (Attack): Hit")
	})

	test("an event's effects fire: using a piece does what its mechanics say", () => {
		const out = runEngine(base({ mode: "apply", random: face(10), deltas: [{ owner: "character:1", op: "use", piece: "Longsword", check: "attack" }] }))
		expect(out.changes).toEqual([expect.objectContaining({ slotId: HP, op: "add", value: -1, note: "Longsword" })])
	})

	test("🚧 a use naming no check lands as one against nothing — no die thrown (owner ruling ★4, P1-1)", () => {
		const out = runEngine(base({ mode: "apply", random: face(10), deltas: [{ owner: "character:1", op: "use", piece: "Longsword" }] }))
		expect(out.changes).toEqual([expect.objectContaining({ slotId: HP, op: "add", value: -1, note: "Longsword" })])
		expect(out.outcomes.some((o) => o.kind === "check")).toBe(false)
		expect(out.explain.some((e) => e.terms.some((t) => t.origin.kind === "roll"))).toBe(false)
	})

	test("🚧 one change set reads what its own earlier changes left (2026-10-18): a second spend finds less", () => {
		const out = runEngine(
			base({
				mode: "apply",
				deltas: [
					{ owner: "character:1", slot: "hp", op: "spend", value: 15 },
					{ owner: "character:1", slot: "hp", op: "spend", value: 10 },
					{ owner: "character:1", slot: "hp", op: "spend", value: 5 }
				]
			})
		)
		expect(out.changes.map((c) => c.value)).toEqual([-15, -5])
		expect(out.rejected.map((r) => r.why)).toEqual(["Ann has 5 Health, not 10 to spend."])
		expect(out.explain.map((e) => e.text)).toContain("5 (Health) − 5 (proposed) = 0")
	})

	test("refusals are named; a set on a ruleset value is reviewable, an unknown slot is not", () => {
		const deltas: ProposedDelta[] = [
			{ owner: "character:1", slot: "hp", op: "set", value: 14, reason: "healed" },
			{ owner: "character:1", slot: "luck", op: "add", value: 1 },
			{ owner: "character:9", slot: "hp", op: "add", value: 1 },
			{ owner: "character:1", repertoire: "weapons", op: "remove", piece: "Spear" },
			{ owner: "character:1", slot: "defense", op: "add", value: 1 },
			{ owner: "character:1", slot: "hp", op: "spend", value: 50 },
			{ owner: "character:1", slot: "hp", op: "add", value: -5, reason: "arrow" }
		]
		const out = runEngine(base({ mode: "apply", deltas }))
		expect(out.rejected.map((r) => r.reason)).toEqual([
			"set-on-ruleset-value",
			"unknown-slot",
			"unknown-owner",
			"unknown-piece",
			"derived-value",
			"not-enough"
		])
		expect(out.reviewable.map((r) => r.rejected.reason)).toEqual(["set-on-ruleset-value"])
		expect(out.changes).toEqual([expect.objectContaining({ slotId: HP, op: "add", value: -5 })])
		expect(out.explain.map((e) => e.text)).toContain("20 (Health) − 5 (arrow) = 15")
	})

	test("prose: sets are recorded, nothing is counted or rolled", () => {
		const out = runEngine(
			base({
				rigour: "prose",
				mode: "apply",
				random: face(10),
				deltas: [
					{ owner: "character:1", slot: "hp", op: "set", value: 14 },
					{ owner: "character:1", slot: "hp", op: "add", value: -2 },
					{ owner: "character:1", op: "hit", piece: "Longsword", against: 10 },
					{ owner: "character:1", repertoire: "conditions", op: "add", piece: "Tired" }
				]
			})
		)
		expect(out.changes.map((c) => c.op)).toEqual(["set", "add", "add"])
		expect(out.changes[1]).toMatchObject({ slotId: HP, op: "add", value: -2 })
		expect(out.changes[2]!.items).toEqual([{ kind: "inline", name: "Tired", description: "Tired" }])
		expect(out.rejected).toEqual([])
		expect(out.explain).toEqual([])
		expect(out.facts.unrolled).toEqual(["character:1:hit:Longsword"])
	})

	// Walk 6 (2026-10-17): Words only turned `spend hp 2` into a proposal.
	// Relative arithmetic applies at every rigour; only rolls are skipped,
	// and at prose the outcome is told in words.
	for (const rigour of ["prose", "mechanics", "scripts"] as const)
		test(`${rigour}: spend, gain and modify change the value by their amount`, () => {
			const out = runEngine(
				base({
					rigour,
					mode: "apply",
					random: face(10),
					deltas: [
						{ owner: "character:1", slot: "hp", op: "spend", value: 2 },
						{ owner: "character:1", slot: "hp", op: "gain", value: 1 },
						{ owner: "character:1", slot: "hp", op: "modify", value: -3 }
					]
				})
			)
			expect(out.rejected).toEqual([])
			expect(out.reviewable).toEqual([])
			expect(out.changes.map((c) => [c.slotId, c.op, c.value])).toEqual([
				[HP, "add", -2],
				[HP, "add", 1],
				[HP, "add", -3]
			])
			const told = out.outcomes.map((o) => o.text)
			if (rigour === "prose") {
				expect(told).toEqual(["Ann: Health falls", "Ann: Health rises", "Ann: Health falls"])
				expect(told.join(" ")).not.toMatch(/\d/)
			} else expect(told).toEqual(["Ann: Health −2", "Ann: Health +1", "Ann: Health −3"])
		})
})

describe("time", () => {
	test("an elapsed trigger fires once per `every` passed", () => {
		const owners = [ann({ ails: [piece({ name: "Poisoned", traits: ["poison"] })] })]
		const out = runEngine(base({ mode: "advance", elapsed: 5, owners }))
		expect(out.changes).toEqual([expect.objectContaining({ slotId: HP, op: "add", value: -2, note: "Poisoned" })])
		expect(out.outcomes[0]).toMatchObject({ kind: "trigger", text: "Ann: Health −2 (Poisoned)" })
	})

	test("an `at` trigger fires when its date falls in the time passed; with no clock it says so", () => {
		const owners = [ann({ ails: [piece({ name: "Cursed", traits: ["curse"] })] })]
		const clock = { now: { year: 100, month: 1, day: 1, hour: 10, minute: 0 }, calendar: null }
		expect(runEngine(base({ mode: "advance", elapsed: 1, owners, clock })).changes).toEqual([])
		expect(runEngine(base({ mode: "advance", elapsed: 3, owners, clock })).changes).toEqual([
			expect.objectContaining({ slotId: HP, value: -5 })
		])
		const noClock = runEngine(base({ mode: "advance", elapsed: 3, owners, clock: null }))
		expect(noClock.changes).toEqual([])
		expect(noClock.explain.find((e) => e.target === "clock")!.text).toMatch(/^needs a clock/)
	})
})

describe("dice", () => {
	test("rollDice reads the expression grammar", () => {
		expect(rollDice("2d6+1", face(4, 6)).faces.length).toBe(2)
		expect(() => rollDice("d", Math.random)).toThrow(/not a die/)
	})
	test("a check against nothing has no verdict", () => {
		expect(degreeOf(decl.conventions!.degrees!, { total: 30, natural: 15 })).toBeNull()
	})
})

describe("budget: degrade before drop", () => {
	test("the lowest priority steps down first; only then does a block leave", () => {
		const owners = [ann({ pieces: [piece({ name: "Longsword", description: "A long blade with a story behind it.", equipped: true, traits: ["steel"] })] }), bram()]
		const out = runEngine(base({ owners, actions: { "*": "club" } }))
		const all = Object.entries(out.blocks).reduce((a, [k, b]) => a + (k === "holders" ? 0 : (b as { tokens: number }).tokens), 0)
		const fit = fitRulesetBlocks(out.blocks, all - 1)
		expect(fit.steps[0]).toBe("pieces: summary → index")
		expect(fit.record.pieces!.depth).toBe("index")
		expect(Object.keys(fit.record)).toEqual(Object.keys(out.blocks))
		const tight = fitRulesetBlocks(out.blocks, out.blocks.voice!.tokens + 2)
		expect(tight.steps.filter((s) => s.endsWith("dropped")).length).toBeGreaterThan(0)
		expect(tight.record.voice).toBeDefined()
		expect(tight.steps.indexOf("sheet: summary → index")).toBeLessThan(tight.steps.findIndex((s) => s.endsWith("dropped")))
	})
})
