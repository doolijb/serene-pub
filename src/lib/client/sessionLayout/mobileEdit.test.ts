/**
 * The phone layout editor's model (./mobileEdit) — pure, so the whole
 * interaction is covered without a phone or a viewport.
 */
import { describe, expect, it } from "vitest"
import type { PanelLayoutV2, PanelV2 } from "@serene-pub/sdk"
import {
	MIDDLE_EMPTY,
	UNKNOWN_PANEL,
	UNKNOWN_TAB,
	samePanels,
	type ArrangeOutcome
} from "./arrangeOps"
import {
	NO_PANEL_ABOVE,
	NO_PANEL_BELOW,
	PHONE_SECTIONS,
	addAt,
	canSplitOut,
	duplicateTab,
	mintFor,
	moveRow,
	moveRowTo,
	moveTabInto,
	moveTabWithin,
	phoneRows,
	phoneSections,
	removeTabFrom,
	setRowHeight,
	setRowPriority,
	splitTab
} from "./mobileEdit"

const p = (
	key: string,
	tabs: string[],
	extra: Partial<PanelV2> = {}
): PanelV2 => ({ key, tabs, ...extra })

const base = (): PanelLayoutV2 => ({
	version: 2,
	left: [p("p3", ["chronicle", "lore-entries"]), p("p4", ["stats"])],
	middle: [
		p("p2", ["stats#world"], { height: "fit" }),
		p("p1", ["messages"]),
		p("p6", ["composer"])
	],
	right: [p("p5", ["authors-note"])]
})

function ok(out: ArrangeOutcome): PanelLayoutV2 {
	if (!out.layout) throw new Error(`refused: ${out.refused}`)
	return out.layout
}

describe("rows", () => {
	it("list Left · Middle · Right, one row per panel", () => {
		expect(PHONE_SECTIONS.map((s) => [s.place, s.label])).toEqual([
			["left", "Left"],
			["middle", "Middle"],
			["right", "Right"]
		])
		const sections = phoneSections(base())
		expect(sections.map((s) => s.label)).toEqual([
			"Left",
			"Middle",
			"Right"
		])
		expect(phoneRows(base()).map((r) => r.key)).toEqual([
			"p3",
			"p4",
			"p2",
			"p1",
			"p6",
			"p5"
		])
		expect(sections[0].rows[0].tabs).toEqual(["chronicle", "lore-entries"])
		expect(sections[1].rows.every((r) => r.place === "middle")).toBe(true)
	})
	it("carry the effective height and priority, a composer's reading fit / high with nothing stored", () => {
		const rows = Object.fromEntries(
			phoneRows(base()).map((r) => [r.key, r])
		)
		expect(base().middle[2]).toEqual({ key: "p6", tabs: ["composer"] })
		expect([rows.p6.height, rows.p6.priority]).toEqual(["fit", "high"])
		expect([rows.p2.height, rows.p2.priority]).toEqual(["fit", "normal"])
		expect([rows.p1.height, rows.p1.priority]).toEqual(["fill", "low"])
		expect([rows.p3.height, rows.p3.priority]).toEqual(["fill", "normal"])
	})
	it("read a share as fill", () => {
		const b = {
			...base(),
			left: [p("a", ["places"], { height: { share: 4 } })]
		}
		expect(phoneRows(b).find((r) => r.key === "a")?.height).toBe("fill")
	})
	it("carry a title when there is one", () => {
		const b = { ...base(), right: [p("t", ["places"], { title: "Named" })] }
		const rows = Object.fromEntries(phoneRows(b).map((r) => [r.key, r]))
		expect(rows.t.title).toBe("Named")
		expect(rows.p3).not.toHaveProperty("title")
	})
	it("know their neighbours within one zone", () => {
		const rows = Object.fromEntries(
			phoneRows(base()).map((r) => [r.key, r])
		)
		expect([rows.p2.aboveKey, rows.p2.belowKey]).toEqual([null, "p1"])
		expect([rows.p1.aboveKey, rows.p1.belowKey]).toEqual(["p2", "p6"])
		expect([rows.p3.aboveKey, rows.p3.belowKey]).toEqual([null, "p4"])
		expect([rows.p5.aboveKey, rows.p5.belowKey]).toEqual([null, null])
	})
	it("each section's Add is a new panel at the end of its zone", () => {
		expect(phoneSections(base()).map((s) => s.add)).toEqual([
			{ kind: "stack", place: "left" },
			{ kind: "stack", place: "middle" },
			{ kind: "stack", place: "right" }
		])
	})
})

