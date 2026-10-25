/**
 * 🚧 Spell points on Vis Itineris (PLAN-sheet-widget-redesign §8): under the
 * setting `casting: points` a spell's `spend` costs its level from
 * `itineris-spell-points` (a cantrip nothing) and the spell stays known; a
 * long rest (an advance of eight hours or more) fills the pool back to its
 * maximum — the level-up script's `spellPoints` when a script reported it,
 * else the pool's configured `max`. Under `casting: slots` (the default) a
 * spend is a piece spent, as before.
 */
import { beforeAll, describe, expect, test } from "vitest"
import "@serene-pub/core-catalog"
import { getRepertoire, getRuleset, type RulesetDecl } from "@serene-pub/sdk"
import { LONG_REST_MINUTES, runApply, SPELL_POINTS_SLOT } from "./engine"
import { elapsedInUnits } from "./resolve"
import { conventionsFor, settingValues } from "./conventions"
import type { EngineInput, HeldPiece, OwnerView } from "./types"

const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const SPELLS_SLOT = "test:slot/sp-spells@1"

let ruleset: RulesetDecl
beforeAll(() => {
	ruleset = getRuleset(VIS_ITINERIS)!
})

const spell = (name: string, level: number): HeldPiece => ({
	key: name.toLowerCase(),
	props: { name, description: `${name}.`, level } as unknown as HeldPiece["props"],
	count: 1,
	form: "inline",
	item: { kind: "inline", name, description: `${name}.`, level } as unknown as HeldPiece["item"]
})

function caster(points: number, max?: number): OwnerView {
	return {
		key: "character:1",
		owner: { kind: "session_cast", id: 1 },
		name: "Ann",
		stats: [
			{ slotId: SPELL_POINTS_SLOT, selector: "itineris-spell-points", type: "integer", value: points, label: "Spell points", ...(max !== undefined ? { max } : {}) }
		],
		repertoires: [
			{ slotId: SPELLS_SLOT, repertoire: getRepertoire(`${VIS_ITINERIS}#spells`)!, pieces: [spell("Firebolt", 0), spell("Burning Hands", 1), spell("Fireball", 3)] }
		],
		custom: [],
		bag: {}
	}
}

const input = (casting: "points" | "slots", over: Partial<EngineInput>): EngineInput => {
	const settings = settingValues(ruleset, { values: { casting } })
	return {
		ruleset,
		rigour: "mechanics",
		owners: [],
		actions: {},
		deltas: [],
		elapsed: 0,
		ties: [],
		turn: 1,
		settings,
		conventions: conventionsFor(ruleset, settings),
		...over
	}
}

const cast = (name: string) => ({ owner: "character:1", op: "spend", repertoire: "spells", piece: name, reason: "cast" })

describe("casting: points", () => {
	test("a spell costs its level in points and stays known", () => {
		const out = runApply(input("points", { owners: [caster(4, 6)], deltas: [cast("Burning Hands")] }))
		expect(out.rejected).toEqual([])
		expect(out.changes).toEqual([{ owner: { kind: "session_cast", id: 1 }, slotId: SPELL_POINTS_SLOT, op: "add", value: -1, note: "cast" }])
		expect(out.outcomes.map((o) => o.text)).toContain("Ann casts Burning Hands: Spell points −1 (3 left)")
	})

	test("a cantrip costs nothing", () => {
		const out = runApply(input("points", { owners: [caster(0, 6)], deltas: [cast("Firebolt")] }))
		expect(out.rejected).toEqual([])
		expect(out.changes).toEqual([])
		expect(out.outcomes.map((o) => o.text)).toContain("Ann casts Firebolt")
	})

	test("too few points is refused, in words, and nothing changes", () => {
		const out = runApply(input("points", { owners: [caster(2, 6)], deltas: [cast("Fireball")] }))
		expect(out.changes).toEqual([])
		expect(out.rejected[0]).toMatchObject({ reason: "not-enough" })
		expect(JSON.stringify(out.rejected[0])).toContain("not the 3 Fireball costs")
	})

	test("a long rest fills the pool to the configured max; a short one does not", () => {
		const conv = conventionsFor(ruleset, settingValues(ruleset, { values: { casting: "points" } }))
		const long = elapsedInUnits({ minutes: LONG_REST_MINUTES }, conv.time).units
		const short = elapsedInUnits({ minutes: 60 }, conv.time).units
		const rested = runApply(input("points", { owners: [caster(1, 6)], elapsed: long }))
		expect(rested.changes).toContainEqual({ owner: { kind: "session_cast", id: 1 }, slotId: SPELL_POINTS_SLOT, op: "set", value: 6, note: "A long rest" })
		const napped = runApply(input("points", { owners: [caster(1, 6)], elapsed: short }))
		expect(napped.changes.filter((c) => c.slotId === SPELL_POINTS_SLOT)).toEqual([])
	})

	test("the level-up script's `spellPoints`, when reported, is the maximum", () => {
		const conv = conventionsFor(ruleset, settingValues(ruleset, { values: { casting: "points" } }))
		const long = elapsedInUnits({ hours: 8 }, conv.time).units
		const out = runApply(
			input("points", {
				owners: [caster(0, 99)],
				elapsed: long,
				scripted: { "character:1": { values: { spellPoints: 4 }, modifies: [], explain: [], failed: [] } }
			})
		)
		expect(out.changes).toContainEqual(expect.objectContaining({ slotId: SPELL_POINTS_SLOT, op: "set", value: 4 }))
	})
})

