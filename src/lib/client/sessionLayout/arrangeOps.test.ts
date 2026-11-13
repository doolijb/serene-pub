/**
 * The layout editor's pure panel ops (./arrangeOps), shared by the desktop
 * and phone editors. Every op answers a new `PanelLayoutV2` or a refusal, and
 * no sequence of them may break the rules: a panel holds a tab, and the
 * middle is never empty.
 */
import { describe, expect, it } from "vitest"
import type { PanelLayoutV2, PanelV2 } from "@serene-pub/sdk"
import {
	DEFAULT_PANEL_LOOK,
	panelsOf,
	validateSessionLayout
} from "@serene-pub/sdk"
import {
	STORY_WORLD_LAYOUT,
	STORY_LAYOUT,
	LAIR_LAYOUT
} from "@serene-pub/core-catalog"
import {
	ALREADY_PLACED,
	MIDDLE_EMPTY,
	UNKNOWN_PANEL,
	UNKNOWN_TAB,
	addTab,
	allPanels,
	declaredPanelOf,
	heightOf,
	isStackPlace,
	lookOf,
	moveTab,
	movePanel,
	newPanel,
	nextPanelKey,
	panelOfTab,
	placedIds,
	priorityOf,
	removeRefusal,
	removeTab,
	samePanels,
	setHeight,
	setLook,
	setPriority,
	setTabOrder,
	setTitle,
	splitOut,
	stackOf,
	type ArrangeOutcome,
	type StackPlace
} from "./arrangeOps"

const p = (
	key: string,
	tabs: string[],
	extra: Partial<PanelV2> = {}
): PanelV2 => ({ key, tabs, ...extra })

/** Messages and a strip in the middle, two panels left, one right. */
const base = (): PanelLayoutV2 => ({
	version: 2,
	left: [p("p3", ["chronicle", "lore-entries"]), p("p4", ["stats"])],
	middle: [p("p2", ["stats#world"]), p("p1", ["messages"])],
	right: [p("p5", ["authors-note"])]
})

/** Only Messages in the middle. */
const lone = (): PanelLayoutV2 => ({
	...base(),
	middle: [p("p1", ["messages"])]
})

function ok(out: ArrangeOutcome): PanelLayoutV2 {
	if (!out.layout) throw new Error(`refused: ${out.refused}`)
	return out.layout
}

describe("readers", () => {
	it("isStackPlace is the three zones", () => {
		for (const place of ["left", "middle", "right"] as const)
			expect(isStackPlace(place)).toBe(true)
		for (const place of ["above", "primary", "below"] as const)
			expect(isStackPlace(place)).toBe(false)
	})
	it("stackOf and allPanels read left, middle, right", () => {
		expect(stackOf(base(), "middle").map((x) => x.key)).toEqual([
			"p2",
			"p1"
		])
		expect(
			allPanels(base()).map(({ panel, place }) => [panel.key, place])
		).toEqual([
			["p3", "left"],
			["p4", "left"],
			["p2", "middle"],
			["p1", "middle"],
			["p5", "right"]
		])
	})
	it("placedIds lists every tab once", () => {
		expect(placedIds(base()).sort()).toEqual(
			[
				"authors-note",
				"chronicle",
				"lore-entries",
				"messages",
				"stats",
				"stats#world"
			].sort()
		)
	})
	it("nextPanelKey is one past the highest `p<n>`", () => {
		expect(nextPanelKey(base())).toBe("p6")
		const odd = {
			...base(),
			right: [p("custom", ["authors-note"]), p("p41", ["places"])]
		}
		expect(nextPanelKey(odd)).toBe("p42")
	})
	it("panelOfTab finds the holder and its place", () => {
		expect(panelOfTab(base(), "messages")).toMatchObject({
			place: "middle",
			panel: { key: "p1" }
		})
		expect(panelOfTab(base(), "nope")).toBeNull()
	})
	it("samePanels compares by content", () => {
		expect(samePanels(base(), base())).toBe(true)
		expect(samePanels(base(), ok(setTitle(base(), "p4", "x")))).toBe(false)
	})
})

