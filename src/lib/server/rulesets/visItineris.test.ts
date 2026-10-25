/**
 * 🚧 Vis Itineris (core's rigorous d20 ruleset) through the handler at
 * `mechanics`: an attack with a weapon piece, read under the table's
 * degrees setting — four degrees (by margin, a natural 20 or 1 moving a
 * step) or hit-or-miss (a natural 20 a critical, a natural 1 always a miss).
 *
 * ⏳ Vis Itineris's declaration is read from the SDK repo's SOURCE: the built
 * catalogue this phase predates it. Point the import at
 * `@serene-pub/core-catalog` once `sdk:build` has run. Ability modifiers and
 * proficiency are Vis Itineris's `vis-itineris-derive` script's: the attacks below the
 * first block are the die and the weapon alone; the last runs the script
 * through the QuickJS host (`scripts.ts`).
 */

import { describe, expect, test } from "vitest"
import { getRepertoire, getRuleset, type RulesetDecl } from "@serene-pub/sdk"
import { pieceDisplayText, runApply, runResolve, selectorLabel } from "./engine"
import { conventionsFor, presetOf, settingValues } from "./conventions"
import { degreeOf } from "./dice"
import { runDerivedScripts } from "./scripts"
import type { EngineInput, OwnerView } from "./types"

const VIS_ITINERIS = "core:ruleset/vis-itineris@1"

async function visItineris(): Promise<RulesetDecl> {
	// A computed path, so the typecheck does not walk the unbuilt source.
	const source = new URL("../../../../../serene-pub-sdk/core-catalog/src/registry/rulesets.ts", import.meta.url).pathname
	await import(/* @vite-ignore */ source)
	return getRuleset(VIS_ITINERIS)!
}

function fighter(): OwnerView {
	const weapons = getRepertoire(`${VIS_ITINERIS}#weapons`)!
	const props = {
		name: "Longsword",
		description: "A long, straight blade.",
		category: "martial",
		damage: { dice: 1, die: "d8", type: "slashing" },
		traits: ["versatile"]
	}
	return {
		key: "character:1",
		owner: { kind: "session_cast", id: 1 },
		name: "Ser Ana",
		stats: [],
		repertoires: [
			{
				slotId: "test:slot/itineris-gear@1",
				repertoire: weapons,
				pieces: [{ key: "longsword", props, count: 1, form: "inline", item: { kind: "inline", ...props } }]
			}
		],
		custom: [],
		bag: {}
	}
}

const face = (n: number) => () => (n - 1) / 20 + 0.001

