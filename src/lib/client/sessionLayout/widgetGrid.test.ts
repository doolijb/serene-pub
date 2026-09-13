/**
 * The widget-grid model (PLAN 25 MVP): the normal chat falls out of the
 * widget model, and each widget's constraints map to the expected CSS Grid.
 */
import { describe, expect, it } from "vitest"
import {
	DEFAULT_CELL,
	cellsFromPx,
	defaultChatLayout,
	loadChatLayout,
	placementOf,
	stackPlacements,
	trackFor,
	updateWidget,
	widgetItemStyle,
	widgetsInZone,
	zoneGridStyle,
	type WidgetConfig
} from "./widgetGrid"
import { ADVENTURE_LAYOUT } from "@serene-pub/core-catalog"
import { loadArranged, unitPinned } from "./arrangedGeometry"
import { resolveRailColumn } from "./sideRail"
import { unitsOf } from "./tabGroups"

const wid = (over: Partial<WidgetConfig> = {}): WidgetConfig => ({
	id: "w",
	zone: "middle",
	order: 0,
	size: { w: "grow", h: "grow" },
	anchor: {},
	...over
})

describe("the normal chat falls out of the model", () => {
	it("is two required widgets in the middle zone, in order", () => {
		const l = defaultChatLayout()
		const mid = widgetsInZone(l, "middle")
		expect(mid.map((w) => w.id)).toEqual(["messages", "composer"])
		expect(mid.every((w) => w.required)).toBe(true)
		expect(widgetsInZone(l, "left")).toEqual([])
		expect(widgetsInZone(l, "right")).toEqual([])
	})

	it("messages GROW-fill the top; composer is FIXED at the bottom", () => {
		const l = defaultChatLayout()
		const [messages, composer] = widgetsInZone(l, "middle")
		expect(messages.size.h).toBe("grow")
		expect(messages.anchor).toMatchObject({ top: true, left: true, right: true })
		expect(composer.size.h).toBe("fixed")
		expect(composer.anchor).toMatchObject({
			bottom: true,
			left: true,
			right: true
		})
	})

	it("the middle zone grid is infinite cells across, [grow fixed] down", () => {
		const l = defaultChatLayout()
		const style = zoneGridStyle(widgetsInZone(l, "middle"), l.cell)
		expect(style).toContain(
			`grid-template-columns:repeat(auto-fill, minmax(${DEFAULT_CELL}px, 1fr))`
		)
		// messages GROW → 1fr, composer FIXED → auto
		expect(style).toContain("grid-template-rows:1fr auto")
	})

	it("messages stretch to fill; composer anchors to the bottom edge", () => {
		const l = defaultChatLayout()
		const [messages, composer] = widgetsInZone(l, "middle")
		const m = widgetItemStyle(messages, l.cell)
		expect(m).toContain("justify-self:stretch")
		expect(m).toContain("align-self:stretch")
		expect(m).toContain("grid-column:1 / -1")
		const c = widgetItemStyle(composer, l.cell)
		expect(c).toContain("align-self:end") // bottom-anchored, not stretched
	})
})

describe("size specs → grid tracks / bounds", () => {
	it("grow→1fr, fixed→auto, {cells}→px, {min,max}→minmax", () => {
		expect(trackFor("grow", 44)).toBe("1fr")
		expect(trackFor("fixed", 44)).toBe("auto")
		expect(trackFor({ cells: 3 }, 44)).toBe("132px")
		expect(trackFor({ minCells: 4, maxCells: 8 }, 44)).toBe(
			"minmax(176px, 352px)"
		)
	})

	it("min/max cells become min/max-inline-size on the item", () => {
		const w = wid({
			size: { w: { minCells: 4, maxCells: 8 }, h: "grow" },
			anchor: { left: true }
		})
		const s = widgetItemStyle(w, 44)
		expect(s).toContain("min-inline-size:176px")
		expect(s).toContain("max-inline-size:352px")
		expect(s).toContain("justify-self:start") // left-only anchor
	})

	it("a fixed-cell width pins the inline size", () => {
		const w = wid({ size: { w: { cells: 6 }, h: "grow" }, anchor: {} })
		expect(widgetItemStyle(w, 44)).toContain("inline-size:264px")
	})
})