describe("addTab", () => {
	it("adds at the end, or at an index", () => {
		const end = ok(addTab(base(), "places", { panelKey: "p4" }))
		expect(end.left[1].tabs).toEqual(["stats", "places"])
		const at = ok(addTab(base(), "places", { panelKey: "p3", index: 1 }))
		expect(at.left[0].tabs).toEqual(["chronicle", "places", "lore-entries"])
		const mid = ok(addTab(base(), "places", { panelKey: "p1" }))
		expect(mid.middle[1].tabs).toEqual(["messages", "places"])
	})
	it("refuses a widget already placed, and an unknown panel", () => {
		expect(addTab(base(), "stats", { panelKey: "p3" }).refused).toBe(
			ALREADY_PLACED
		)
		expect(addTab(base(), "places", { panelKey: "nope" }).refused).toBe(
			UNKNOWN_PANEL
		)
	})
	it("never mutates its input", () => {
		const b = base()
		const before = JSON.stringify(b)
		addTab(b, "places", { panelKey: "p1" })
		expect(JSON.stringify(b)).toBe(before)
	})
})

describe("newPanel", () => {
	it("mints the next key, in any zone", () => {
		expect(
			ok(newPanel(base(), "places", { place: "right", index: 0 }))
				.right[0]
		).toEqual({ key: "p6", tabs: ["places"] })
		expect(
			ok(
				newPanel(base(), "places", { place: "middle", index: 1 })
			).middle.map((x) => x.key)
		).toEqual(["p2", "p6", "p1"])
	})
	it("keeps the panel as asked: height, priority, title; the index clamps", () => {
		const out = ok(
			newPanel(
				base(),
				"places",
				{ place: "left", index: 9 },
				{ height: "fit", priority: "low", title: "T" }
			)
		)
		expect(out.left[2]).toEqual({
			key: "p6",
			tabs: ["places"],
			height: "fit",
			priority: "low",
			title: "T"
		})
	})
	it("refuses a widget already placed", () => {
		expect(
			newPanel(base(), "messages", { place: "left", index: 0 }).refused
		).toBe(ALREADY_PLACED)
	})
})

describe("removeTab", () => {
	it("removes a tab; a panel it empties goes", () => {
		const out = ok(removeTab(base(), "stats"))
		expect(out.left.map((x) => x.key)).toEqual(["p3"])
		expect(
			ok(removeTab(base(), "stats#world")).middle.map((x) => x.key)
		).toEqual(["p1"])
	})
	it("the middle may lose a panel while another remains, Messages included", () => {
		expect(removeRefusal(base(), "messages")).toBeNull()
		expect(ok(removeTab(base(), "messages")).middle).toEqual([
			p("p2", ["stats#world"])
		])
	})
	it("refuses MIDDLE_EMPTY for the last tab of the middle's only panel", () => {
		expect(removeRefusal(lone(), "messages")).toBe(MIDDLE_EMPTY)
		expect(removeTab(lone(), "messages").refused).toBe(MIDDLE_EMPTY)
	})
	it("a tab that is not the last of the only middle panel just leaves", () => {
		const two = ok(addTab(lone(), "board", { panelKey: "p1" }))
		expect(removeRefusal(two, "messages")).toBeNull()
		expect(ok(removeTab(two, "messages")).middle).toEqual([
			p("p1", ["board"])
		])
	})
	it("tidies `open` when the open tab leaves", () => {
		const b = base()
		b.left[0] = { ...b.left[0], open: "lore-entries" }
		expect(ok(removeTab(b, "lore-entries")).left[0]).toEqual({
			key: "p3",
			tabs: ["chronicle"]
		})
	})
	it("refuses an unknown tab", () => {
		expect(removeTab(base(), "nope").refused).toBe(UNKNOWN_TAB)
		expect(removeRefusal(base(), "nope")).toBe(UNKNOWN_TAB)
	})
})