describe("moving rows", () => {
	it("up and down within a zone", () => {
		expect(ok(moveRow(base(), "p4", -1)).left.map((x) => x.key)).toEqual([
			"p4",
			"p3"
		])
		expect(ok(moveRow(base(), "p2", 1)).middle.map((x) => x.key)).toEqual([
			"p1",
			"p2",
			"p6"
		])
		const rows = Object.fromEntries(
			phoneRows(base()).map((r) => [r.key, r])
		)
		expect([rows.p1.canMoveUp, rows.p1.canMoveDown]).toEqual([true, true])
	})
	it("the ends do not move, and never cross into another zone", () => {
		const b = base()
		expect(moveRow(b, "p3", -1).layout).toBe(b)
		expect(moveRow(b, "p4", 1).layout).toBe(b)
		expect(moveRow(b, "p2", -1).layout).toBe(b)
		expect(moveRow(b, "p6", 1).layout).toBe(b)
		expect(moveRow(b, "p5", 1).layout).toBe(b)
		expect(moveRow(b, "p3", 0).layout).toBe(b)
		const rows = Object.fromEntries(phoneRows(b).map((r) => [r.key, r]))
		expect([rows.p2.canMoveUp, rows.p2.canMoveDown]).toEqual([false, true])
		expect([rows.p5.canMoveUp, rows.p5.canMoveDown]).toEqual([false, false])
	})
	it("a step and back is where it began", () => {
		expect(
			samePanels(
				ok(moveRow(ok(moveRow(base(), "p2", 1)), "p2", -1)),
				base()
			)
		).toBe(true)
	})
	it("refuses an unknown row", () => {
		expect(moveRow(base(), "nope", 1).refused).toBe(UNKNOWN_PANEL)
		expect(moveRowTo(base(), "nope", 1).refused).toBe(UNKNOWN_PANEL)
	})
	it("a drag lands at an index within its zone, clamped", () => {
		const b: PanelLayoutV2 = {
			...base(),
			left: [p("a", ["x"]), p("b", ["y"]), p("c", ["z"])]
		}
		expect(ok(moveRowTo(b, "a", 2)).left.map((x) => x.key)).toEqual([
			"b",
			"c",
			"a"
		])
		expect(ok(moveRowTo(b, "c", 0)).left.map((x) => x.key)).toEqual([
			"c",
			"a",
			"b"
		])
		expect(ok(moveRowTo(b, "a", 99)).left.map((x) => x.key)).toEqual([
			"b",
			"c",
			"a"
		])
		expect(moveRowTo(b, "b", 1).layout).toBe(b)
	})
})

describe("Move into panel above / below", () => {
	it("merges a one-tab panel into the one above", () => {
		expect(ok(moveTabInto(base(), "stats", -1)).left).toEqual([
			p("p3", ["chronicle", "lore-entries", "stats"])
		])
	})
	it("moves one tab into the panel below, at its start", () => {
		expect(ok(moveTabInto(base(), "lore-entries", 1)).left).toEqual([
			p("p3", ["chronicle"]),
			p("p4", ["lore-entries", "stats"])
		])
	})
	it("works inside the middle", () => {
		const out = ok(moveTabInto(base(), "messages", 1))
		expect(out.middle).toEqual([
			p("p2", ["stats#world"], { height: "fit" }),
			p("p6", ["messages", "composer"])
		])
	})
	it("says so when there is no neighbour", () => {
		expect(moveTabInto(base(), "chronicle", -1).refused).toBe(
			NO_PANEL_ABOVE
		)
		expect(moveTabInto(base(), "authors-note", 1).refused).toBe(
			NO_PANEL_BELOW
		)
		expect(moveTabInto(base(), "stats#world", -1).refused).toBe(
			NO_PANEL_ABOVE
		)
		expect(moveTabInto(base(), "nope", 1).refused).toBe(UNKNOWN_TAB)
	})
})

