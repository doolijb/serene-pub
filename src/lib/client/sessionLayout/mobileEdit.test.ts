/**
 * The phone layout editor's model (./mobileEdit) — pure, so the whole
 * interaction is covered without a phone or a viewport.
 */
import { describe, expect, it } from "vitest"
import type { PanelLayoutV1, PanelV1 } from "@serene-pub/sdk"
import { MIDDLE_EMPTY, samePanels, type ArrangeOutcome } from "./arrangeOps"
import {
	NO_PANEL_ABOVE,
	NO_PANEL_BELOW,
	addAt,
	canSplitOut,
	duplicateTab,
	makeMain,
	mintFor,
	moveRow,
	moveRowTo,
	moveTabInto,
	moveTabWithin,
	phoneRows,
	phoneSections,
	removeTabFrom,
	setRowHeight,
	splitTab
} from "./mobileEdit"

const p = (key: string, tabs: string[], extra: Partial<PanelV1> = {}): PanelV1 => ({ key, tabs, ...extra })

const base = (): PanelLayoutV1 => ({
	version: 1,
	left: [p("p3", ["chronicle", "lore-entries"]), p("p4", ["stats"])],
	middle: { above: [p("p2", ["stats#world"], { height: "fit" })], primary: p("p1", ["messages"]), below: [] },
	right: [p("p5", ["authors-note"], { pinned: false })]
})

function ok(out: ArrangeOutcome): PanelLayoutV1 {
	if (!out.layout) throw new Error(`refused: ${out.refused}`)
	return out.layout
}

describe("rows", () => {
	it("list Above · Middle · Below · Left · Right, one row per panel", () => {
		const sections = phoneSections(base())
		expect(sections.map((s) => s.label)).toEqual(["Above", "Middle", "Below", "Left", "Right"])
		expect(phoneRows(base()).map((r) => r.key)).toEqual(["p2", "p1", "p3", "p4", "p5"])
		expect(sections[3].rows[0].tabs).toEqual(["chronicle", "lore-entries"])
	})
	it("carry a group on side rows only", () => {
		const rows = phoneRows(base())
		const group = Object.fromEntries(rows.map((r) => [r.key, r.group]))
		expect(group).toEqual({ p2: null, p1: null, p3: "docked", p4: "docked", p5: "rail" })
	})
	it("split each side into Docked then In the rail, an empty group still listed", () => {
		const sections = phoneSections(base())
		expect(sections[0].groups).toBeNull()
		expect(sections[1].groups).toBeNull()
		const left = sections[3].groups!
		expect(left.map((g) => [g.label, g.rows.map((r) => r.key)])).toEqual([
			["Docked", ["p3", "p4"]],
			["In the rail", []]
		])
		const right = sections[4].groups!
		expect(right.map((g) => [g.group, g.rows.map((r) => r.key)])).toEqual([
			["docked", []],
			["rail", ["p5"]]
		])
	})
	it("read docked before rail whatever the stack order", () => {
		const b: PanelLayoutV1 = { ...base(), left: [p("r", ["x"], { pinned: false }), p("d", ["y"])] }
		expect(phoneSections(b)[3].rows.map((r) => r.key)).toEqual(["d", "r"])
		const rows = Object.fromEntries(phoneRows(b).map((r) => [r.key, r]))
		expect([rows.d.belowKey, rows.r.aboveKey]).toEqual(["r", "d"])
	})
	it("offer Make main on every row but the primary", () => {
		const main = Object.fromEntries(phoneRows(base()).map((r) => [r.key, r.canMakeMain]))
		expect(main).toEqual({ p2: true, p1: false, p3: true, p4: true, p5: true })
	})
	it("carry a height everywhere but the primary", () => {
		const h = Object.fromEntries(phoneRows(base()).map((r) => [r.key, r.height]))
		expect(h).toEqual({ p2: "fit", p1: null, p3: "fill", p4: "fill", p5: "fill" })
	})
	it("know their neighbours within one column", () => {
		const rows = Object.fromEntries(phoneRows(base()).map((r) => [r.key, r]))
		expect([rows.p2.aboveKey, rows.p2.belowKey]).toEqual([null, "p1"])
		expect([rows.p1.aboveKey, rows.p1.belowKey]).toEqual(["p2", null])
		expect([rows.p3.aboveKey, rows.p3.belowKey]).toEqual([null, "p4"])
		expect([rows.p5.aboveKey, rows.p5.belowKey]).toEqual([null, null])
	})
	it("each section's Add lands where it says", () => {
		const adds = phoneSections(base()).map((s) => s.add)
		expect(adds[1]).toEqual({ kind: "panel", panelKey: "p1" })
		expect(adds[3]).toEqual({ kind: "stack", place: "left" })
	})
})

