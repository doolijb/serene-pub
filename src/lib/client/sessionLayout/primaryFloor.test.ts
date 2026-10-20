/**
 * The primary floor — since R-B (owner review 2026-10-14, no lock) only a
 * CONVERTER's rule: a blob with no stored `panels` gets its genre's primary
 * when the old slots placed none; stored panels are read as stored, a layout
 * with no conversation included. Over panels (PLAN-session-panels-2026-10-14).
 */
import { describe, expect, test } from "vitest"
import {
	type PanelLayoutV1,
	type PanelV1,
	primaryPlaced,
	type SessionLayoutV1
} from "@serene-pub/sdk"
import {
	drawnIdsOf,
	drawnOf,
	readStoredLayout,
	withPrimaryFilled,
	withPrimaryFloor
} from "./primaryFloor"

/** A panel layout: the primary's tabs, and a panel per id on each side. */
function panels(
	o: {
		primary?: string[]
		above?: string[]
		below?: string[]
		left?: string[]
		right?: string[]
	} = {}
): PanelLayoutV1 {
	let n = 1
	const one = (id: string): PanelV1 => ({ key: `p${++n}`, tabs: [id] })
	return {
		version: 1,
		middle: {
			above: (o.above ?? []).map(one),
			primary: { key: "p1", tabs: o.primary ?? ["messages"] },
			below: (o.below ?? []).map(one)
		},
		left: (o.left ?? []).map(one),
		right: (o.right ?? []).map(one)
	}
}

