/**
 * 🚧 An item's supply as the lorebook's item editor edits it (attributes
 * phase 3c): the mode a row opens on, switching modes, the one rule a save
 * is held to, what a row says of it — and the Items door that asks for it.
 */
import { describe, expect, it } from "vitest"
import { ITEM_TYPE_ID } from "$lib/shared/entries/types"
import { descriptorFor } from "../sections"
import {
	ITEM_SUPPLY_LABELS,
	ITEM_SUPPLY_MODES,
	setSupplyMode,
	supplyModeOf,
	supplyProblem,
	supplySummary
} from "./itemSupply"

describe("an item's supply", () => {
	it("offers the three modes the item type declares, in order, each with a label", () => {
		expect(ITEM_SUPPLY_MODES).toEqual(["unique", "limited", "unlimited"])
		for (const mode of ITEM_SUPPLY_MODES) expect(ITEM_SUPPLY_LABELS[mode].length).toBeGreaterThan(0)
	})

	it("opens on the stored mode, and a missing or unknown one on the default, unlimited", () => {
		expect(supplyModeOf({ supply: "unique" })).toBe("unique")
		expect(supplyModeOf({ supply: "limited", supplyLimit: 3 })).toBe("limited")
		expect(supplyModeOf({})).toBe("unlimited")
		expect(supplyModeOf({ supply: "plenty" })).toBe("unlimited")
	})

	it("switching to limited keeps a limit it had, or starts at one; any other mode drops it", () => {
		const draft: Record<string, any> = { supply: "unlimited", supplyLimit: null }
		setSupplyMode(draft, "limited")
		expect(draft).toEqual({ supply: "limited", supplyLimit: 1 })
		draft.supplyLimit = 5
		setSupplyMode(draft, "unique")
		expect(draft).toEqual({ supply: "unique", supplyLimit: null })
		const kept: Record<string, any> = { supply: "limited", supplyLimit: 4 }
		setSupplyMode(kept, "limited")
		expect(kept.supplyLimit).toBe(4)
	})

	it("holds a limited supply to a whole limit of at least one, and nothing else to anything", () => {
		expect(supplyProblem({ supply: "limited", supplyLimit: 2 })).toBeNull()
		for (const bad of [null, undefined, 0, -1, 1.5, "3"])
			expect(supplyProblem({ supply: "limited", supplyLimit: bad })).toMatch(/whole number, 1 or more/)
		expect(supplyProblem({ supply: "unique", supplyLimit: null })).toBeNull()
		expect(supplyProblem({ supply: "unlimited" })).toBeNull()
	})

	it("a row says a bounded supply and nothing for an unlimited one", () => {
		expect(supplySummary({ supply: "unique" })).toBe("One of a kind")
		expect(supplySummary({ supply: "limited", supplyLimit: 3 })).toBe("3 exist")
		expect(supplySummary({ supply: "limited", supplyLimit: 1 })).toBe("1 exists")
		expect(supplySummary({ supply: "limited", supplyLimit: null })).toBe("")
		expect(supplySummary({ supply: "unlimited" })).toBe("")
	})
})

describe("the Items door", () => {
	const items = descriptorFor("items")!

	it("writes item entries, opening a new one unlimited", () => {
		expect(items.typeId).toBe(ITEM_TYPE_ID)
		expect(items.label).toBe("Items")
		expect(items.newDraft(4)).toMatchObject({
			typeId: ITEM_TYPE_ID,
			lorebookId: 4,
			name: "",
			supply: "unlimited",
			supplyLimit: null
		})
	})

	it("saves a named item whose supply holds, and refuses one that does not", () => {
		const draft = { ...items.newDraft(4), name: "Rusty key" }
		expect(items.validate(draft, [])).toBe(true)
		expect(items.validate({ ...draft, name: " " }, [])).toBe(false)
		expect(items.validate({ ...draft, supply: "limited", supplyLimit: null }, [])).toBe(false)
		expect(items.validate({ ...draft, supply: "limited", supplyLimit: 3 }, [])).toBe(true)
	})

	it("reads a row into the pool as an item", () => {
		const row = { id: 9, name: "Rusty key", content: "", keys: [], typeId: ITEM_TYPE_ID, supply: "unique" }
		expect(items.toPoolItem(row)).toMatchObject({ key: "entry#9", kind: ITEM_TYPE_ID, name: "Rusty key" })
		expect(items.title(row)).toBe("Rusty key")
	})
})
