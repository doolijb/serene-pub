/**
 * The primary floor (brief 7a): the one placement rule left once the
 * conversation may sit in any zone. A layout places at least one instance of
 * its genre's primary widget, ANYWHERE; a reader that finds none appends the
 * bare primary to the middle, and the editor hides × on the last one.
 */
import { describe, expect, test } from "vitest"
import type { Arranged } from "./arrangedGeometry"
import {
	floorKeeps,
	floorNote,
	placedIdsOf,
	primaryPlaced,
	withPrimaryFloor,
	type SessionPlacement
} from "./primaryFloor"
import { defaultZoneLayout, type ZoneLayout } from "./schema"
import { emptyChatLayout, loadChatLayout, widgetsInZone, withGridWidget } from "./widgetGrid"

const zones = (left: string[] = [], right: string[] = []): ZoneLayout => ({
	version: 1,
	zones: {
		left: { kind: "side", side: "left", widgets: left },
		right: { kind: "side", side: "right", widgets: right }
	}
})
const placement = (over: Partial<SessionPlacement> = {}): SessionPlacement => ({
	zones: zones(),
	grid: emptyChatLayout(),
	arranged: {},
	...over
})

describe("withPrimaryFloor — fires only when no instance is placed anywhere", () => {
	test("nothing saved: the conversation fills the middle, exactly as before", () => {
		const out = withPrimaryFloor(placement({ zones: defaultZoneLayout() }), "messages")
		expect(widgetsInZone(out.grid, "middle").map((w) => [w.id, w.size.h])).toEqual([
			["messages", "grow"]
		])
	})

	test("Messages in a side list: nothing is appended — the move is honoured", () => {
		const p = placement({ zones: zones(["messages"]) })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("Messages in the arrangement alone: nothing is appended", () => {
		const arranged: Arranged = {
			right: { cols: 1, rows: 12, items: [{ id: "messages", x: 0, y: 0, w: 1, h: 12 }] }
		}
		const p = placement({ arranged })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("a grid entry that names a side counts as placed", () => {
		const grid = loadChatLayout({
			version: 1,
			widgets: [{ id: "messages", zone: "left", order: 0, size: { w: "grow", h: "grow" } }]
		})
		const p = placement({ grid })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("any instance satisfies it — the Lair's Sanctum copy alone included", () => {
		const p = placement({ zones: zones([], ["world-state", "messages#sanctum"]) })
		expect(primaryPlaced(p, "messages")).toBe(true)
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("none placed: the bare primary is appended AFTER the middle's own widgets", () => {
		const grid = withGridWidget(emptyChatLayout(), "world-state", "middle")
		const out = withPrimaryFloor(placement({ grid }), "messages")
		expect(widgetsInZone(out.grid, "middle").map((w) => w.id)).toEqual([
			"world-state",
			"messages"
		])
	})

	test("none placed, and an arranged middle: the arranged middle gets a cell too", () => {
		// The live view draws an arranged middle in preference to the grid, so
		// appending to the grid alone would draw nothing.
		const arranged: Arranged = {
			middle: { cols: 8, rows: 12, items: [{ id: "world-state", x: 0, y: 0, w: 8, h: 3 }] }
		}
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		const cell = out.arranged.middle!.items.find((i: { id: string }) => i.id === "messages")
		expect(cell).toMatchObject({ x: 0, w: 8 })
		expect(cell!.y).toBeGreaterThanOrEqual(3)
	})

	test("an EMPTY arranged middle is filled by it", () => {
		const arranged: Arranged = { middle: { cols: 8, rows: 12, items: [] } }
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		expect(out.arranged.middle!.items).toEqual([
			{ id: "messages", x: 0, y: 0, w: 8, h: 12 }
		])
	})

	test("an R71 genre's own primary is the floor there", () => {
		const out = withPrimaryFloor(placement(), "acme.game:board")
		expect(out.grid.widgets.map((w) => [w.id, w.zone])).toEqual([["acme.game:board", "middle"]])
	})

	test("reads every place in reading order: arrangement, grid, lists", () => {
		const p = placement({
			zones: zones(["stats"]),
			grid: withGridWidget(emptyChatLayout(), "world-state", "middle"),
			arranged: { middle: { cols: 1, rows: 1, items: [{ id: "map", x: 0, y: 0, w: 1, h: 1 }] } }
		})
		expect(placedIdsOf(p)).toEqual(["map", "world-state", "stats"])
	})
})

describe("floorKeeps — the × is hidden on the last one", () => {
	test("the only Messages is kept", () => {
		expect(floorKeeps("messages", ["stats", "messages"], "messages")).toBe(true)
	})

	test("with a second instance placed, either may go", () => {
		const placed = ["messages", "world-state", "messages#sanctum"]
		expect(floorKeeps("messages", placed, "messages")).toBe(false)
		expect(floorKeeps("messages#sanctum", placed, "messages")).toBe(false)
	})

	test("the last instance is kept even when it is a copy", () => {
		expect(floorKeeps("messages#sanctum", ["messages#sanctum"], "messages")).toBe(true)
	})

	test("never keeps anything that is not the primary", () => {
		expect(floorKeeps("stats", ["stats"], "messages")).toBe(false)
	})

	test("says why, in place of the ×", () => {
		expect(floorNote("Messages")).toBe("A session needs one Messages widget")
	})
})
