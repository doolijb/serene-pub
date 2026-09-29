import { describe, expect, it } from "vitest"
import {
	activeFilterCount,
	buildTree,
	comparePoolBy,
	emptyFilters,
	filterPool,
	flattenTree,
	hasNesting,
	type PoolItem
} from "./poolFilter"

const WORLD = "core:entry/world-lore"
const HISTORY = "core:entry/history"
const SCENE = "scene"

function item(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: WORLD,
		name: `Entry ${over.id}`,
		content: "",
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: over.id,
		position: over.id,
		priority: 1,
		createdAt: 0,
		updatedAt: 0,
		...over
	}
}

describe("filterPool", () => {
	it("narrows to the chosen kinds and leaves the rest of the pool alone", () => {
		const pool = [
			item({ id: 1, kind: WORLD }),
			item({ id: 2, kind: HISTORY }),
			item({ id: 3, kind: SCENE, key: "scene#3" })
		]
		expect(
			filterPool(pool, { ...emptyFilters(), kinds: [HISTORY] }).map(
				(i) => i.id
			)
		).toEqual([2])
		expect(
			filterPool(pool, {
				...emptyFilters(),
				kinds: [HISTORY, SCENE]
			}).map((i) => i.id)
		).toEqual([2, 3])
		// No kinds chosen is the whole pool, never an empty one.
		expect(filterPool(pool, emptyFilters()).map((i) => i.id)).toEqual([
			1, 2, 3
		])
	})

	it("hides archived entries until the filter asks for them", () => {
		const pool = [
			item({ id: 1 }),
			item({ id: 2, archived: true }),
			item({ id: 3, archived: true })
		]
		expect(filterPool(pool, emptyFilters()).map((i) => i.id)).toEqual([1])
		expect(
			filterPool(pool, { ...emptyFilters(), archived: true }).map(
				(i) => i.id
			)
		).toEqual([2, 3])
	})

	it("narrows to pinned entries, archived still hidden", () => {
		const pool = [
			item({ id: 1, pinned: true }),
			item({ id: 2 }),
			item({ id: 3, pinned: true, archived: true })
		]
		expect(
			filterPool(pool, { ...emptyFilters(), pinned: true }).map(
				(i) => i.id
			)
		).toEqual([1])
	})

	it("splits the pool on whether an entry has keywords", () => {
		const pool = [
			item({ id: 1, keys: ["umber", "umber city"] }),
			item({ id: 2, keys: [] }),
			item({ id: 3, keys: ["   "] })
		]
		expect(
			filterPool(pool, { ...emptyFilters(), keywords: "has" }).map(
				(i) => i.id
			)
		).toEqual([1])
		expect(
			filterPool(pool, { ...emptyFilters(), keywords: "none" }).map(
				(i) => i.id
			)
		).toEqual([2, 3])
	})

	it("searches name, keywords and content, case-insensitively", () => {
		const pool = [
			item({ id: 1, name: "Umber City", keys: ["stacks"] }),
			item({ id: 2, name: "The Archive", keys: ["umber", "vault"] }),
			item({ id: 3, name: "Verity's Oath", content: "Sworn in UMBER." }),
			item({ id: 4, name: "Nothing" })
		]
		expect(
			filterPool(pool, { ...emptyFilters(), search: "umber" }).map(
				(i) => i.id
			)
		).toEqual([1, 2, 3])
		// An empty query is a search box, not a wall.
		expect(
			filterPool(pool, { ...emptyFilters(), search: "  " }).map(
				(i) => i.id
			)
		).toEqual([1, 2, 3, 4])
	})

	it("counts only the filters that are narrowing something", () => {
		expect(activeFilterCount(emptyFilters())).toBe(0)
		expect(
			activeFilterCount({
				...emptyFilters(),
				kinds: [WORLD],
				pinned: true,
				keywords: "has"
			})
		).toBe(3)
		expect(
			activeFilterCount({
				...emptyFilters(),
				off: true,
				machineWritten: true,
				readIn: true,
				looseEnds: true
			})
		).toBe(4)
	})

	/**
	 * Switched off and archived are two facts, not one. An off entry is a
	 * switch on a row the author still keeps in front of them, so it is listed;
	 * an archived one has been put out of the way, so it is not.
	 */
	it("lists switched-off entries and narrows to them when asked", () => {
		const pool = [item({ id: 1 }), item({ id: 2, off: true })]
		expect(filterPool(pool, emptyFilters()).map((i) => i.id)).toEqual([
			1, 2
		])
		expect(
			filterPool(pool, { ...emptyFilters(), off: true }).map((i) => i.id)
		).toEqual([2])
	})

	it("narrows to what a machine wrote", () => {
		const pool = [item({ id: 1 }), item({ id: 2, machineWritten: true })]
		expect(
			filterPool(pool, { ...emptyFilters(), machineWritten: true }).map(
				(i) => i.id
			)
		).toEqual([2])
	})

	it("narrows to what the newest run read in", () => {
		const pool = [item({ id: 1 }), item({ id: 2 })]
		expect(
			filterPool(
				pool,
				{ ...emptyFilters(), readIn: true },
				new Set(["entry#2"])
			).map((i) => i.id)
		).toEqual([2])
		// Nothing read in is an empty answer, never the whole pool.
		expect(
			filterPool(pool, { ...emptyFilters(), readIn: true }).map(
				(i) => i.id
			)
		).toEqual([])
	})

	it("narrows to loose ends, which are unkeyworded and never read in", () => {
		const pool = [
			item({ id: 1, keys: ["umber"] }),
			item({ id: 2, keys: [] }),
			item({ id: 3, keys: [] })
		]
		expect(
			filterPool(
				pool,
				{ ...emptyFilters(), looseEnds: true },
				new Set(["entry#3"])
			).map((i) => i.id)
		).toEqual([2])
	})
})

