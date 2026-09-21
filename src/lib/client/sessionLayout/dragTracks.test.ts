import { describe, expect, it } from "vitest"
import {
	applyDrop,
	cycleExtent,
	dropTargets,
	extentLabel,
	growShares,
	materializeExtent,
	nudgeTrack,
	snapTrack,
	trackCss,
	type DropTarget,
	type Zone,
	type ZoneRects
} from "./dragTracks"

/**
 * The spike's middle zone: a fit row over a grow row, one column.
 * 600px tall in a 600-wide box, the split at y=120.
 */
function middle(): Zone {
	return {
		rows: ["fit", "grow"],
		cols: ["grow"],
		units: [
			{
				key: "world",
				title: "World State",
				row: { start: 1, span: 1 },
				col: { start: 1, span: 1 }
			},
			{
				key: "messages",
				title: "Messages",
				row: { start: 2, span: 1 },
				col: { start: 1, span: 1 }
			}
		]
	}
}

const middleRects: ZoneRects = {
	box: { left: 100, top: 0, width: 600, height: 600 },
	rowLines: [0, 120, 600],
	colLines: [100, 700]
}

/** A one-row, two-column zone with the second column empty. */
function split(): Zone {
	return {
		rows: ["grow"],
		cols: ["grow", "grow"],
		units: [
			{
				key: "stats",
				title: "Stats",
				row: { start: 1, span: 1 },
				col: { start: 1, span: 1 }
			}
		]
	}
}

const splitRects: ZoneRects = {
	box: { left: 0, top: 0, width: 400, height: 200 },
	rowLines: [0, 200],
	colLines: [0, 200, 400]
}

describe("dropTargets", () => {
	it("names the row a drop between two rows would open", () => {
		const [nearest] = dropTargets(middle(), middleRects, { x: 400, y: 118 })
		expect(nearest.kind).toBe("row-gap")
		expect(nearest.kind === "row-gap" && nearest.line).toBe(2)
		expect(nearest.label).toBe(
			"New row between World State and Messages · fit"
		)
	})

	it("names the row above the first and below the last", () => {
		const targets = dropTargets(middle(), middleRects, { x: 400, y: 2 })
		expect(targets[0].label).toBe("New row above World State · fit")
		const below = dropTargets(middle(), middleRects, { x: 400, y: 598 })
		expect(below[0].label).toBe("New row below Messages · fit")
	})

	it("offers a unit's edge as a share of twelve", () => {
		const [nearest] = dropTargets(middle(), middleRects, { x: 690, y: 400 })
		expect(nearest.kind).toBe("unit-edge")
		if (nearest.kind !== "unit-edge") return
		expect(nearest.unit).toBe("messages")
		expect(nearest.side).toBe("end")
		expect(nearest.share).toEqual({ host: 6, joiner: 6 })
		expect(nearest.label).toBe("Beside Messages · 6 of 12")
	})

	it("uses the dragged widget's declared span for the share", () => {
		const [nearest] = dropTargets(
			middle(),
			middleRects,
			{ x: 690, y: 400 },
			{ span: 4 }
		)
		expect(nearest.label).toBe("Beside Messages · 4 of 12")
		expect(nearest.kind === "unit-edge" && nearest.share).toEqual({
			host: 8,
			joiner: 4
		})
	})

	it("offers an empty track cell", () => {
		const [nearest] = dropTargets(split(), splitRects, { x: 300, y: 100 })
		expect(nearest.kind).toBe("empty-cell")
		expect(nearest.label).toBe("Place in row 1, column 2")
	})

	it("offers the tray once the pointer leaves the zone", () => {
		const [nearest] = dropTargets(middle(), middleRects, {
			x: 1000,
			y: 900
		})
		expect(nearest.kind).toBe("tray")
		expect(nearest.label).toBe("Remove from the layout")
	})

	it("never offers the dragged unit its own edges or cells", () => {
		const targets = dropTargets(
			middle(),
			middleRects,
			{ x: 400, y: 400 },
			{
				dragging: "messages"
			}
		)
		expect(
			targets.some((t) => t.kind === "unit-edge" && t.unit === "messages")
		).toBe(false)
		expect(
			targets.some((t) => t.kind === "empty-cell" && t.row === 2)
		).toBe(true)
	})
})

