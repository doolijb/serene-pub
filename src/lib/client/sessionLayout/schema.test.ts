/**
 * The zone resolver: rules merge ascending and cumulatively (any number of
 * widths), the pin refinement turns an unpinned rail into icons, strips never
 * become drawers, and normalization survives garbage while preserving the
 * user's own template fields.
 */
import { describe, expect, it } from "vitest"
import {
	defaultZoneLayout,
	normalizeZoneLayout,
	resolveMessageCap,
	resolveZone,
	withWidget,
	withoutWidget,
	type ZoneDef
} from "./schema"

const side = (over: Partial<ZoneDef> = {}): ZoneDef => ({
	kind: "side",
	side: "right",
	widgets: [],
	...over
})

describe("rule resolution", () => {
	it("merges ascending and cumulatively — later rules state only deltas", () => {
		const def = side({
			rules: [
				{ min: 0, mode: "drawer", width: 300 },
				{ min: 900, mode: "rail" },
				{ min: 1500, width: 340 },
				{ min: 2200, columns: 2 }
			]
		})
		expect(resolveZone("z", def, 500)).toMatchObject({
			mode: "drawer",
			width: 300
		})
		// mode changed, width inherited from below
		expect(resolveZone("z", def, 1000)).toMatchObject({
			mode: "rail",
			width: 300
		})
		expect(resolveZone("z", def, 1600)).toMatchObject({
			mode: "rail",
			width: 340,
			columns: 1
		})
		expect(resolveZone("z", def, 3000)).toMatchObject({
			mode: "rail",
			width: 340,
			columns: 2
		})
	})

	it("any number of rules — a thirteen-step ladder walks the same", () => {
		const rules = Array.from({ length: 13 }, (_, i) => ({
			min: i * 100,
			width: 200 + i
		}))
		const def = side({ rules: [{ min: 0, mode: "rail" }, ...rules] })
		expect(resolveZone("z", def, 1250).width).toBe(212)
	})

	it("unpinned rails present as icon strips; drawers ignore pinning", () => {
		const pinned = side({ pinned: true })
		const loose = side({ pinned: false })
		expect(resolveZone("z", pinned, 1000).mode).toBe("rail")
		expect(resolveZone("z", loose, 1000).mode).toBe("icons")
		expect(resolveZone("z", loose, 400).mode).toBe("drawer")
	})

	it("strips are rows or hidden, never drawers", () => {
		const strip: ZoneDef = {
			kind: "strip",
			area: "top",
			widgets: [],
			rules: [{ min: 0, mode: "row" }, { min: 900, mode: "drawer" as any }]
		}
		expect(resolveZone("t", strip, 1200).mode).toBe("row")
	})

	it("default side ladders mirror the mockup breakpoints", () => {
		expect(resolveZone("r", side(), 500).mode).toBe("drawer")
		expect(resolveZone("r", side(), 800).mode).toBe("rail")
		const left = side({ side: "left" })
		expect(resolveZone("l", left, 800).mode).toBe("drawer")
		expect(resolveZone("l", left, 1300).mode).toBe("rail")
		expect(resolveZone("l", left, 2500)).toMatchObject({
			width: 344,
			columns: 2
		})
	})
})

describe("message cap", () => {
	it("caps only where a rule says so", () => {
		const layout = defaultZoneLayout()
		expect(resolveMessageCap(layout, 1000)).toBeUndefined()
		expect(resolveMessageCap(layout, 2000)).toBe(54)
		expect(resolveMessageCap(layout, 3000)).toBe(58)
	})
})

describe("normalization and edits", () => {
	it("garbage falls back; user templates keep their unknown fields", () => {
		expect(normalizeZoneLayout(null, ["a"]).zones.right?.widgets).toEqual([
			"a"
		])
		const custom = {
			version: 1,
			myNote: "keep me",
			zones: {
				lore: { kind: "side", side: "left", widgets: ["x", 3, "y"] }
			}
		}
		const n = normalizeZoneLayout(custom)
		expect((n as any).myNote).toBe("keep me")
		expect(n.zones.lore?.widgets).toEqual(["x", "y"])
	})

	it("a widget lives in at most one slot — insert moves, never copies", () => {
		let layout = defaultZoneLayout(["a", "b"])
		layout = withWidget(layout, "left", "a")
		expect(layout.zones.right?.widgets).toEqual(["b"])
		expect(layout.zones.left?.widgets).toEqual(["a"])
		layout = withWidget(layout, "right", "a", "b")
		expect(layout.zones.right?.widgets).toEqual(["a", "b"])
		layout = withoutWidget(layout, "b")
		expect(layout.zones.right?.widgets).toEqual(["a"])
	})
})
