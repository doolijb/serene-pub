/**
 * The side column's rail model (ruled 2026-09-10) — pure, so the whole
 * decision is covered without a component harness.
 */
import { describe, expect, it } from "vitest"
import {
	MIN_GROUP_PX,
	MIN_WIDGET_PX,
	RAIL_GAP_PX,
	collapseColumn,
	collapsedOrder,
	railFit,
	resolveRailColumn,
	type RailGroup
} from "./sideRail"

/** A column of three equal groups in a 12-row arrangement. */
function groups(...over: Partial<RailGroup>[]): RailGroup[] {
	return over.map((o, i) => ({
		key: `g${i}`,
		rows: 4,
		pinned: false,
		open: false,
		...o
	}))
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
			totalRows: 12,
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
			totalRows: 12,
			groups: groups({ pinned: true, open: true }, { open: false })
		})
		// 4 of 12 rows, of the column less the one gap between the two groups.
		expect(r[0].heightPx).toBe(198)
		expect(r[1].heightPx).toBe(0)
	})
})

describe("resolveRailColumn — (b) a pinned group keeps its height", () => {
	it("does not shrink a pinned group when a sibling expands", () => {
		const base = {
			columnPx: 600,
			totalRows: 12,
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
			totalRows: 12,
			groups: [
				{ key: "loose", rows: 12, pinned: false, open: true },
				{ key: "docked", rows: 6, pinned: true, open: true }
			],
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
			totalRows: 12,
			groups: [
				{ key: "big", rows: 11, pinned: true, open: true },
				{ key: "late", rows: 4, pinned: false, open: true }
			],
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
			totalRows: 12,
			groups: [
				{ key: "big", rows: 11, pinned: true, open: true },
				{ key: "a", rows: 4, pinned: false, open: true },
				{ key: "b", rows: 4, pinned: false, open: true }
			]
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
			totalRows: 12,
			groups: [
				{ key: "big", rows: 12, pinned: true, open: true },
				{ key: "a", rows: 4, pinned: false, open: true },
				{ key: "b", rows: 4, pinned: false, open: true }
			],
			focusKey: "b"
		})
		expect(r.filter((p) => p.state === "flyout").map((p) => p.key)).toEqual(
			["b"]
		)
	})

	it("takes the room a collapsed sibling gave back", () => {
		const open3 = {
			columnPx: 300,
			totalRows: 12,
			groups: [
				{ key: "a", rows: 6, pinned: true, open: true },
				{ key: "b", rows: 6, pinned: true, open: true },
				{ key: "c", rows: 4, pinned: false, open: true }
			],
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
			totalRows: 60,
			groups: [{ key: "sliver", rows: 1, pinned: true, open: true }]
		})
		// One row of sixty is 10px, which is not a panel. Shares alone could
		// never overflow the column either — they are proportions OF it — so a
		// column that only ever handed out shares would make rule (c)
		// unreachable. The floor is what makes a short column run out.
		expect(r[0].heightPx).toBe(MIN_GROUP_PX)
		expect(r[0].state).toBe("expanded")
	})

	it("runs out of column when the floors no longer fit — which is rule (c)", () => {
		// Four groups filling a 16-row arrangement. In a 500px column each
		// share clears the floor and all four fit — gaps and all, which is what
		// the share denominator is for. In a 300px column they do not.
		const four = (columnPx: number) =>
			resolveRailColumn({
				columnPx,
				totalRows: 16,
				groups: groups(
					{ pinned: true, open: true },
					{ pinned: true, open: true },
					{ pinned: true, open: true },
					{ pinned: true, open: true }
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
			totalRows: 12,
			groups: groups({ pinned: true, open: true }, { open: true })
		})
		expect(r.map((p) => p.state)).toEqual(["expanded", "expanded"])
		// 0 = "no height of its own yet"; the renderer lets flex share it out.
		expect(r.map((p) => p.heightPx)).toEqual([0, 0])
	})

	it("never returns a negative height, whatever it is handed", () => {
		const r = resolveRailColumn({
			columnPx: -50,
			totalRows: 0,
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
			resolveRailColumn({ columnPx: 600, totalRows: 12, groups: g }).map(
				(p) => p.key
			)
		).toEqual(["g0", "g1", "g2"])
	})
})