describe("cellsFromPx — seeding a drag from a measured size", () => {
	it("rounds to the nearest whole cell, floored at 1", () => {
		expect(cellsFromPx(133, 44)).toBe(3) // 3.02 -> 3
		expect(cellsFromPx(176, 44)).toBe(4)
		expect(cellsFromPx(10, 44)).toBe(1) // never zero cells
		expect(cellsFromPx(0, 44)).toBe(1)
	})
})

describe("updateWidget — immutable edit", () => {
	it("patches one widget by id and leaves the rest (and the input) untouched", () => {
		const l = defaultChatLayout()
		const next = updateWidget(l, "composer", {
			size: { w: "grow", h: { minCells: 4 } }
		})
		const composer = widgetsInZone(next, "middle").find(
			(w) => w.id === "composer"
		)!
		const messages = widgetsInZone(next, "middle").find(
			(w) => w.id === "messages"
		)!
		expect(composer.size.h).toEqual({ minCells: 4 })
		expect(messages.size.h).toBe("grow") // untouched
		// input not mutated
		expect(
			widgetsInZone(l, "middle").find((w) => w.id === "composer")!.size.h
		).toBe("fixed")
		expect(next).not.toBe(l)
	})
})

describe("loadChatLayout — defensive rehydrate", () => {
	it("falls back to the default for junk / wrong-version / non-object input", () => {
		for (const junk of [undefined, null, 42, "x", {}, { version: 2 }, {
			version: 1
		}]) {
			expect(loadChatLayout(junk)).toEqual(defaultChatLayout())
		}
	})

	it("round-trips a saved composer min-height while keeping required widgets", () => {
		const saved = updateWidget(defaultChatLayout(), "composer", {
			size: { w: "grow", h: { minCells: 4 } }
		})
		const loaded = loadChatLayout(JSON.parse(JSON.stringify(saved)))
		const composer = widgetsInZone(loaded, "middle").find(
			(w) => w.id === "composer"
		)!
		expect(composer.size.h).toEqual({ minCells: 4 })
		expect(composer.required).toBe(true) // identity kept from the default
		expect(widgetsInZone(loaded, "middle").map((w) => w.id)).toEqual([
			"messages",
			"composer"
		])
	})

	it("ignores a malformed size and keeps the default for that widget", () => {
		const loaded = loadChatLayout({
			version: 1,
			cell: 44,
			widgets: [{ id: "composer", size: { w: "grow" } /* no h */ }]
		})
		const composer = widgetsInZone(loaded, "middle").find(
			(w) => w.id === "composer"
		)!
		expect(composer.size.h).toBe("fixed") // default preserved
	})

	it("guarantees both required widgets even if the blob dropped one", () => {
		const loaded = loadChatLayout({
			version: 1,
			cell: 44,
			widgets: [{ id: "messages", size: { w: "grow", h: "grow" } }]
		})
		expect(widgetsInZone(loaded, "middle").map((w) => w.id)).toEqual([
			"messages",
			"composer"
		])
	})
})

/**
 * A preset's middle zone, as the live view resolves it. The shipped Adventure
 * layout is the case that matters: its strip is a widget the built-in default
 * has never heard of, and a rehydrate that only patched the default's own two
 * widgets dropped it on the floor — the strip never rendered and the editor's
 * tray still offered it as unplaced.
 */
describe("preset → effective middle zone", () => {
	it("keeps the Adventure preset's world-state strip above the messages", () => {
		const loaded = loadChatLayout(ADVENTURE_LAYOUT.widgetGrid)
		expect(widgetsInZone(loaded, "middle").map((w) => w.id)).toEqual([
			"world-state",
			"messages",
			"composer"
		])
		const strip = widgetsInZone(loaded, "middle")[0]
		expect(strip.size).toEqual({ w: "grow", h: "fixed" })
		expect(strip.required).toBeUndefined()
	})

	it("admits an unknown widget into the zone the blob names", () => {
		const loaded = loadChatLayout({
			version: 1,
			cell: 44,
			widgets: [
				{
					id: "plugin:widget/tracker",
					zone: "right",
					order: 0,
					size: { w: "grow", h: "fixed" },
					anchor: { top: true }
				}
			]
		})
		expect(widgetsInZone(loaded, "right").map((w) => w.id)).toEqual([
			"plugin:widget/tracker"
		])
		// The anchor guarantee is untouched by a newcomer.
		expect(widgetsInZone(loaded, "middle").map((w) => w.id)).toEqual([
			"messages",
			"composer"
		])
	})

	it("ignores an entry that names neither a real zone nor a real size", () => {
		const loaded = loadChatLayout({
			version: 1,
			cell: 44,
			widgets: [
				{ id: "nowhere", zone: "elsewhere", size: { w: "grow", h: "fixed" } },
				{ id: "sizeless", zone: "middle" }
			]
		})
		expect(loaded.widgets.map((w) => w.id)).toEqual([
			"messages",
			"composer"
		])
	})
})

