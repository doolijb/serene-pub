/**
 * The SIDE RAIL MODEL (ruled 2026-09-10), the middle's collapse and the
 * arranged cells' placement — the half of ./sessionLayoutModel that the live
 * columns, the arranged middle and the Move tab's rail preview decide with.
 * The session layout's model builds one (`rail`) and hands it out.
 */
import * as Icons from "@lucide/svelte"
import type { PanelInstance } from "$lib/client/surfaces/types"
import { unitPinned } from "./arrangedGeometry"
import { unitsOf, type RenderUnit } from "./tabGroups"
import { placementOf } from "./widgetGrid"
import type { PlacementInput } from "$lib/shared/widgets/context"
import {
	MIN_WIDGET_PX,
	collapseColumn,
	collapsedOrder,
	resolveRailColumn,
	type CellState,
	type ColumnLayout,
	type RailPlacement
} from "./sideRail"
import {
	type ArrangedItem,
	type DrawnZone,
	isInstanceOf
} from "@serene-pub/sdk"

/** A side column's measure, as the rail model is decided against it. */
export interface ColumnMeasure {
	/** The mobile sheet: the side's panels listed, not a column of them. */
	sheet: boolean
	/** Below the app's 1024px breakpoint (or previewing a width that is). */
	narrow: boolean
	/**
	 * The sides are tucked (./tuckedSides): every group is a rail icon and
	 * the one the tucked flyout names (`tuckedKey`) is the flyout — whatever
	 * the user's docked open/closed choices were, which are kept for untucking.
	 */
	tucked?: boolean
	/** The group the tucked flyout shows on THIS side, if any. */
	tuckedKey?: string | null
	heightPx: number
	widthPx: number
}

export interface SideRailModelInput {
	inst(id: string): PanelInstance | undefined
	iconOf(p: PanelInstance): any
	middleWidgetIcon(id: string): any
	widgetLabel(id: string): string
}

