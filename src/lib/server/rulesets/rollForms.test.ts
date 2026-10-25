/**
 * 🚧 What a session's ruleset decides, for a roll form (lane M2, 2026-10-22;
 * S4, 2026-10-23: read off the sections at run time, every label the
 * ruleset's): the checks decided by the way whose difficulty bands the form
 * offers — any way, not only dice — the bands and the usual one, the ways'
 * kinds and the outcome words; a ruleset whose ways hold none puts no roll
 * form (the Lair refuses politely, saying why).
 */
import { describe, expect, test } from "vitest"
import "@serene-pub/core-catalog"
import { defineAttributeSlot, defineFunction, defineRuleset, getAttributeSlot, getFunction, getRuleset } from "@serene-pub/sdk"
import { rulesetRolls } from "./rollForms"

const WILL = "test:slot/rf-will@1"

function declare(id: string, conventions: Record<string, unknown>, selectors: Record<string, unknown>) {
	if (!getAttributeSlot(WILL))
		defineAttributeSlot(WILL, { type: "integer", label: { en: "Will" }, descriptor: "Will.", appliesTo: ["cast"], config: { min: 0, max: 10 }, default: 2 })
	return (
		getRuleset(id) ??
		defineRuleset(id, {
			name: { en: id },
			voice: { prose: "In words." },
			conventions: { time: { unit: "scene" }, ...conventions } as never,
			stats: [{ id: WILL }],
			selectors: selectors as never,
			repertoires: []
		})
	)
}

describe("roll forms read method bands", () => {
	test("Vis Itineris: its die, every check in its order and words, its bands, Medium the usual, its outcome words", async () => {
		const vi = getRuleset("core:ruleset/vis-itineris@1")!
		const r = await rulesetRolls(vi)
		expect(r).toMatchObject({ dice: true, band: "medium", methods: ["die-target"], chance: true })
		expect(r.checks.length).toBeGreaterThan(10)
		// Its way first, in the way's own words; then its checks as it lists them, in its own words (GM 2026-10-23, G2 ★1).
		expect(r.checks.slice(0, 3)).toEqual([
			{ key: "die", label: "Roll a d20" },
			{ key: "save.strength", label: "Strength save" },
			{ key: "ability.strength", label: "Strength" }
		])
		expect(r.checks.find((c) => c.key === "skill.sleight-of-hand")?.label).toBe("Sleight of hand")
		expect(r.checks.some((c) => c.key === "damage")).toBe(false)
		expect(r.bands.map((b) => b.id)).toEqual(["very-easy", "easy", "medium", "hard", "very-hard", "nearly-impossible"])
		expect(r.outcomes.map((o) => o.label)).toEqual(["Critical failure", "Failure", "Success", "Critical success"])
	})

	test("🚧 S4: Wherewithal's contest — the one way with bands — in the way's own words; no chance", async () => {
		const r = await rulesetRolls(getRuleset("core:ruleset/wherewithal@1")!)
		expect(r).toMatchObject({ dice: true, band: "even", methods: ["none", "bid", "compare"], chance: false })
		expect(r.checks).toEqual([{ key: "contest", label: "Mettle against mettle" }])
	})

	test("🚧 S4: a ruleset in sections with its own way — a module that decides — is read as one of its ways, told in words", async () => {
		const OMEN = "test:function/rf-omen@1"
		if (!getFunction(OMEN as never))
			defineFunction(OMEN as never, {
				name: { en: "Read the omens" },
				meaning: { en: "The omens decide." },
				kind: "deciding",
				prose: "The omens decide how it goes.",
				phases: ["after"],
				chance: true,
				body: "export function decide(input) { return { degree: 'success' } }"
			} as never)
		const decl =
			getRuleset("test:ruleset/rf-omens@1") ??
			defineRuleset("test:ruleset/rf-omens@1", {
				name: { en: "Omens" },
				voice: { prose: "Omens, in words." },
				functions: [{ ref: OMEN, key: "omens" }],
				outcomes: [{ id: "ill", label: { en: "Ill-omened" }, five: "fail" }, { id: "fair", label: { en: "Fair" }, five: "success" }]
			} as never)
		const r = await rulesetRolls(decl)
		// A package way holds no difficulty a form can offer: no checks, its kind its function id, chance its module's.
		expect(r).toMatchObject({ dice: false, checks: [], bands: [], band: null, methods: [OMEN], chance: true })
		expect(r.outcomes).toEqual([{ id: "ill", label: "Ill-omened", five: "fail" }, { id: "fair", label: "Fair", five: "success" }])
	})

	test("a comparison against a target asks how hard as a die does; a spend is never offered", async () => {
		const decl = declare(
			"test:ruleset/rf-diceless@1",
			{
				methods: {
					contest: { kind: "compare", bands: [{ id: "even", label: { en: "Even" }, target: 3, default: true }] },
					risk: { kind: "bid", resource: "rf-will", costs: [{ spend: 1, band: "success" }] }
				},
				defaultMethod: "contest"
			},
			{ resist: { kind: "check", base: "rf-will" }, gamble: { kind: "check", method: "risk" } }
		)
		const r = await rulesetRolls(decl)
		expect(r).toMatchObject({ dice: true, band: "even", methods: ["compare", "bid"], chance: false })
		expect(r.checks.map((c) => c.key)).toEqual(["resist"])
		expect(r.bands).toEqual([{ id: "even", label: "Even", target: 3 }])
	})

	test("a pool holds no bands: no roll form, and the methods say why", async () => {
		const decl = declare("test:ruleset/rf-pool@1", { methods: { pool: { kind: "dice-pool", sides: 6, successOn: 5, poolOf: "rf-will" } } }, { sneak: { kind: "check" } })
		expect(await rulesetRolls(decl)).toEqual({ dice: false, checks: [], bands: [], band: null, methods: ["dice-pool"], outcomes: [], chance: true })
	})

	test("Freeform decides nothing: no roll form, no methods", async () => {
		expect(await rulesetRolls(getRuleset("core:ruleset/freeform@1")!)).toMatchObject({ dice: false, checks: [], methods: [], chance: false })
	})
})