describe("moveTab", () => {
	it("reorders within a panel", () => {
		expect(
			ok(moveTab(base(), "lore-entries", { panelKey: "p3", index: 0 }))
				.left[0].tabs
		).toEqual(["lore-entries", "chronicle"])
	})
	it("answers the same object for a move that changes nothing", () => {
		const b = base()
		expect(
			moveTab(b, "chronicle", { panelKey: "p3", index: 0 }).layout
		).toBe(b)
	})
	it("moves across panels and zones", () => {
		const out = ok(moveTab(base(), "chronicle", { panelKey: "p5" }))
		expect(out.left[0].tabs).toEqual(["lore-entries"])
		expect(out.right[0].tabs).toEqual(["authors-note", "chronicle"])
	})
	it("out of a one-tab panel removes that panel", () => {
		const out = ok(moveTab(base(), "stats", { panelKey: "p3" }))
		expect(out.left.map((x) => x.key)).toEqual(["p3"])
		expect(out.left[0].tabs).toEqual(["chronicle", "lore-entries", "stats"])
	})
	it("the middle's one-tab panel may go to a side while another middle panel remains", () => {
		const out = ok(moveTab(base(), "messages", { panelKey: "p4" }))
		expect(out.left[1].tabs).toEqual(["stats", "messages"])
		expect(out.middle.map((x) => x.key)).toEqual(["p2"])
	})
	it("into the other middle panel", () => {
		const out = ok(
			moveTab(base(), "messages", { panelKey: "p2", index: 0 })
		)
		expect(out.middle).toEqual([p("p2", ["messages", "stats#world"])])
	})
	it("refuses MIDDLE_EMPTY for the middle's last tab going to a side", () => {
		expect(moveTab(lone(), "messages", { panelKey: "p4" }).refused).toBe(
			MIDDLE_EMPTY
		)
	})
	it("a multi-tab middle panel's tab may go to a side", () => {
		const two = ok(addTab(lone(), "board", { panelKey: "p1" }))
		const out = ok(moveTab(two, "board", { panelKey: "p5" }))
		expect(out.middle).toEqual([p("p1", ["messages"])])
		expect(out.right[0].tabs).toEqual(["authors-note", "board"])
	})
	it("refuses unknown tabs and panels", () => {
		expect(moveTab(base(), "nope", { panelKey: "p4" }).refused).toBe(
			UNKNOWN_TAB
		)
		expect(moveTab(base(), "stats", { panelKey: "nope" }).refused).toBe(
			UNKNOWN_PANEL
		)
	})
})

describe("splitOut", () => {
	it("a one-tab panel just moves", () => {
		const out = ok(splitOut(base(), "stats", { place: "right", index: 0 }))
		expect(out.left.map((x) => x.key)).toEqual(["p3"])
		expect(out.right[0]).toEqual({ key: "p4", tabs: ["stats"] })
	})
	it("a tab of a multi-tab panel takes a new panel", () => {
		const out = ok(
			splitOut(base(), "lore-entries", { place: "left", index: 1 })
		)
		expect(out.left).toEqual([
			p("p3", ["chronicle"]),
			p("p6", ["lore-entries"]),
			p("p4", ["stats"])
		])
	})
	it("a tab of a multi-tab middle panel takes a new panel in any zone", () => {
		const two = ok(addTab(lone(), "board", { panelKey: "p1" }))
		const out = ok(splitOut(two, "board", { place: "right", index: 0 }))
		expect(out.middle).toEqual([p("p1", ["messages"])])
		expect(out.right[0]).toEqual(p("p6", ["board"]))
	})
	it("refuses MIDDLE_EMPTY for the middle's only one-tab panel to a side", () => {
		expect(
			splitOut(lone(), "messages", { place: "left", index: 0 }).refused
		).toBe(MIDDLE_EMPTY)
	})
	it("refuses unknown tabs", () => {
		expect(
			splitOut(base(), "nope", { place: "left", index: 0 }).refused
		).toBe(UNKNOWN_TAB)
	})
})

describe("movePanel", () => {
	it("moves a middle panel to a side while another stays", () => {
		const out = ok(movePanel(base(), "p1", { place: "left", index: 0 }))
		expect(out.left[0]).toEqual(p("p1", ["messages"]))
		expect(out.middle).toEqual([p("p2", ["stats#world"])])
	})
	it("moves a side panel into the middle, panel kept as is", () => {
		const b = base()
		b.right[0] = { ...b.right[0], height: "fit", priority: "low" }
		const out = ok(movePanel(b, "p5", { place: "middle", index: 1 }))
		expect(out.middle.map((x) => x.key)).toEqual(["p2", "p5", "p1"])
		expect(out.middle[1]).toEqual({
			key: "p5",
			tabs: ["authors-note"],
			height: "fit",
			priority: "low"
		})
		expect(out.right).toEqual([])
	})
	it("refuses MIDDLE_EMPTY for the middle's only panel to a side, but it may move within the middle", () => {
		expect(
			movePanel(lone(), "p1", { place: "left", index: 0 }).refused
		).toBe(MIDDLE_EMPTY)
		const l = lone()
		expect(movePanel(l, "p1", { place: "middle", index: 3 }).layout).toBe(l)
	})
	it("answers the same object for its own slot", () => {
		const b = base()
		expect(movePanel(b, "p4", { place: "left", index: 1 }).layout).toBe(b)
		expect(movePanel(b, "p4", { place: "left", index: 99 }).layout).toBe(b)
	})
	it("reorders within a stack (index counts without the panel)", () => {
		expect(
			ok(movePanel(base(), "p4", { place: "left", index: 0 })).left.map(
				(x) => x.key
			)
		).toEqual(["p4", "p3"])
		expect(
			ok(
				movePanel(base(), "p2", { place: "middle", index: 1 })
			).middle.map((x) => x.key)
		).toEqual(["p1", "p2"])
	})
	it("refuses an unknown panel", () => {
		expect(
			movePanel(base(), "nope", { place: "left", index: 0 }).refused
		).toBe(UNKNOWN_PANEL)
	})
})

