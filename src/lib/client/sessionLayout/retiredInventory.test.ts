/**
 * R79: the Inventory widget is REMOVED for now, with no replacement — and a
 * layout somebody stored while it existed still has to open.
 *
 * Adventure and Lair shipped it, so a session arranged on either, a preset
 * saved from one, and a per-widget settings row can all still name
 * `inventory`. None of those rows is rewritten: every reader drops the id
 * instead (`RETIRED_WIDGET_IDS`, the SDK's one list), so the widget is simply
 * not drawn — no crash, no labelled placeholder, no empty card.
 *
 * The fixture is the pre-R79 Adventure blob, spelled out rather than imported:
 * core-catalog's own copy no longer carries the widget, and a user's row does.
 */
import { describe, expect, test } from "vitest"
import { fromLegacy, resolve, type Unit } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "@serene-pub/core-catalog"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { presetBase } from "$lib/shared/sessionLayout/presets"
import { loadArranged } from "./arrangedGeometry"
import { previewOf } from "./presetPreview"
import { normalizeZoneLayout, placedWidgetIds } from "./schema"
import { unitsOf } from "./tabGroups"
import { RETIRED_WIDGET_IDS, isRetiredWidget, loadChatLayout, widgetsInZone } from "./widgetGrid"

/** A stored layout from before R79: every slot names the widget somewhere. */
const STORED = {
	zoneLayout: {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", pinned: false, widgets: ["inventory"] },
			right: {
				kind: "side",
				side: "right",
				pinned: true,
				widgets: ["scene-portraits", "stats", "inventory"]
			}
		}
	},
	widgetGrid: {
		version: 1,
		cell: 44,
		widgets: [
			{ id: "world-state", zone: "middle", order: 0, size: { w: "grow", h: "fixed" }, anchor: { top: true } },
			{ id: "messages", zone: "middle", order: 1, size: { w: "grow", h: "grow" }, required: true },
			// Somebody dragged it under the conversation.
			{ id: "inventory", zone: "middle", order: 2, size: { w: "grow", h: "fixed" }, anchor: { bottom: true } }
		]
	},
	arrangedGrid: {
		left: {
			cols: 1,
			rows: 12,
			// A tab group it shared with the lore.
			items: [
				{ id: "inventory", x: 0, y: 0, w: 1, h: 12, group: "g:bag" },
				{ id: "lore-entries", x: 0, y: 0, w: 1, h: 12, group: "g:bag" }
			]
		},
		right: {
			cols: 1,
			rows: 12,
			items: [
				{ id: "scene-portraits", x: 0, y: 0, w: 1, h: 4 },
				{ id: "stats", x: 0, y: 4, w: 1, h: 4 },
				{ id: "inventory", x: 0, y: 8, w: 1, h: 4 }
			]
		}
	},
	widgetSettings: { inventory: { groupBy: "item" }, stats: { density: "compact" } }
}

/** The per-panel half of a user's row: it was on, and ordered. */
const STORED_PANELS = {
	active: [
		{ id: "inventory", order: 2, collapsed: false, drawered: false, on: true },
		{ id: "stats", order: 1, collapsed: false, drawered: false, on: true }
	]
}

const ids = (xs: readonly { id: string }[] | undefined) => (xs ?? []).map((x) => x.id)

/** Every widget a v2 unit places: itself, or each member of its tab group. */
const widgetsOfUnit = (u: Unit): string[] =>
	u.kind === "widget" ? [u.widget] : u.kind === "group" ? u.members.map((m) => m.widget) : []

describe("core no longer has an Inventory widget (R79)", () => {
	test("not declared, not offered — and its id is retired", () => {
		expect(ids(CORE_WIDGETS)).not.toContain("inventory")
		expect(ids(coreDefaultWidgets())).not.toContain("inventory")
		expect(RETIRED_WIDGET_IDS.has("inventory")).toBe(true)
		expect(isRetiredWidget("inventory")).toBe(true)
	})
})

describe("a stored placement of 'inventory' is ignored on every layout path", () => {
	test("the panel manager seeds no instance for it, whatever the row says", () => {
		const m = new SurfaceManager()
		m.init(
			1,
			coreDefaultWidgets(),
			{ ...STORED_PANELS, ...STORED } as never,
			() => {},
			presetBase(STORED)
		)
		expect(ids(m.instances)).not.toContain("inventory")
		expect(ids(m.addable)).not.toContain("inventory")
		expect(ids(m.gridInstances)).not.toContain("inventory")
		expect(ids(m.drawerInstances)).not.toContain("inventory")
		// …and what it does hold still reads its own stored state.
		expect(m.instances.find((p) => p.id === "stats")?.active).toBe(true)
	})

	test("side zones: the widget list loses it, and a zone that only held it is empty", () => {
		const zones = normalizeZoneLayout(STORED.zoneLayout).zones
		expect(zones.right.widgets).toEqual(["scene-portraits", "stats"])
		expect(zones.left.widgets).toEqual([])
		expect(placedWidgetIds(normalizeZoneLayout(STORED.zoneLayout))).not.toContain("inventory")
	})

	test("arranged geometry: the card goes, a tab group keeps its other member", () => {
		const arranged = loadArranged(STORED.arrangedGrid)
		expect(ids(arranged.right?.items)).toEqual(["scene-portraits", "stats"])
		expect(ids(arranged.left?.items)).toEqual(["lore-entries"])
	})

	test("the rail and the mobile views (render units) never list it", () => {
		const arranged = loadArranged(STORED.arrangedGrid)
		const keys = (side: "left" | "right") =>
			unitsOf(arranged[side]!.items).flatMap((u) => u.members.map((m) => m.id))
		expect(keys("right")).toEqual(["scene-portraits", "stats"])
		expect(keys("left")).toEqual(["lore-entries"])
	})

	test("the middle grid does not seat it", () => {
		const grid = loadChatLayout(STORED.widgetGrid)
		expect(ids(widgetsInZone(grid, "middle"))).toEqual(["world-state", "messages"])
	})

	test("a preset's picture does not draw it", () => {
		const picture = previewOf(STORED)
		expect(ids(picture.right.cells)).toEqual(["scene-portraits", "stats"])
		expect(ids(picture.left.cells)).toEqual(["lore-entries"])
		// A preset stored as zone lists only.
		const lists = previewOf({ zoneLayout: STORED.zoneLayout })
		expect(ids(lists.right.cells)).toEqual(["scene-portraits", "stats"])
		expect(ids(lists.left.cells)).toEqual([])
	})

	test("the v2 document read from it has no unit for it, and no row track left for one", () => {
		const doc = fromLegacy(STORED)!.layout
		const placed = Object.values(doc.zones).flatMap((z) => (z?.units ?? []).flatMap(widgetsOfUnit))
		expect(placed).not.toContain("inventory")
		expect(doc.zones.right?.units.map((u) => u.key)).toEqual(["scene-portraits", "stats"])
		expect(doc.zones.right?.rows).toHaveLength(2)
		const r = resolve(doc, { width: 1600, height: 900 })
		expect(r.zones.right?.units.map((u) => u.key)).toEqual(["scene-portraits", "stats"])
		// Its stored settings do not ride into the document either.
		expect(Object.keys(fromLegacy(STORED)?.widgetSettings ?? {})).toEqual(["stats"])
	})
})
