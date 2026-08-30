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
	trackFor,
	updateWidget,
	widgetItemStyle,
	widgetsInZone,
	zoneGridStyle,
	type WidgetConfig
} from "./widgetGrid"

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
