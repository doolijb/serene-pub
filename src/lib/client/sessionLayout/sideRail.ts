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
 * `pinned` comes from the arrangement — a field on the items the group is made
 * of, ruled 2026-09-10 (see `unitPinned` in ./arrangedGeometry) — and `open` is
 * transient UI state whose default is exactly `pinned`. This module holds no
 * state of its own, so the simulator and the live host can run the same
 * decision over different numbers and get the same behaviour.
 *
 * A "group" is a live render unit (see ./tabGroups): a tab group of several
 * widgets, or a single widget, which is a group of one.
 */

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
	/** The render unit's key (a group id, or a lone widget's id). */
	key: string
	/** Rows this group's box spans in the arrangement — its share of the column. */
	rows: number
	/** Docked by the arrangement: expanded by default, and keeps its height. */
	pinned: boolean
	/** The user has this group open. Defaults to `pinned` at the call site. */
	open: boolean
}

export interface RailColumnInput {
	/** Measured height of the column, px. 0 = not measured yet. */
	columnPx: number
	/** Rows the arrangement's grid has — the denominator for a group's share. */
	totalRows: number
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
	 * The group's height in the column when `expanded`, px. 0 means either
	 * "not expanded" or "the column has not been measured yet" — the renderer
	 * sets no basis for a 0 and lets flex share the space out.
	 */
	heightPx: number
}

/**
 * Resolve a whole column: which groups are drawn where, and how tall.
 *
 * The pinned open groups are served first at their own share of the column and
 * are never revisited, which IS rule (b). Then the rest, in column order: each
 * expands into what is left if `railFit` says it fits, and otherwise becomes an
 * icon — or the one flyout, if it is the group the user just asked for.
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
	const totalRows = Math.max(1, o.totalRows)

	if (o.narrow) {
		return o.groups.map((g) => ({
			key: g.key,
			state:
				g.open && g.key === o.focusKey
					? ("flyout" as const)
					: ("collapsed" as const),
			heightPx: 0
		}))
	}

	/**
	 * The height the group boxes divide between them: the column, less the gap
	 * that separates each pair of them. Counted over ALL the groups, not the
	 * open ones — a share that moved as siblings opened and closed would be a
	 * pinned group changing height, which is the one thing rule (b) forbids.
	 * Without it the shares of a full arrangement add up to the whole column
	 * and the LAST group is short by exactly the gaps: it would sit there
	 * refusing to open, a few pixels from fitting.
	 */
	const usable = Math.max(0, column - gap * Math.max(0, o.groups.length - 1))
	/**
	 * This group's share, from the rows it was arranged at. Rounded DOWN so a
	 * full arrangement's shares can never add up to more than `usable` — the
	 * same few pixels, arriving as a rounding error instead.
	 */
	const shareOf = (g: RailGroup) =>
		column > 0
			? Math.max(
					0,
					Math.floor((Math.max(0, g.rows) / totalRows) * usable)
				)
			: 0

	const out = new Map<string, RailPlacement>()
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
			out.set(g.key, { key: g.key, state: "collapsed", heightPx: 0 })
			continue
		}
		// What the group asks for: its share of the column, but never less than
		// the floor — a group's SHARE alone could never overflow the column
		// (the shares are proportions OF it), so a rule that only ever asked
		// for shares would make rule (c) unreachable. A short column is
		// exactly where a stack of groups stops fitting, and this is where
		// that shows up.
		const wanted = Math.max(shareOf(g), floor)
		if (
			railFit({
				columnPx: column,
				takenPx: taken,
				minPx: floor,
				gapPx: gap
			}) === "inline"
		) {
			const cost = taken > 0 ? gap : 0
			const heightPx =
				column > 0 ? Math.min(wanted, column - taken - cost) : 0
			taken += cost + heightPx
			out.set(g.key, { key: g.key, state: "expanded", heightPx })
		} else if (!flew && g.key === o.focusKey) {
			flew = true
			out.set(g.key, { key: g.key, state: "flyout", heightPx: 0 })
		} else {
			out.set(g.key, { key: g.key, state: "collapsed", heightPx: 0 })
		}
	}
	// Reported in the order the caller gave them — the column's order, which is
	// what it draws in — however they were served.
	return o.groups.map((g) => out.get(g.key)!)
}

