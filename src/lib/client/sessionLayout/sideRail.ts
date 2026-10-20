/**
 * The side column's RAIL MODEL (ruled 2026-09-10) — pure, and the whole
 * decision behind it.
 *
 * The older idea was a parent side panel that arbitrated the column's space
 * for everything in it. This replaces it: **each docked widget group in a side
 * column is its own toggling panel**, and the column is a stack of them plus a
 * slim rail of icons at its outer edge. Three rules, and this module is all
 * three:
 *
 *   (a) a group is either EXPANDED in the column or COLLAPSED to an icon in
 *       the rail. That is the only thing more enabled widgets ever adds — more
 *       icons, never more chrome.
 *   (b) PINNED groups are expanded by default and KEEP their height when a
 *       sibling expands. They are served first, at their own share of the
 *       column, and nothing later takes it back from them.
 *   (c) a group that cannot fit beside them — the column's remainder is under
 *       its minimum — opens as a FLYOUT over the session at full column
 *       height rather than squeezing the column. That is the same flyout the
 *       unpinned rails have always had; it closes on outside click, Escape, or
 *       its own rail icon.
 *
 * Nothing here is persisted, and both inputs arrive as arguments. A group's
 * `pinned` is its PANEL's (PLAN-session-panels-2026-10-14: docked, or in the
 * rail — `pinned: false`) and `open` is transient UI state whose default is
 * exactly `pinned`. This module holds no state of its own, so the simulator
 * and the live host can run the same decision over different numbers and get
 * the same behaviour.
 *
 * A "group" is a panel: one or more widgets as tabs. Its height is the
 * panel's (`fit` · `fill` · `{ share }`, below).
 */
import type { PanelHeightV1 } from "@serene-pub/sdk"

/** The slim icon rail at a column's outer edge. Matches `.zone-iconstrip`. */
export const RAIL_PX = 36

/**
 * The least height a group is worth expanding into, i.e. the height (c) tests
 * the column's remainder against, and the least it will expand to. A stated
 * choice, not a measured one: a panel header plus enough body to read.
 */
export const MIN_GROUP_PX = 120

/** Gap between two stacked groups — `.live-side`'s 0.4rem. */
export const RAIL_GAP_PX = 6

/** Where one group is drawn. */
export type RailState = "expanded" | "collapsed" | "flyout"

/** How a cell is drawn: the rail's three, plus the sheet's folded title bar. */
export type CellState = RailState | "folded"

/**
 * A whole side column, resolved: the answer the side rail model's
 * `columnLayout` returns and the live side (./SideMount) draws.
 */
export interface ColumnLayout {
	/** Where each panel is drawn, by panel key. */
	state: Record<string, CellState>
	/** Each drawn panel's grid row (1-based), in column order. */
	row: Record<string, number>
	/** `grid-template-rows` for the rows that are actually drawn. */
	rows: string
	/** The one panel currently OVER the session, if any. */
	flyout: string | null
}

export interface RailFitInput {
	/** Usable height of the column. */
	columnPx: number
	/** Height already committed to groups that keep it (rule (b)). */
	takenPx: number
	/** The least height this group is usable at. */
	minPx: number
	/** Gap between two stacked groups. Default `RAIL_GAP_PX`. */
	gapPx?: number
}

/**
 * Rule (c), on its own: can this group expand beside what already holds the
 * column, or must it fly out over the session?
 *
 * An UNMEASURED column (0, the state every column is in for its first frame)
 * is deliberately not an answer of "no room": read that way, every group that
 * is expanded by default would open as a flyout on first paint and then snap
 * back a frame later.
 */
export function railFit(o: RailFitInput): "inline" | "flyout" {
	if (!(o.columnPx > 0)) return "inline"
	const gap = o.takenPx > 0 ? (o.gapPx ?? RAIL_GAP_PX) : 0
	return o.columnPx - o.takenPx - gap >= o.minPx ? "inline" : "flyout"
}

export interface RailGroup {
	/** The panel's key. */
	key: string
	/**
	 * Its height (PLAN-session-panels §1.3): `fit` its content (at least the
	 * floor), `fill` an equal share of what the others leave, `{ share }`
	 * twelfths of the column's docked height.
	 */
	height: PanelHeightV1
	/** Docked by the layout: expanded by default, and keeps its height. */
	pinned: boolean
	/** The user has this group open. Defaults to `pinned` at the call site. */
	open: boolean
}

export interface RailColumnInput {
	/** Measured height of the column, px. 0 = not measured yet. */
	columnPx: number
	/** The groups, in COLUMN ORDER (top to bottom). */
	groups: RailGroup[]
	/**
	 * The group the user opened last, and the ONLY one allowed to fly out. An
	 * expand-all would otherwise stack a flyout per group that did not fit;
	 * the honest reading of "expand everything" is "fill the column, and leave
	 * what does not fit as icons".
	 */
	focusKey?: string | null
	/** Below the app's 1024px breakpoint: nothing docks (see below). */
	narrow?: boolean
	gapPx?: number
	minGroupPx?: number
}

export interface RailPlacement {
	key: string
	state: RailState
	/**
	 * A `{ share }` group's height in the column when `expanded`, px. 0 means
	 * "not expanded", "the column has not been measured yet", or a `fit` /
	 * `fill` group, whose height is the grid's to share out (`track`).
	 */
	heightPx: number
	/** Its `grid-template-rows` track when `expanded`; "" otherwise. */
	track: string
}