export function createSideRailModel(input: SideRailModelInput) {
	/* ── the side rail model (ruled 2026-09-10) ─────────────────────────────
	 * Each docked widget GROUP — a tab group, or a lone widget, which is a group
	 * of one — is its own toggling panel, and the column is a stack of them plus
	 * a slim rail of icons at its outer edge:
	 *
	 *   (a) a group is EXPANDED in the column or COLLAPSED to a rail icon, so
	 *       enabling more widgets only ever adds icons;
	 *   (b) PINNED groups are expanded by default and KEEP their height when a
	 *       sibling expands;
	 *   (c) a group with no room left beside them opens as a FLYOUT over the
	 *       session at full column height rather than squeezing the column, and
	 *       closes on outside click, Escape or its own rail icon.
	 *
	 * ./sideRail is all three, pure and tested. Of the two inputs it takes,
	 * exactly one is persisted: a group's `pinned` is a field on the arranged
	 * ITEMS it is made of (`unitPinned` / `withPins` in ./arrangedGeometry),
	 * written by the Move tab, while `open` — which unpinned groups the user
	 * has out right now — is transient per session view and defaults to exactly
	 * `pinned`. The live columns and the Move tab's preview read the same state.
	 */
	/** Transient per-group open state, keyed `side:groupKey`. Default: pinned. */
	let groupOpen = $state<Record<string, boolean>>({})
	/** The group opened last, per side — the only one allowed to fly out. */
	let groupFocus = $state<Record<"left" | "right", string | null>>({
		left: null,
		right: null
	})
	function groupKey(side: "left" | "right", key: string): string {
		return `${side}:${key}`
	}
	/**
	 * A group's pin, read off the arrangement it is made of. NOT the zone's pin
	 * (that one is the un-arranged rail's — docked rail vs icon strip); an
	 * arrangement that carries none reads as all pinned.
	 */
	function groupPinned(u: RenderUnit): boolean {
		return unitPinned(u.members)
	}
	function groupIsOpen(side: "left" | "right", u: RenderUnit): boolean {
		return groupOpen[groupKey(side, u.key)] ?? groupPinned(u)
	}
	function toggleGroup(side: "left" | "right", u: RenderUnit) {
		const open = !groupIsOpen(side, u)
		groupOpen[groupKey(side, u.key)] = open
		// Only the group the user just asked for may fly out (see ./sideRail),
		// so closing one hands the focus back rather than leaving it pointing at
		// a group that is now an icon.
		groupFocus[side] = open ? u.key : null
	}
	/**
	 * The column's groups, top to bottom. Sorted by the arrangement's own cells
	 * — a pure function of the saved geometry, so the order never changes as
	 * groups open and close. It must not: a keyed `{#each}` MOVES its nodes to
	 * follow a reorder, and moving an iframe reloads it.
	 */
	function columnUnits(
		items: readonly ArrangedItem[] | DrawnZone
	): RenderUnit[] {
		return unitsOf(items).sort(
			(a, b) => a.box.y - b.box.y || a.box.x - b.box.x
		)
	}
	/** A group's icon: its widget's, or the stacked one for a tab group. */
	function groupIcon(u: RenderUnit) {
		if (u.members.length > 1) return Icons.Layers
		const id = u.members[0].id
		if (isInstanceOf(id, "messages")) return input.middleWidgetIcon(id)
		const p = input.inst(id)
		return p ? input.iconOf(p) : Icons.LayoutPanelTop
	}
	/**
	 * The same icon as a NAME, for the panels menu — that list crosses a module
	 * bridge to the header, and a component reference is a thing to draw with,
	 * not a thing to publish.
	 */
	function groupIconName(u: RenderUnit): string {
		if (u.members.length > 1) return "Layers"
		const id = u.members[0].id
		if (isInstanceOf(id, "messages")) return "MessagesSquare"
		return input.inst(id)?.icon || "LayoutPanelTop"
	}
	/** A group's tooltip: every title in it, which is what opening it opens. */
	function groupTitle(u: RenderUnit): string {
		return u.members.map((m) => input.widgetLabel(m.id)).join(" · ")
	}
	/**
	 * A column's BANDS: the units that share a row of it, read off the
	 * arrangement's own cells. A band, not a widget, is what the rail model
	 * sizes: two widgets side by side are one row of the column.
	 */
	function bandsOf(units: RenderUnit[]): RenderUnit[][] {
		const bands: RenderUnit[][] = []
		for (const u of units) {
			const last = bands[bands.length - 1]
			if (last?.some((v) => u.box.y < v.box.y + v.box.h)) last.push(u)
			else bands.push([u])
		}
		return bands
	}
	function bandRows(b: RenderUnit[]): number {
		return (
			Math.max(...b.map((u) => u.box.y + u.box.h)) -
			Math.min(...b.map((u) => u.box.y))
		)
	}
	/**
	 * Resolve a whole side column: the rail model over its bands, plus the
	 * collapse and the order a collapsed column draws in.
	 *
	 * Collapsing gives every unit its OWN band — that is what "side by side
	 * becomes rows" means — and the bands are then taken in the collapsed order,
	 * so a top-anchored widget is first and a bottom-anchored one last. The
	 * order is spent as an explicit `grid-row` (and a CSS `order` for the sheet,
	 * which is a flex column): re-sorting the `{#each}` instead would MOVE the
	 * nodes, and moving an iframe reloads it.
	 */
	function columnLayout(
		side: "left" | "right",
		units: RenderUnit[],
		totalRows: number,
		m: ColumnMeasure
	): ColumnLayout {
		const sheet = m.sheet
		const tucked = !!m.tucked && !sheet
		const tuckedKey = tucked ? (m.tuckedKey ?? null) : null
		const isOpen = (u: RenderUnit) =>
			tucked ? u.key === tuckedKey : groupIsOpen(side, u)
		const focusKey = tucked ? tuckedKey : groupFocus[side]
		const natural = bandsOf(units)
		const collapsed = collapseColumn({
			columnPx: m.widthPx,
			// One minimum per widget in the widest row: what has to fit side by
			// side is what decides whether it can.
			minWidthPx: Array(
				Math.max(1, ...natural.map((b) => b.length))
			).fill(MIN_WIDGET_PX),
			// Tucked, every group is its own rail icon, so its own band: the
			// flyout is exactly the group asked for.
			narrow: m.narrow || tucked
		})
		const orderKeys = collapsedOrder(
			units.map((u) => ({
				key: u.key,
				box: u.box,
				anchor: u.members[0]?.anchor
			}))
		)
		const order: Record<string, number> = {}
		orderKeys.forEach((k, i) => (order[k] = i))
		const byKey = new Map(units.map((u) => [u.key, u]))
		const bands = collapsed
			? orderKeys.map((k) => [byKey.get(k)!]).filter((b) => !!b[0])
			: natural
		const focus = bands.findIndex((b) => b.some((u) => u.key === focusKey))
		// The SHEET is not a column — it is the side's panels, listed — so
		// nothing in it competes for height and nothing flies out of it.
		const place: RailPlacement[] = sheet
			? bands.map((_, i) => ({
					key: `b${i}`,
					state: "expanded" as const,
					heightPx: 0
				}))
			: resolveRailColumn({
					columnPx: m.heightPx,
					totalRows,
					groups: bands.map((b, i) => ({
						key: `b${i}`,
						rows: bandRows(b),
						pinned: b.some((u) => groupPinned(u)),
						open: b.some((u) => isOpen(u))
					})),
					focusKey: focus >= 0 ? `b${focus}` : null,
					// The rail model's no-column answer: all icons, and the one
					// asked for flies out.
					narrow: m.narrow || tucked
				})
		const state: Record<string, CellState> = {}
		const row: Record<string, number> = {}
		const heights: number[] = []
		bands.forEach((b, i) => {
			const p = place[i]
			const drawnHere = p.state !== "collapsed"
			if (drawnHere && p.state !== "flyout") heights.push(p.heightPx)
			const r = Math.max(1, heights.length)
			// A band that flies out flies out ONCE: two members positioned over
			// the session at the same edge would sit on top of each other, so
			// the one the user asked for goes and the rest stay icons.
			let flownHere = false
			for (const u of b) {
				const open = isOpen(u)
				const mine =
					p.state !== "flyout" ||
					(!flownHere &&
						(focusKey === u.key ||
							b.every((v) => focusKey !== v.key)))
				if (p.state === "flyout" && mine && open) flownHere = true
				row[u.key] = r
				state[u.key] = sheet
					? // Ruled 2026-09-10: the pinned / expanded state carries
						// over, and a group that is not open arrives folded to
						// its title bar rather than gone.
						open
						? "expanded"
						: "folded"
					: drawnHere && open && mine
						? p.state
						: "collapsed"
			}
		})
		return {
			state,
			row,
			order,
			collapsed,
			flyout:
				Object.entries(state).find(([, v]) => v === "flyout")?.[0] ??
				null,
			// A band with a height of its own gets it; 0 is the unmeasured
			// column, where flex/grid sharing them out is the better guess.
			rows: heights.map((h) => (h > 0 ? `${h}px` : "1fr")).join(" ")
		}
	}
	/**
	 * A group's box in the column. The height is the grid's (`col.rows`), so all
	 * this places is WHICH row — and, when the column is collapsed, that it has
	 * a column of its own. `order` rides along for the mobile sheet, which is a
	 * flex column and so cannot read an explicit grid row; in the grid it is
	 * inert, because every cell there is placed explicitly.
	 */
	function cellGridStyle(
		u: RenderUnit,
		col: ColumnLayout,
		state: CellState
	): string {
		if (state === "collapsed") return "display:none;"
		const order = `order:${col.order[u.key] ?? 0};`
		// A flyout is out of flow entirely (see the renderer's `flyoutStyle`).
		if (state === "flyout") return order
		const row = col.row[u.key] ?? 1
		return col.collapsed
			? `grid-column:1;grid-row:${row};${order}`
			: `grid-column:${u.box.x + 1} / span ${u.box.w};grid-row:${row};${order}`
	}

	/* ── the MIDDLE zone's collapse (ruled 2026-09-10) ──────────────────────
	 * The same rule, in the zone that is not a rail: below the breakpoint there
	 * are no side-by-side placements anywhere, and above it the middle collapses
	 * when it is narrower than the widgets sharing a row need. The order is the
	 * collapsed one — top-anchored first, bottom-anchored last — and it is spent
	 * as an explicit grid row, never as a re-sorted `{#each}`: the middle is
	 * where Messages lives, and moving it is the reload the whole layout is
	 * built to avoid. The row heights stay PROPORTIONAL (`<rows>fr` each), so a
	 * collapsed middle is the arrangement stacked, not the arrangement
	 * forgotten. `items` is the arranged middle (none while it is drawn from the
	 * grid), `widthPx` its measured width. */
	function middleCollapse(
		items: readonly ArrangedItem[] | DrawnZone,
		widthPx: number,
		narrow: boolean
	) {
		const units = columnUnits(items)
		const bands = bandsOf(units)
		const collapsed = collapseColumn({
			columnPx: widthPx,
			minWidthPx: Array(Math.max(1, ...bands.map((b) => b.length))).fill(
				MIN_WIDGET_PX
			),
			narrow
		})
		const keys = collapsedOrder(
			units.map((u) => ({
				key: u.key,
				box: u.box,
				anchor: u.members[0]?.anchor
			}))
		)
		const row: Record<string, number> = {}
		keys.forEach((k, i) => (row[k] = i + 1))
		const byKey = new Map(units.map((u) => [u.key, u]))
		return {
			collapsed,
			row,
			rows: keys
				.map((k) => `${Math.max(1, byKey.get(k)?.box.h ?? 1)}fr`)
				.join(" ")
		}
	}

	/* ── real placement for the arranged renderers (PLAN 25) ───────────────
	 * A widget's `layout.v1` has to describe the cells it is actually in, and
	 * the arranged zones are the one place that geometry already exists in
	 * full: the zone's cell grid and each render unit's box. So the placement
	 * is a repackaging, not a second layout pass — `placementOf` derives the
	 * zone edges the box touches and the tier from the cell's measured width
	 * (the renderer measures each cell). */
	function unitPlacement(
		zone: { cols: number; rows: number } | undefined,
		u: RenderUnit,
		widthPx: number,
		id: string,
		heightPx?: number
	): PlacementInput {
		// Geometry is the UNIT's — grouped widgets share one footprint, which is
		// what a tab group is — while pinned/collapsed and the chrome are the
		// individual widget's.
		const p = input.inst(id)
		const primary = isInstanceOf(id, "messages")
		return placementOf({
			// `zone` is absent only for the one read a mount can still make
			// while its arranged zone is being taken down. The answer is thrown
			// away with it.
			zone: { cols: zone?.cols ?? 1, rows: zone?.rows ?? 1 },
			box: u.box,
			widthPx,
			heightPx,
			// The contract's `pinned`: "placed in the grid, not collapsible /
			// closable away". The conversation — and an R71 genre's own
			// primary — never collapses or closes away wherever it is placed;
			// for a panel it is its own declaration.
			pinned:
				primary || p?.role === "primary"
					? true
					: !(p?.layout.closable ?? true),
			collapsed: p?.collapsed ?? false,
			// Nothing in an arranged zone is drawered — the zone places its
			// widgets (Panel's `chrome="zone"`).
			drawered: false,
			// Told, not derived: `Panel` paints a card and a title bar for every
			// secondary, and the primary widget renders full-bleed with neither.
			// A grouped member's title comes from its TAB, so it gets no bar.
			chrome: primary
				? { background: false, wrapper: false, titleBar: false }
				: {
						background: true,
						wrapper: true,
						titleBar: u.members.length === 1
					}
		})
	}
	/**
	 * justify/align-self for an arranged cell from a widget's anchor edges —
	 * the connector's analog of widgetItemStyle's anchoring. Default (no
	 * anchor) is stretch; only a widget the user explicitly anchored changes.
	 */
	function cellSelfAlign(near?: boolean, far?: boolean): string {
		if (near && far) return "stretch"
		if (near) return "start"
		if (far) return "end"
		return "stretch"
	}
	function anchorCellStyle(a?: {
		top?: boolean
		bottom?: boolean
		left?: boolean
		right?: boolean
	}): string {
		if (!a) return ""
		return `justify-self:${cellSelfAlign(a.left, a.right)};align-self:${cellSelfAlign(a.top, a.bottom)};`
	}

	return {
		unitPlacement,
		anchorCellStyle,
		get groupOpen() {
			return groupOpen
		},
		set groupOpen(v: Record<string, boolean>) {
			groupOpen = v
		},
		get groupFocus() {
			return groupFocus
		},
		groupKey,
		groupPinned,
		groupIsOpen,
		toggleGroup,
		columnUnits,
		groupIcon,
		groupIconName,
		groupTitle,
		columnLayout,
		cellGridStyle,
		middleCollapse
	}
}

export type SideRailModel = ReturnType<typeof createSideRailModel>