describe("moving rows", () => {
	it("up and down within a side", () => {
		const out = ok(moveRow(base(), "p4", -1))
		expect(out.left.map((x) => x.key)).toEqual(["p4", "p3"])
		const b = base()
		expect(moveRow(b, "p3", -1).layout).toBe(b)
	})
	it("a strip crosses the primary", () => {
		const down = ok(moveRow(base(), "p2", 1))
		expect(down.middle.above).toEqual([])
		expect(down.middle.below.map((x) => x.key)).toEqual(["p2"])
		const back = ok(moveRow(down, "p2", -1))
		expect(samePanels(back, base())).toBe(true)
	})
	it("the primary does not move", () => {
		const b = base()
		expect(moveRow(b, "p1", 1).layout).toBe(b)
		expect(phoneRows(b).find((r) => r.key === "p1")).toMatchObject({ canMoveUp: false, canMoveDown: false })
	})
	it("a drag lands at an index, a step at a time", () => {
		const b: PanelLayoutV1 = { ...base(), left: [p("a", ["x"]), p("b", ["y"]), p("c", ["z"])] }
		expect(ok(moveRowTo(b, "a", 2)).left.map((x) => x.key)).toEqual(["b", "c", "a"])
	})
})

describe("the side groups", () => {
	const two = (): PanelLayoutV1 => ({
		...base(),
		left: [p("d1", ["a"]), p("d2", ["b"]), p("r1", ["c"], { pinned: false }), p("r2", ["d"], { pinned: false })]
	})
	const keys = (l: PanelLayoutV1) =>
		phoneSections(l)[3].groups!.map((g) => g.rows.map((r) => r.key))
	it("up / down within a group reorder it", () => {
		expect(keys(ok(moveRow(two(), "d2", -1)))).toEqual([["d2", "d1"], ["r1", "r2"]])
		expect(keys(ok(moveRow(two(), "r1", 1)))).toEqual([["d1", "d2"], ["r2", "r1"]])
	})
	it("down from the last docked row goes first in the rail", () => {
		const out = ok(moveRow(two(), "d2", 1))
		expect(keys(out)).toEqual([["d1"], ["d2", "r1", "r2"]])
		expect(out.left.find((x) => x.key === "d2")?.pinned).toBe(false)
	})
	it("up from the first rail row docks it last", () => {
		const out = ok(moveRow(two(), "r1", -1))
		expect(keys(out)).toEqual([["d1", "d2", "r1"], ["r2"]])
		expect(out.left.find((x) => x.key === "r1")).not.toHaveProperty("pinned")
	})
	it("the ends do not move", () => {
		const b = two()
		expect(moveRow(b, "d1", -1).layout).toBe(b)
		expect(moveRow(b, "r2", 1).layout).toBe(b)
		const rows = Object.fromEntries(phoneRows(b).map((r) => [r.key, r]))
		expect([rows.d2.canMoveDown, rows.r1.canMoveUp]).toEqual([true, true])
	})
	it("a drag crosses the boundary a step at a time", () => {
		expect(keys(ok(moveRowTo(two(), "d1", 3)))).toEqual([["d2"], ["r1", "r2", "d1"]])
		expect(keys(ok(moveRowTo(two(), "r2", 0)))).toEqual([["r2", "d1", "d2"], ["r1"]])
	})
	it("an all-rail side is an empty Docked group; up docks its first row", () => {
		const b = base()
		expect(keys({ ...b, left: [p("r", ["x"], { pinned: false })] })).toEqual([[], ["r"]])
		const out = ok(moveRow(b, "p5", -1))
		expect(out.right).toEqual([p("p5", ["authors-note"])])
	})
	it("the last docked row may go to the rail, leaving Docked empty", () => {
		const one: PanelLayoutV1 = { ...base(), left: [p("d", ["x"])] }
		const out = ok(moveRow(one, "d", 1))
		expect(out.left).toEqual([p("d", ["x"], { pinned: false })])
	})
})

describe("Make main", () => {
	it("a strip becomes the primary; the old primary goes to the end of Above", () => {
		const out = ok(makeMain(base(), "p2"))
		expect(out.middle.primary).toEqual(p("p2", ["stats#world"]))
		expect(out.middle.above).toEqual([p("p1", ["messages"])])
	})
	it("a side row moves into the middle and loses its rail and height", () => {
		const out = ok(makeMain(base(), "p5"))
		expect(out.right).toEqual([])
		expect(out.middle.primary).toEqual(p("p5", ["authors-note"]))
		expect(out.middle.above.map((x) => x.key)).toEqual(["p2", "p1"])
	})
	it("the primary already is main", () => {
		const b = base()
		expect(makeMain(b, "p1").layout).toBe(b)
	})
})

