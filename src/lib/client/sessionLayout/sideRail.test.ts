/**
 * The side column's rail model (ruled 2026-09-10) — pure, so the whole
 * decision is covered without a component harness. A group is a PANEL
 * (PLAN-session-panels-2026-10-14): docked or in the rail, at its height.
 */
import { describe, expect, it } from "vitest"
import {
	MIN_GROUP_PX,
	RAIL_GAP_PX,
	panelTrack,
	railFit,
	resolveRailColumn,
	rovingStep,
	rovingStop,
	type RailGroup
} from "./sideRail"
import { resolveDrawn, type PanelHeightV1, type PanelV1 } from "@serene-pub/sdk"

/** A column as the test states it: `rows` twelfths of the column, or a height. */
type Spec = { key: string; rows?: number; height?: PanelHeightV1; pinned: boolean; open: boolean }

/**
 * The column as a STORED layout, read the way the page reads it (C5): each
 * group a right-side panel, its pin written the way a panel writes one
 * (`pinned: false`, or no field at all) and its height a `{ share }` of the
 * rows it is given, then drawn by `resolveDrawn` — so every case below runs
 * the pin and the height from the stored panel to the rail; `open` is
 * transient and rides beside it, by key.
 */
function throughDrawn(column: Spec[]): RailGroup[] {
	const right: PanelV1[] = column.map((g) => ({
		key: g.key,
		tabs: [`w-${g.key}`],
		...(g.pinned ? {} : { pinned: false as const }),
		height: g.height ?? { share: g.rows ?? 4 }
	}))
	const zone = resolveDrawn(
		{
			panels: {
				version: 1,
				left: [],
				right,
				middle: { above: [], primary: { key: "p0", tabs: ["messages"] }, below: [] }
			}
		},
		{ inline: 1300 }
	).right
	const open = new Map(column.map((g) => [g.key, g.open]))
	return zone.panels.map((p) => ({
		key: p.key,
		height: p.height,
		pinned: p.pinned,
		open: open.get(p.key) ?? false
	}))
}

/** A column of three equal groups, each four twelfths of it. */
function groups(...over: Partial<Spec>[]): RailGroup[] {
	return throughDrawn(
		over.map((o, i) => ({
			key: `g${i}`,
			rows: 4,
			pinned: false,
			open: false,
			...o
		}))
	)
}

describe("railFit — expand beside the pinned ones, or fly out", () => {
	it("expands when what is left clears this group's minimum", () => {
		expect(railFit({ columnPx: 600, takenPx: 300, minPx: 120 })).toBe(
			"inline"
		)
	})

	it("flies out when what is left is below it", () => {
		expect(railFit({ columnPx: 600, takenPx: 500, minPx: 120 })).toBe(
			"flyout"
		)
	})

	it("counts a gap only when something already holds the column", () => {
		// Exactly the minimum with no gap to pay: it fits.
		expect(railFit({ columnPx: 120, takenPx: 0, minPx: 120 })).toBe(
			"inline"
		)
		// The same remainder, one gap short of it, does not.
		expect(
			railFit({
				columnPx: 120 + RAIL_GAP_PX,
				takenPx: RAIL_GAP_PX,
				minPx: 120,
				gapPx: RAIL_GAP_PX
			})
		).toBe("flyout")
	})

	it("does not fly a group out of a column that has not been measured", () => {
		// First paint: the column reports 0 until it is laid out. Reading that
		// as "no room" would open every default-expanded group as a flyout.
		expect(railFit({ columnPx: 0, takenPx: 0, minPx: 120 })).toBe("inline")
	})
})

describe("resolveRailColumn — (a) expanded or an icon in the rail", () => {
	it("expands the pinned groups and collapses the rest, with no state of its own", () => {
		const r = resolveRailColumn({
			columnPx: 600,
			groups: groups(
				{ pinned: true, open: true },
				{ pinned: false, open: false },
				{ pinned: false, open: false }
			)
		})
		expect(r.map((p) => p.state)).toEqual([
			"expanded",
			"collapsed",
			"collapsed"
		])
	})

	it("gives an expanded group its share of the column and a collapsed one nothing", () => {
		const r = resolveRailColumn({
			columnPx: 600,
			groups: groups({ pinned: true, open: true }, { open: false })
		})
		// A share of 4 twelfths, of the column less the one gap between the two groups.
		expect(r[0].heightPx).toBe(198)
		expect(r[1].heightPx).toBe(0)
	})
})

