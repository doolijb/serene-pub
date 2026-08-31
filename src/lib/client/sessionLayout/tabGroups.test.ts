import { describe, expect, test } from "vitest"
import { unitsOf } from "./tabGroups"
import type { GsPos } from "./GridStackZone.svelte"

const pos = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	group?: string
): GsPos => ({ id, x, y, w, h, ...(group ? { group } : {}) })

describe("unitsOf", () => {
	test("ungrouped items are one-member units at their own cell", () => {
		const u = unitsOf([pos("a", 0, 0, 2, 2), pos("b", 2, 0, 1, 3)])
		expect(u).toHaveLength(2)
		expect(u.find((x) => x.key === "a")?.box).toEqual({ x: 0, y: 0, w: 2, h: 2 })
		expect(u.find((x) => x.key === "b")?.members.map((m) => m.id)).toEqual(["b"])
	})

	test("adjacent group collapses to its tight bounding box", () => {
		// two cards stacked vertically → bbox spans both
		const u = unitsOf([pos("a", 0, 0, 2, 2, "g1"), pos("b", 0, 2, 2, 3, "g1")])
		expect(u).toHaveLength(1)
		expect(u[0].key).toBe("g1")
		expect(u[0].box).toEqual({ x: 0, y: 0, w: 2, h: 5 })
		expect(u[0].members.map((m) => m.id)).toEqual(["a", "b"])
	})

	test("members are ordered top-left → bottom-right (tab order)", () => {
		const u = unitsOf([
			pos("late", 3, 3, 1, 1, "g"),
			pos("early", 0, 0, 1, 1, "g"),
			pos("mid", 0, 1, 1, 1, "g")
		])
		expect(u[0].members.map((m) => m.id)).toEqual(["early", "mid", "late"])
	})

	test("a horizontally-adjacent group keeps its combined width", () => {
		const u = unitsOf([pos("a", 0, 0, 1, 2, "g"), pos("b", 1, 0, 2, 2, "g")])
		expect(u[0].box).toEqual({ x: 0, y: 0, w: 3, h: 2 })
	})

	test("scattered group overlapping another widget shrinks to its top-left member", () => {
		// group members at corners (0,0) and (4,4); a solo widget sits at (2,2)
		// INSIDE the group's bbox → the bbox would overlap it, so the group
		// collapses to its top-left member's cell.
		const u = unitsOf([
			pos("g-a", 0, 0, 1, 1, "g"),
			pos("g-b", 4, 4, 1, 1, "g"),
			pos("solo", 2, 2, 1, 1)
		])
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
		const u = unitsOf([pos("g-a", 0, 0, 1, 1, "g"), pos("g-b", 4, 4, 1, 1, "g")])
		expect(u[0].box).toEqual({ x: 0, y: 0, w: 5, h: 5 })
	})

	test("two independent groups each collapse separately", () => {
		const u = unitsOf([
			pos("a", 0, 0, 2, 1, "g1"),
			pos("b", 0, 1, 2, 1, "g1"),
			pos("c", 3, 0, 1, 2, "g2"),
			pos("d", 4, 0, 1, 2, "g2")
		])
		expect(u).toHaveLength(2)
		expect(u.find((x) => x.key === "g1")?.box).toEqual({ x: 0, y: 0, w: 2, h: 2 })
		expect(u.find((x) => x.key === "g2")?.box).toEqual({ x: 3, y: 0, w: 2, h: 2 })
	})
})
