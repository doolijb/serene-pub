/**
 * What Done writes (brief 7a): the conversation is committed wherever its card
 * was left. It used to be stripped out of any side list (`withoutGridRequired`)
 * and kept in the middle's grid whatever the frame said, so a Messages card
 * dragged into a side was back in the middle the moment Done was pressed.
 */
import { describe, expect, test } from "vitest"
import type {
	ArrangedGridV1,
	ArrangedZone,
	SessionLayoutV1,
	ZoneId,
	ZoneLayoutV1
} from "@serene-pub/sdk"
import {
	ADVENTURE_LAYOUT,
	CHAT_LAYOUT,
	LAIR_LAYOUT
} from "@serene-pub/core-catalog"
import {
	arrangementAtDone,
	changedSlots,
	normalisedSlots,
	placementAtDone
} from "./donePlacement"
import { drawnOf, withPrimaryFloor } from "./primaryFloor"
import {
	arrangementIsEmpty,
	dedupeArranged,
	loadArranged,
	seedPositions
} from "./arrangedGeometry"
import { middleSeedPlace, sideSeedPin } from "./editorSeed"
import { normalizeZoneLayout } from "./schema"
import type { GsItem } from "./gsItem"
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

/* ── the round trip: open the editor, press Done, change nothing (lane E1) ──
 *
 * `openThenDone` is the editor's whole path with no hand on it, over pure
 * functions: the model's read of the stored slots, the working copy seeded
 * from the stored arrangement, each zone the stored layout does NOT arrange
 * reporting its SEED (what `GridStackZone`'s first emit hands the editor: the
 * default placement at the editor's measure, side cards carrying their zone's
 * pin), then `commitArrangement`'s three steps. What it returns is the patch
 * Done would emit.
 */
const SIDE_ZONE_IDS = { left: "left", right: "right" }
/** The editor's measure for the seed: any will do — that is the point. */
const MEASURE = { cols: 8, rows: 14 }

function storedRead(stored: SessionLayoutV1) {
	const savedGrid = loadChatLayout(stored.widgetGrid, "messages")
	const storedArranged = loadArranged(stored.arrangedGrid)
	const floored = withPrimaryFloor(
		{
			zones: normalizeZoneLayout(stored.zoneLayout),
			grid: savedGrid,
			arranged: storedArranged
		},
		"messages"
	)
	return { savedGrid, storedArranged, layout: floored.zones, grid: floored.grid }
}

/** What a never-arranged zone's gridstack zone reports when it is seeded. */
function seedReport(
	zone: ZoneId,
	read: ReturnType<typeof storedRead>
): ArrangedZone {
	const items: GsItem[] =
		zone === "middle"
			? widgetsInZone(read.grid, "middle").map((w) => ({
					id: w.id,
					title: w.id,
					...middleSeedPlace(w, w.id === "messages")
				}))
			: (read.layout.zones[zone]?.widgets ?? []).map((id) => ({
					id,
					title: id,
					h: 3,
					...sideSeedPin(read.layout.zones[zone])
				}))
	const pin = new Map(items.map((i) => [i.id, i.pinned]))
	return {
		...MEASURE,
		items: seedPositions(items, MEASURE.cols, MEASURE.rows).map((c) =>
			pin.get(c.id) === false ? { ...c, pinned: false } : c
		)
	}
}

function openThenDone(
	stored: SessionLayoutV1,
	edit: {
		working?: (w: ArrangedGridV1) => ArrangedGridV1
		authored?: ZoneId[]
	} = {}
) {
	const read = storedRead(stored)
	let working: ArrangedGridV1 = { ...read.storedArranged }
	for (const zone of ["left", "middle", "right"] as const)
		if (!working[zone]) working[zone] = seedReport(zone, read)
	if (edit.working) working = edit.working(working)
	const arrangement = dedupeArranged(working).arranged
	const done = placementAtDone({
		zones: read.layout,
		grid: read.grid,
		arrangement,
		sideZoneIds: SIDE_ZONE_IDS,
		primaryId: "messages"
	})
	const kept = arrangementAtDone(
		arrangement,
		read.storedArranged,
		new Set(edit.authored ?? [])
	)
	const next: SessionLayoutV1 = {
		zoneLayout: done.zones,
		widgetGrid: done.grid,
		arrangedGrid: arrangementIsEmpty(kept) ? undefined : kept
	}
	return {
		patch: changedSlots(
			{
				zoneLayout: read.layout,
				widgetGrid: read.savedGrid,
				arrangedGrid: read.storedArranged
			},
			next
		),
		next,
		working: arrangement
	}
}