/** A composer panel (declared fit/high) and a notes panel (declared fill/normal). */
const withComposer = (): PanelLayoutV2 => ({
	...base(),
	middle: [p("p1", ["messages"]), p("p6", ["composer"])],
	right: [p("p5", ["notes"])]
})

describe("declared defaults", () => {
	it("declaredPanelOf reads the widget's declaration, else fill / normal", () => {
		expect(declaredPanelOf("composer")).toEqual({
			height: "fit",
			priority: "high"
		})
		expect(declaredPanelOf("messages")).toEqual({
			height: "fill",
			priority: "low"
		})
		expect(declaredPanelOf("turn-line")).toEqual({
			height: "fit",
			priority: "normal"
		})
		expect(declaredPanelOf("notes")).toEqual({
			height: "fill",
			priority: "normal"
		})
		expect(declaredPanelOf(undefined)).toEqual({
			height: "fill",
			priority: "normal"
		})
	})
	it("heightOf and priorityOf: stored when valid, else declared (of the OPEN tab)", () => {
		const l = withComposer()
		expect(heightOf(l.middle[1])).toBe("fit")
		expect(priorityOf(l.middle[1])).toBe("high")
		expect(heightOf(p("x", ["composer"], { height: "fill" }))).toBe("fill")
		expect(
			heightOf(p("x", ["composer"], { height: { share: 3 } }))
		).toEqual({ share: 3 })
		expect(priorityOf(p("x", ["composer"], { priority: "low" }))).toBe(
			"low"
		)
		expect(
			priorityOf(p("x", ["composer"], { priority: "bogus" as never }))
		).toBe("high")
		expect(
			heightOf(p("x", ["composer"], { height: "bogus" as never }))
		).toBe("fit")
		expect(
			heightOf(p("x", ["notes", "composer"], { open: "composer" }))
		).toBe("fit")
	})
})

describe("setHeight", () => {
	it("a composer panel: Fit removes the field, Fill writes it", () => {
		const l = withComposer()
		expect(l.middle[1].height).toBeUndefined()
		expect(setHeight(l, "p6", "fit").layout).toBe(l)
		const fill = ok(setHeight(l, "p6", "fill"))
		expect(fill.middle[1].height).toBe("fill")
		expect(ok(setHeight(l, "p6", undefined)).middle[1].height).toBe("fill")
		const back = ok(setHeight(fill, "p6", "fit"))
		expect(back.middle[1]).not.toHaveProperty("height")
	})
	it("a notes panel: Fill removes the field, Fit writes it", () => {
		const l = withComposer()
		expect(setHeight(l, "p5", "fill").layout).toBe(l)
		expect(setHeight(l, "p5", undefined).layout).toBe(l)
		const fit = ok(setHeight(l, "p5", "fit"))
		expect(fit.right[0].height).toBe("fit")
		expect(ok(setHeight(fit, "p5", "fill")).right[0]).not.toHaveProperty(
			"height"
		)
	})
	it("a share is held to a whole 1–12", () => {
		const l = withComposer()
		expect(ok(setHeight(l, "p5", { share: 40 })).right[0].height).toEqual({
			share: 12
		})
		expect(ok(setHeight(l, "p5", { share: 0 })).right[0].height).toEqual({
			share: 1
		})
		expect(ok(setHeight(l, "p5", { share: 3.6 })).right[0].height).toEqual({
			share: 4
		})
		expect(
			ok(setHeight(l, "p5", { share: Number.NaN })).right[0].height
		).toEqual({ share: 1 })
	})
	it("works in the middle, and refuses an unknown panel", () => {
		expect(ok(setHeight(base(), "p2", "fit")).middle[0].height).toBe("fit")
		expect(setHeight(base(), "nope", "fit").refused).toBe(UNKNOWN_PANEL)
	})
	it("a height that changes nothing answers the same object", () => {
		const b = base()
		expect(setHeight(b, "p4", undefined).layout).toBe(b)
		const s = ok(setHeight(b, "p4", { share: 4 }))
		expect(setHeight(s, "p4", { share: 4 }).layout).toBe(s)
	})
	it("never mutates its input", () => {
		const l = withComposer()
		const before = JSON.stringify(l)
		setHeight(l, "p6", "fill")
		expect(JSON.stringify(l)).toBe(before)
	})
})

