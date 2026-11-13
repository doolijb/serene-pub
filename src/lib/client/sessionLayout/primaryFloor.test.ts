/**
 * The primary floor — since R-B (owner review 2026-10-14, no lock) only a
 * CONVERTER's rule: a blob with no stored `panels` gets its genre's primary
 * when the old slots placed none; stored panels are read as stored, a layout
 * with no conversation included. Over panels v2 (PLAN 2026-11-05): three flat
 * stacks, no primary panel.
 */
import { describe, expect, test } from "vitest"
import {
	type PanelLayoutV1,
	type PanelLayoutV2,
	type PanelV2,
	primaryPlaced,
	type SessionLayoutV1
} from "@serene-pub/sdk"
import {
	drawnIdsOf,
	drawnOf,
	primaryInstances,
	readStoredLayout,
	withPrimaryFloor
} from "./primaryFloor"

/** A v2 panel layout: a panel per id in each zone, keys p1… in order. */
function panels(
	o: { middle?: string[]; left?: string[]; right?: string[] } = {}
): PanelLayoutV2 {
	let n = 0
	const one = (id: string): PanelV2 => ({ key: `p${++n}`, tabs: [id] })
	const middle = (o.middle ?? ["messages"]).map(one)
	return {
		version: 2,
		left: (o.left ?? []).map(one),
		middle,
		right: (o.right ?? []).map(one)
	}
}

const ids = (list: PanelV2[]) => list.map((p) => p.tabs)