describe("Split out", () => {
	it("gives a tab its own panel right after the one it leaves, in the same zone", () => {
		expect(ok(splitTab(base(), "chronicle")).left).toEqual([
			p("p3", ["lore-entries"]),
			p("p7", ["chronicle"]),
			p("p4", ["stats"])
		])
		const two = ok(
			addAt(base(), "places", { kind: "panel", panelKey: "p1" })
		)
		const out = ok(splitTab(two, "places"))
		expect(out.middle.map((x) => x.tabs)).toEqual([
			["stats#world"],
			["messages"],
			["places"],
			["composer"]
		])
	})
	it("is a no-op on a one-tab panel", () => {
		const b = base()
		expect(canSplitOut(b, "stats")).toBe(false)
		expect(canSplitOut(b, "chronicle")).toBe(true)
		expect(canSplitOut(b, "nope")).toBe(false)
		expect(splitTab(b, "stats").layout).toBe(b)
		expect(splitTab(b, "nope").refused).toBe(UNKNOWN_TAB)
	})
	it("undoes Move into panel above", () => {
		const split = ok(
			splitTab(ok(moveTabInto(base(), "stats", -1)), "stats")
		)
		expect(split.left.map((x) => x.tabs)).toEqual([
			["chronicle", "lore-entries"],
			["stats"]
		])
	})
})

describe("tabs inside a row", () => {
	it("reorder a step at a time", () => {
		expect(
			ok(moveTabWithin(base(), "lore-entries", -1)).left[0].tabs
		).toEqual(["lore-entries", "chronicle"])
		const b = base()
		expect(moveTabWithin(b, "chronicle", -1).layout).toBe(b)
		expect(moveTabWithin(b, "lore-entries", 1).layout).toBe(b)
		expect(moveTabWithin(b, "nope", 1).refused).toBe(UNKNOWN_TAB)
	})
})

describe("no lock", () => {
	it("Messages can be removed while the middle keeps a panel", () => {
		expect(
			ok(removeTabFrom(base(), "messages")).middle.map((x) => x.key)
		).toEqual(["p2", "p6"])
	})
	it("the middle is never empty", () => {
		const alone: PanelLayoutV2 = {
			...base(),
			middle: [p("p1", ["messages"])]
		}
		expect(removeTabFrom(alone, "messages").refused).toBe(MIDDLE_EMPTY)
	})
	it("a second Messages mints its own id", () => {
		expect(mintFor(base(), "messages")).toBe("messages#2")
	})
})

describe("Add, Duplicate, ×", () => {
	it("Add lands a new panel at the end of a zone", () => {
		expect(
			ok(
				addAt(base(), "places", { kind: "stack", place: "left" })
			).left.map((x) => x.key)
		).toEqual(["p3", "p4", "p7"])
		expect(
			ok(
				addAt(base(), "places", { kind: "stack", place: "middle" })
			).middle.at(-1)
		).toEqual(p("p7", ["places"]))
	})
	it("Add lands a tab in a panel", () => {
		expect(
			ok(addAt(base(), "places", { kind: "panel", panelKey: "p5" }))
				.right[0].tabs
		).toEqual(["authors-note", "places"])
	})
	it("Duplicate mints fresh and lands beside the source", () => {
		const copy = mintFor(base(), "chronicle", ["chronicle#2"], {
			fresh: true
		})
		expect(copy).toBe("chronicle#3")
		expect(
			ok(duplicateTab(base(), "chronicle", copy)).left[0].tabs
		).toEqual(["chronicle", "chronicle#3", "lore-entries"])
		expect(duplicateTab(base(), "nope", "x").refused).toBe(UNKNOWN_TAB)
	})
	it("× drops a panel it empties", () => {
		expect(ok(removeTabFrom(base(), "authors-note")).right).toEqual([])
	})
})

describe("height and priority", () => {
	it("Fit and Fill, stored only when they differ from the declaration", () => {
		expect(ok(setRowHeight(base(), "p4", "fit")).left[1].height).toBe("fit")
		expect(ok(setRowHeight(base(), "p6", "fill")).middle[2].height).toBe(
			"fill"
		)
		const b = base()
		expect(setRowHeight(b, "p6", "fit").layout).toBe(b)
		expect(setRowHeight(b, "p4", "fill").layout).toBe(b)
	})
	it("a priority row change", () => {
		const low = ok(setRowPriority(base(), "p6", "low"))
		expect(phoneRows(low).find((r) => r.key === "p6")?.priority).toBe("low")
		const b = base()
		expect(setRowPriority(b, "p6", "high").layout).toBe(b)
		expect(ok(setRowPriority(b, "p4", "high")).left[1].priority).toBe(
			"high"
		)
		expect(setRowPriority(b, "nope", "high").refused).toBe(UNKNOWN_PANEL)
	})
})