describe("setPriority", () => {
	it("a composer panel: High removes the field, Low writes it", () => {
		const l = withComposer()
		expect(setPriority(l, "p6", "high").layout).toBe(l)
		expect(setPriority(l, "p6", undefined).layout).toBe(l)
		const low = ok(setPriority(l, "p6", "low"))
		expect(low.middle[1].priority).toBe("low")
		expect(ok(setPriority(low, "p6", "high")).middle[1]).not.toHaveProperty(
			"priority"
		)
		expect(
			ok(setPriority(low, "p6", undefined)).middle[1]
		).not.toHaveProperty("priority")
	})
	it("a notes panel: Normal removes, High writes", () => {
		const l = withComposer()
		expect(setPriority(l, "p5", "normal").layout).toBe(l)
		expect(ok(setPriority(l, "p5", "high")).right[0].priority).toBe("high")
	})
	it("an invalid value is ignored; an unknown panel is refused", () => {
		const l = withComposer()
		expect(setPriority(l, "p6", "bogus" as never).layout).toBe(l)
		expect(setPriority(l, "nope", "low").refused).toBe(UNKNOWN_PANEL)
	})
	it("unchanged answers the same object", () => {
		const low = ok(setPriority(withComposer(), "p6", "low"))
		expect(setPriority(low, "p6", "low").layout).toBe(low)
	})
})

const glassy = (): PanelLayoutV2 => ({ ...base(), opacity: 30 })

describe("lookOf and setLook", () => {
	it("lookOf is the default for a layout that stores none, else what it stores", () => {
		expect(lookOf(base())).toEqual(DEFAULT_PANEL_LOOK)
		expect(
			lookOf({ ...base(), backing: "glass", opacity: 40, gap: "tight" })
		).toEqual({
			backing: "glass",
			opacity: 40,
			gap: "tight",
			behind: "background",
			behindDim: 0
		})
	})
	it("round-trips behind and behindDim, drops the defaults, ignores invalid, clamps", () => {
		const on = ok(setLook(base(), { behind: "backdrop", behindDim: 40.4 }))
		expect(on.behind).toBe("backdrop")
		expect(on.behindDim).toBe(40)
		expect(lookOf(on)).toMatchObject({ behind: "backdrop", behindDim: 40 })
		const off = ok(setLook(on, { behind: "background", behindDim: 0 }))
		expect(off).not.toHaveProperty("behind")
		expect(off).not.toHaveProperty("behindDim")
		expect(samePanels(off, base())).toBe(true)
		const b = base()
		expect(
			setLook(b, {
				behind: "wall" as never,
				behindDim: Number.NaN
			}).layout
		).toBe(b)
		expect(ok(setLook(b, { behindDim: 250 })).behindDim).toBe(100)
		expect(ok(setLook(b, { behindDim: -4 })).behindDim).toBeUndefined()
		expect(
			lookOf({ ...b, behind: "x" as never, behindDim: 900 })
		).toMatchObject({ behind: "background", behindDim: 100 })
	})
	it("writes a value that differs from the default and removes one that equals it", () => {
		const glass = ok(
			setLook(base(), { backing: "glass", gap: "spacious", opacity: 50 })
		)
		expect(lookOf(glass)).toEqual({
			backing: "glass",
			gap: "spacious",
			opacity: 50,
			behind: "background",
			behindDim: 0
		})
		const back = ok(
			setLook(glass, {
				backing: DEFAULT_PANEL_LOOK.backing,
				gap: DEFAULT_PANEL_LOOK.gap,
				opacity: DEFAULT_PANEL_LOOK.opacity
			})
		)
		expect(back).not.toHaveProperty("backing")
		expect(back).not.toHaveProperty("gap")
		expect(back).not.toHaveProperty("opacity")
		expect(samePanels(back, base())).toBe(true)
	})
	it("rounds and clamps opacity to 0–100", () => {
		// 150 clamps to 100, the default, so nothing is stored.
		expect(ok(setLook(glassy(), { opacity: 150 })).opacity).toBeUndefined()
		expect(ok(setLook(base(), { opacity: -5 })).opacity).toBe(0)
		expect(ok(setLook(base(), { opacity: 42.6 })).opacity).toBe(43)
	})
	it("ignores an invalid value and answers the same object", () => {
		const b = base()
		expect(
			setLook(b, {
				backing: "wood" as never,
				gap: "huge" as never,
				opacity: Number.NaN
			}).layout
		).toBe(b)
		expect(setLook(b, { opacity: "x" as never }).layout).toBe(b)
		const only = ok(setLook(b, { backing: "none", gap: "huge" as never }))
		expect(only.backing).toBe("none")
		expect(only).not.toHaveProperty("gap")
	})
	it("an empty patch or a value already held answers the same object", () => {
		const b = base()
		expect(setLook(b, {}).layout).toBe(b)
		expect(setLook(b, { backing: DEFAULT_PANEL_LOOK.backing }).layout).toBe(
			b
		)
		const glass = ok(setLook(b, { backing: "glass" }))
		expect(setLook(glass, { backing: "glass" }).layout).toBe(glass)
	})
	it("never touches the panels, nor the input", () => {
		const b = base()
		const before = JSON.stringify(b)
		const out = ok(setLook(b, { backing: "glass", opacity: 10 }))
		expect(out.left).toBe(b.left)
		expect(out.middle).toBe(b.middle)
		expect(out.right).toBe(b.right)
		expect(JSON.stringify(b)).toBe(before)
	})
})

