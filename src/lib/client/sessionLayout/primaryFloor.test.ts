/**
 * The primary floor (brief 7a): the one placement rule left once the
 * conversation may sit in any zone. A layout places at least one instance of
 * its genre's primary widget, ANYWHERE; a reader that finds none appends the
 * bare primary to the middle, and the editor hides × on the last one.
 */
import { describe, expect, test } from "vitest"
import { type ArrangedGridV1, primaryPlaced, type ZoneLayoutV1 } from "@serene-pub/sdk"
import {
	drawnIdsOf,
	floorKeeps,
	floorKeptId,
	floorNote,
	floorRefusal,
	sessionLayoutOf,
	withPrimaryFloor,
	type SessionPlacement
} from "./primaryFloor"
import { defaultZoneLayout } from "./schema"
import { emptyChatLayout, loadChatLayout, widgetsInZone, withGridWidget } from "./widgetGrid"

const zones = (left: string[] = [], right: string[] = []): ZoneLayoutV1 => ({
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
		const arranged: ArrangedGridV1 = {
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
		expect(primaryPlaced(sessionLayoutOf(p), "messages")).toBe(true)
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
		const arranged: ArrangedGridV1 = {
			middle: { cols: 8, rows: 12, items: [{ id: "world-state", x: 0, y: 0, w: 8, h: 3 }] }
		}
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		const cell = out.arranged.middle!.items.find((i: { id: string }) => i.id === "messages")
		expect(cell).toMatchObject({ x: 0, w: 8 })
		expect(cell!.y).toBeGreaterThanOrEqual(3)
	})

	test("under a strip, the log takes the whole free band, never a 3-row sliver", () => {
		// Seen live: world-state 14×3 over a 15-row middle, the floor's log
		// 14×3 under it and twelve blank rows below — on every read.
		const arranged: ArrangedGridV1 = {
			middle: { cols: 14, rows: 15, items: [{ id: "world-state", x: 0, y: 0, w: 14, h: 3 }] }
		}
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		expect(out.arranged.middle!.items).toEqual([
			{ id: "world-state", x: 0, y: 0, w: 14, h: 3 },
			{ id: "messages", x: 0, y: 3, w: 14, h: 12 }
		])
	})

	test("the tallest free band wins, wherever it is", () => {
		const arranged: ArrangedGridV1 = {
			middle: {
				cols: 10,
				rows: 12,
				items: [
					{ id: "a", x: 0, y: 2, w: 4, h: 2 },
					{ id: "b", x: 0, y: 10, w: 10, h: 2 }
				]
			}
		}
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		expect(out.arranged.middle!.items.at(-1)).toEqual({ id: "messages", x: 0, y: 4, w: 10, h: 6 })
	})

	test("no free band 3 rows tall: room is made the way the tray makes it", () => {
		const arranged: ArrangedGridV1 = {
			middle: { cols: 8, rows: 6, items: [{ id: "world-state", x: 0, y: 0, w: 8, h: 6 }] }
		}
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		const cell = out.arranged.middle!.items.find((i: { id: string }) => i.id === "messages")
		expect(cell).toMatchObject({ x: 0, w: 8, h: 3 })
	})

	test("an EMPTY arranged middle is filled by it", () => {
		const arranged: ArrangedGridV1 = { middle: { cols: 8, rows: 12, items: [] } }
		const out = withPrimaryFloor(placement({ arranged }), "messages")
		expect(out.arranged.middle!.items).toEqual([
			{ id: "messages", x: 0, y: 0, w: 8, h: 12 }
		])
	})

	test("an R71 genre's own primary is the floor there", () => {
		const out = withPrimaryFloor(placement(), "acme.game:board")
		expect(out.grid.widgets.map((w) => [w.id, w.zone])).toEqual([["acme.game:board", "middle"]])
	})
})