describe("anchoring → self-alignment (fixed/bounded widgets only)", () => {
	// GROW always stretches (see above); the anchor positions a FIXED widget.
	const fixed = (anchor: WidgetConfig["anchor"]) =>
		widgetItemStyle(wid({ size: { w: "fixed", h: "fixed" }, anchor }), 44)

	it("both edges → stretch, one edge → start/end, none → stretch", () => {
		expect(fixed({ top: true, bottom: true })).toContain(
			"align-self:stretch"
		)
		expect(fixed({ top: true })).toContain("align-self:start")
		expect(fixed({ bottom: true })).toContain("align-self:end")
		expect(fixed({ right: true })).toContain("justify-self:end")
		expect(fixed({})).toContain("align-self:stretch")
	})

	it("a GROW axis stretches regardless of a single-edge anchor", () => {
		// messages: grow height + top anchor → still fills (stretch)
		expect(
			widgetItemStyle(
				wid({ size: { w: "grow", h: "grow" }, anchor: { top: true } }),
				44
			)
		).toContain("align-self:stretch")
	})
})

/**
 * Real placement (PLAN 25): the geometry a zone hands each widget so its
 * `layout.v1` describes where it actually sits, not a single-widget default.
 */
describe("placementOf — a widget's cell geometry", () => {
	const zone = { cols: 4, rows: 20 }

	it("zone carries the grid's dims AND this widget's 1-based start cell", () => {
		const p = placementOf({
			zone,
			box: { x: 0, y: 14, w: 4, h: 5 },
			widthPx: 300
		})
		expect(p.zone).toEqual({ columns: 4, column: 1, rows: 20, row: 15 })
		expect(p.box.cols).toBe(4)
		expect(p.box.rows).toBe(5)
	})

	it("edges: a full-width box mid-zone touches left+right only", () => {
		const p = placementOf({
			zone,
			box: { x: 0, y: 14, w: 4, h: 5 },
			widthPx: 300
		})
		expect(p.box.edges).toEqual({
			top: false,
			right: true,
			bottom: false,
			left: true
		})
	})

	it("edges: a box filling the zone touches all four", () => {
		const p = placementOf({
			zone,
			box: { x: 0, y: 0, w: 4, h: 20 },
			widthPx: 300
		})
		expect(p.box.edges).toEqual({
			top: true,
			right: true,
			bottom: true,
			left: true
		})
	})

	it("edges: an inset box touches none", () => {
		const p = placementOf({
			zone: { cols: 8, rows: 8 },
			box: { x: 2, y: 2, w: 3, h: 3 },
			widthPx: 300
		})
		expect(p.box.edges).toEqual({
			top: false,
			right: false,
			bottom: false,
			left: false
		})
	})

	it("a box overhanging the zone still reads as touching (a clamp is not a gap)", () => {
		const p = placementOf({
			zone: { cols: 4, rows: 4 },
			box: { x: 0, y: 2, w: 6, h: 9 },
			widthPx: 300
		})
		expect(p.box.edges.right).toBe(true)
		expect(p.box.edges.bottom).toBe(true)
	})

	it("tier is the app's breakpoints applied to the widget's OWN box", () => {
		const at = (widthPx: number) =>
			placementOf({ zone, box: { x: 0, y: 0, w: 4, h: 1 }, widthPx }).tier
		expect(at(320)).toBe("compact")
		expect(at(640)).toBe("cozy")
		expect(at(1024)).toBe("roomy")
		expect(at(1440)).toBe("wide")
		// Unmeasured (first paint) is honestly the narrowest class, not a guess.
		expect(at(0)).toBe("compact")
	})

	it("box.rows is the occupied rows unless the zone's tracks aren't cells", () => {
		const box = { x: 0, y: 0, w: 4, h: 6 }
		expect(placementOf({ zone, box, widthPx: 300 }).box.rows).toBe(6)
		// null = the contract's "grows / is unbounded" (a 1fr or auto track).
		expect(placementOf({ zone, box, widthPx: 300, rows: null }).box.rows).toBeNull()
		// …and an explicit cell height never changes which edges it touches.
		const p = placementOf({ zone, box, widthPx: 300, rows: null })
		expect(p.box.edges.top).toBe(true)
		expect(p.box.edges.bottom).toBe(false)
	})

	it("carries pinned / collapsed / drawered through, defaulting to false", () => {
		const bare = placementOf({ zone, box: { x: 0, y: 0, w: 1, h: 1 }, widthPx: 0 })
		expect([bare.pinned, bare.collapsed, bare.drawered]).toEqual([
			false,
			false,
			false
		])
		const p = placementOf({
			zone,
			box: { x: 0, y: 0, w: 1, h: 1 },
			widthPx: 0,
			pinned: true,
			collapsed: true,
			drawered: true
		})
		expect([p.pinned, p.collapsed, p.drawered]).toEqual([true, true, true])
	})
})

