/**
 * `storedPanelsKind`, `storedLayoutAsV2` and `exportedSessionLayout`: the pure
 * conversion of a stored layout to panels version 2 (lay-E).
 */
import { describe, expect, test } from "vitest"
import {
	exportedSessionLayout,
	storedLayoutAsV2,
	storedPanelsKind
} from "./panelsFromStored"

const V1 = {
	version: 1,
	left: [],
	middle: {
		above: [],
		primary: { key: "p1", tabs: ["messages"] },
		below: []
	},
	right: [{ key: "p2", tabs: ["stats"], pinned: false }]
}
const PIN = { id: 1, slug: "mine" }
const SLOTS = {
	zoneLayout: {
		version: 1,
		zones: {
			left: {
				kind: "side",
				side: "left",
				pinned: true,
				widgets: ["stats"]
			}
		}
	},
	widgetGrid: {
		version: 1,
		cell: 44,
		widgets: [
			{
				id: "messages",
				zone: "middle",
				order: 0,
				size: { w: "grow", h: "grow" }
			}
		]
	}
}
const FLOOR = { zoneLayout: { version: 1, zones: {} } }
const V2 = {
	version: 2,
	left: [],
	middle: [{ key: "p1", tabs: ["messages"] }],
	right: []
}

const v1Layout = (extra: Record<string, unknown> = {}) => ({
	panels: V1,
	...extra
})

/** A deep copy; the conversions must leave their input equal to it. */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v))

const tabsOf = (panels: any): string[] =>
	[...panels.left, ...panels.middle, ...panels.right].flatMap(
		(p: any) => p.tabs
	)

describe("storedPanelsKind", () => {
	test("names each kind", () => {
		expect(storedPanelsKind({ panels: V2 })).toBe("v2")
		expect(storedPanelsKind({ panels: V1 })).toBe("v1")
		expect(storedPanelsKind(SLOTS)).toBe("slots")
		expect(storedPanelsKind(FLOOR)).toBe("floor")
		expect(storedPanelsKind({})).toBe("none")
		expect(storedPanelsKind({ panels: "nope" })).toBe("other")
		expect(storedPanelsKind({ panels: { version: 3 } })).toBe("other")
		expect(storedPanelsKind(null)).toBe("other")
		expect(storedPanelsKind([])).toBe("other")
	})
})