describe("applyDrop", () => {
	it("opens a new row and moves the unit into it", () => {
		const target: DropTarget = {
			kind: "row-gap",
			line: 1,
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const { zone, refused } = applyDrop(middle(), target, "messages")
		expect(refused).toBeUndefined()
		expect(zone.rows).toEqual(["fit", "fit"])
		expect(zone.units.find((u) => u.key === "messages")?.row.start).toBe(1)
		expect(zone.units.find((u) => u.key === "world")?.row.start).toBe(2)
	})

	it("joins a row as two column tracks and keeps neighbours full width", () => {
		const target: DropTarget = {
			kind: "unit-edge",
			unit: "messages",
			side: "end",
			share: { host: 8, joiner: 4 },
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const { zone, refused } = applyDrop(middle(), target, "stats", {
			title: "Stats"
		})
		expect(refused).toBeUndefined()
		expect(zone.cols).toEqual([{ grow: 8 }, { grow: 4 }])
		expect(zone.units.find((u) => u.key === "messages")?.col).toEqual({
			start: 1,
			span: 1
		})
		expect(zone.units.find((u) => u.key === "stats")?.col).toEqual({
			start: 2,
			span: 1
		})
		// The row above never asked to be split, so it still spans both.
		expect(zone.units.find((u) => u.key === "world")?.col).toEqual({
			start: 1,
			span: 2
		})
	})

	it("joins on the start side by putting the newcomer first", () => {
		const target: DropTarget = {
			kind: "unit-edge",
			unit: "messages",
			side: "start",
			share: { host: 8, joiner: 4 },
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const { zone } = applyDrop(middle(), target, "stats")
		expect(zone.cols).toEqual([{ grow: 4 }, { grow: 8 }])
		expect(zone.units.find((u) => u.key === "stats")?.col.start).toBe(1)
		expect(zone.units.find((u) => u.key === "messages")?.col.start).toBe(2)
	})

	it("refuses a join a host has no room for", () => {
		const zone: Zone = {
			rows: ["grow"],
			cols: [{ grow: 1 }, { grow: 11 }],
			units: [
				{
					key: "messages",
					title: "Messages",
					row: { start: 1, span: 1 },
					col: { start: 1, span: 1 }
				}
			]
		}
		const target: DropTarget = {
			kind: "unit-edge",
			unit: "messages",
			side: "end",
			share: { host: 0, joiner: 1 },
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const result = applyDrop(zone, target, "stats")
		expect(result.refused).toBe("Messages is already as narrow as it goes.")
		expect(result.zone).toBe(zone)
	})

	it("places a unit in an empty cell", () => {
		const target: DropTarget = {
			kind: "empty-cell",
			row: 1,
			col: 2,
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const { zone } = applyDrop(split(), target, "inventory", {
			title: "Inventory"
		})
		expect(zone.units).toHaveLength(2)
		expect(zone.units.find((u) => u.key === "inventory")?.col).toEqual({
			start: 2,
			span: 1
		})
	})

	it("refuses a drop onto an occupied cell and names both", () => {
		const target: DropTarget = {
			kind: "empty-cell",
			row: 1,
			col: 1,
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const zone = middle()
		const result = applyDrop(zone, target, "stats", { title: "Stats" })
		expect(result.refused).toBe("World State would overlap Stats.")
		expect(result.zone).toBe(zone)
	})

	it("refuses a drop outside the zone's tracks", () => {
		const target: DropTarget = {
			kind: "empty-cell",
			row: 9,
			col: 1,
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const result = applyDrop(middle(), target, "stats", { title: "Stats" })
		expect(result.refused).toBe("Stats does not fit in this zone.")
	})

	it("removes to the tray and drops the row it emptied", () => {
		const tray: DropTarget = {
			kind: "tray",
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 96,
			label: ""
		}
		const { zone } = applyDrop(middle(), tray, "world")
		expect(zone.rows).toEqual(["grow"])
		expect(zone.units).toHaveLength(1)
		expect(zone.units[0].row).toEqual({ start: 1, span: 1 })
	})

	it("refuses to empty a zone that must keep a widget", () => {
		const zone = split()
		const tray: DropTarget = {
			kind: "tray",
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 96,
			label: ""
		}
		const result = applyDrop(zone, tray, "stats", {
			minUnits: 1,
			zoneLabel: "The middle zone"
		})
		expect(result.refused).toBe(
			"The middle zone keeps at least one widget."
		)
		expect(result.zone).toBe(zone)
	})

	it("collapses a column split nothing uses any more", () => {
		const joined: Zone = {
			rows: ["grow"],
			cols: [{ grow: 8 }, { grow: 4 }],
			units: [
				{
					key: "messages",
					title: "Messages",
					row: { start: 1, span: 1 },
					col: { start: 1, span: 1 }
				},
				{
					key: "stats",
					title: "Stats",
					row: { start: 1, span: 1 },
					col: { start: 2, span: 1 }
				}
			]
		}
		const target: DropTarget = {
			kind: "row-gap",
			line: 2,
			guide: { left: 0, top: 0, width: 0, height: 0 },
			distance: 0,
			label: ""
		}
		const { zone } = applyDrop(joined, target, "stats")
		expect(zone.cols).toEqual(["grow"])
		expect(zone.units.every((u) => u.col.span === 1)).toBe(true)
	})
})

describe("snapTrack", () => {
	it("snaps a fixed track to whole cells and reads the value", () => {
		expect(snapTrack({ cells: 6 }, 0, 44, 528).label).toBe(
			"6 cells · 264px"
		)
		const out = snapTrack({ cells: 6 }, 44, 44, 528)
		expect(out.extent).toEqual({ cells: 7 })
		expect(out.label).toBe("7 cells · 308px")
	})

	it("snaps a grow track in twelfths of the zone", () => {
		const out = snapTrack({ grow: 6 }, 44, 44, 528)
		expect(out.extent).toEqual({ grow: 7 })
		expect(out.px).toBe(308)
		expect(out.label).toBe("7 of 12 · 308px")
	})

	it("stops at the adjoining widget's declared minimum", () => {
		const out = snapTrack({ cells: 6 }, -300, 44, 528, { minCells: 4 })
		expect(out.extent).toEqual({ cells: 4 })
		expect(out.clampedTo).toBe("min")
	})

	it("stops at the declared maximum, in twelfths too", () => {
		const out = snapTrack({ grow: 6 }, 9999, 44, 528, { maxCells: 8 })
		expect(out.extent).toEqual({ grow: 8 })
		expect(out.clampedTo).toBe("max")
	})

	it("moves the floor of a minmax track", () => {
		const out = snapTrack({ min: 4, max: 8 }, 44, 44, 528)
		expect(out.extent).toEqual({ min: 5, max: 8 })
		expect(out.label).toBe("5–8 cells · 220px")
	})

	it("refuses to drag a fit track", () => {
		const out = snapTrack("fit", 40, 44, 528)
		expect(out.refused).toBe("A fit track is sized by its content.")
		expect(out.extent).toBe("fit")
	})
})

describe("nudgeTrack", () => {
	it("moves a fixed track one cell", () => {
		expect(nudgeTrack({ cells: 6 }, 1, 44, 528).extent).toEqual({
			cells: 7
		})
		expect(nudgeTrack({ cells: 6 }, -1, 44, 528).extent).toEqual({
			cells: 5
		})
	})

	it("moves a grow track one twelfth", () => {
		expect(nudgeTrack({ grow: 6 }, -1, 44, 528).extent).toEqual({ grow: 5 })
	})

	it("honours the same bounds the pointer does", () => {
		const out = nudgeTrack({ grow: 3 }, -1, 44, 528, { minCells: 3 })
		expect(out.extent).toEqual({ grow: 3 })
		expect(out.clampedTo).toBe("min")
	})
})

describe("extents", () => {
	it("materialises what is on screen before a drag", () => {
		expect(materializeExtent("grow", 176, 44, 528)).toEqual({ grow: 4 })
		expect(materializeExtent("fit", 130, 44, 528)).toEqual({ cells: 3 })
		expect(materializeExtent({ cells: 6 }, 999, 44, 528)).toEqual({
			cells: 6
		})
	})

	it("cycles grow → fit → cells → grow", () => {
		const first = cycleExtent("grow", 264, 44)
		expect(first).toBe("fit")
		const second = cycleExtent(first, 264, 44)
		expect(second).toEqual({ cells: 6 })
		expect(cycleExtent(second, 264, 44)).toBe("grow")
	})

	it("declares tracks the browser can solve", () => {
		expect(trackCss("grow", 44)).toBe("minmax(0, 1fr)")
		expect(trackCss("fit", 44)).toBe("auto")
		expect(trackCss({ cells: 6 }, 44)).toBe("264px")
		expect(trackCss({ grow: 8 }, 44)).toBe("minmax(0, 8fr)")
		expect(trackCss({ min: 4 }, 44)).toBe("minmax(176px, 1fr)")
	})

	it("reads shares in twelfths", () => {
		expect(growShares(["grow"])).toEqual([12])
		expect(growShares(["grow", "grow"])).toEqual([6, 6])
		expect(growShares([{ grow: 8 }, { grow: 4 }])).toEqual([8, 4])
		expect(extentLabel({ grow: 8 }, 352)).toBe("8 of 12 · 352px")
		expect(extentLabel({ cells: 1 })).toBe("1 cell")
	})
})