describe("stackPlacements — the MVP zone stack", () => {
	it("gives each stacked widget its own row, full width", () => {
		const ws = widgetsInZone(defaultChatLayout(), "middle")
		const ps = stackPlacements(ws, { columns: 6, widthPx: 700 })
		expect(ps.map((p) => p.zone.row)).toEqual([1, 2])
		expect(ps.every((p) => p.zone.rows === 2)).toBe(true)
		expect(ps.every((p) => p.zone.columns === 6 && p.box.cols === 6)).toBe(true)
	})

	it("messages touch the top, composer the bottom, both the sides", () => {
		const ws = widgetsInZone(defaultChatLayout(), "middle")
		const [messages, composer] = stackPlacements(ws, {
			columns: 6,
			widthPx: 700
		})
		expect(messages.box.edges).toEqual({
			top: true,
			right: true,
			bottom: false,
			left: true
		})
		expect(composer.box.edges).toEqual({
			top: false,
			right: true,
			bottom: true,
			left: true
		})
	})

	it("a grow/fixed height is unbounded; a cell-bounded one reports its cells", () => {
		const base = defaultChatLayout()
		const ws = widgetsInZone(
			updateWidget(base, "composer", {
				size: { w: "grow", h: { minCells: 3 } }
			}),
			"middle"
		)
		const [messages, composer] = stackPlacements(ws, {
			columns: 6,
			widthPx: 700
		})
		expect(messages.box.rows).toBeNull() // grow
		expect(composer.box.rows).toBe(3)
	})
})

/**
 * The Adventure preset's RIGHT column, which a live session opened as a strip
 * of icons the player had to click.
 *
 * A side is drawn from its arrangement when it has one, and a group in an
 * arrangement is expanded exactly when it is pinned. Shipping no arrangement
 * left that decision to the width ladder instead, so whether the party was
 * docked or collapsed depended on what the session box happened to measure.
 */
describe("preset → the right column opens docked", () => {
	const arranged = () => loadArranged(ADVENTURE_LAYOUT.arrangedGrid)

	it("ships an arrangement for the side it docks", () => {
		const right = arranged().right
		expect(right?.items.map((i) => i.id)).toEqual([
			"scene-portraits",
			"stats",
			"inventory"
		])
		expect(right?.cols).toBe(1)
	})

	it("pins every group, which is what open-by-default means", () => {
		// Absent means pinned, and `true` is never written — so an arrangement
		// saved before the field existed reads as all groups pinned.
		for (const unit of unitsOf(arranged().right!.items))
			expect(unitPinned(unit.members), unit.key).toBe(true)
	})

	it("expands all three in a column tall enough to hold them", () => {
		const right = arranged().right!
		const units = unitsOf(right.items)
		const placed = resolveRailColumn({
			columnPx: 900,
			totalRows: right.rows,
			groups: units.map((u) => ({
				key: u.key,
				rows: u.box.h,
				pinned: unitPinned(u.members),
				open: unitPinned(u.members)
			}))
		})
		expect(placed.map((p) => p.state)).toEqual([
			"expanded",
			"expanded",
			"expanded"
		])
	})
})