/**
 * A panel's grid track: `{ share }` its twelfths (px once the column is
 * measured, else as `fr`), `fit` its content but never under the floor, and
 * `fill` an equal share of whatever the others leave.
 */
export function panelTrack(
	height: PanelHeightV1,
	heightPx: number,
	floorPx = MIN_GROUP_PX
): string {
	if (typeof height === "object")
		return heightPx > 0 ? `${heightPx}px` : `minmax(0,${height.share}fr)`
	if (height === "fit") return `minmax(${floorPx}px,auto)`
	return "minmax(0,1fr)"
}

/**
 * Resolve a whole column: which groups are drawn where, and how tall.
 *
 * The pinned open groups are served first and are never revisited, which IS
 * rule (b). Then the rest, in column order: each expands into what is left if
 * `railFit` says it fits, and otherwise becomes an icon — or the one flyout,
 * if it is the group the user just asked for.
 *
 * What a group costs the column is its `{ share }` (its twelfths of the
 * column, less the gaps) or, for `fit` and `fill`, the floor: content and
 * fills are the grid's to size (`panelTrack`), and the floor is what each
 * must at least have to be worth expanding.
 *
 * Below the breakpoint (`narrow`) a side takes no layout space at all, so
 * there is no column to dock into: everything is an icon, and the group the
 * user tapped is the sheet. That is the existing mobile overlay, reached
 * through the same decision rather than through a second model.
 */
export function resolveRailColumn(o: RailColumnInput): RailPlacement[] {
	const gap = o.gapPx ?? RAIL_GAP_PX
	const floor = o.minGroupPx ?? MIN_GROUP_PX
	const column = Math.max(0, o.columnPx)

	if (o.narrow) {
		return o.groups.map((g) => ({
			key: g.key,
			state:
				g.open && g.key === o.focusKey
					? ("flyout" as const)
					: ("collapsed" as const),
			heightPx: 0,
			track: ""
		}))
	}

	/**
	 * The height the groups divide between them: the column, less the gap
	 * that separates each pair. Counted over ALL the groups, not the open ones
	 * — a share that moved as siblings opened and closed would be a pinned
	 * group changing height, which is the one thing rule (b) forbids. Rounded
	 * DOWN so twelve twelfths never add up to more than the column.
	 */
	const usable = Math.max(0, column - gap * Math.max(0, o.groups.length - 1))
	const shareOf = (g: RailGroup) =>
		column > 0 && typeof g.height === "object"
			? Math.max(0, Math.floor((Math.max(0, g.height.share) / 12) * usable))
			: 0

	const out = new Map<string, RailPlacement>()
	const closed = (key: string): RailPlacement => ({
		key,
		state: "collapsed",
		heightPx: 0,
		track: ""
	})
	let taken = 0
	// Pinned first, wherever they sit in the column: rule (b) is that they are
	// served before anything else can spend the space.
	const order = [
		...o.groups.filter((g) => g.pinned),
		...o.groups.filter((g) => !g.pinned)
	]
	let flew = false
	for (const g of order) {
		if (!g.open) {
			out.set(g.key, closed(g.key))
			continue
		}
		const share = shareOf(g)
		// A share alone could never overflow the column (the shares are
		// proportions OF it), so the floor is what makes rule (c) reachable:
		// a short column is exactly where a stack stops fitting.
		const wanted = Math.max(share, floor)
		if (
			railFit({
				columnPx: column,
				takenPx: taken,
				minPx: floor,
				gapPx: gap
			}) === "inline"
		) {
			const cost = taken > 0 ? gap : 0
			const spent = column > 0 ? Math.min(wanted, column - taken - cost) : 0
			// Only a share is a height of its own; fit and fill are the grid's.
			const heightPx = typeof g.height === "object" ? spent : 0
			taken += cost + spent
			out.set(g.key, {
				key: g.key,
				state: "expanded",
				heightPx,
				track: panelTrack(g.height, heightPx, floor)
			})
		} else if (!flew && g.key === o.focusKey) {
			flew = true
			out.set(g.key, { key: g.key, state: "flyout", heightPx: 0, track: "" })
		} else {
			out.set(g.key, closed(g.key))
		}
	}
	// Reported in the order the caller gave them — the column's order, which is
	// what it draws in — however they were served.
	return o.groups.map((g) => out.get(g.key)!)
}

/**
 * Roving focus over a rail of icons (ported from the retired v2 stage,
 * 2026-09-27): a rail is ONE tab stop, and the arrow keys, Home and End move
 * within it — the WAI-ARIA toolbar pattern, instead of one tab stop per icon.
 * Both arrow axes step, so the same rail reads the same whether it is drawn
 * as a column or, on a phone, as a row. Wraps at both ends.
 *
 * Returns the index to focus, or `null` for a key the rail does not handle
 * (which the caller must then leave alone, so Tab and Enter still work).
 */
export function rovingStep(
	key: string,
	index: number,
	count: number
): number | null {
	if (count <= 0) return null
	let next: number
	if (key === "ArrowDown" || key === "ArrowRight") next = index + 1
	else if (key === "ArrowUp" || key === "ArrowLeft") next = index - 1
	else if (key === "Home") next = 0
	else if (key === "End") next = count - 1
	else return null
	return (next + count) % count
}

/** The index that holds a rail's tab stop, kept inside a rail that shrank. */
export function rovingStop(remembered: number | undefined, count: number): number {
	if (count <= 0) return 0
	return Math.min(Math.max(0, remembered ?? 0), count - 1)
}