describe("buildTree", () => {
	it("puts roots first and nests children under their anchor", () => {
		const pool = [
			item({ id: 3, key: "entry#3", parentKey: "entry#1" }),
			item({ id: 1, key: "entry#1" }),
			item({ id: 2, key: "entry#2" })
		]
		const tree = buildTree(pool)
		expect(tree.map((n) => n.item.id)).toEqual([1, 2])
		expect(tree[0].children.map((n) => n.item.id)).toEqual([3])
	})

	it("treats an entry whose anchor is not in the pool as a root", () => {
		const pool = [
			item({ id: 1, key: "entry#1" }),
			item({ id: 2, key: "entry#2", parentKey: "entry#99" })
		]
		expect(buildTree(pool).map((n) => n.item.id)).toEqual([1, 2])
	})

	it("treats an anchor cycle as roots rather than looping", () => {
		const pool = [
			item({ id: 1, key: "entry#1", parentKey: "entry#2" }),
			item({ id: 2, key: "entry#2", parentKey: "entry#1" })
		]
		expect(
			buildTree(pool)
				.map((n) => n.item.id)
				.sort()
		).toEqual([1, 2])
	})

	it("nests a scene under the history entry it was compiled into", () => {
		const pool = [
			item({ id: 7, kind: HISTORY, key: "entry#7" }),
			item({
				id: 4,
				kind: SCENE,
				key: "scene#4",
				parentKey: "entry#7"
			})
		]
		const tree = buildTree(pool)
		expect(tree.map((n) => n.item.key)).toEqual(["entry#7"])
		expect(tree[0].children.map((n) => n.item.key)).toEqual(["scene#4"])
	})

	it("reports whether anything in the pool is nested at all", () => {
		expect(hasNesting([item({ id: 1 })])).toBe(false)
		expect(
			hasNesting([
				item({ id: 1, key: "entry#1" }),
				item({ id: 2, key: "entry#2", parentKey: "entry#1" })
			])
		).toBe(true)
	})
})

describe("flattenTree", () => {
	it("walks parent then children, carrying depth", () => {
		const pool = [
			item({ id: 1, key: "entry#1" }),
			item({ id: 2, key: "entry#2", parentKey: "entry#1" }),
			item({ id: 3, key: "entry#3", parentKey: "entry#2" })
		]
		const rows = flattenTree(buildTree(pool), new Set())
		expect(rows.map((r) => [r.item.id, r.depth])).toEqual([
			[1, 0],
			[2, 1],
			[3, 2]
		])
		expect(rows[0].hasChildren).toBe(true)
		expect(rows[2].hasChildren).toBe(false)
	})

	it("stops at a collapsed row", () => {
		const pool = [
			item({ id: 1, key: "entry#1" }),
			item({ id: 2, key: "entry#2", parentKey: "entry#1" })
		]
		const rows = flattenTree(buildTree(pool), new Set(["entry#1"]))
		expect(rows.map((r) => r.item.id)).toEqual([1])
		expect(rows[0].collapsed).toBe(true)
	})
})

describe("comparePoolBy", () => {
	it("puts pinned entries ahead of priority, and only of priority", () => {
		const pool = [
			item({ id: 1, priority: 3 }),
			item({ id: 2, priority: 1, pinned: true })
		]
		expect(
			[...pool].sort(comparePoolBy("priority-desc")).map((i) => i.id)
		).toEqual([2, 1])
		expect(
			[...pool].sort(comparePoolBy("position-asc")).map((i) => i.id)
		).toEqual([1, 2])
	})

	it("orders by the declared date for the two date orderings", () => {
		const pool = [
			item({ id: 1, kind: HISTORY, order: 10_000 }),
			item({ id: 2, kind: HISTORY, order: 20_000 })
		]
		expect(
			[...pool].sort(comparePoolBy("entry-date-desc")).map((i) => i.id)
		).toEqual([2, 1])
		expect(
			[...pool].sort(comparePoolBy("entry-date-asc")).map((i) => i.id)
		).toEqual([1, 2])
	})
})
