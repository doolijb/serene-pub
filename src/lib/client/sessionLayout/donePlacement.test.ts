/**
 * What Done writes (brief 7a): the conversation is committed wherever its card
 * was left. It used to be stripped out of any side list (`withoutGridRequired`)
 * and kept in the middle's grid whatever the frame said, so a Messages card
 * dragged into a side was back in the middle the moment Done was pressed.
 */
import { describe, expect, test } from "vitest"
import type { ArrangedGridV1, ZoneLayoutV1 } from "@serene-pub/sdk"
import { placementAtDone } from "./donePlacement"
import { withPrimaryFloor } from "./primaryFloor"
import {
	defaultChatLayout,
	loadChatLayout,
	widgetsInZone,
	withGridWidget
} from "./widgetGrid"

const zones = (left: string[], right: string[]): ZoneLayoutV1 => ({
	version: 1,
	zones: {
		left: { kind: "side", side: "left", widgets: left },
		right: { kind: "side", side: "right", widgets: right }
	}
})
const sideZoneIds = { left: "left", right: "right" }

describe("placementAtDone — Messages moved into a side stays there", () => {
	/** The conversation dragged from the middle into the left column, world-state into the middle. */
	const arrangement: ArrangedGridV1 = {
		left: {
			cols: 1,
			rows: 12,
			items: [
				{ id: "stats", x: 0, y: 0, w: 1, h: 4 },
				{ id: "messages", x: 0, y: 4, w: 1, h: 8 }
			]
		},
		middle: { cols: 10, rows: 12, items: [{ id: "world-state", x: 0, y: 0, w: 10, h: 12 }] },
		right: { cols: 1, rows: 12, items: [] }
	}
	const before = {
		zones: zones(["stats"], ["world-state"]),
		grid: defaultChatLayout()
	}

	test("the left list holds it, in row order", () => {
		const done = placementAtDone({ ...before, arrangement, sideZoneIds })
		expect(done.zones.zones.left.widgets).toEqual(["stats", "messages"])
		expect(done.zones.zones.right.widgets).toEqual([])
	})

	test("the middle's grid no longer does", () => {
		const done = placementAtDone({ ...before, arrangement, sideZoneIds })
		expect(widgetsInZone(done.grid, "middle").map((w) => w.id)).toEqual(["world-state"])
		expect(done.middle).toEqual(["world-state"])
	})

	test("and the next read keeps it there: the floor finds it placed and appends nothing", () => {
		const done = placementAtDone({ ...before, arrangement, sideZoneIds })
		const reread = withPrimaryFloor(
			{
				zones: done.zones,
				grid: loadChatLayout(JSON.parse(JSON.stringify(done.grid))),
				arranged: arrangement
			},
			"messages"
		)
		expect(widgetsInZone(reread.grid, "middle").map((w) => w.id)).toEqual(["world-state"])
		expect(reread.zones.zones.left.widgets).toContain("messages")
	})

	test("moved back into the middle, it rejoins the grid", () => {
		const done = placementAtDone({
			zones: zones(["stats", "messages"], []),
			grid: withGridWidget(loadChatLayout({ version: 1, widgets: [] }), "world-state", "middle"),
			arrangement: {
				left: { cols: 1, rows: 12, items: [{ id: "stats", x: 0, y: 0, w: 1, h: 12 }] },
				middle: {
					cols: 10,
					rows: 12,
					items: [
						{ id: "world-state", x: 0, y: 0, w: 10, h: 3 },
						{ id: "messages", x: 0, y: 3, w: 10, h: 9 }
					]
				}
			},
			sideZoneIds
		})
		expect(done.zones.zones.left.widgets).toEqual(["stats"])
		expect(widgetsInZone(done.grid, "middle").map((w) => w.id)).toEqual(["world-state", "messages"])
	})

	test("joining the middle's grid, the log takes the floor's shape, not a strip's", () => {
		// A Chat session Done'd before free placement: the log in the middle
		// frame, the grid empty. The next Done writes it into the grid — as a
		// log that fills, so the grid draws what the frame did.
		const done = placementAtDone({
			zones: zones([], []),
			grid: loadChatLayout({ version: 1, widgets: [] }),
			arrangement: { middle: { cols: 10, rows: 12, items: [{ id: "messages", x: 0, y: 0, w: 10, h: 12 }] } },
			sideZoneIds,
			primaryId: "messages"
		})
		expect(widgetsInZone(done.grid, "middle")).toMatchObject([
			{ id: "messages", size: { w: "grow", h: "grow" }, anchor: { top: true, bottom: true, left: true, right: true } }
		])
	})

	test("any other newcomer keeps a strip's shape", () => {
		const done = placementAtDone({
			zones: zones([], []),
			grid: loadChatLayout({ version: 1, widgets: [] }),
			arrangement: { middle: { cols: 10, rows: 12, items: [{ id: "world-state", x: 0, y: 0, w: 10, h: 3 }] } },
			sideZoneIds,
			primaryId: "messages"
		})
		expect(widgetsInZone(done.grid, "middle")[0].size).toEqual({ w: "grow", h: "fixed" })
	})

	test("a side's frame folds a grid entry that named that side into its list", () => {
		// A preset may name a side in the grid; once the side reports, its
		// list is the truth and the grid's copy goes.
		const grid = loadChatLayout({
			version: 1,
			widgets: [{ id: "messages", zone: "left", order: 0, size: { w: "grow", h: "grow" } }]
		})
		const done = placementAtDone({
			zones: zones(["messages"], []),
			grid,
			arrangement: { left: { cols: 1, rows: 12, items: [{ id: "messages", x: 0, y: 0, w: 1, h: 12 }] } },
			sideZoneIds
		})
		expect(done.grid.widgets).toEqual([])
		expect(done.zones.zones.left.widgets).toEqual(["messages"])
	})

	test("an absent middle frame is no opinion: the grid is handed back as it was", () => {
		const grid = defaultChatLayout()
		const done = placementAtDone({ zones: zones([], []), grid, arrangement: {}, sideZoneIds })
		expect(done.grid).toBe(grid)
		expect(done.middle).toEqual(["messages"])
	})
})