function attack(decl: RulesetDecl, degrees: string, natural: number, against: number) {
	const settings = settingValues(decl, { values: { degrees } })
	const input: EngineInput = {
		ruleset: decl,
		rigour: "mechanics",
		owners: [fighter()],
		actions: {},
		deltas: [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack.melee", against }],
		elapsed: 0,
		ties: [],
		turn: 1,
		random: face(natural),
		conventions: conventionsFor(decl, settings)
	}
	return runApply(input)
}

describe("Vis Itineris at mechanics: an attack with a weapon piece", () => {
	test("🚧 a hit rolls the weapon's damage (P2-1) — told, with no target to take it; resolve renders it", async () => {
		const decl = await visItineris()
		const out = attack(decl, "fourfold", 16, 15)
		expect(out.outcomes[0]!.check).toMatchObject({ selector: "attack.melee", natural: 16, total: 16, band: "success" })
		// d8 on the same face (16 of 20 → 7 of 8); nobody named to take it.
		expect(out.outcomes[1]).toMatchObject({ kind: "effect", text: "Ser Ana's Longsword deals 7 damage" })
		expect(out.outcomes.map((o) => o.text).join("\n")).not.toContain("On a hit, roll the weapon's damage")
		expect(out.explain.find((e) => e.target === out.outcomes[1]!.explainKey)!.text).toBe("1d8 (7) = 7")
		expect(out.changes).toEqual([])
		expect(out.explain[0]!.text).toBe("d20 16 vs 15")
		const read = runResolve({ ruleset: decl, rigour: "mechanics", owners: [fighter()], actions: { "*": "swing the longsword" }, deltas: [], elapsed: 0, ties: [], turn: 1 })
		// 🚧 The turn economy line (M2, 2026-10-22): `actions.perTurn` read where numbers show.
		expect(read.blocks.voice!.text).toBe(`${decl.voice!.mechanics}\nA turn holds 3 actions and a reaction.`)
		expect(read.blocks.pieces!.text).toContain("Longsword — A long, straight blade.")
	})

	test("four degrees vs hit-or-miss: the same dice, read two ways", async () => {
		const decl = await visItineris()
		// A natural 20 that misses the target by 5.
		expect(attack(decl, "fourfold", 20, 25).outcomes[0]!.check).toMatchObject({ band: "success", five: "success" })
		expect(attack(decl, "classic", 20, 25).outcomes[0]!.check).toMatchObject({ band: "critical", five: "crit" })
		// A natural 1 against an easy target.
		expect(attack(decl, "fourfold", 1, 5).outcomes[0]!.check).toMatchObject({ band: "critical-failure", five: "crit-fail" })
		expect(attack(decl, "classic", 1, 5).outcomes[0]!.check).toMatchObject({ band: "natural-one", five: "crit-fail" })
		// Beating the target by ten.
		expect(attack(decl, "fourfold", 19, 9).outcomes[0]!.check).toMatchObject({ band: "critical-success" })
		expect(attack(decl, "classic", 19, 9).outcomes[0]!.check).toMatchObject({ band: "success" })
		// A miss is a miss either way — and the hit riders do not fire.
		const miss = attack(decl, "classic", 8, 15)
		expect(miss.outcomes[0]!.check).toMatchObject({ band: "failure", five: "fail" })
		expect(miss.outcomes).toHaveLength(1)
	})

	test("settings resolve through defaults and presets", async () => {
		const decl = await visItineris()
		expect(settingValues(decl)).toMatchObject({ degrees: "fourfold", bonuses: "typed" })
		expect(presetOf(decl, settingValues(decl))).toBe("vis-itineris")
		expect(presetOf(decl, settingValues(decl, { preset: "classic" }))).toBe("classic")
		expect(conventionsFor(decl, { bonuses: "classic" }).bonuses).toMatchObject({ stacking: "sum", edge: "edge" })
	})
})

// ── Item effects the handler executes (owner ruling ★4, P2-1/P2-2/P2-3) ─────

const HP_SLOT = "core:slot/hp@1"
const held = (props: Record<string, unknown>, count = 1) => ({
	key: String(props.name).toLowerCase(),
	props: { description: "", ...props } as any,
	count,
	form: "inline" as const,
	item: { kind: "inline", description: "", ...props, ...(count > 1 ? { count } : {}) } as any
})
const hpStat = (value: number, max?: number) => ({
	slotId: HP_SLOT,
	selector: "hp",
	type: "integer",
	value,
	label: "Health",
	...(max !== undefined ? { max } : {})
})
function adventurer(key: string, name: string, hp: number, max: number, reps: Array<[string, ReturnType<typeof held>[]]> = [], values: Record<string, number> = {}): OwnerView {
	const id = Number(key.split(":")[1])
	return {
		key,
		owner: { kind: "session_cast", id },
		name,
		stats: [hpStat(hp, max)],
		repertoires: reps.map(([rep, pieces]) => ({ slotId: `test:slot/fx-${rep}@1`, repertoire: getRepertoire(`${VIS_ITINERIS}#${rep}`)!, pieces })),
		custom: [],
		bag: {},
		...(Object.keys(values).length ? { _values: values } : {})
	} as OwnerView
}
/** Run `apply` at `mechanics`, with each owner's derived values as a script would report them. */
function applyFx(decl: RulesetDecl, owners: OwnerView[], deltas: EngineInput["deltas"], faces: number[], rigour: EngineInput["rigour"] = "mechanics") {
	let i = 0
	const scripted = Object.fromEntries(
		owners.map((o) => [o.key, { values: (o as unknown as { _values?: Record<string, number> })._values ?? {}, modifies: [], explain: [], failed: [] }])
	)
	return runApply({
		ruleset: decl,
		rigour,
		owners,
		actions: {},
		deltas,
		elapsed: 0,
		ties: [],
		turn: 1,
		random: () => (faces[i++ % faces.length]! - 1) / 20 + 0.001,
		conventions: conventionsFor(decl, settingValues(decl)),
		scripted
	})
}
const POTION = { name: "Potion of healing", uses: 1, heals: "2d4+2", traits: ["potion", "healing"] }
const ANTITOXIN = { name: "Antitoxin", uses: 1, traits: ["potion", "poison-ward"] }
const POISONED = { name: "Poisoned", traits: ["condition-poisoned"] }

describe("🚧 item effects, executed by the handler (owner ruling ★4)", () => {
	test("a weapon hit takes its dice plus the attack's modifier off the target named; a miss takes nothing", async () => {
		const decl = await visItineris()
		const longsword = { name: "Longsword", category: "martial", damage: { dice: 1, die: "d8" }, damageType: "slashing" }
		const ana = adventurer("character:1", "Ana", 12, 12, [["weapons", [held(longsword)]]], { "strength-mod": 3, "dexterity-mod": 1 })
		const orc = adventurer("character:2", "the orc", 15, 15)
		// d20 15 + 3 vs 13: a hit; d8 on face 10 → 4, + Strength 3 = 7.
		const hit = applyFx(decl, [ana, orc], [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack.melee", against: 13, aimedAt: "character:2" }], [15, 10])
		expect(hit.outcomes[0]!.check).toMatchObject({ total: 18, band: "success" })
		expect(hit.changes).toEqual([{ owner: { kind: "session_cast", id: 2 }, slotId: HP_SLOT, op: "add", value: -7, note: "Longsword" }])
		expect(hit.outcomes[1]!.text).toBe("Ana's Longsword deals 7 slashing damage to the orc: Health −7")
		expect(hit.explain.find((e) => e.target === hit.outcomes[1]!.explainKey)!.text).toBe("1d8 (4) + 3 (Strength modifier) = 7")
		// A target named by name, not on any sheet: told, written nowhere.
		const told = applyFx(decl, [ana], [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack.melee", against: 13, aimedAt: "a goblin" }], [15, 10])
		expect(told.outcomes[1]!.text).toBe("Ana's Longsword deals 7 slashing damage to a goblin")
		expect(told.changes).toEqual([])
		// A miss deals nothing.
		const miss = applyFx(decl, [ana, orc], [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack.melee", against: 19, aimedAt: "character:2" }], [5, 10])
		expect(miss.outcomes).toHaveLength(1)
		expect(miss.changes).toEqual([])
	})

	test("an overkill blow stops at nothing left; two blows read what the first left; a critical doubles the dice", async () => {
		const decl = await visItineris()
		const axe = { name: "Greataxe", category: "martial", damage: { dice: 1, die: "d12" } }
		const ana = adventurer("character:1", "Ana", 12, 12, [["weapons", [held(axe)]]], { "strength-mod": 3 })
		const rat = adventurer("character:2", "the rat", 5, 5)
		const two = applyFx(
			decl,
			[ana, rat],
			[
				{ owner: "character:1", op: "hit", piece: "Greataxe", check: "attack.melee", against: 12, aimedAt: "character:2" },
				{ owner: "character:1", op: "hit", piece: "Greataxe", check: "attack.melee", against: 12, aimedAt: "character:2" }
			],
			[15, 1]
		)
		// d12 face 1 → 1, + 3 = 4 each: 5 → 1 → 0, the second only 1.
		expect(two.changes.map((c) => c.value)).toEqual([-4, -1])
		expect(two.outcomes.at(-1)!.text).toContain("Health −1 (all left to lose)")
		// A natural 20 against Vis Itineris's four degrees is a critical success: two d12.
		const crit = applyFx(decl, [ana, adventurer("character:2", "the troll", 40, 40)], [{ owner: "character:1", op: "hit", piece: "Greataxe", check: "attack.melee", against: 5, aimedAt: "character:2" }], [20, 1, 1])
		expect(crit.outcomes[0]!.check).toMatchObject({ five: "crit" })
		expect(crit.explain.find((e) => e.target === crit.outcomes[1]!.explainKey)!.text).toBe("1d12 doubled for a critical (1, 1) + 3 (Strength modifier) = 5")
	})

	test("🚧 P2-2: a finesse or ranged weapon rolls with Strength or Dexterity, whichever is higher — attack and damage", async () => {
		const decl = await visItineris()
		const rapier = { name: "Rapier", category: "martial", damage: { dice: 1, die: "d8" }, traits: ["finesse"] }
		const club = { name: "Club", category: "simple", damage: { dice: 1, die: "d4" } }
		const pip = adventurer("character:1", "Pip", 9, 9, [["weapons", [held(rapier), held(club)]]], { "strength-mod": -1, "dexterity-mod": 3 })
		const fine = applyFx(decl, [pip], [{ owner: "character:1", op: "hit", piece: "Rapier", check: "attack.melee", against: 10 }], [10, 10])
		expect(fine.explain.find((e) => e.target === "character:1.attack.melee")!.text).toBe("d20 10 + 3 (Dexterity modifier) = 13 vs 10")
		expect(fine.explain.find((e) => e.target === fine.outcomes[1]!.explainKey)!.text).toBe("1d8 (4) + 3 (Dexterity modifier) = 7")
		const blunt = applyFx(decl, [pip], [{ owner: "character:1", op: "hit", piece: "Club", check: "attack.melee", against: 5 }], [10, 10])
		expect(blunt.explain.find((e) => e.target === "character:1.attack.melee")!.text).toBe("d20 10 − 1 (Strength modifier) = 9 vs 5")
	})

	test("a potion drunk with no check heals its dice, never past full, and is spent; given to someone, it heals them", async () => {
		const decl = await visItineris()
		const pip = adventurer("character:1", "Pip", 3, 9, [["consumables", [held(POTION)]]])
		// 2d4+2 on face 12 → 3 + 3 + 2 = 8; only 6 to full.
		const drunk = applyFx(decl, [pip], [{ owner: "character:1", op: "use", piece: "Potion of healing" }], [12])
		expect(drunk.changes[0]).toEqual({ owner: { kind: "session_cast", id: 1 }, slotId: HP_SLOT, op: "add", value: 6, note: "Potion of healing" })
		expect(drunk.outcomes.map((o) => o.text)).toEqual(["Pip's Potion of healing heals 8: Health +6 (back to full)", "Pip no longer has Potion of healing"])
		expect(drunk.changes[1]).toMatchObject({ slotId: "test:slot/fx-consumables@1", op: "remove" })
		expect(drunk.changes).toHaveLength(2)
		// Fed to a friend: their health, the drinker's potion.
		const ann = adventurer("character:2", "Ann", 1, 10)
		const fed = applyFx(decl, [pip, ann], [{ owner: "character:1", op: "use", piece: "Potion of healing", aimedAt: "Ann" }], [12])
		expect(fed.changes[0]).toMatchObject({ owner: { kind: "session_cast", id: 2 }, value: 8 })
		expect(fed.outcomes[0]!.text).toBe("Pip's Potion of healing heals Ann 8: Health +8")
	})

	test("a stack loses one per drink; two drinks in one turn each read what the first left", async () => {
		const decl = await visItineris()
		const pip = adventurer("character:1", "Pip", 1, 12, [["consumables", [held(POTION, 2)]]])
		const out = applyFx(
			decl,
			[pip],
			[
				{ owner: "character:1", op: "use", piece: "Potion of healing" },
				{ owner: "character:1", op: "use", piece: "Potion of healing" },
				{ owner: "character:1", op: "use", piece: "Potion of healing" }
			],
			[12]
		)
		const hp = out.changes.filter((c) => c.slotId === HP_SLOT).map((c) => c.value)
		expect(hp).toEqual([8, 3])
		expect(out.outcomes.map((o) => o.text)).toEqual(
			expect.arrayContaining(["Pip uses Potion of healing; 1 left", "Pip no longer has Potion of healing"])
		)
		// A third from a stack of two: none left — refused, nothing healed.
		expect(out.rejected).toHaveLength(1)
		expect(out.rejected[0]!.why).toBe("Pip has no Potion of healing left to use.")
	})

	test("an antitoxin ends Poisoned, and a poison the same turn puts on does not take hold — either order", async () => {
		const decl = await visItineris()
		const sick = adventurer("character:1", "Pip", 9, 9, [
			["consumables", [held(ANTITOXIN)]],
			["conditions", [held(POISONED)]]
		])
		const cured = applyFx(decl, [sick], [{ owner: "character:1", op: "use", piece: "Antitoxin" }], [10])
		expect(cured.changes[0]).toMatchObject({ slotId: "test:slot/fx-conditions@1", op: "remove" })
		expect(cured.outcomes.map((o) => o.text)).toEqual(["Antitoxin ends Poisoned on Pip", "Pip no longer has Antitoxin"])
		const well = () => adventurer("character:1", "Pip", 9, 9, [["consumables", [held(ANTITOXIN)]], ["conditions", []]])
		const after = applyFx(decl, [well()], [
			{ owner: "character:1", repertoire: "conditions", op: "add", piece: POISONED as never },
			{ owner: "character:1", op: "use", piece: "Antitoxin" }
		], [10])
		expect(after.changes.some((c) => c.slotId === "test:slot/fx-conditions@1" && c.op === "add")).toBe(false)
		expect(after.outcomes.map((o) => o.text)).toContain("Poisoned does not take hold on Pip (Antitoxin)")
		const before = applyFx(decl, [well()], [
			{ owner: "character:1", op: "use", piece: "Antitoxin" },
			{ owner: "character:1", repertoire: "conditions", op: "add", piece: POISONED as never }
		], [10])
		expect(before.changes.some((c) => c.slotId === "test:slot/fx-conditions@1" && c.op === "add")).toBe(false)
		expect(before.outcomes.map((o) => o.text)).toContain("Poisoned does not take hold on Pip")
	})

	test("a flask thrown harms its target and is spent; a healing spell adds the caster's modifier and is never spent", async () => {
		const decl = await visItineris()
		const fire = { name: "Alchemist's fire", uses: 1, damage: { formula: "1d4" }, damageType: "fire" }
		const cure = { name: "Cure wounds", level: 1, school: "evocation", heals: "2d8", traits: ["healing"] }
		const bard = adventurer("character:1", "Bard", 8, 8, [["consumables", [held(fire)]], ["spells", [held(cure)]]], { "casting-mod": 3 })
		const ann = adventurer("character:2", "Ann", 2, 20)
		const thrown = applyFx(decl, [bard, ann], [{ owner: "character:1", op: "use", piece: "Alchemist's fire", aimedAt: "character:2" }], [10])
		expect(thrown.outcomes[0]!.text).toBe("Bard's Alchemist's fire deals 2 fire damage to Ann: Health −2")
		expect(thrown.outcomes[1]!.text).toBe("Bard no longer has Alchemist's fire")
		const healed = applyFx(decl, [bard, adventurer("character:2", "Ann", 2, 20)], [{ owner: "character:1", op: "use", piece: "Cure wounds", aimedAt: "Ann" }], [12])
		// 2d8 on face 12 → 5 + 5, + spellcasting 3 = 13.
		expect(healed.outcomes.map((o) => o.text)).toEqual(["Bard's Cure wounds heals Ann 13: Health +13"])
		expect(healed.changes.filter((c) => c.slotId !== HP_SLOT)).toEqual([])
	})

	test("at prose nothing is rolled: a potion drunk is still spent and an antitoxin still cures — health in words alone", async () => {
		const decl = await visItineris()
		const pip = adventurer("character:1", "Pip", 3, 9, [["consumables", [held(POTION), held(ANTITOXIN)]], ["conditions", [held(POISONED)]]])
		const out = applyFx(decl, [pip], [
			{ owner: "character:1", op: "use", piece: "Potion of healing" },
			{ owner: "character:1", op: "use", piece: "Antitoxin" }
		], [10], "prose")
		expect(out.changes.some((c) => c.slotId === HP_SLOT)).toBe(false)
		expect(out.changes.filter((c) => c.op === "remove").length).toBe(3)
		expect(out.facts.unrolled).toEqual(["character:1:use:Potion of healing", "character:1:use:Antitoxin"])
	})

	test("🚧 P2-3: armour class is on the sheet, beside health — worked out, never stored", async () => {
		const decl = await visItineris()
		const ana = adventurer("character:1", "Ana", 12, 12)
		const read = runResolve({
			ruleset: decl,
			rigour: "mechanics",
			owners: [ana],
			actions: {},
			deltas: [],
			elapsed: 0,
			ties: [],
			turn: 1,
			scripted: { "character:1": { values: { "armour-class": 16 }, modifies: [], explain: [], failed: [] } }
		})
		expect(read.blocks.sheet!.text).toContain("Ana — Health: 12; Armour class: 16")
		// The spell-point maximum shows only where a script reports it (a points table).
		expect(read.blocks.sheet!.text).not.toContain("Spell points at most")
		const words = runResolve({ ruleset: decl, rigour: "prose", owners: [ana], actions: {}, deltas: [], elapsed: 0, ties: [], turn: 1 })
		expect(words.blocks.sheet?.text ?? "").not.toContain("Armour class")
	})
})

describe("selector families (A2): a condition on `attack` reaches `attack.melee`", () => {
	test("a Poisoned holder's melee attack rolls against the edge", async () => {
		const decl = await visItineris()
		const conditions = getRepertoire(`${VIS_ITINERIS}#conditions`)!
		const poisoned = { name: "Poisoned", description: "Sick and shaky.", traits: ["condition-poisoned"] }
		const ana: OwnerView = {
			...fighter(),
			repertoires: [
				...fighter().repertoires,
				{
					slotId: "test:slot/itineris-conditions@1",
					repertoire: conditions,
					pieces: [{ key: "poisoned", props: poisoned, count: 1, form: "inline", item: { kind: "inline", ...poisoned } }]
				}
			]
		}
		const conventions = conventionsFor(decl, settingValues(decl))
		expect(conventions.bonuses?.edge).toBe("edge")
		const roll = (owner: OwnerView, check: string) =>
			runApply({
				ruleset: decl,
				rigour: "mechanics",
				owners: [owner],
				actions: {},
				deltas: [{ owner: "character:1", op: "hit", piece: "Longsword", check, against: 15 }],
				elapsed: 0,
				ties: [],
				turn: 1,
				random: (() => {
					const faces = [17, 6]
					let i = 0
					return () => (faces[i++ % faces.length]! - 1) / 20 + 0.001
				})(),
				conventions
			})
		// Two dice, the lower kept: the −edge `attack` carries reached `attack.melee`.
		const sick = roll(ana, "attack.melee")
		expect(sick.outcomes[0]!.check).toMatchObject({ selector: "attack.melee", natural: 6 })
		expect(sick.explain.find((e) => e.target === "character:1.attack.melee")!.text).toBe("d20 (17, 6, against the edge) 6 vs 15")
		// The generic `check` reaches a skill check; a saving throw it does not.
		expect(roll(ana, "skill.stealth").outcomes[0]!.check).toMatchObject({ natural: 6 })
		expect(roll(ana, "save.constitution").outcomes[0]!.check).toMatchObject({ natural: 17 })
		// Well again, one die.
		expect(roll(fighter(), "attack.melee").outcomes[0]!.check).toMatchObject({ natural: 17 })
	})
})

describe("degrees step by rank, never by declaration order", () => {
	test("hit-or-miss lists Natural 1 after Success; a step up from Success is Critical", async () => {
		const decl = await visItineris()
		const classic = conventionsFor(decl, { degrees: "classic" }).degrees!
		expect(degreeOf(classic, { total: 16, natural: 14, against: 15 })!.band.id).toBe("success")
		expect(degreeOf(classic, { total: 16, natural: 14, against: 15, adjust: 1 })!.band.id).toBe("critical")
		expect(degreeOf(classic, { total: 14, natural: 14, against: 15, adjust: -1 })!.band.id).toBe("natural-one")
		expect(degreeOf(classic, { total: 16, natural: 14, against: 15, adjust: 5 })!.band.id).toBe("critical")
	})
})

describe("Vis Itineris's derive script, run by the handler", () => {
	test("an attack at mechanics is d20 + Strength modifier + proficiency, with the explain string", async () => {
		const decl = await visItineris()
		// TODO(sdk:build): read the seeded row (`seedCoreScripts`) once the
		// built catalogue carries the envelope-reading script.
		const scripts = new URL("../../../../../serene-pub-sdk/core-catalog/src/seed/visItinerisScripts.ts", import.meta.url).pathname
		const { VIS_ITINERIS_DERIVE_SCRIPT, VIS_ITINERIS_BULK_SCRIPT } = await import(/* @vite-ignore */ scripts)
		const sources: Record<string, string> = {
			[VIS_ITINERIS_DERIVE_SCRIPT.seedKey]: VIS_ITINERIS_DERIVE_SCRIPT.source,
			[VIS_ITINERIS_BULK_SCRIPT.seedKey]: VIS_ITINERIS_BULK_SCRIPT.source
		}
		const ana: OwnerView = {
			...fighter(),
			stats: [
				{ slotId: "core:slot/level@1", selector: "level", type: "integer", value: 1, label: "Level" },
				{ slotId: "core:slot/itineris-strength@1", selector: "itineris-strength", type: "integer", value: 16, label: "Strength" },
				{ slotId: "core:slot/itineris-dexterity@1", selector: "itineris-dexterity", type: "integer", value: 12, label: "Dexterity" }
			]
		}
		const input: EngineInput = {
			ruleset: decl,
			rigour: "mechanics",
			owners: [ana],
			actions: {},
			deltas: [{ owner: "character:1", op: "hit", piece: "Longsword", check: "attack.melee", against: 15 }],
			elapsed: 0,
			ties: [],
			turn: 1,
			random: face(12),
			conventions: conventionsFor(decl, settingValues(decl))
		}
		input.scripted = await runDerivedScripts(null, input, {
			loadSource: async (key) => sources[key] ?? null,
			seed: "vis-itineris-test"
		})
		expect(input.scripted["character:1"]!.values).toMatchObject({ "strength-mod": 3, "dexterity-mod": 1, proficiency: 2, "armour-class": 11 })
		// Bulk answers in its own terms (no `values`): only its explain sentence is taken.
		expect(input.scripted["character:1"]!.failed).toEqual([])
		const out = runApply(input, "vis-itineris-test")
		expect(out.outcomes[0]!.check).toMatchObject({ selector: "attack.melee", natural: 12, total: 17, band: "success" })
		expect(out.explain.find((e) => e.target === "character:1.attack.melee")!.text).toBe("d20 12 + 3 (Strength modifier) + 2 (Proficiency) = 17 vs 15")
		expect(out.explain.find((e) => e.target === "character:1.script")!.text).toBe(
			"core:script/vis-itineris-derive: AC 11 = 10 + Dexterity; proficiency 2 at level 1"
		)
	})
})

describe("explain words: a selector reads as words, never its id", () => {
	test("checks and derived selectors read in plain words", () => {
		const ruleset = getRuleset("core:ruleset/vis-itineris@1") as RulesetDecl
		const input = { ruleset } as unknown as Pick<EngineInput, "ruleset">
		expect(selectorLabel(input, null, "attack.melee")).toBe("Melee attack")
		// 🚧 The check reference's own words (GM's check labels; lane T3): what the roll form says.
		expect(selectorLabel(input, null, "skill.athletics")).toBe("Athletics")
		expect(selectorLabel(input, null, "strength-mod")).toBe("Strength modifier")
		expect(selectorLabel(input, null, "proficiency")).toBe("Proficiency")
		expect(selectorLabel(input, { stats: [{ selector: "hp", label: "Health" }] } as unknown as Pick<OwnerView, "stats">, "hp")).toBe("Health")
	})
})

describe("a library piece in an outcome reads by its name", () => {
	test("never its row id", () => {
		const ruleset = getRuleset("core:ruleset/vis-itineris@1") as RulesetDecl
		const rows = Object.values(ruleset.compendium?.rows ?? {}).flat()
		const row = rows.find((r) => r.id === "potion-of-healing") ?? rows[0]!
		const input = { ruleset } as unknown as Pick<EngineInput, "ruleset">
		expect(pieceDisplayText(input, { kind: "compendium", compendiumId: ruleset.id, pieceId: row.id, version: row.version } as any)).toBe(row.piece.name)
		expect(pieceDisplayText(input, { kind: "compendium", compendiumId: ruleset.id, pieceId: row.id, version: row.version, count: 2 } as any)).toBe(`${row.piece.name} ×2`)
		expect(pieceDisplayText(input, { kind: "compendium", compendiumId: ruleset.id, pieceId: "no-such-row", version: "1" } as any)).toBe("No such row")
	})
})

describe("🚧 Q2-1: a lock is picked with the picker's hands (owner ruling ★6)", () => {
	const DOOR = { name: "Door to The Vault", way: "door", state: "locked", lockDc: 12, trap: { name: "Poison needle", dc: 12, damage: "1d4 poison" } }
	const place = () =>
		({
			key: "location:5",
			owner: { kind: "session_location", id: 5 },
			name: "The Sunken Gate",
			stats: [],
			repertoires: [{ slotId: "test:slot/fx-exits@1", repertoire: getRepertoire(`${VIS_ITINERIS}#exits`)!, pieces: [held(DOOR)] }],
			custom: [],
			bag: {}
		}) as unknown as OwnerView

	test("a traverse with an actor rolls the actor's skill, never the place's; the outcome stays the place's, naming the picker", async () => {
		const decl = await visItineris()
		const rook = adventurer("player-seat:3", "Rook Valen", 9, 9, [], { "dexterity-mod": 3 })
		const out = applyFx(decl, [place(), rook], [{ owner: "location:5", op: "traverse", piece: "Door to The Vault", check: "skill.sleight-of-hand", against: 12, actor: "player-seat:3" }], [11])
		const check = out.outcomes.find((o) => o.kind === "check")!
		expect(check.owner).toBe("location:5")
		expect(check.text).toMatch(/^Rook Valen — traverse Door to The Vault \(/)
		expect(check.check).toMatchObject({ natural: 11, total: 14, against: 12, actor: "player-seat:3" })
		const working = out.explain.find((e) => e.target === "player-seat:3.skill.sleight-of-hand")!
		expect(working.text).toMatch(/Dexterity/)
		// The way's rider is how crossing works, never a result.
		expect(out.outcomes.map((o) => o.text).join("\n")).not.toMatch(/Crossing a locked way takes a check/)
	})

	test("a failed pick on a trapped way springs the trap on the picker", async () => {
		const decl = await visItineris()
		const rook = adventurer("player-seat:3", "Rook Valen", 9, 9, [], { "dexterity-mod": 0 })
		// d20 2 + 0 against 12 fails; the needle's 1d4 on the same face reads 1.
		const out = applyFx(decl, [place(), rook], [{ owner: "location:5", op: "traverse", piece: "Door to The Vault", check: "skill.sleight-of-hand", against: 12, actor: "player-seat:3" }], [2])
		const sprung = out.outcomes.find((o) => /Poison needle springs on Rook Valen/.test(o.text))
		expect(sprung?.text).toMatch(/^Poison needle springs on Rook Valen: Health −\d$/)
		expect(out.changes.some((c) => c.slotId === HP_SLOT && c.op === "add" && Number(c.value) < 0)).toBe(true)
	})
})
