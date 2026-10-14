import { describe, expect, test } from "vitest"
import { unitsOf } from "./tabGroups"
import { resolveDrawn, type ArrangedItem } from "@serene-pub/sdk"

/**
 * The items, arranged in a middle frame and DRAWN by the SDK's one layout
 * reader (`resolveDrawn`, C5): every case groups what a renderer is handed,
 * never the stored slot itself.
 */
const drawn = (items: ArrangedItem[]) =>
	resolveDrawn({ arrangedGrid: { middle: { cols: 12, rows: 12, items } } }, { inline: 1300 }).middle

const pos = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	group?: string
): ArrangedItem => ({ id, x, y, w, h, ...(group ? { group } : {}) })

describe("unitsOf", () => {
	test("ungrouped items are one-member units at their own cell", () => {
		const u = unitsOf(drawn([pos("a", 0, 0, 2, 2), pos("b", 2, 0, 1, 3)]))
		expect(u).toHaveLength(2)
		expect(u.find((x) => x.key === "a")?.box).toEqual({ x: 0, y: 0, w: 2, h: 2 })
		expect(u.find((x) => x.key === "b")?.members.map((m) => m.id)).toEqual(["b"])
	})

	test("adjacent group collapses to its tight bounding box", () => {
		// two cards stacked vertically → bbox spans both
		const u = unitsOf(drawn([pos("a", 0, 0, 2, 2, "g1"), pos("b", 0, 2, 2, 3, "g1")]))
		expect(u).toHaveLength(1)
		expect(u[0].key).toBe("g1")
		expect(u[0].box).toEqual({ x: 0, y: 0, w: 2, h: 5 })
		expect(u[0].members.map((m) => m.id)).toEqual(["a", "b"])
	})

	test("members are ordered top-left → bottom-right (tab order)", () => {
		const u = unitsOf(drawn([
			pos("late", 3, 3, 1, 1, "g"),
			pos("early", 0, 0, 1, 1, "g"),
			pos("mid", 0, 1, 1, 1, "g")
		]))
		expect(u[0].members.map((m) => m.id)).toEqual(["early", "mid", "late"])
	})

	test("a horizontally-adjacent group keeps its combined width", () => {
		const u = unitsOf(drawn([pos("a", 0, 0, 1, 2, "g"), pos("b", 1, 0, 2, 2, "g")]))
		expect(u[0].box).toEqual({ x: 0, y: 0, w: 3, h: 2 })
	})

	test("scattered group overlapping another widget shrinks to its top-left member", () => {
		// group members at corners (0,0) and (4,4); a solo widget sits at (2,2)
		// INSIDE the group's bbox → the bbox would overlap it, so the group
		// collapses to its top-left member's cell.
		const u = unitsOf(drawn([
			pos("g-a", 0, 0, 1, 1, "g"),
			pos("g-b", 4, 4, 1, 1, "g"),
			pos("solo", 2, 2, 1, 1)
		]))
		const group = u.find((x) => x.key === "g")!
		expect(group.box).toEqual({ x: 0, y: 0, w: 1, h: 1 })
		// the solo is untouched
		expect(u.find((x) => x.key === "solo")?.box).toEqual({
			x: 2,
			y: 2,
			w: 1,
			h: 1
		})
	})

	test("scattered group with NOTHING in between keeps its bbox", () => {
		// members at (0,0) and (4,4) but no other widget inside → bbox is fine.
		const u = unitsOf(drawn([pos("g-a", 0, 0, 1, 1, "g"), pos("g-b", 4, 4, 1, 1, "g")]))
		expect(u[0].box).toEqual({ x: 0, y: 0, w: 5, h: 5 })
	})

	test("two independent groups each collapse separately", () => {
		const u = unitsOf(drawn([
			pos("a", 0, 0, 2, 1, "g1"),
			pos("b", 0, 1, 2, 1, "g1"),
			pos("c", 3, 0, 1, 2, "g2"),
			pos("d", 4, 0, 1, 2, "g2")
		]))
		expect(u).toHaveLength(2)
		expect(u.find((x) => x.key === "g1")?.box).toEqual({ x: 0, y: 0, w: 2, h: 2 })
		expect(u.find((x) => x.key === "g2")?.box).toEqual({ x: 3, y: 0, w: 2, h: 2 })
	})

	test("a drawn zone groups what it draws: no retired card, pins as written, and no cells no units", () => {
		const zone = drawn([
			{ ...pos("a", 0, 0, 2, 2, "g"), pinned: false },
			{ ...pos("b", 0, 2, 2, 2, "g"), pinned: false },
			pos("inventory", 2, 0, 1, 1)
		])
		const u = unitsOf(zone)
		expect(u.map((x) => x.key)).toEqual(["g"])
		expect(u[0].members.map((m) => [m.id, m.pinned])).toEqual([
			["a", false],
			["b", false]
		])
		const listed = resolveDrawn(
			{ zoneLayout: { version: 1, zones: { right: { kind: "side", side: "right", widgets: ["a"] } } } },
			{ inline: 1300 }
		).right
		expect(unitsOf(listed)).toEqual([])
	})
})