describe("🚧 casting: points, honoured (owner ruling ★7, P2-4)", () => {
	test("two spells in one turn: the second reads the pool the first left", () => {
		const out = runApply(input("points", { owners: [caster(4, 6)], deltas: [cast("Fireball"), cast("Burning Hands"), cast("Burning Hands")] }))
		expect(out.changes.map((c) => c.value)).toEqual([-3, -1])
		expect(out.rejected.map((r) => r.why)).toEqual(["Ann has 0 Spell points, not the 1 Burning Hands costs."])
	})

	test("a long rest refills to the derive script's spell-points-max, over a stale configured max", () => {
		const conv = conventionsFor(ruleset, settingValues(ruleset, { values: { casting: "points" } }))
		const long = elapsedInUnits({ minutes: LONG_REST_MINUTES }, conv.time).units
		const out = runApply(
			input("points", {
				owners: [caster(1, 4)],
				elapsed: long,
				scripted: { "character:1": { values: { "spell-points-max": 8 }, modifies: [], explain: [], failed: [] } }
			})
		)
		expect(out.changes).toContainEqual({ owner: { kind: "session_cast", id: 1 }, slotId: SPELL_POINTS_SLOT, op: "set", value: 8, note: "A long rest" })
		expect(out.outcomes.map((o) => o.text)).toContain("Ann: Spell points back to 8 (a long rest)")
	})
})

describe("🚧 the pool read off the declaration (M2, 2026-10-22: VI's numbers into its declaration — M3 declares them)", () => {
	const declared = (rest?: unknown) => {
		const conv = conventionsFor(ruleset, settingValues(ruleset, { values: { casting: "slots" } }))
		return { ...conv, casting: { pool: "itineris-spell-points", cost: "level", repertoire: "spells", refill: "long" }, ...(rest ? { rest } : {}) } as never
	}

	test("conventions.casting, laid by a setting's choice: a cast costs its level from the pool, whatever the setting's id", () => {
		const out = runApply({ ...input("slots", { owners: [caster(4, 6)], deltas: [cast("Burning Hands")] }), conventions: declared() })
		expect(out.changes.map((c) => [c.slotId, c.value])).toEqual([[SPELL_POINTS_SLOT, -1]])
		expect(out.outcomes.map((o) => o.text)).toEqual(["Ann casts Burning Hands: Spell points −1 (3 left)"])
	})

	test("the refill is the rest the declaration names, its minutes read — never a number of the engine's", () => {
		const conv = conventionsFor(ruleset, settingValues(ruleset))
		const at = (minutes: number) => elapsedInUnits({ minutes }, conv.time).units
		// Vis Itineris's own long rest: 480 minutes.
		expect(runApply({ ...input("slots", { owners: [caster(1, 6)], elapsed: at(480) }), conventions: declared() }).changes).toContainEqual(
			expect.objectContaining({ slotId: SPELL_POINTS_SLOT, op: "set", value: 6 })
		)
		expect(runApply({ ...input("slots", { owners: [caster(1, 6)], elapsed: at(470) }), conventions: declared() }).changes).toEqual([])
		// A table whose long rest is an hour refills after an hour.
		const hour = [{ id: "long", label: { en: "Long rest" }, minutes: 60, recharges: ["long"] }]
		expect(runApply({ ...input("slots", { owners: [caster(1, 6)], elapsed: at(60) }), conventions: declared(hour) }).changes).toContainEqual(
			expect.objectContaining({ slotId: SPELL_POINTS_SLOT, op: "set", value: 6 })
		)
	})

	test("a caster with no pool is refused in the pool's own words", () => {
		const noPool = { ...caster(4, 6), stats: [] }
		const out = runApply({ ...input("slots", { owners: [noPool], deltas: [cast("Burning Hands")] }), conventions: declared() })
		expect(out.rejected.map((r) => r.why)).toEqual(["Ann has no spell points to cast Burning Hands with."])
	})
})

describe("casting: slots (the default)", () => {
	test("a spend is the piece spent, the pool untouched; a long rest leaves the pool alone", () => {
		const out = runApply(input("slots", { owners: [caster(4, 6)], deltas: [cast("Burning Hands")] }))
		expect(out.changes.some((c) => c.slotId === SPELL_POINTS_SLOT)).toBe(false)
		expect(out.changes[0]).toMatchObject({ slotId: SPELLS_SLOT, op: "remove" })
		const conv = conventionsFor(ruleset, settingValues(ruleset, { values: { casting: "slots" } }))
		const rested = runApply(input("slots", { owners: [caster(1, 6)], elapsed: elapsedInUnits({ hours: 8 }, conv.time).units }))
		expect(rested.changes.some((c) => c.slotId === SPELL_POINTS_SLOT)).toBe(false)
	})
})