describe("drawnIdsOf — placed means drawn, never merely named", () => {
	test("reading order: the middle, the left, the right, then the strips", () => {
		const p = placement({
			zones: {
				version: 1,
				zones: {
					top: { kind: "strip", area: "top", widgets: ["banner"] },
					left: { kind: "side", side: "left", widgets: ["stats"] },
					right: { kind: "side", side: "right", widgets: ["lore"] }
				}
			} as ZoneLayoutV1,
			arranged: { middle: { cols: 1, rows: 2, items: [{ id: "map", x: 0, y: 0, w: 1, h: 1 }] } }
		})
		expect(drawnIdsOf(p)).toEqual(["map", "stats", "lore", "banner"])
	})

	test("an arranged middle draws over the grid's middle", () => {
		const p = placement({
			grid: withGridWidget(emptyChatLayout(), "world-state", "middle"),
			arranged: { middle: { cols: 1, rows: 1, items: [{ id: "map", x: 0, y: 0, w: 1, h: 1 }] } }
		})
		expect(drawnIdsOf(p)).toEqual(["map"])
	})

	test("a side's arrangement draws over its list and over a grid entry naming it", () => {
		const grid = loadChatLayout({
			version: 1,
			widgets: [{ id: "messages", zone: "right", order: 0, size: { w: "grow", h: "grow" } }]
		})
		const p = placement({
			zones: zones([], ["world-state", "stats"]),
			grid,
			arranged: { right: { cols: 1, rows: 3, items: [{ id: "world-state", x: 0, y: 0, w: 1, h: 3 }] } }
		})
		expect(drawnIdsOf(p)).toEqual(["world-state"])
	})

	test("a grid entry naming a side with no zone on that side draws nowhere", () => {
		const grid = loadChatLayout({
			version: 1,
			widgets: [{ id: "messages", zone: "left", order: 0, size: { w: "grow", h: "grow" } }]
		})
		const p = placement({
			zones: { version: 1, zones: { right: { kind: "side", side: "right", widgets: [] } } },
			grid
		})
		expect(drawnIdsOf(p)).toEqual([])
		expect(primaryPlaced(sessionLayoutOf(p), "messages")).toBe(false)
	})
})

describe("withPrimaryFloor — a primary named where nothing draws it", () => {
	test("a grid entry the side's arrangement shadows: the floor fires, and the entry moves", () => {
		// Seen live: the grid named Messages in the right, the right's
		// arrangement held World State alone, and no conversation drew.
		const grid = loadChatLayout({
			version: 1,
			widgets: [
				{ id: "scene-portraits", zone: "middle", order: 0, size: { w: "grow", h: "grow" } },
				{ id: "messages", zone: "right", order: 0, size: { w: "grow", h: "grow" } }
			]
		})
		const p = placement({
			zones: zones([], ["world-state"]),
			grid,
			arranged: { right: { cols: 1, rows: 3, items: [{ id: "world-state", x: 0, y: 0, w: 1, h: 3 }] } }
		})
		const out = withPrimaryFloor(p, "messages")
		expect(out.grid.widgets.map((w) => [w.id, w.zone])).toEqual([
			["scene-portraits", "middle"],
			["messages", "middle"]
		])
		expect(primaryPlaced(sessionLayoutOf(out), "messages")).toBe(true)
	})

	test("a zone list the arrangement shadows stops naming it, so the editor lists it once", () => {
		const p = placement({
			zones: zones(["messages"], []),
			arranged: { left: { cols: 1, rows: 3, items: [{ id: "stats", x: 0, y: 0, w: 1, h: 3 }] } }
		})
		const out = withPrimaryFloor(p, "messages")
		expect(out.zones.zones.left.widgets).toEqual([])
		expect(widgetsInZone(out.grid, "middle").map((w) => w.id)).toEqual(["messages"])
	})
})

describe("floorRefusal — Done asks the floor of what it would commit", () => {
	test("a layout that draws no Messages is refused, in the floor's words", () => {
		const p = placement({ grid: withGridWidget(emptyChatLayout(), "world-state", "middle") })
		expect(floorRefusal(p, "messages", "Messages")).toBe("A session needs one Messages widget")
	})

	test("one drawn anywhere passes", () => {
		const p = placement({ zones: zones(["messages"], []) })
		expect(floorRefusal(p, "messages", "Messages")).toBeNull()
	})
})

describe("floorKeptId — the card whose × is hidden", () => {
	test("the one instance, when exactly one is placed", () => {
		expect(floorKeptId(["stats", "messages#sanctum"], "messages")).toBe("messages#sanctum")
	})

	test("none when two are placed, or none", () => {
		expect(floorKeptId(["messages", "messages#sanctum"], "messages")).toBeNull()
		expect(floorKeptId(["stats"], "messages")).toBeNull()
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