/* ── one column, or several? (ruled 2026-09-10) ──────────────────────────
 *
 * A layout made at 4K has to translate to a phone. The rule is not a second
 * layout for small screens: it is that side-by-side placements STOP being
 * side-by-side when there is not room for them, and become rows in grid order
 * instead. Widget authors own what happens inside a widget; the host owns only
 * this collapse.
 *
 * Below the app's 1024px breakpoint that is unconditional — there are no
 * side-by-side placements on mobile at all. On the desktop it is a question
 * about THIS column: whether the widgets that share a row still clear their own
 * minimum widths in it. A fixed breakpoint would answer for a window; a side
 * column is a quarter of one, and it is the column the widgets have to live in.
 */

/**
 * The width a widget stops being usable below. A stated choice, not a measured
 * one, and the DEFAULT the caller passes per widget — a widget that declares
 * its own minimum should be asked, not overruled.
 */
export const MIN_WIDGET_PX = 220

export interface ColumnCollapseInput {
	/** Measured width of the column, px. 0 = not laid out yet. */
	columnPx: number
	/** Minimum usable width of each widget that shares the widest row, px. */
	minWidthPx: number[]
	/** Gap between two side-by-side widgets. Default `RAIL_GAP_PX`. */
	gapPx?: number
	/** Below the app's 1024px breakpoint: never side by side. */
	narrow?: boolean
}

/**
 * Does this column have to draw its widgets one under the other?
 *
 * An UNMEASURED column (0) is left as it was arranged, for the same reason
 * `railFit` does not fly everything out of one: read as "no room", every wide
 * layout would flip to a single column for its first frame and back on the
 * next.
 */
export function collapseColumn(o: ColumnCollapseInput): boolean {
	if (o.narrow) return true
	if (o.minWidthPx.length < 2) return false
	if (!(o.columnPx > 0)) return false
	const gap = o.gapPx ?? RAIL_GAP_PX
	const asked =
		o.minWidthPx.reduce((n, w) => n + Math.max(0, w), 0) +
		gap * (o.minWidthPx.length - 1)
	return asked > o.columnPx
}

export interface OrderUnit {
	key: string
	/** The cells it was arranged at — grid order is `y` then `x`. */
	box: { x: number; y: number }
	/** Anchored edges. In a collapsed column these mean ORDER, and nothing else. */
	anchor?: {
		top?: boolean
		bottom?: boolean
		left?: boolean
		right?: boolean
	}
}

/**
 * The order a collapsed column draws its groups in: top-anchored first,
 * bottom-anchored last, everything else between, and grid order within each of
 * the three.
 *
 * An anchor pins a widget to an edge of its zone, which is a thing a 2D grid
 * can honour and a single column cannot: there is one column, so "left" and
 * "right" have nowhere to point, and "top"/"bottom" can only mean first and
 * last. Anchored to BOTH edges it cannot be in two places, so it is read as
 * top — the same reading `cellSelfAlign` gives it, which is "stretch", i.e. the
 * one it starts at.
 *
 * Returned as keys rather than applied to the DOM on purpose: the renderer
 * spends this on the CSS `order` property. A keyed `{#each}` that re-sorts
 * MOVES its nodes, and moving an iframe reloads it — the no-reload law again.
 */
export function collapsedOrder(units: OrderUnit[]): string[] {
	const rank = (u: OrderUnit) =>
		u.anchor?.top ? 0 : u.anchor?.bottom ? 2 : 1
	return [...units]
		.sort(
			(a, b) =>
				rank(a) - rank(b) || a.box.y - b.box.y || a.box.x - b.box.x
		)
		.map((u) => u.key)
}