describe("withPrimaryFloor — fires only when no instance is placed anywhere", () => {
	test("Messages in the middle: returned by reference", () => {
		const p = panels()
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("Messages in a side panel: nothing is added — the move is honoured", () => {
		const p = panels({ middle: ["stats"], left: ["messages"] })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("Messages as a second tab: placed", () => {
		const p: PanelLayoutV2 = {
			...panels({ middle: [] }),
			middle: [{ key: "p1", tabs: ["stats", "messages"] }]
		}
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("any instance satisfies it — the Lair's Sanctum copy alone included", () => {
		const p = panels({ middle: ["stats"], right: ["messages#sanctum"] })
		expect(withPrimaryFloor(p, "messages")).toBe(p)
	})

	test("none placed: the bare primary leads the middle, under a fresh key", () => {
		const p = panels({ middle: ["stats", "places"] })
		const out = withPrimaryFloor(p, "messages")
		expect(ids(out.middle)).toEqual([["messages"], ["stats"], ["places"]])
		expect(out.middle[0].key).toBe("p3")
		expect(primaryPlaced({ panels: out }, "messages")).toBe(true)
		expect(out.middle.slice(1)).toEqual(p.middle)
	})

	test("an R71 genre's own primary is the floor there", () => {
		const out = withPrimaryFloor(panels({ middle: ["stats"] }), "battleship:board")
		expect(ids(out.middle)[0]).toEqual(["battleship:board"])
	})
})

describe("drawnIdsOf — placed means drawn, never merely named", () => {
	test("reading order: the middle, the left, the right", () => {
		const layout: SessionLayoutV1 = {
			panels: panels({
				middle: ["places", "messages", "album"],
				left: ["chronicle"],
				right: ["stats"]
			})
		}
		expect(drawnIdsOf(layout)).toEqual(["places", "messages", "album", "chronicle", "stats"])
	})

	test("a retired widget's tab is named, never drawn", () => {
		const layout: SessionLayoutV1 = {
			panels: {
				...panels(),
				right: [{ key: "r", tabs: ["inventory", "stats"] }]
			}
		}
		expect(drawnIdsOf(layout)).toEqual(["messages", "stats"])
	})

	test("an instance is drawn once, in its first panel in reading order", () => {
		const layout: SessionLayoutV1 = { panels: panels({ left: ["stats"], right: ["stats"] }) }
		expect(drawnIdsOf(layout)).toEqual(["messages", "stats"])
	})
})

describe("drawnOf / readStoredLayout — the SDK's one reader (C5)", () => {
	test("drawnOf is resolveDrawn: panels, the tab shown, height and priority", () => {
		const d = drawnOf({
			panels: {
				...panels(),
				right: [{ key: "r", tabs: ["stats", "places"], open: "places" }]
			}
		})
		const r = d.right.panels[0]
		expect([r.key, r.open, r.tabs.map((t) => t.instanceId)]).toEqual([
			"r",
			"places",
			["stats", "places"]
		])
		expect(d.middle.panels.map((p) => p.open)).toEqual(["messages"])
		expect(r.priority).toBe("normal")
	})

	test("drawnOf hands the declared defaults through", () => {
		const d = drawnOf(
			{ panels: panels() },
			{ inline: 0 },
			{ widgets: [{ id: "messages", panel: { height: "fit", priority: "high" } }] }
		)
		expect([d.middle.panels[0].height, d.middle.panels[0].priority]).toEqual(["fit", "high"])
	})

	test("a stored blob with only the old slots reads as panels, floored", () => {
		const read = readStoredLayout({
			zoneLayout: {
				version: 1,
				zones: { right: { kind: "side", side: "right", widgets: ["stats"] } }
			}
		})
		expect(read.panels.version).toBe(2)
		expect(read.panels.middle[0].tabs).toEqual(["messages"])
		expect(ids(read.panels.right)).toEqual([["stats"]])
		expect("zoneLayout" in read).toBe(false)
	})

	test("a stored version 1 blob is read as version 2", () => {
		const v1: PanelLayoutV1 = {
			version: 1,
			left: [],
			right: [{ key: "p2", tabs: ["stats"] }],
			middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] }
		}
		const read = readStoredLayout({ panels: v1 })
		expect(read.panels.version).toBe(2)
		expect(drawnIdsOf(read)).toContain("messages")
		expect(drawnIdsOf(read)).toContain("stats")
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
			expect(primaryPlaced(read, "messages")).toBe(true)
			expect(drawnIdsOf(read)).toContain("messages")
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

	test("withholding Messages drops the Composer and Turn line with it; others stay", () => {
		const read = readStoredLayout(
			{
				panels: panels({
					middle: ["messages", "turn-line", "composer", "places"],
					right: ["stats"]
				})
			},
			"battleship:board",
			new Set(["messages"])
		)
		expect(drawnIdsOf(read)).toEqual(["places", "stats"])
	})

	test("withholding another widget keeps the Composer", () => {
		const read = readStoredLayout(
			{ panels: panels({ middle: ["messages", "composer", "places"] }) },
			"messages",
			new Set(["places"])
		)
		expect(drawnIdsOf(read)).toEqual(["messages", "composer"])
	})

	test("a converted blob with a non-Messages primary loses the converter's floor conversation, Composer and Turn line", () => {
		const read = readStoredLayout(
			{
				zoneLayout: {
					version: 1,
					zones: { right: { kind: "side", side: "right", widgets: ["stats"] } }
				}
			},
			"battleship:board",
			new Set(["messages"])
		)
		expect(drawnIdsOf(read)).toEqual(["battleship:board", "stats"])
	})

	test("a converted blob with a non-Messages primary, Messages not withheld: the floor conversation goes, the board leads", () => {
		const read = readStoredLayout(
			{ zoneLayout: { version: 1, zones: {} } },
			"battleship:board"
		)
		expect(drawnIdsOf(read)).toEqual(["battleship:board"])
	})

	test("a converted blob with Messages as its primary keeps the converter's conversation and its pair", () => {
		const read = readStoredLayout({ zoneLayout: { version: 1, zones: {} } })
		expect(drawnIdsOf(read)).toEqual(["messages", "turn-line", "composer"])
	})

	test("omitting the whole middle of a stored layout floors the genre's primary", () => {
		const read = readStoredLayout(
			{ panels: panels({ right: ["stats"] }) },
			"battleship:board",
			new Set(["messages"])
		)
		expect(read.panels.middle.map((p) => p.tabs)).toEqual([["battleship:board"]])
	})
})

describe("a stored layout holding no conversation (R-B, no lock)", () => {
	test("stored panels are read as stored: no floor, the middle holds what it holds", () => {
		const read = readStoredLayout({ panels: panels({ middle: ["places"], right: ["stats"] }) })
		expect(ids(read.panels.middle)).toEqual([["places"]])
		expect(drawnIdsOf(read)).toEqual(["places", "stats"])
		expect(primaryPlaced(read, "messages")).toBe(false)
	})

	test("the conversation moved to a side stays there; nothing is added in the middle", () => {
		const read = readStoredLayout({ panels: panels({ middle: ["stats"], left: ["messages"] }) })
		expect(drawnIdsOf(read)).toEqual(["stats", "messages"])
	})

	test("a converted blob (old slots only) still gets the floor", () => {
		const read = readStoredLayout({
			zoneLayout: { version: 1, zones: { left: { kind: "side", side: "left", widgets: ["stats"] } } }
		})
		expect(drawnIdsOf(read)).toContain("messages")
		expect(drawnIdsOf(read)).toContain("stats")
	})
})

describe("primaryInstances", () => {
	test("the bare id and every #name copy", () => {
		expect(primaryInstances(["messages", "stats", "messages#a"], "messages")).toEqual([
			"messages",
			"messages#a"
		])
	})
})