describe("storedLayoutAsV2", () => {
	test("v1 becomes v2 and the moves land in the outer settings AND the blob", () => {
		const input = {
			layout: v1Layout({
				widgetSettings: {
					messages: {
						composer: "quill",
						nextUp: "list",
						title: "kept"
					}
				}
			}),
			settings: { messages: { composer: "writer", showActions: true } }
		}
		const out = storedLayoutAsV2(input)
		expect((out.layout.panels as any).version).toBe(2)
		expect(tabsOf(out.layout.panels)).toEqual(
			expect.arrayContaining([
				"messages",
				"composer",
				"turn-line",
				"stats"
			])
		)
		// The key sits in both stores: it moves in both, from each one's value.
		expect(out.settings).toEqual({
			composer: { composer: "writer", showActions: true }
		})
		expect(out.layout.widgetSettings).toEqual({
			messages: { title: "kept" },
			composer: { composer: "quill" },
			"turn-line": { nextUp: "list" }
		})
		expect(out.changed).toEqual({
			layout: true,
			settings: true,
			styles: false
		})
	})

	test("a style pin is copied to the store that holds it, the outer one first", () => {
		const outer = storedLayoutAsV2({
			layout: v1Layout({ widgetStyles: { messages: { id: 2 } } }),
			styles: { messages: PIN }
		})
		expect(outer.styles).toEqual({
			messages: PIN,
			composer: PIN,
			"turn-line": PIN
		})
		expect(outer.layout.widgetStyles).toEqual({ messages: { id: 2 } })
		expect(outer.changed.styles).toBe(true)

		const blob = storedLayoutAsV2({
			layout: v1Layout({ widgetStyles: { messages: PIN } })
		})
		expect(blob.layout.widgetStyles).toEqual({
			messages: PIN,
			composer: PIN,
			"turn-line": PIN
		})
		expect(blob.styles).toBeUndefined()
		expect(blob.changed).toEqual({
			layout: true,
			settings: false,
			styles: false
		})
	})

	test("dropStale drops composer* and turn-line* from all four stores, only for v1 and slots", () => {
		const stale = {
			composer: { composer: "minimal" },
			"composer#2": { composer: "minimal" },
			"turn-line": { nextUp: "head" },
			stats: { title: "x" }
		}
		const stores = () => ({
			settings: json(stale),
			styles: json({ composer: PIN, "turn-line#2": PIN, stats: PIN })
		})
		const withBlob = (layout: Record<string, unknown>) => ({
			...layout,
			widgetSettings: json(stale),
			widgetStyles: { composer: PIN, "turn-line": PIN, stats: PIN }
		})
		for (const base of [v1Layout(), SLOTS]) {
			const out = storedLayoutAsV2(
				{ layout: withBlob(base), ...stores() },
				{ dropStale: true }
			)
			expect(out.layout.widgetSettings).toEqual({ stats: { title: "x" } })
			expect(out.layout.widgetStyles).toEqual({ stats: PIN })
			expect(out.settings).toEqual({ stats: { title: "x" } })
			expect(out.styles).toEqual({ stats: PIN })
		}
		for (const base of [{ panels: V2 }, FLOOR, {}]) {
			const input = { layout: withBlob(base), ...stores() }
			const out = storedLayoutAsV2(input, { dropStale: true })
			expect(out.layout.widgetSettings).toEqual(stale)
			expect(out.settings).toEqual(stale)
			expect(out.styles).toEqual(input.styles)
		}
		// Without the flag a v1 keeps them.
		const kept = storedLayoutAsV2({
			layout: withBlob(v1Layout()),
			...stores()
		})
		expect(kept.settings).toHaveProperty("composer#2")
	})

	test("none ({}) with messages.composer moves the setting and leaves the layout alone", () => {
		const out = storedLayoutAsV2({
			layout: {},
			settings: { messages: { composer: "quill" } }
		})
		expect(out.layout).toEqual({})
		expect(out.settings).toEqual({ composer: { composer: "quill" } })
		expect(out.changed).toEqual({
			layout: false,
			settings: true,
			styles: false
		})
	})

	test("an outer entry left empty is removed; a blob entry left empty stays {}", () => {
		const out = storedLayoutAsV2({
			layout: v1Layout({
				widgetSettings: { messages: { showNudge: false } }
			}),
			settings: { messages: { showComposer: true } }
		})
		expect(out.settings).toEqual({})
		expect(out.layout.widgetSettings).toEqual({ messages: {} })
	})

	test("v2 and other come back as they are", () => {
		for (const layout of [{ panels: V2 }, { panels: "nope" }]) {
			const input = {
				layout,
				settings: { messages: { composer: "quill" } }
			}
			const out = storedLayoutAsV2(input)
			expect(out.layout).toBe(input.layout)
			expect(out.settings).toBe(input.settings)
			expect(out.changed).toEqual({
				layout: false,
				settings: false,
				styles: false
			})
		}
	})

	test("never mutates its input, and a second call changes nothing", () => {
		const input = {
			layout: v1Layout({
				widgetSettings: {
					messages: { composer: "quill", nextUp: "list" }
				},
				widgetStyles: { messages: PIN }
			}),
			settings: { messages: { composer: "writer", hostCard: true } },
			styles: { messages: PIN }
		}
		const before = json(input)
		const once = storedLayoutAsV2(input, { dropStale: true })
		expect(input).toEqual(before)
		const twice = storedLayoutAsV2(once, { dropStale: true })
		expect(twice.changed).toEqual({
			layout: false,
			settings: false,
			styles: false
		})
		expect(twice.layout).toEqual(once.layout)
		expect(twice.settings).toEqual(once.settings)
		expect(twice.styles).toEqual(once.styles)

		for (const slots of [SLOTS, {}]) {
			const s = {
				layout: slots,
				settings: { messages: { composer: "quill" } }
			}
			const first = storedLayoutAsV2(s)
			expect(storedLayoutAsV2(first).changed).toEqual({
				layout: false,
				settings: false,
				styles: false
			})
		}
	})
})

describe("exportedSessionLayout", () => {
	test("v1 exports as v2, panels first, old slots stripped, settings split", () => {
		const out = exportedSessionLayout({
			...SLOTS,
			...v1Layout({ widgetSettings: { messages: { composer: "quill" } } })
		}) as any
		expect(Object.keys(out)[0]).toBe("panels")
		expect(out.panels.version).toBe(2)
		expect(out).not.toHaveProperty("zoneLayout")
		expect(out.widgetSettings).toEqual({
			messages: {},
			composer: { composer: "quill" }
		})
	})

	test("a floor-only old-slot layout keeps its old slots", () => {
		const out = exportedSessionLayout(FLOOR) as any
		expect(out.zoneLayout).toEqual(FLOOR.zoneLayout)
		expect(out.panels).toBeUndefined()
	})

	test("a v2 layout with inert old slots loses the slots and keeps its panels", () => {
		const out = exportedSessionLayout({ ...SLOTS, panels: V2 }) as any
		expect(out).not.toHaveProperty("zoneLayout")
		expect(out.panels).toEqual(V2)
	})

	test("a non-object is returned as it is", () => {
		expect(exportedSessionLayout(null)).toBeNull()
	})
})
