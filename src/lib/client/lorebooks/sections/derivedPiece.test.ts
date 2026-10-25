/**
 * A rules list entry's own fields (lane C1): what the editor draws, what it
 * stores, and the write gate's refusal said for a person.
 */
import { describe, expect, test } from "vitest"
import "@serene-pub/core-catalog"
import { getRuleset, i18nText, rulesetEntryable } from "@serene-pub/sdk"
import {
	explainRefusal,
	pieceFields,
	pieceFormDraft,
	pieceProblem,
	pieceStorageValues,
	rememberRulesLists,
	rulesListOf,
	type PieceList
} from "./derivedPiece"
import { kindLabel } from "./kinds"

/** A ruleset's lists, as `entries:types` sends them. */
function listsOf(rulesetId: string): PieceList[] {
	const rules = getRuleset(rulesetId)!
	return rulesetEntryable(rules).map((id) => {
		const rep = rules.repertoires.find((r) => r.id === id)!
		const slot = rulesetId.slice(
			rulesetId.indexOf("/") + 1,
			rulesetId.indexOf("@")
		)
		return {
			typeId: `core:entry/${slot}.${id}`,
			label: i18nText(rep.label) ?? id,
			repertoireId: id,
			piece: rep.piece
		}
	})
}

const VIS = listsOf("core:ruleset/vis-itineris@1")
const weapons = VIS.find((l) => l.repertoireId === "weapons")!
const conditions = listsOf("core:ruleset/freeform@1").find(
	(l) => l.repertoireId === "conditions"
)!

describe("the fields a rules list entry's editor draws", () => {
	test("the list's own fields, without its name or its holder's parts", () => {
		const keys = pieceFields(weapons).map(([k]) => k)
		expect(keys).toContain("description")
		expect(keys).toContain("damage")
		expect(keys).toContain("category")
		// The name is the entry's Name box; worn and how long it lasts are the holder's.
		expect(keys).not.toContain("name")
		expect(keys).not.toContain("equipped")
		expect(keys).not.toContain("duration")
	})

	test("Freeform's conditions draw their one field of their own", () => {
		expect(pieceFields(conditions).map(([k]) => k)).toContain("lasts")
	})
})

describe("what the form stores", () => {
	test("numbers are read, a line of words is split, blanks are cleared", () => {
		const stored = pieceStorageValues(
			{
				description: "A short blade.",
				damage: { dice: "1", die: "d4" },
				traits: "finesse, light",
				weight: ""
			},
			weapons
		)
		expect(stored.description).toBe("A short blade.")
		expect(stored.damage).toEqual({ dice: 1, die: "d4" })
		expect(stored.traits).toEqual(["finesse", "light"])
		expect(stored.weight).toBeNull()
	})

	test("a row's line of words comes back to the form as one line", () => {
		const form = pieceFormDraft(
			{
				name: "Dagger",
				description: "Short.",
				traits: ["finesse", "light"]
			},
			weapons
		)
		expect(form.traits).toBe("finesse, light")
		expect(form.name).toBeUndefined()
	})
})

describe("the write gate's refusal, said for a person", () => {
	test("a weapon with no damage is refused under its Damage field", () => {
		const problem = pieceProblem(
			{ name: "Dagger", description: "Short.", category: "simple" },
			weapons
		)
		expect(problem).toEqual({
			field: "damage",
			message: "Add damage to save this."
		})
	})

	test("a whole weapon is accepted", () => {
		expect(
			pieceProblem(
				{
					name: "Dagger",
					description: "Short.",
					category: "simple",
					damage: { dice: 1, die: "d4" }
				},
				weapons
			)
		).toBeNull()
	})

	test("a bound is said as the range it keeps", () => {
		expect(
			explainRefusal("'hands' is above the maximum 2.", weapons)
		).toEqual({
			field: "hands",
			message: "Hands is 2 or less."
		})
	})

	test("a refusal it cannot word is shown as the checker said it", () => {
		expect(explainRefusal("Something else entirely.", weapons)).toEqual({
			field: null,
			message: "Something else entirely."
		})
	})
})

describe("the lists the workspace has been told about", () => {
	test("a list is found by its type, and labels its kind", () => {
		rememberRulesLists([weapons])
		expect(rulesListOf(weapons.typeId)?.label).toBe("Weapons")
		expect(kindLabel(weapons.typeId)).toBe("Weapons")
	})

	test("a list not told about yet is still called by its own id, never the rules'", () => {
		expect(kindLabel("core:entry/vis-itineris.not-told")).toBe("Not Told")
	})
})