describe("the shipped layouts round-trip through open → Done unchanged", () => {
	for (const [name, layout] of [
		["Chat", CHAT_LAYOUT],
		["Adventure", ADVENTURE_LAYOUT],
		["Lair", LAIR_LAYOUT]
	] as const) {
		test(`${name}: Done with no change emits no patch at all`, () => {
			expect(openThenDone(layout).patch).toEqual({})
		})
		test(`${name}: what Done would write normalises equal to what is stored`, () => {
			const { next } = openThenDone(layout)
			expect(normalisedSlots(next)).toEqual(
				normalisedSlots({
					zoneLayout: storedRead(layout).layout,
					widgetGrid: storedRead(layout).savedGrid,
					arrangedGrid: layout.arrangedGrid
				})
			)
		})
	}

	test("Adventure: the world strip stays drawn from the grid — a fixed strip at its own height", () => {
		const { next } = openThenDone(ADVENTURE_LAYOUT)
		expect(next.arrangedGrid?.middle).toBeUndefined()
		const drawn = drawnOf(
			{
				zones: next.zoneLayout!,
				grid: next.widgetGrid!,
				arranged: loadArranged(next.arrangedGrid)
			},
			{ inline: 1216 }
		)
		expect(drawn.middle.drawnFrom).toBe("grid")
		expect(drawn.middle.instances[0]).toMatchObject({
			instanceId: "stats#world",
			size: { w: "grow", h: "fixed" }
		})
	})

	test("Adventure: the unpinned left stays its zone list — an icon strip, never a docked column", () => {
		const { next } = openThenDone(ADVENTURE_LAYOUT)
		expect(next.arrangedGrid?.left).toBeUndefined()
		expect(next.zoneLayout!.zones.left).toMatchObject({
			pinned: false,
			widgets: ["chronicle", "lore-entries"]
		})
	})

	test("the regression this guards: writing every working frame (the old Done) re-arranged Adventure", () => {
		const { working } = openThenDone(ADVENTURE_LAYOUT)
		const old = changedSlots(
			{ arrangedGrid: ADVENTURE_LAYOUT.arrangedGrid },
			{ arrangedGrid: working }
		)
		expect(Object.keys(old)).toEqual(["arrangedGrid"])
		// The seed's strip: three cells of a proportional middle.
		expect(working.middle?.items.find((i) => i.id === "stats#world")?.h).toBe(3)
	})
})