describe("setTitle", () => {
	it("names, trims and clears", () => {
		const named = ok(setTitle(base(), "p3", "  Lore  "))
		expect(named.left[0].title).toBe("Lore")
		expect(ok(setTitle(named, "p3", "   ")).left[0]).not.toHaveProperty(
			"title"
		)
	})
	it("unchanged answers the same object; unknown is refused", () => {
		const b = base()
		expect(setTitle(b, "p3", undefined).layout).toBe(b)
		expect(setTitle(b, "nope", "x").refused).toBe(UNKNOWN_PANEL)
	})
})

describe("setTabOrder", () => {
	it("reorders and tidies `open`", () => {
		const b = base()
		b.left[0] = { ...b.left[0], open: "lore-entries" }
		expect(
			ok(setTabOrder(b, "p3", ["lore-entries", "chronicle"])).left[0]
		).toEqual({ key: "p3", tabs: ["lore-entries", "chronicle"] })
	})
	it("refuses a list that is not the panel's tabs", () => {
		expect(setTabOrder(base(), "p3", ["chronicle", "stats"]).refused).toBe(
			UNKNOWN_TAB
		)
		expect(setTabOrder(base(), "p3", ["chronicle"]).refused).toBe(
			UNKNOWN_TAB
		)
	})
	it("the same order answers the same object", () => {
		const b = base()
		expect(setTabOrder(b, "p3", ["chronicle", "lore-entries"]).layout).toBe(
			b
		)
	})
})

/* ── property loop: random edits over the core layouts ─────────────────── */

/** A small seeded PRNG (mulberry32), so a failure replays. */
function rng(seed: number) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const POOL = [
	"places",
	"album",
	"actions",
	"turn-order",
	"chronicle",
	"stats#2",
	"messages#2",
	"annex#notes",
	"lore-entries"
]
const PLACES: StackPlace[] = ["left", "middle", "right"]

function invariants(layout: PanelLayoutV2, why: string) {
	const panels = allPanels(layout)
	for (const { panel } of panels)
		expect(
			panel.tabs.length,
			`${why}: empty panel ${panel.key}`
		).toBeGreaterThan(0)
	const ids = placedIds(layout)
	expect(new Set(ids).size, `${why}: duplicate id in ${ids.join(",")}`).toBe(
		ids.length
	)
	const keys = panels.map(({ panel }) => panel.key)
	expect(new Set(keys).size, `${why}: duplicate key`).toBe(keys.length)
	expect(layout.middle.length, `${why}: empty middle`).toBeGreaterThan(0)
	for (const { panel } of panels) {
		expect(panel).not.toHaveProperty("pinned")
		if (panel.open)
			expect(
				panel.tabs.includes(panel.open) && panel.tabs[0] !== panel.open,
				`${why}: untidy open`
			).toBe(true)
	}
	const v = validateSessionLayout({ panels: layout })
	expect(v.errors, why).toEqual([])
}