describe("resolveRailColumn — below the breakpoint the rail is the header's buttons", () => {
	it("docks nothing: the group the user tapped is the sheet, the rest are icons", () => {
		const r = resolveRailColumn({
			columnPx: 700,
			totalRows: 12,
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
			totalRows: 12,
			narrow: true,
			groups: groups({ pinned: true, open: true })
		})
		expect(r[0].state).toBe("collapsed")
	})
})

describe("the module's stated constants", () => {
	it("keeps a floor a panel is actually usable at", () => {
		expect(MIN_GROUP_PX).toBeGreaterThan(40)
	})
})

describe("collapseColumn — side by side, or one under the other", () => {
	it("keeps two widgets side by side when the column can hold both", () => {
		expect(collapseColumn({ columnPx: 700, minWidthPx: [220, 220] })).toBe(
			false
		)
	})

	it("stacks them when it cannot — the threshold is the widgets, not a breakpoint", () => {
		expect(collapseColumn({ columnPx: 400, minWidthPx: [220, 220] })).toBe(
			true
		)
		// One pixel is the whole difference, and it is THEIR pixel: two 220s
		// and the gap between them.
		const exact = 220 + 220 + RAIL_GAP_PX
		expect(
			collapseColumn({ columnPx: exact, minWidthPx: [220, 220] })
		).toBe(false)
		expect(
			collapseColumn({ columnPx: exact - 1, minWidthPx: [220, 220] })
		).toBe(true)
	})

	it("never puts two widgets side by side below the breakpoint", () => {
		// Ruled 2026-09-10: on mobile there are no side-by-side placements at
		// all, however wide the thing claims to be.
		expect(
			collapseColumn({
				columnPx: 4000,
				minWidthPx: [220, 220],
				narrow: true
			})
		).toBe(true)
	})

	it("has nothing to collapse when nothing shares a row", () => {
		expect(collapseColumn({ columnPx: 100, minWidthPx: [220] })).toBe(false)
		expect(collapseColumn({ columnPx: 100, minWidthPx: [] })).toBe(false)
		// …except on mobile, where a single widget is already a row of one.
		expect(
			collapseColumn({ columnPx: 100, minWidthPx: [220], narrow: true })
		).toBe(true)
	})

	it("leaves an unmeasured column as it was arranged", () => {
		// 0 is "not laid out yet", not "no room": collapsing on it would flip
		// every 4K layout to a single column for a frame on every load.
		expect(collapseColumn({ columnPx: 0, minWidthPx: [220, 220] })).toBe(
			false
		)
	})

	it("keeps a floor a widget is actually usable at", () => {
		expect(MIN_WIDGET_PX).toBeGreaterThan(120)
	})
})

describe("collapsedOrder — anchors mean order, and nothing else", () => {
	const at = (key: string, y: number, x = 0, anchor?: any) => ({
		key,
		box: { x, y },
		anchor
	})

	it("draws a collapsed column in grid order: down, then across", () => {
		expect(
			collapsedOrder([
				at("c", 2),
				at("a", 0),
				at("b", 1, 3),
				at("b2", 1, 0)
			])
		).toEqual(["a", "b2", "b", "c"])
	})

	it("puts top-anchored first and bottom-anchored last", () => {
		expect(
			collapsedOrder([
				at("mid", 1),
				at("foot", 2, 0, { bottom: true }),
				at("head", 3, 0, { top: true })
			])
		).toEqual(["head", "mid", "foot"])
	})

	it("keeps grid order WITHIN each of the three bands", () => {
		expect(
			collapsedOrder([
				at("h2", 5, 0, { top: true }),
				at("h1", 1, 0, { top: true }),
				at("f2", 9, 0, { bottom: true }),
				at("f1", 4, 0, { bottom: true }),
				at("m", 2)
			])
		).toEqual(["h1", "h2", "m", "f1", "f2"])
	})

	it("reads an anchor to BOTH edges as top — it cannot be in two places", () => {
		expect(
			collapsedOrder([
				at("free", 0),
				at("both", 9, 0, { top: true, bottom: true })
			])
		).toEqual(["both", "free"])
	})

	it("ignores the left/right anchors: there is only one column now", () => {
		expect(
			collapsedOrder([
				at("b", 1, 0, { left: true }),
				at("a", 0, 0, { right: true })
			])
		).toEqual(["a", "b"])
	})
})
