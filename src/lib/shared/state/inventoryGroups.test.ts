/**
 * An inventory is possession edges read two ways: down the owners, or down the
 * items. Both readings are of the same edges, so neither may invent or lose one.
 */
import { describe, expect, test } from "vitest"
import {
	groupByItem,
	groupByOwner,
	type InventoryOwner
} from "./inventoryGroups"

const owners: InventoryOwner[] = [
	{ key: "world", label: "On the table", kind: "session", id: 3 },
	{ key: "verity", label: "Verity", kind: "session_cast", id: 11 },
	{ key: "marrow", label: "Marrow", kind: "session_cast", id: 12 }
]

const possessions = {
	verity: [
		{ entryId: 7, name: "rusty key", quantity: 1 },
		{ entryId: 4, name: "a lantern", quantity: 2 }
	],
	world: [{ entryId: 9, name: "a millstone", quantity: 1 }]
}

describe("groupByOwner", () => {
	test("every owner is a group, including the ones carrying nothing", () => {
		const groups = groupByOwner(possessions, owners)
		expect(groups.map((g) => g.key)).toEqual(["world", "verity", "marrow"])
		expect(groups[2].items).toEqual([])
	})

	test("items read in name order, so a group does not reshuffle on a write", () => {
		const groups = groupByOwner(possessions, owners)
		expect(groups[1].items.map((i) => i.name)).toEqual([
			"a lantern",
			"rusty key"
		])
	})

	test("the world group can be left out", () => {
		const groups = groupByOwner(possessions, owners, { showWorld: false })
		expect(groups.map((g) => g.key)).toEqual(["verity", "marrow"])
	})

	test("an owner nobody can name still shows what it is carrying", () => {
		const groups = groupByOwner(
			{ wren: [{ entryId: 1, name: "a coin", quantity: 1 }] },
			owners
		)
		expect(groups.at(-1)).toMatchObject({
			key: "wren",
			label: "wren",
			owner: null
		})
	})

	test("a quantity of nothing is not a line", () => {
		const groups = groupByOwner(
			{ verity: [{ entryId: 7, name: "rusty key", quantity: 0 }] },
			owners
		)
		expect(groups[1].items).toEqual([])
	})
})

describe("groupByItem", () => {
	test("one row per item, naming who holds it and how many", () => {
		const items = groupByItem(possessions, owners)
		expect(items.map((i) => i.name)).toEqual([
			"a lantern",
			"a millstone",
			"rusty key"
		])
		expect(items[0]).toMatchObject({ entryId: 4, total: 2 })
		expect(items[0].holders).toEqual([
			{ key: "verity", label: "Verity", quantity: 2 }
		])
	})

	test("an item in two hands is one row and two holders", () => {
		const items = groupByItem(
			{
				verity: [{ entryId: 7, name: "rusty key", quantity: 1 }],
				marrow: [{ entryId: 7, name: "rusty key", quantity: 2 }]
			},
			owners
		)
		expect(items).toHaveLength(1)
		expect(items[0].total).toBe(3)
		expect(items[0].holders.map((h) => h.key)).toEqual(["verity", "marrow"])
	})
})