describe("resolveRailColumn — (b) a pinned group keeps its height", () => {
	it("does not shrink a pinned group when a sibling expands", () => {
		const base = {
			columnPx: 600,
			groups: groups(
				{ pinned: true, open: true },
				{ pinned: true, open: true },
				{ open: false }
			)
		}
		const before = resolveRailColumn(base)
		const after = resolveRailColumn({
			...base,
			groups: groups(
				{ pinned: true, open: true },
				{ pinned: true, open: true },
				{ open: true }
			),
			focusKey: "g2"
		})
		expect(after[0].heightPx).toBe(before[0].heightPx)
		expect(after[1].heightPx).toBe(before[1].heightPx)
	})

	it("serves the pinned groups first, wherever they sit in the column", () => {
		// The unpinned one is FIRST in column order and asks for the lot; the
		// pinned one below it still gets its share.
		const r = resolveRailColumn({
			columnPx: 400,
			groups: throughDrawn([
				{ key: "loose", rows: 12, pinned: false, open: true },
				{ key: "docked", rows: 6, pinned: true, open: true }
			]),
			focusKey: "loose"
		})
		const docked = r.find((p) => p.key === "docked")!
		expect(docked.state).toBe("expanded")
		expect(docked.heightPx).toBe(197) // half of 400 less the one gap
	})
})

describe("resolveRailColumn — (c) no room beside the pinned ones is a flyout", () => {
	it("opens the group the user just asked for over the session, at full height", () => {
		const r = resolveRailColumn({
			columnPx: 300,
			groups: throughDrawn([
				{ key: "big", rows: 11, pinned: true, open: true },
				{ key: "late", rows: 4, pinned: false, open: true }
			]),
			focusKey: "late"
		})
		expect(r.find((p) => p.key === "big")!.state).toBe("expanded")
		expect(r.find((p) => p.key === "late")!.state).toBe("flyout")
	})

	it("leaves a group that cannot fit and was NOT just asked for collapsed", () => {
		// Expand-all must not turn into a stack of flyouts: only the focused
		// group may leave the column.
		const r = resolveRailColumn({
			columnPx: 300,
			groups: throughDrawn([
				{ key: "big", rows: 11, pinned: true, open: true },
				{ key: "a", rows: 4, pinned: false, open: true },
				{ key: "b", rows: 4, pinned: false, open: true }
			])
		})
		expect(r.map((p) => p.state)).toEqual([
			"expanded",
			"collapsed",
			"collapsed"
		])
	})

	it("never flies more than one group out", () => {
		const r = resolveRailColumn({
			columnPx: 200,
			groups: throughDrawn([
				{ key: "big", rows: 12, pinned: true, open: true },
				{ key: "a", rows: 4, pinned: false, open: true },
				{ key: "b", rows: 4, pinned: false, open: true }
			]),
			focusKey: "b"
		})
		expect(r.filter((p) => p.state === "flyout").map((p) => p.key)).toEqual(
			["b"]
		)
	})

	it("takes the room a collapsed sibling gave back", () => {
		const open3 = {
			columnPx: 300,
			groups: throughDrawn([
				{ key: "a", rows: 6, pinned: true, open: true },
				{ key: "b", rows: 6, pinned: true, open: true },
				{ key: "c", rows: 4, pinned: false, open: true }
			]),
			focusKey: "c"
		}
		expect(resolveRailColumn(open3).find((p) => p.key === "c")!.state).toBe(
			"flyout"
		)
		// Collapse `b` and the same request fits in the column instead.
		const collapsed = resolveRailColumn({
			...open3,
			groups: open3.groups.map((g) =>
				g.key === "b" ? { ...g, open: false } : g
			)
		})
		expect(collapsed.find((p) => p.key === "c")!.state).toBe("expanded")
	})
})