describe("withPrimaryFloor — fires only when no instance is placed anywhere", () => {
	test("Messages as the primary panel: returned by reference", () => {
		const p = panels()
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("Messages in a side panel: nothing is added — the move is honoured", () => {
		const p = panels({ primary: ["stats"], left: ["messages"] })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("Messages as a strip, or a second tab: placed", () => {
		const strip = panels({ primary: ["stats"], below: ["messages"] })
		expect(withPrimaryFloor(strip, "messages")).toBe(strip)
		const tab = panels({ primary: ["stats", "messages"] })
		expect(withPrimaryFloor(tab, "messages")).toBe(tab)
	})

	test("any instance satisfies it — the Lair's Sanctum copy alone included", () => {
		const p = panels({ primary: ["stats"], right: ["messages#sanctum"] })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("none placed: the bare primary fills the middle, and the old primary moves up, fit", () => {
		const out = withPrimaryFloor(panels({ primary: ["stats"], above: ["places"] }), "messages")
		expect(out.middle.primary.tabs).toEqual(["messages"])
		expect(out.middle.above.map((p) => [p.tabs, p.height])).toEqual([
			[["places"], undefined],
			[["stats"], "fit"]
		])
		// A fresh key: none of the layout's own.
		expect(out.middle.primary.key).toBe("p3")
		expect(primaryPlaced({ panels: out }, "messages")).toBe(true)
	})

	test("an old primary that draws nothing (a retired widget) is not kept", () => {
		const out = withPrimaryFloor(panels({ primary: ["inventory"] }), "messages")
		expect(out.middle.above).toEqual([])
		expect(out.middle.primary.tabs).toEqual(["messages"])
	})

	test("an R71 genre's own primary is the floor there", () => {
		const out = withPrimaryFloor(panels({ primary: ["stats"] }), "battleship:board")
		expect(out.middle.primary.tabs).toEqual(["battleship:board"])
	})
})

describe("drawnIdsOf — placed means drawn, never merely named", () => {
	test("reading order: the middle (above, primary, below), the left, the right", () => {
		const layout: SessionLayoutV1 = {
			panels: panels({ above: ["places"], below: ["album"], left: ["chronicle"], right: ["stats"] })
		}
		expect(drawnIdsOf(layout)).toEqual(["places", "messages", "album", "chronicle", "stats"])
	})

	test("a retired widget's tab is named, never drawn", () => {
		const layout: SessionLayoutV1 = { panels: panels({ right: ["inventory", "stats"] }) }
		expect(drawnIdsOf(layout)).toEqual(["messages", "stats"])
	})

	test("an instance is drawn once, in its first panel in reading order", () => {
		const layout: SessionLayoutV1 = { panels: panels({ left: ["stats"], right: ["stats"] }) }
		expect(drawnIdsOf(layout)).toEqual(["messages", "stats"])
	})
})

describe("drawnOf / readStoredLayout — the SDK's one reader (C5)", () => {
	test("drawnOf is resolveDrawn: panels, the tab shown and one pin each", () => {
		const d = drawnOf(
			{
				panels: {
					...panels(),
					right: [{ key: "r", tabs: ["stats", "places"], open: "places", pinned: false }]
				}
			},
			{ inline: 1300 }
		)
		const r = d.right.panels[0]
		expect([r.key, r.open, r.pinned, r.tabs.map((t) => t.instanceId)]).toEqual([
			"r",
			"places",
			false,
			["stats", "places"]
		])
		expect(d.middle.primary.tabs.map((t) => t.instanceId)).toEqual(["messages"])
	})

	test("a stored blob with only the old slots reads as panels, floored", () => {
		const read = readStoredLayout({
			zoneLayout: {
				version: 1,
				zones: { right: { kind: "side", side: "right", widgets: ["stats"] } }
			}
		})
		expect(read.panels!.middle.primary.tabs).toEqual(["messages"])
		expect(read.panels!.right.map((p) => p.tabs)).toEqual([["stats"]])
		expect("zoneLayout" in read).toBe(false)
	})

	test("stored panels are the whole truth: old slots beside them are not read", () => {
		const read = readStoredLayout({
			panels: panels({ right: ["places"] }),
			zoneLayout: {
				version: 1,
				zones: { right: { kind: "side", side: "right", widgets: ["stats"] } }
			}
		})
		expect(drawnIdsOf(read)).toEqual(["messages", "places"])
	})

	test("anything that is not an object reads as a layout that saved nothing", () => {
		for (const junk of [null, 7, "x", []]) {
			const read = readStoredLayout(junk)
			expect(drawnIdsOf(read)).toEqual(["messages"])
		}
	})

	test("settings and style pins travel with it", () => {
		const read = readStoredLayout({
			panels: panels(),
			widgetSettings: { messages: { order: "newest" } },
			widgetStyles: { messages: { slug: "novel" } }
		})
		expect(read.widgetSettings).toEqual({ messages: { order: "newest" } })
		expect(read.widgetStyles).toEqual({ messages: { slug: "novel" } })
	})

	test("a genre that withholds a widget (R71) never draws it, and its own primary is floored", () => {
		const read = readStoredLayout(
			{ panels: panels({ right: ["stats"] }) },
			"battleship:board",
			new Set(["messages"])
		)
		expect(drawnIdsOf(read)).toEqual(["battleship:board", "stats"])
	})
})


describe("a stored layout holding no conversation (R-B, no lock)", () => {
	test("stored panels are read as stored: no floor, the primary holds what it holds", () => {
		const read = readStoredLayout({ panels: panels({ primary: ["places"], right: ["stats"] }) })
		expect(read.panels!.middle.primary.tabs).toEqual(["places"])
		expect(drawnIdsOf(read)).toEqual(["places", "stats"])
		expect(primaryPlaced(read, "messages")).toBe(false)
	})

	test("the conversation moved to a side stays there; nothing is added in the middle", () => {
		const read = readStoredLayout({ panels: panels({ primary: ["stats"], left: ["messages"] }) })
		expect(drawnIdsOf(read)).toEqual(["stats", "messages"])
	})

	test("an empty primary with strips is not floored either (the live view fills it, `withPrimaryFilled`)", () => {
		const read = readStoredLayout({ panels: panels({ primary: [], above: ["places"] }) })
		expect(read.panels!.middle.primary.tabs).toEqual([])
		expect(drawnIdsOf(read)).toEqual(["places"])
	})

	test("a converted blob (old slots only) still gets the floor", () => {
		const read = readStoredLayout({
			zoneLayout: { version: 1, zones: { left: { kind: "side", side: "left", widgets: ["stats"] } } }
		})
		expect(drawnIdsOf(read)).toEqual(["messages", "stats"])
	})
})

describe("withPrimaryFilled — the primary is a place, never left blank while the middle holds something", () => {
	const P = (key: string, tabs: string[]) => ({ key, tabs })
	test("a primary with tabs: returned by reference", () => {
		const m = { above: [P("a", ["x"])], primary: P("p", ["map"]), below: [] }
		expect(withPrimaryFilled(m)).toBe(m)
	})

	test("an empty primary takes the nearest: the last above, else the first below", () => {
		const up = withPrimaryFilled({ above: [P("a1", ["x"]), P("a2", ["y"])], primary: P("p", []), below: [P("b1", ["z"])] })
		expect([up.above.map((p) => p.key), up.primary.key, up.below.map((p) => p.key)]).toEqual([["a1"], "a2", ["b1"]])
		const down = withPrimaryFilled({ above: [], primary: P("p", []), below: [P("b1", ["z"]), P("b2", ["w"])] })
		expect([down.above.length, down.primary.key, down.below.map((p) => p.key)]).toEqual([0, "b1", ["b2"]])
	})

	test("nothing in the middle at all: returned as it is", () => {
		const m = { above: [], primary: P("p", []), below: [] }
		expect(withPrimaryFilled(m)).toBe(m)
	})
})
