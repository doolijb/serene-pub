/**
 * Note 5 (built 2026-10-02): the Loose ends queue — one list of the book's
 * chores, grouped by chore, sorted chore-then-most-recently-changed,
 * snapshotted on open (a fixed row only leaves), no per-row dismissal.
 */
import { describe, expect, it } from "vitest"
import {
	CHORES,
	groupLooseEnds,
	liveQueue,
	looseEnds,
	membersWithLore,
	nextLooseEnd
} from "./looseEnds"
import { CAST_KIND, SCENE_KIND, type PoolItem } from "./poolFilter"

const WORLD = "core:entry/world-lore"
const CHARACTER = "core:entry/character-lore"
const HISTORY = "core:entry/history"
const PLACE = "core:entry/location"

function item(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: WORLD,
		name: `Entry ${over.id}`,
		content: "Some words.",
		keys: ["word"],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: over.id,
		position: over.id,
		priority: 1,
		createdAt: 0,
		updatedAt: over.id,
		...over
	}
}

const chores = (rows: { chore: string }[]) => rows.map((r) => r.chore)
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe("looseEnds — which chores a book has", () => {
	it("a finished book has none", () => {
		expect(
			looseEnds({
				items: [
					item({ id: 1 }),
					item({
						id: 2,
						kind: HISTORY,
						date: { year: 1, month: null, day: null }
					})
				]
			})
		).toEqual([])
	})

	it("needs keywords by the pool's one rule — pinned and off rows are done", () => {
		const rows = looseEnds({
			items: [
				item({ id: 1, keys: [] }),
				item({ id: 2, keys: [], pinned: true }),
				item({ id: 3, keys: [], off: true }),
				item({ id: 4, keys: ["  "] })
			]
		})
		expect(ids(rows)).toEqual([
			"needs-keywords:entry#4",
			"needs-keywords:entry#1"
		])
	})

	it("undated history, and empty content on any entry", () => {
		const rows = looseEnds({
			items: [
				item({ id: 1, kind: HISTORY, date: null }),
				item({ id: 2, content: "  " })
			]
		})
		expect(chores(rows)).toEqual(["undated-history", "empty-content"])
	})

	it("an empty place is an undescribed place — unless a link joins it", () => {
		const rows = looseEnds({
			items: [
				item({ id: 1, kind: PLACE, content: "" }),
				item({ id: 2, kind: PLACE, content: "" })
			],
			linkedKeys: new Set(["entry#2"])
		})
		// Not ALSO "empty content": one chore per fix.
		expect(ids(rows)).toEqual(["undescribed-place:entry#1"])
	})

	it("archived rows, scenes and cast rows in the pool are no entry chores", () => {
		expect(
			looseEnds({
				items: [
					item({ id: 1, keys: [], content: "", archived: true }),
					item({ id: 2, key: "scene#2", kind: SCENE_KIND, keys: [] }),
					item({ id: 3, key: "cast#3", kind: CAST_KIND, keys: [] })
				]
			})
		).toEqual([])
	})

	it("one row per pending suggestion and per possible duplicate", () => {
		const rows = looseEnds({
			items: [],
			suggestions: [{ id: 9, name: "Mara" }],
			duplicates: [{ nameA: "Ann", nameB: "Anne" }]
		})
		expect(chores(rows)).toEqual(["cast-suggestion", "cast-suggestion"])
		expect(rows.map((r) => r.target)).toEqual([
			{ kind: "suggestions", tab: "suggestions" },
			{ kind: "suggestions", tab: "duplicates" }
		])
	})

	it("an orphan is a background member with no lore and no tie", () => {
		const members = [
			{ id: 1, name: "Lone", castKind: "background" as const, updatedAt: 1 },
			{ id: 2, name: "Lored", castKind: "background" as const, updatedAt: 1 },
			{ id: 3, name: "Tied", castKind: "background" as const, updatedAt: 1 },
			{ id: 4, name: "Carded", castKind: "character" as const, updatedAt: 1 }
		]
		const rows = looseEnds({
			items: [],
			members,
			membersWithLore: membersWithLore([
				{ lorebookBindingId: 2, typeId: CHARACTER }
			]),
			linkedKeys: new Set(["cast#3"])
		})
		expect(ids(rows)).toEqual(["orphan-member:cast#1"])
		expect(rows[0].target).toEqual({ kind: "member", castId: 1 })
	})

	it("sorts by chore, then most recently changed first", () => {
		const rows = looseEnds({
			items: [
				item({ id: 1, content: "", updatedAt: 5 }),
				item({ id: 2, keys: [], updatedAt: 1 }),
				item({ id: 3, content: "", updatedAt: 9 }),
				item({ id: 4, keys: [], updatedAt: 7 })
			]
		})
		expect(ids(rows)).toEqual([
			"needs-keywords:entry#4",
			"needs-keywords:entry#2",
			"empty-content:entry#3",
			"empty-content:entry#1"
		])
	})

	it("names no 'never read in' chore yet — that one waits on E2", () => {
		expect(CHORES.map((c) => c.id)).not.toContain("never-read-in")
	})
})

describe("groupLooseEnds", () => {
	it("groups in chore order, leaving out chores with nothing in them", () => {
		const rows = looseEnds({
			items: [
				item({ id: 1, content: "" }),
				item({ id: 2, kind: HISTORY, date: null })
			]
		})
		const groups = groupLooseEnds(rows)
		expect(groups.map((g) => g.chore.id)).toEqual([
			"undated-history",
			"empty-content"
		])
		expect(groups.map((g) => g.rows.length)).toEqual([1, 1])
	})
})

describe("the snapshot — nothing reshuffles while the reader works", () => {
	const before = looseEnds({
		items: [
			item({ id: 1, keys: [], updatedAt: 3 }),
			item({ id: 2, keys: [], updatedAt: 2 }),
			item({ id: 3, keys: [], updatedAt: 1 })
		]
	})

	it("a fixed row leaves; a newly changed one does not jump to the top", () => {
		// Entry 1 got keywords; entry 3 was touched, so live sorts it first.
		const live = looseEnds({
			items: [
				item({ id: 2, keys: [], updatedAt: 2 }),
				item({ id: 3, keys: [], updatedAt: 99 })
			]
		})
		expect(ids(liveQueue(before, live))).toEqual([
			"needs-keywords:entry#2",
			"needs-keywords:entry#3"
		])
	})

	it("a new loose end waits for the next open", () => {
		const live = [
			...before,
			...looseEnds({ items: [item({ id: 9, content: "" })] })
		]
		expect(liveQueue(before, live)).toHaveLength(3)
	})

	it("Next goes on from the row just fixed, by its place in the snapshot", () => {
		const live = before.filter((r) => r.id !== "needs-keywords:entry#1")
		expect(nextLooseEnd(before, live, "needs-keywords:entry#1")?.id).toBe(
			"needs-keywords:entry#2"
		)
	})

	it("Next wraps to the top, and is null when nothing else is left", () => {
		expect(nextLooseEnd(before, before, "needs-keywords:entry#3")?.id).toBe(
			"needs-keywords:entry#1"
		)
		const onlyOne = [before[0]]
		expect(nextLooseEnd(before, onlyOne, before[0].id)).toBeNull()
		expect(nextLooseEnd(before, [], null)).toBeNull()
		expect(nextLooseEnd(before, before, null)?.id).toBe(before[0].id)
	})
})