describe("resolveRailColumn — the edges", () => {
	it("expands a group no smaller than the floor, even in a thin column", () => {
		const r = resolveRailColumn({
			columnPx: 600,
			groups: throughDrawn([{ key: "sliver", rows: 1, pinned: true, open: true }])
		})
		// One twelfth of 600 is 50px, which is not a panel. Shares alone could
		// never overflow the column either — they are proportions OF it — so a
		// column that only ever handed out shares would make rule (c)
		// unreachable. The floor is what makes a short column run out.
		expect(r[0].heightPx).toBe(MIN_GROUP_PX)
		expect(r[0].state).toBe("expanded")
	})

	it("runs out of column when the floors no longer fit — which is rule (c)", () => {
		// Four groups of three twelfths each. In a 500px column each share
		// clears the floor and all four fit — gaps and all, which is what the
		// share denominator is for. In a 300px column they do not.
		const four = (columnPx: number) =>
			resolveRailColumn({
				columnPx,
					groups: groups(
					{ rows: 3, pinned: true, open: true },
					{ rows: 3, pinned: true, open: true },
					{ rows: 3, pinned: true, open: true },
					{ rows: 3, pinned: true, open: true }
				)
			}).map((p) => p.state)
		expect(four(500)).toEqual([
			"expanded",
			"expanded",
			"expanded",
			"expanded"
		])
		expect(four(300)).toEqual([
			"expanded",
			"expanded",
			"collapsed",
			"collapsed"
		])
	})

	it("holds an unmeasured column open rather than flying everything out", () => {
		const r = resolveRailColumn({
			columnPx: 0,
			groups: groups({ pinned: true, open: true }, { open: true })
		})
		expect(r.map((p) => p.state)).toEqual(["expanded", "expanded"])
		// 0 = "no height of its own yet"; the renderer lets flex share it out.
		expect(r.map((p) => p.heightPx)).toEqual([0, 0])
	})

	it("never returns a negative height, whatever it is handed", () => {
		const r = resolveRailColumn({
			columnPx: -50,
			groups: groups({ pinned: true, open: true }, { open: true })
		})
		for (const p of r) expect(p.heightPx).toBeGreaterThanOrEqual(0)
	})

	it("reports every group it was given, in the order it was given them", () => {
		const g = groups(
			{ pinned: true, open: true },
			{ open: true },
			{ open: false }
		)
		expect(
			resolveRailColumn({ columnPx: 600, groups: g }).map(
				(p) => p.key
			)
		).toEqual(["g0", "g1", "g2"])
	})
})

describe("resolveRailColumn — below the breakpoint the rail is the header's buttons", () => {
	it("docks nothing: the group the user tapped is the sheet, the rest are icons", () => {
		const r = resolveRailColumn({
			columnPx: 700,
			narrow: true,
			groups: groups(
				{ pinned: true, open: true },
				{ pinned: true, open: true },
				{ open: true }
			),
			focusKey: "g2"
		})
		expect(r.map((p) => p.state)).toEqual([
			"collapsed",
			"collapsed",
			"flyout"
		])
	})

	it("shows no sheet at all when nothing was tapped", () => {
		const r = resolveRailColumn({
			columnPx: 700,
			narrow: true,
			groups: groups({ pinned: true, open: true })
		})
		expect(r[0].state).toBe("collapsed")
	})
})

describe("a RAIL-ONLY side — every panel in the rail (lane E1)", () => {
	it("as a column it would draw nothing: every group collapsed, its whole width empty", () => {
		// Why the model draws such a side tucked and counts a rail for it
		// (./sideSlot `sideFlowPx` `railOnly`): docked, it is a blank column.
		const r = resolveRailColumn({
			columnPx: 700,
			groups: groups(
				{ pinned: false, open: false },
				{ pinned: false, open: false }
			)
		})
		expect(r.map((p) => p.state)).toEqual(["collapsed", "collapsed"])
	})

	it("drawn as its rail (the tucked decision), the group asked for comes out over the session", () => {
		const r = resolveRailColumn({
			columnPx: 700,
			narrow: true,
			groups: groups(
				{ pinned: false, open: false },
				{ pinned: false, open: true }
			),
			focusKey: "g1"
		})
		expect(r.map((p) => p.state)).toEqual(["collapsed", "flyout"])
	})
})

describe("the module's stated constants", () => {
	it("keeps a floor a panel is actually usable at", () => {
		expect(MIN_GROUP_PX).toBeGreaterThan(40)
	})
})

