/**
 * 🚧 Pieces on the wire (§8): the host reads a `compendium` piece's row and a
 * `lore` piece's entry into `resolved`, and names each repertoire an owner's
 * list stats hold — so a widget draws a piece without carrying a compendium.
 *
 * ⏳ Vis Itineris's declaration is read from the SDK repo's SOURCE, as
 * `visItineris.test.ts` does, until the built catalogue carries it.
 */

import { beforeAll, describe, expect, test } from "vitest"
import { definePluginAttributeSlot, getRuleset } from "@serene-pub/sdk"
import { compendiumReadingOf, piecesRead, repertoiresOnWire } from "./read"

const VIS = "core:ruleset/vis-itineris@1"
const longsword = { kind: "compendium", compendiumId: VIS, pieceId: "longsword", version: "1.0.0" } as const

beforeAll(async () => {
	// A computed path, so the typecheck does not walk the unbuilt source.
	const source = new URL("../../../../../serene-pub-sdk/core-catalog/src/registry/rulesets.ts", import.meta.url).pathname
	await import(/* @vite-ignore */ source)
	expect(getRuleset(VIS)).toBeTruthy()
})

describe("pieces on the wire", () => {
	test("a compendium row reads as its name, words for its facts, and its library's name", () => {
		const r = compendiumReadingOf(longsword)!
		expect(r.name).toBe("Longsword")
		expect(r.compendiumName).toBe("Vis Itineris")
		expect(r.keyProps.map((p) => [p.key, p.label, p.value])).toEqual([
			["category", "Training needed", "Martial"],
			["damage", "Damage", "1d8 slashing"],
			["versatileDie", "Two-handed damage", "d10"],
			["hands", "Hands", "1"]
		])
		// `versatile` is the `versatileDie` field now (2026-10-17): traits hold only what no field says.
		expect(r.traits).not.toContain("versatile")
		expect(compendiumReadingOf({ compendiumId: VIS, pieceId: "vorpal-blade" })).toBeUndefined()
		expect(compendiumReadingOf({ compendiumId: "plugin.gone:ruleset/x@1", pieceId: "a" })).toBeUndefined()
	})

	test("every bag is read — world, cast by id and by slug, places — and nothing else moves", () => {
		const bag = { "core.weapons": [longsword, { kind: "lore", entryId: 7, count: 3 }, "rope"], "core.hp": 9 }
		const inline = { kind: "inline", name: "Second wind", description: "x" }
		const state = {
			world: { "core.features": [inline] },
			cast: { byId: { "player_seat:1": bag }, ann: bag },
			locations: { byId: {} },
			version: 4
		}
		const out = piecesRead(state, new Map([[7, { title: "Grandfather’s sword", content: "Old steel." }]]))
		const weapons = out.cast.byId["player_seat:1"]["core.weapons"] as Record<string, unknown>[]
		expect((weapons[0].resolved as { name: string }).name).toBe("Longsword")
		expect(weapons[1].resolved).toEqual({ name: "Grandfather’s sword", description: "Old steel.", keyProps: [] })
		expect(weapons[2]).toBe("rope")
		// One bag under two keys stays one bag.
		expect(out.cast.ann).toBe(out.cast.byId["player_seat:1"])
		// A bag with no reference is the same object; the input is never mutated.
		expect(out.world).toBe(state.world)
		expect("resolved" in (bag["core.weapons"][0] as object)).toBe(false)
		expect(out.version).toBe(4)
	})

	test("🚧 a row is looked up in the repertoire its field holds (P2-5): the spell Shield is no armour", () => {
		const spell = compendiumReadingOf({ compendiumId: VIS, pieceId: "shield" }, "spells")!
		expect(spell.keyProps.map((p) => p.key)).toContain("level")
		expect(spell.keyProps.map((p) => p.key)).not.toContain("acBase")
		const armour = compendiumReadingOf({ compendiumId: VIS, pieceId: "shield" }, "armour")!
		expect(armour.keyProps.map((p) => p.key)).toContain("acBase")
		// A field holding the spells repertoire reads its pieces there.
		definePluginAttributeSlot("test.p25", "test.p25:slot/known-spells@1", {
			type: "list",
			label: "Known spells",
			descriptor: "The spells they know.",
			appliesTo: ["cast"],
			config: { repertoire: `${VIS}#spells` }
		})
		const ref = { kind: "compendium", compendiumId: VIS, pieceId: "shield", version: "1.1.0" }
		const out = piecesRead({ cast: { byId: { "1": { "known-spells": [ref], test_p25_known_spells: [ref] } } } }, new Map())
		for (const key of ["known-spells", "test_p25_known_spells"]) {
			const read = (out.cast.byId["1"] as unknown as Record<string, Array<{ resolved: { keyProps: { key: string }[] } }>>)[key]![0]!.resolved
			expect(read.keyProps.map((p) => p.key)).toContain("level")
		}
	})

	test("an owner's repertoires: name and piece shape, once per address; none when it holds none", () => {
		const reps = repertoiresOnWire({
			"core:slot/a@1": { repertoire: `${VIS}#weapons` },
			"core:slot/b@1": { repertoire: `${VIS}#weapons` },
			"core:slot/c@1": { min: 0 },
			"core:slot/d@1": { repertoire: "plugin.gone:ruleset/x@1#things" }
		})!
		expect(Object.keys(reps)).toEqual([`${VIS}#weapons`])
		expect(reps[`${VIS}#weapons`].label).toBe("Weapons")
		expect(Object.keys(reps[`${VIS}#weapons`].piece.fields ?? {})).toEqual(expect.arrayContaining(["name", "damage"]))
		expect(repertoiresOnWire({ "core:slot/c@1": { min: 0 } })).toBeUndefined()
	})
})
