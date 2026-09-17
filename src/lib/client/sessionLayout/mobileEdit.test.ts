/**
 * The mobile layout editor's reorder model — pure, so the whole interaction is
 * covered without a phone, a gridstack or a viewport.
 */
import { describe, expect, it } from "vitest"
import type { GsLayout } from "./GridStackZone.svelte"
import { collapsedOrder } from "./sideRail"
import { unitsOf } from "./tabGroups"
import {
	mobileRows,
	moveMember,
	moveRow,
	moveRowTo,
	restackZone,
	setRowPinned
} from "./mobileEdit"

/** A side column: three full-width groups stacked, the ordinary case. */
const side = (): GsLayout => ({
	cols: 1,
	rows: 9,
	items: [
		{ id: "notes", x: 0, y: 0, w: 1, h: 3 },
		{ id: "map", x: 0, y: 3, w: 1, h: 3 },
		{ id: "cast", x: 0, y: 6, w: 1, h: 3 }
	]
})

/** The chat middle: one tall widget over a short one. */
const middle = (): GsLayout => ({
	cols: 4,
	rows: 12,
	items: [
		{ id: "messages", x: 0, y: 0, w: 4, h: 9 },
		{ id: "world-state", x: 0, y: 9, w: 4, h: 3 }
	]
})

/** Two widgets side by side over a full-width one. */
const twoD = (): GsLayout => ({
	cols: 4,
	rows: 8,
	items: [
		{ id: "a", x: 0, y: 0, w: 2, h: 4 },
		{ id: "b", x: 2, y: 0, w: 2, h: 4 },
		{ id: "c", x: 0, y: 4, w: 4, h: 4 }
	]
})

/** A tab group of two, over a lone widget. */
const grouped = (): GsLayout => ({
	cols: 2,
	rows: 8,
	items: [
		{ id: "one", x: 0, y: 0, w: 2, h: 2, group: "g1" },
		{ id: "two", x: 0, y: 2, w: 2, h: 2, group: "g1" },
		{ id: "solo", x: 0, y: 4, w: 2, h: 4 }
	]
})

/** The order the collapsed (phone) render draws in, straight from the runtime. */
function renderedOrder(z: GsLayout): string[] {
	const units = unitsOf(z.items)
	return collapsedOrder(
		units.map((u) => ({
			key: u.key,
			box: u.box,
			anchor: u.members[0]?.anchor
		}))
	)
}

/** Do any two render units sit on the same cells? */
function overlaps(z: GsLayout): number {
	const boxes = unitsOf(z.items).map((u) => u.box)
	let n = 0
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			if (
				a.x < b.x + b.w &&
				a.x + a.w > b.x &&
				a.y < b.y + b.h &&
				a.y + a.h > b.y
			)
				n++
		}
	return n
}

/** Every box inside the grid the zone declares. */
function inBounds(z: GsLayout): boolean {
	return z.items.every(
		(i) =>
			i.x >= 0 && i.y >= 0 && i.x + i.w <= z.cols && i.y + i.h <= z.rows
	)
}

function item(z: GsLayout, id: string): string {
	return JSON.stringify(z.items.find((i) => i.id === id))
}

describe("mobileRows — the list the phone editor draws", () => {
	it("lists a zone's groups in the order the collapsed render draws them", () => {
		expect(mobileRows(side()).map((r) => r.key)).toEqual(
			renderedOrder(side())
		)
	})

	it("reports a tab group as one row carrying its members in tab order", () => {
		const rows = mobileRows(grouped())
		expect(rows.map((r) => r.key)).toEqual(["g1", "solo"])
		expect(rows[0].members).toEqual(["one", "two"])
		expect(rows[1].members).toEqual(["solo"])
	})

	it("reads an absent pin as pinned and an explicit false as unpinned", () => {
		const z = side()
		z.items[1] = { ...z.items[1], pinned: false }
		const rows = mobileRows(z)
		expect(rows.map((r) => r.pinned)).toEqual([true, false, true])
	})

	it("shows a top/bottom anchor as the rank it means in one column", () => {
		const z = side()
		z.items[2] = { ...z.items[2], anchor: { top: true } }
		const rows = mobileRows(z)
		expect(rows.map((r) => r.key)).toEqual(["cast", "notes", "map"])
		expect(rows.map((r) => r.rank)).toEqual([0, 1, 1])
	})

	it("has nothing to list without an arrangement", () => {
		expect(mobileRows(undefined)).toEqual([])
	})
})