describe("heights — fit, fill and a share (PLAN-session-panels §1.3)", () => {
	it("a share is its own twelfths of the docked height, as px once measured", () => {
		const r = resolveRailColumn({
			columnPx: 606,
			groups: throughDrawn([
				{ key: "a", rows: 4, pinned: true, open: true },
				{ key: "b", rows: 8, pinned: true, open: true }
			])
		})
		expect(r.map((p) => p.heightPx)).toEqual([200, 400])
		expect(r.map((p) => p.track)).toEqual(["200px", "400px"])
	})

	it("fit takes its content, never under the floor; fill shares what is left", () => {
		const r = resolveRailColumn({
			columnPx: 700,
			groups: throughDrawn([
				{ key: "fit", height: "fit", pinned: true, open: true },
				{ key: "a", height: "fill", pinned: true, open: true },
				{ key: "b", height: "fill", pinned: true, open: true }
			])
		})
		expect(r.map((p) => p.state)).toEqual(["expanded", "expanded", "expanded"])
		// Neither is a height of its own: the grid sizes them.
		expect(r.map((p) => p.heightPx)).toEqual([0, 0, 0])
		expect(r.map((p) => p.track)).toEqual([
			`minmax(${MIN_GROUP_PX}px,auto)`,
			"minmax(0,1fr)",
			"minmax(0,1fr)"
		])
	})

	it("an absent or unreadable height draws as fill", () => {
		const [g] = throughDrawn([
			{ key: "x", height: "tall" as unknown as PanelHeightV1, pinned: true, open: true }
		])
		expect(g.height).toBe("fill")
	})

	it("a fit or fill panel costs the column its floor, so rule (c) still bites", () => {
		// Two fills hold 2 × 120 + a gap of a 260px column: a third does not fit.
		const r = resolveRailColumn({
			columnPx: 260,
			groups: throughDrawn([
				{ key: "a", height: "fill", pinned: true, open: true },
				{ key: "b", height: "fill", pinned: true, open: true },
				{ key: "c", height: "fit", pinned: false, open: true }
			]),
			focusKey: "c"
		})
		expect(r.map((p) => p.state)).toEqual(["expanded", "expanded", "flyout"])
	})

	it("an unmeasured share is a proportional track, never a 0px row", () => {
		expect(panelTrack({ share: 6 }, 0)).toBe("minmax(0,6fr)")
		expect(panelTrack({ share: 6 }, 300)).toBe("300px")
		expect(panelTrack("fit", 0, 90)).toBe("minmax(90px,auto)")
		expect(panelTrack("fill", 0)).toBe("minmax(0,1fr)")
	})

	it("a collapsed or flown-out panel has no track", () => {
		const r = resolveRailColumn({
			columnPx: 200,
			groups: throughDrawn([
				{ key: "big", rows: 12, pinned: true, open: true },
				{ key: "out", rows: 4, pinned: false, open: true },
				{ key: "shut", rows: 4, pinned: false, open: false }
			]),
			focusKey: "out"
		})
		expect(r.map((p) => [p.state, p.track])).toEqual([
			["expanded", "188px"], // the column less its two gaps
			["flyout", ""],
			["collapsed", ""]
		])
	})
})

describe("rail roving focus (one tab stop, arrows within)", () => {
	it("steps on both arrow axes and wraps at either end", () => {
		expect(rovingStep("ArrowDown", 0, 3)).toBe(1)
		expect(rovingStep("ArrowRight", 2, 3)).toBe(0)
		expect(rovingStep("ArrowUp", 0, 3)).toBe(2)
		expect(rovingStep("ArrowLeft", 1, 3)).toBe(0)
	})
	it("Home and End jump to the ends", () => {
		expect(rovingStep("Home", 2, 3)).toBe(0)
		expect(rovingStep("End", 0, 3)).toBe(2)
	})
	it("leaves every other key, and an empty rail, alone", () => {
		expect(rovingStep("Tab", 0, 3)).toBeNull()
		expect(rovingStep("Enter", 0, 3)).toBeNull()
		expect(rovingStep("ArrowDown", 0, 0)).toBeNull()
	})
	it("keeps the tab stop inside a rail that shrank", () => {
		expect(rovingStop(undefined, 3)).toBe(0)
		expect(rovingStop(5, 3)).toBe(2)
		expect(rovingStop(1, 0)).toBe(0)
	})
})