describe("Move into panel above / below", () => {
	it("merges a one-tab panel into the one above", () => {
		const out = ok(moveTabInto(base(), "stats", -1))
		expect(out.left).toEqual([p("p3", ["chronicle", "lore-entries", "stats"])])
	})
	it("moves one tab into the panel below, at its start", () => {
		const out = ok(moveTabInto(base(), "lore-entries", 1))
		expect(out.left).toEqual([p("p3", ["chronicle"]), p("p4", ["lore-entries", "stats"])])
	})
	it("a strip moves into the primary", () => {
		const out = ok(moveTabInto(base(), "stats#world", 1))
		expect(out.middle.above).toEqual([])
		expect(out.middle.primary.tabs).toEqual(["stats#world", "messages"])
	})
	it("says so when there is no neighbour", () => {
		expect(moveTabInto(base(), "chronicle", -1).refused).toBe(NO_PANEL_ABOVE)
		expect(moveTabInto(base(), "authors-note", 1).refused).toBe(NO_PANEL_BELOW)
	})
	it("the primary's last tab leaves by promotion", () => {
		const out = ok(moveTabInto(base(), "messages", -1))
		expect(out.middle.above).toEqual([])
		expect(out.middle.primary).toEqual(p("p2", ["stats#world", "messages"]))
	})
	it("the primary's last tab moves into the panel below; the one above is promoted", () => {
		const b: PanelLayoutV1 = { ...base(), middle: { ...base().middle, below: [p("p9", ["places"])] } }
		const out = ok(moveTabInto(b, "messages", 1))
		expect(out.middle.primary).toEqual(p("p2", ["stats#world"]))
		expect(out.middle.below).toEqual([p("p9", ["messages", "places"])])
	})
})

describe("Split out", () => {
	it("gives a tab its own panel right after the one it leaves", () => {
		const out = ok(splitTab(base(), "chronicle"))
		expect(out.left).toEqual([p("p3", ["lore-entries"]), p("p6", ["chronicle"]), p("p4", ["stats"])])
	})
	it("a tab of the primary lands first below", () => {
		const two = ok(addAt(base(), "places", { kind: "panel", panelKey: "p1" }))
		const out = ok(splitTab(two, "places"))
		expect(out.middle.primary.tabs).toEqual(["messages"])
		expect(out.middle.below).toEqual([{ ...p("p6", ["places"]), height: "fit" }])
	})
	it("is a no-op on a one-tab panel", () => {
		const b = base()
		expect(canSplitOut(b, "stats")).toBe(false)
		expect(canSplitOut(b, "chronicle")).toBe(true)
		expect(splitTab(b, "stats").layout).toBe(b)
	})
	it("undoes Move into panel above", () => {
		const merged = ok(moveTabInto(base(), "stats", -1))
		const split = ok(splitTab(merged, "stats"))
		expect(split.left.map((x) => x.tabs)).toEqual([["chronicle", "lore-entries"], ["stats"]])
	})
})

describe("tabs inside a row", () => {
	it("reorder a step at a time", () => {
		const out = ok(moveTabWithin(base(), "lore-entries", -1))
		expect(out.left[0].tabs).toEqual(["lore-entries", "chronicle"])
		const b = base()
		expect(moveTabWithin(b, "chronicle", -1).layout).toBe(b)
	})
})

describe("no lock", () => {
	it("Messages can be removed; the strip above is promoted", () => {
		const out = ok(removeTabFrom(base(), "messages"))
		expect(out.middle.primary).toEqual(p("p2", ["stats#world"]))
		expect(out.middle.above).toEqual([])
	})
	it("the middle is never empty", () => {
		const alone: PanelLayoutV1 = { ...base(), middle: { above: [], primary: p("p1", ["messages"]), below: [] } }
		expect(removeTabFrom(alone, "messages").refused).toBe(MIDDLE_EMPTY)
		expect(moveTabInto(alone, "messages", 1).refused).toBeTruthy()
	})
	it("a second Messages mints its own id", () => {
		expect(mintFor(base(), "messages")).toBe("messages#2")
	})
})

describe("Add, Duplicate, ×", () => {
	it("Add lands a new panel at the end of a stack", () => {
		const out = ok(addAt(base(), "places", { kind: "stack", place: "left" }))
		expect(out.left.map((x) => x.key)).toEqual(["p3", "p4", "p6"])
	})
	it("Add lands a tab in a panel", () => {
		const out = ok(addAt(base(), "places", { kind: "panel", panelKey: "p5" }))
		expect(out.right[0].tabs).toEqual(["authors-note", "places"])
	})
	it("Duplicate mints fresh and lands beside the source", () => {
		const copy = mintFor(base(), "chronicle", ["chronicle#2"], { fresh: true })
		expect(copy).toBe("chronicle#3")
		const out = ok(duplicateTab(base(), "chronicle", copy))
		expect(out.left[0].tabs).toEqual(["chronicle", "chronicle#3", "lore-entries"])
	})
	it("× drops a panel it empties", () => {
		const out = ok(removeTabFrom(base(), "authors-note"))
		expect(out.right).toEqual([])
	})
})

describe("height", () => {
	it("Fit and Fill", () => {
		expect(ok(setRowHeight(base(), "p4", "fit")).left[1].height).toBe("fit")
		expect(ok(setRowHeight(base(), "p2", "fill")).middle.above[0]).not.toHaveProperty("height")
	})
})