describe("arrangementAtDone — a seed is not an arrangement; a hand's frame is", () => {
	const frame = (ids: string[]): ArrangedZone => ({
		cols: 1,
		rows: 12,
		items: ids.map((id, n) => ({ id, x: 0, y: n * 3, w: 1, h: 3 }))
	})
	const working: ArrangedGridV1 = {
		left: frame(["a"]),
		middle: frame(["messages"]),
		right: frame(["b"])
	}

	test("keeps the zones the stored layout arranged", () => {
		const kept = arrangementAtDone(working, { right: frame(["b"]) }, new Set())
		expect(Object.keys(kept)).toEqual(["right"])
	})

	test("keeps a zone a hand wrote, though it was never arranged", () => {
		const kept = arrangementAtDone(working, {}, new Set<ZoneId>(["middle"]))
		expect(kept.middle).toBe(working.middle)
		expect(kept.left).toBeUndefined()
	})

	test("Adventure with its middle authored: Done writes the middle, and only the arrangement slot", () => {
		const { patch } = openThenDone(ADVENTURE_LAYOUT, {
			// Messages made two rows taller by a hand: the middle is the user's.
			working: (w) => ({
				...w,
				middle: {
					...w.middle!,
					items: w.middle!.items.map((i) =>
						i.id === "stats#world" ? { ...i, h: 1 } : { ...i, y: 1, h: i.h + 2 }
					)
				}
			}),
			authored: ["middle"]
		})
		expect(Object.keys(patch)).toEqual(["arrangedGrid"])
		expect(patch.arrangedGrid?.middle?.items.map((i) => i.id)).toEqual([
			"stats#world",
			"messages"
		])
		expect(patch.arrangedGrid?.left).toBeUndefined()
		expect(patch.arrangedGrid?.right).toEqual(ADVENTURE_LAYOUT.arrangedGrid!.right)
	})

	test("Adventure's unpinned left, rearranged by hand, keeps its zone's pin on every card", () => {
		const { patch } = openThenDone(ADVENTURE_LAYOUT, {
			working: (w) => ({
				...w,
				left: {
					...w.left!,
					items: w.left!.items.map((i) =>
						i.id === "chronicle" ? { ...i, y: 3 } : { ...i, y: 0 }
					)
				}
			}),
			authored: ["left"]
		})
		expect(patch.arrangedGrid?.left?.items.every((i) => i.pinned === false)).toBe(true)
		// …and its list follows the new row order.
		expect(patch.zoneLayout?.zones.left.widgets).toEqual(["lore-entries", "chronicle"])
	})
})

describe("normalisedSlots / changedSlots — one normaliser for both sides of the round trip", () => {
	const z: ArrangedZone = {
		cols: 1,
		rows: 12,
		items: [
			{ id: "b", x: 0, y: 6, w: 1, h: 6 },
			{ id: "a", x: 0, y: 0, w: 1, h: 6, pinned: true, anchor: { top: false } }
		]
	}

	test("cell order, a pin of true and an anchor of no edges are spelling, not change", () => {
		const same: ArrangedZone = {
			cols: 1,
			rows: 12,
			items: [
				{ id: "a", x: 0, y: 0, w: 1, h: 6 },
				{ id: "b", x: 0, y: 6, w: 1, h: 6 }
			]
		}
		expect(changedSlots({ arrangedGrid: { right: z } }, { arrangedGrid: { right: same } })).toEqual({})
	})

	test("a pin of false is a change", () => {
		const unpinned: ArrangedZone = {
			...z,
			items: z.items.map((i) => (i.id === "a" ? { ...i, pinned: false } : i))
		}
		expect(
			Object.keys(changedSlots({ arrangedGrid: { right: z } }, { arrangedGrid: { right: unpinned } }))
		).toEqual(["arrangedGrid"])
	})

	test("an arrangement placing nothing is no arrangement", () => {
		expect(
			changedSlots({ arrangedGrid: undefined }, { arrangedGrid: { left: { cols: 6, rows: 10, items: [] } } })
		).toEqual({})
	})

	test("object key order is spelling; list order is not", () => {
		const a: ZoneLayoutV1 = {
			version: 1,
			zones: { right: { kind: "side", side: "right", widgets: ["x", "y"] } }
		}
		const b = { zones: { right: { widgets: ["x", "y"], side: "right", kind: "side" } }, version: 1 } as ZoneLayoutV1
		expect(changedSlots({ zoneLayout: a }, { zoneLayout: b })).toEqual({})
		const c: ZoneLayoutV1 = {
			version: 1,
			zones: { right: { kind: "side", side: "right", widgets: ["y", "x"] } }
		}
		expect(changedSlots({ zoneLayout: a }, { zoneLayout: c })).toEqual({ zoneLayout: c })
	})

	test("a slot Done leaves out is not compared; one it sets to undefined is written", () => {
		expect(changedSlots({ widgetGrid: defaultChatLayout() }, {})).toEqual({})
		expect(
			changedSlots({ arrangedGrid: { right: z } }, { arrangedGrid: undefined })
		).toEqual({ arrangedGrid: undefined })
	})
})
