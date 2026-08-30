/**
 * The panel<->widget translation layer: proves every panel the interim zone
 * system can show is expressible as a PLAN-25 widget, without touching any
 * live rendering.
 */
import { describe, expect, it } from "vitest"
import type { PanelInstance } from "../surfaces/types"
import { widgetsFromSideZones } from "./panelWidgets"
import type { ResolvedZone, ZoneDef } from "./schema"

function panel(id: string, over: Partial<PanelInstance> = {}): PanelInstance {
	return {
		id,
		title: id,
		role: "secondary",
		surface: { kind: "native", component: "x" } as any,
		channels: [],
		layout: {
			span: { ideal: 1, min: 1, max: 1 },
			minInline: 200,
			minBlock: 120,
			collapsible: true,
			closable: true,
			prefer: "grid"
		},
		active: true,
		collapsed: false,
		drawered: false,
		order: 0,
		...over
	}
}

function zone(
	id: string,
	def: Partial<ZoneDef> & { widgets: string[] },
	mode: ResolvedZone["mode"],
	over: Partial<Pick<ResolvedZone, "width" | "columns">> = {}
): ResolvedZone {
	return {
		id,
		def: { kind: "side", side: "right", ...def } as ZoneDef,
		mode,
		width: 264,
		columns: 1,
		...over
	}
}

describe("widgetsFromSideZones — pinned rail", () => {
	it("emits one widget per panel, in zone order, pinned", () => {
		const zones = [
			zone("right", { side: "right", widgets: ["tasks", "map"] }, "rail")
		]
		const instances = [panel("tasks"), panel("map")]
		const widgets = widgetsFromSideZones(zones, instances, 44)

		expect(widgets.map((w) => w.id)).toEqual(["tasks", "map"])
		expect(widgets.every((w) => w.zone === "right")).toBe(true)
		expect(widgets.map((w) => w.order)).toEqual([0, 1])
		expect(widgets.every((w) => w.pinned === true)).toBe(true)
	})

	it("converts the rail's shared pixel width to a stable cell count", () => {
		const zones = [
			zone("right", { side: "right", widgets: ["tasks"] }, "rail", {
				width: 264
			})
		]
		const w = widgetsFromSideZones(zones, [panel("tasks")], 44)[0]
		expect(w.size).toEqual({ w: { cells: 6 }, h: "fixed" }) // 264/44 = 6 exactly
	})

	it("stacks top-down at full column width, natural height", () => {
		const zones = [
			zone("left", { side: "left", widgets: ["notes"] }, "rail")
		]
		const w = widgetsFromSideZones(zones, [panel("notes")], 44)[0]
		expect(w.anchor).toEqual({ top: true, left: true, right: true })
		expect(w.size.h).toBe("fixed")
	})

	it("a wide rail's extra stack columns become colSpan; a single column omits it", () => {
		const wide = zone(
			"right",
			{ side: "right", widgets: ["tasks"] },
			"rail",
			{ columns: 2 }
		)
		const [w1] = widgetsFromSideZones([wide], [panel("tasks")], 44)
		expect(w1.colSpan).toBe(2)

		const narrow = zone(
			"right",
			{ side: "right", widgets: ["tasks"] },
			"rail",
			{ columns: 1 }
		)
		const [w2] = widgetsFromSideZones([narrow], [panel("tasks")], 44)
		expect("colSpan" in w2).toBe(false)
	})
})

describe("widgetsFromSideZones — unpinned modes", () => {
	it("icons mode: pinned:false", () => {
		const zones = [
			zone("right", { side: "right", widgets: ["tasks"] }, "icons")
		]
		const [w] = widgetsFromSideZones(zones, [panel("tasks")], 44)
		expect(w.pinned).toBe(false)
	})

	it("drawer mode: also pinned:false (documented approximation)", () => {
		const zones = [
			zone("right", { side: "right", widgets: ["tasks"] }, "drawer")
		]
		const [w] = widgetsFromSideZones(zones, [panel("tasks")], 44)
		expect(w.pinned).toBe(false)
	})
})

describe("widgetsFromSideZones — exclusions", () => {
	it("a hidden zone emits nothing, even with widgets declared", () => {
		const zones = [
			zone("right", { side: "right", widgets: ["tasks"] }, "hidden")
		]
		expect(widgetsFromSideZones(zones, [panel("tasks")], 44)).toEqual([])
	})

	it("a strip zone is out of scope regardless of mode", () => {
		const zones: ResolvedZone[] = [
			{
				id: "top",
				def: { kind: "strip", area: "top", widgets: ["tasks"] },
				mode: "row",
				width: 264,
				columns: 1
			}
		]
		expect(widgetsFromSideZones(zones, [panel("tasks")], 44)).toEqual([])
	})

	it("a primary-role instance is never emitted as a side widget", () => {
		const zones = [
			zone("right", { side: "right", widgets: ["main"] }, "rail")
		]
		const instances = [panel("main", { role: "primary" })]
		expect(widgetsFromSideZones(zones, instances, 44)).toEqual([])
	})

	it("a stale zone widget id with no matching instance is skipped, not thrown", () => {
		const zones = [
			zone(
				"right",
				{ side: "right", widgets: ["ghost", "tasks"] },
				"rail"
			)
		]
		const widgets = widgetsFromSideZones(zones, [panel("tasks")], 44)
		expect(widgets.map((w) => w.id)).toEqual(["tasks"])
	})
})