describe("moveRow — one step up or down", () => {
	it("swaps exactly the two groups in the rendered order", () => {
		const next = moveRow(side(), "map", -1)
		expect(mobileRows(next).map((r) => r.key)).toEqual([
			"map",
			"notes",
			"cast"
		])
		expect(renderedOrder(next)).toEqual(["map", "notes", "cast"])
	})

	it("leaves every group it did not move byte-identical", () => {
		const before = side()
		const next = moveRow(before, "map", -1)
		expect(item(next, "cast")).toBe(item(before, "cast"))
	})

	it("keeps each group's own height when they differ", () => {
		const next = moveRow(middle(), "world-state", -1)
		expect(mobileRows(next).map((r) => r.key)).toEqual([
			"world-state",
			"messages"
		])
		expect(next.items.find((i) => i.id === "world-state")!.h).toBe(3)
		expect(next.items.find((i) => i.id === "messages")!.h).toBe(9)
	})

	it("refuses to move off either end, returning the arrangement untouched", () => {
		const before = side()
		expect(moveRow(before, "notes", -1)).toBe(before)
		expect(moveRow(before, "cast", 1)).toBe(before)
		expect(moveRow(before, "map", 0)).toBe(before)
		expect(moveRow(before, "nobody", 1)).toBe(before)
	})

	it("swaps side-by-side widgets across rather than down", () => {
		const before = twoD()
		const next = moveRow(before, "a", 1)
		expect(renderedOrder(next)).toEqual(["b", "a", "c"])
		expect(next.items.find((i) => i.id === "a")!.y).toBe(0)
		expect(next.items.find((i) => i.id === "b")!.y).toBe(0)
		expect(item(next, "c")).toBe(item(before, "c"))
	})

	it("takes a widget out of its row when it moves past that row", () => {
		const next = moveRow(twoD(), "b", 1)
		expect(renderedOrder(next)).toEqual(["a", "c", "b"])
		expect(overlaps(next)).toBe(0)
		expect(inBounds(next)).toBe(true)
	})

	it("moves a group into the rank its new neighbour holds", () => {
		const z = side()
		z.items[2] = { ...z.items[2], anchor: { bottom: true } }
		const next = moveRow(z, "map", 1)
		expect(renderedOrder(next)).toEqual(["notes", "cast", "map"])
		expect(mobileRows(next).find((r) => r.key === "map")!.rank).toBe(2)
	})

	it("never produces cells the desktop grid could not draw", () => {
		for (const make of [side, middle, twoD, grouped])
			for (const row of mobileRows(make()))
				for (const delta of [-1, 1]) {
					const next = moveRow(make(), row.key, delta)
					expect(overlaps(next)).toBe(0)
					expect(inBounds(next)).toBe(true)
				}
	})
})

describe("round trip — byte-identical apart from the intended change", () => {
	it("changes nothing at all when nothing is moved", () => {
		const before = side()
		const json = JSON.stringify(before)
		mobileRows(before)
		expect(JSON.stringify(before)).toBe(json)
		expect(restackZone(before)).toBe(before)
	})

	it("restacks a zone to itself when the order is unchanged", () => {
		for (const make of [side, middle, twoD, grouped])
			expect(JSON.stringify(restackZone(make()))).toBe(
				JSON.stringify(make())
			)
	})

	it("returns the original bytes when a move is taken back", () => {
		for (const [make, key, dir] of [
			[side, "map", -1],
			[side, "map", 1],
			[middle, "world-state", -1],
			[twoD, "a", 1],
			[grouped, "solo", -1]
		] as const) {
			const before = make()
			const there = moveRow(before, key, dir)
			expect(JSON.stringify(there)).not.toBe(JSON.stringify(before))
			expect(JSON.stringify(moveRow(there, key, -dir))).toBe(
				JSON.stringify(before)
			)
		}
	})

	it("keeps a widget in its own row once a move has taken it out of one", () => {
		const out = moveRow(twoD(), "b", 1)
		const back = moveRow(out, "b", -1)
		expect(renderedOrder(back)).toEqual(["a", "b", "c"])
		expect(back.items.find((i) => i.id === "b")!.y).not.toBe(0)
		expect(overlaps(back)).toBe(0)
	})

	it("returns the original bytes when a pin is taken back", () => {
		const before = side()
		const off = setRowPinned(before, "map", false)
		expect(JSON.stringify(off)).not.toBe(JSON.stringify(before))
		expect(JSON.stringify(setRowPinned(off, "map", true))).toBe(
			JSON.stringify(before)
		)
	})

	it("returns the original bytes when a member move is taken back", () => {
		const before = grouped()
		const there = moveMember(before, "g1", "two", -1)
		expect(mobileRows(there)[0].members).toEqual(["two", "one"])
		expect(JSON.stringify(moveMember(there, "g1", "two", 1))).toBe(
			JSON.stringify(before)
		)
	})
})

describe("moveRowTo — the drag handle's destination", () => {
	it("lands the group at the index asked for", () => {
		const next = moveRowTo(side(), "notes", 2)
		expect(mobileRows(next).map((r) => r.key)).toEqual([
			"map",
			"cast",
			"notes"
		])
	})

	it("is the arrangement itself when the group is already there", () => {
		const before = side()
		expect(moveRowTo(before, "map", 1)).toBe(before)
		expect(moveRowTo(before, "map", 9)).toEqual(moveRowTo(before, "map", 2))
	})
})

describe("setRowPinned — the per-group pin", () => {
	it("writes the pin onto every member of a tab group", () => {
		const next = setRowPinned(grouped(), "g1", false)
		expect(
			next.items
				.filter((i) => i.group === "g1")
				.every((i) => i.pinned === false)
		).toBe(true)
		expect(mobileRows(next)[0].pinned).toBe(false)
	})
})

describe("moveMember — order inside a tab group", () => {
	it("refuses to move off either end", () => {
		const before = grouped()
		expect(moveMember(before, "g1", "one", -1)).toBe(before)
		expect(moveMember(before, "g1", "two", 1)).toBe(before)
		expect(moveMember(before, "solo", "solo", 1)).toBe(before)
	})

	it("keeps the group's own footprint", () => {
		const next = moveMember(grouped(), "g1", "two", -1)
		const box = unitsOf(next.items).find((u) => u.key === "g1")!.box
		expect(box).toEqual(
			unitsOf(grouped().items).find((u) => u.key === "g1")!.box
		)
	})
})