describe("random edit sequences keep every rule", () => {
	for (const [name, source] of [
		["Chat", STORY_LAYOUT],
		["Adventure", STORY_WORLD_LAYOUT],
		["Lair", LAIR_LAYOUT]
	] as const) {
		it(name, () => {
			const landed = new Map<string, number>()
			for (let seed = 1; seed <= 40; seed++) {
				const r = rng(seed * 7919 + name.length)
				const pick = <T>(xs: readonly T[]): T =>
					xs[Math.floor(r() * xs.length)]
				let layout = structuredClone(panelsOf(source))
				invariants(layout, `${name} start`)
				for (let step = 0; step < 60; step++) {
					const keys = allPanels(layout).map(({ panel }) => panel.key)
					const ids = placedIds(layout)
					const fresh = POOL.filter((id) => !ids.includes(id))
					const freshId = fresh.length ? pick(fresh) : "album#9"
					const anyId = pick([...ids, "nope"])
					const key = pick([...keys, "nope"])
					const slot = {
						place: pick(PLACES),
						index: Math.floor(r() * 4)
					}
					const tabSlot = {
						panelKey: key,
						index: r() < 0.5 ? undefined : Math.floor(r() * 3)
					}
					const ops: Array<[string, () => ArrangeOutcome]> = [
						["addTab", () => addTab(layout, freshId, tabSlot)],
						[
							"newPanel",
							() =>
								newPanel(
									layout,
									freshId,
									slot,
									r() < 0.5 ? { height: "fit" } : {}
								)
						],
						["removeTab", () => removeTab(layout, anyId)],
						["moveTab", () => moveTab(layout, anyId, tabSlot)],
						["splitOut", () => splitOut(layout, anyId, slot)],
						["movePanel", () => movePanel(layout, key, slot)],
						[
							"setHeight",
							() =>
								setHeight(
									layout,
									key,
									pick([
										undefined,
										"fit",
										"fill",
										{ share: Math.floor(r() * 14) }
									] as const)
								)
						],
						[
							"setPriority",
							() =>
								setPriority(
									layout,
									key,
									pick([
										undefined,
										"high",
										"normal",
										"low"
									] as const)
								)
						],
						[
							"setLook",
							() =>
								setLook(layout, {
									backing: pick([
										"card",
										"glass",
										"none"
									] as const),
									opacity: Math.floor(r() * 130) - 10
								})
						],
						[
							"setTitle",
							() =>
								setTitle(
									layout,
									key,
									pick([undefined, "Lore", " "])
								)
						],
						[
							"setTabOrder",
							() => {
								const tabs =
									allPanels(layout).find(
										({ panel }) => panel.key === key
									)?.panel.tabs ?? []
								return setTabOrder(
									layout,
									key,
									[...tabs].reverse()
								)
							}
						]
					]
					const [op, run] = pick(ops)
					const before = JSON.stringify(layout)
					const out = run()
					expect(
						JSON.stringify(layout),
						`${op} mutated its input`
					).toBe(before)
					if (out.layout) {
						if (out.layout !== layout)
							landed.set(op, (landed.get(op) ?? 0) + 1)
						layout = out.layout
						invariants(
							layout,
							`${name} seed ${seed} step ${step} ${op}`
						)
					} else if (
						op === "removeTab" ||
						op === "moveTab" ||
						op === "splitOut" ||
						op === "movePanel"
					) {
						// The only refusals an existing target can meet.
						expect(
							[MIDDLE_EMPTY, UNKNOWN_TAB, UNKNOWN_PANEL],
							`${op}: ${out.refused}`
						).toContain(out.refused)
					}
				}
			}
			for (const op of [
				"removeTab",
				"moveTab",
				"splitOut",
				"movePanel",
				"setHeight",
				"setPriority",
				"setLook"
			])
				expect(
					landed.get(op) ?? 0,
					`${name}: ${op} never changed a layout`
				).toBeGreaterThan(0)
		})
	}
})
