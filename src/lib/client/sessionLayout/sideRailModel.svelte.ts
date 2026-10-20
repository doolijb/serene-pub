/**
 * The SIDE RAIL MODEL (ruled 2026-09-10) and each panel's placement — the
 * half of ./sessionLayoutModel the live side columns decide with
 * (PLAN-session-panels-2026-10-14). The session layout's model builds one
 * (`rail`) and hands it out.
 */
import * as Icons from "@lucide/svelte"
import type { PanelInstance } from "$lib/client/surfaces/types"
import { tierFor } from "$lib/client/surfaces/types"
import type { PlacementInput } from "$lib/shared/widgets/context"
import {
	resolveRailColumn,
	type CellState,
	type ColumnLayout,
	type RailPlacement
} from "./sideRail"
import { type DrawnPanel, isInstanceOf } from "@serene-pub/sdk"

/** A side column's measure, as the rail model is decided against it. */
export interface ColumnMeasure {
	/** The mobile sheet: the side's panels listed, not a column of them. */
	sheet: boolean
	/** Below the app's 1024px breakpoint (or previewing a width that is). */
	narrow: boolean
	/**
	 * The side is drawn tucked (./tuckedSides, or a rail-only side): every
	 * panel is a rail icon and the one the tucked flyout names (`tuckedKey`)
	 * is the flyout — whatever the user's docked open/closed choices were,
	 * which are kept for untucking.
	 */
	tucked?: boolean
	/** The panel the tucked flyout shows on THIS side, if any. */
	tuckedKey?: string | null
	/**
	 * Panels the column treats as docked whatever their pin: the one holding
	 * the layout's primary log, which is never put behind a rail icon.
	 */
	alwaysDocked?: ReadonlySet<string>
	heightPx: number
}

export interface SideRailModelInput {
	inst(id: string): PanelInstance | undefined
	iconOf(p: PanelInstance): any
	middleWidgetIcon(id: string): any
	widgetLabel(id: string): string
}

export function createSideRailModel(input: SideRailModelInput) {
	/* ── the side rail model (ruled 2026-09-10) ─────────────────────────────
	 * Each PANEL in a side column is its own toggling box, and the column is a
	 * stack of them plus a slim rail of icons at its outer edge:
	 *
	 *   (a) a panel is EXPANDED in the column or COLLAPSED to a rail icon, so
	 *       enabling more widgets only ever adds icons;
	 *   (b) DOCKED panels are expanded by default and KEEP their height when
	 *       a sibling expands;
	 *   (c) a panel with no room left beside them opens as a FLYOUT over the
	 *       session at full column height rather than squeezing the column, and
	 *       closes on outside click, Escape or its own rail icon.
	 *
	 * ./sideRail is all three, pure and tested. Of the two inputs it takes,
	 * exactly one is persisted: a panel's `pinned` (docked, or in the rail),
	 * while `open` — which rail panels the user has out right now — is
	 * transient per session view and defaults to exactly `pinned`.
	 */
	/** Transient per-panel open state, keyed `side:panelKey`. Default: pinned. */
	let groupOpen = $state<Record<string, boolean>>({})
	/** The panel opened last, per side — the only one allowed to fly out. */
	let groupFocus = $state<Record<"left" | "right", string | null>>({
		left: null,
		right: null
	})
	function groupKey(side: "left" | "right", key: string): string {
		return `${side}:${key}`
	}
	/** A panel's pin: docked (`true`) or in the rail. */
	function groupPinned(p: DrawnPanel): boolean {
		return p.pinned
	}
	function groupIsOpen(side: "left" | "right", p: DrawnPanel): boolean {
		return groupOpen[groupKey(side, p.key)] ?? groupPinned(p)
	}
	function toggleGroup(side: "left" | "right", p: DrawnPanel) {
		const open = !groupIsOpen(side, p)
		groupOpen[groupKey(side, p.key)] = open
		// Only the panel the user just asked for may fly out (see ./sideRail),
		// so closing one hands the focus back rather than leaving it pointing
		// at a panel that is now an icon.
		groupFocus[side] = open ? p.key : null
	}
	/** A tab's icon: the conversation's, or its widget's. */
	function tabIcon(id: string) {
		if (isInstanceOf(id, "messages")) return input.middleWidgetIcon(id)
		const p = input.inst(id)
		return p ? input.iconOf(p) : Icons.LayoutPanelTop
	}
	/** A panel's icon: its FIRST tab's (a count badge says there are more). */
	function groupIcon(p: DrawnPanel) {
		const id = p.tabs[0]?.instanceId
		return id ? tabIcon(id) : Icons.LayoutPanelTop
	}
	/**
	 * The same icon as a NAME, for the panels menu — that list crosses a module
	 * bridge to the header, and a component reference is a thing to draw with,
	 * not a thing to publish.
	 */
	function groupIconName(p: DrawnPanel): string {
		const id = p.tabs[0]?.instanceId
		if (!id) return "LayoutPanelTop"
		if (isInstanceOf(id, "messages")) return "MessagesSquare"
		return input.inst(id)?.icon || "LayoutPanelTop"
	}
	/** A panel's name: a person's title for it, else every tab's, in order. */
	function groupTitle(p: DrawnPanel): string {
		if (p.title && p.tabs.length > 1) return p.title
		return p.tabs.map((t) => input.widgetLabel(t.instanceId)).join(" · ")
	}
	/**
	 * Resolve a whole side column: the rail model over its panels, top to
	 * bottom. The order is the layout's — never re-sorted, because a keyed
	 * `{#each}` MOVES its nodes to follow a reorder, and moving an iframe
	 * reloads it.
	 */
	function columnLayout(
		side: "left" | "right",
		panels: readonly DrawnPanel[],
		m: ColumnMeasure
	): ColumnLayout {
		const sheet = m.sheet
		const tucked = !!m.tucked && !sheet
		const tuckedKey = tucked ? (m.tuckedKey ?? null) : null
		const docked = (p: DrawnPanel) =>
			groupPinned(p) || !!m.alwaysDocked?.has(p.key)
		const isOpen = (p: DrawnPanel) =>
			tucked
				? p.key === tuckedKey
				: m.alwaysDocked?.has(p.key) || groupIsOpen(side, p)
		const focusKey = tucked ? tuckedKey : groupFocus[side]
		// The SHEET is not a column — it is the side's panels, listed — so
		// nothing in it competes for height and nothing flies out of it.
		const place: RailPlacement[] = sheet
			? panels.map((p) => ({
					key: p.key,
					state: "expanded" as const,
					heightPx: 0,
					track: ""
				}))
			: resolveRailColumn({
					columnPx: m.heightPx,
					groups: panels.map((p) => ({
						key: p.key,
						height: p.height,
						pinned: docked(p),
						open: isOpen(p)
					})),
					focusKey,
					// The rail model's no-column answer: all icons, and the one
					// asked for flies out.
					narrow: m.narrow || tucked
				})
		const state: Record<string, CellState> = {}
		const row: Record<string, number> = {}
		const tracks: string[] = []
		panels.forEach((p, i) => {
			const at = place[i]
			if (sheet) {
				// Ruled 2026-09-10: the docked / open state carries over, and a
				// panel that is not open arrives folded to its title bar
				// rather than gone.
				state[p.key] = isOpen(p) ? "expanded" : "folded"
				row[p.key] = i + 1
				return
			}
			state[p.key] = at.state
			if (at.state === "expanded") {
				tracks.push(at.track)
				row[p.key] = tracks.length
			}
		})
		return {
			state,
			row,
			flyout:
				Object.entries(state).find(([, v]) => v === "flyout")?.[0] ??
				null,
			rows: tracks.join(" ")
		}
	}
	/**
	 * A panel's box in the column. The height is the grid's (`col.rows`), so
	 * all this places is WHICH row.
	 */
	function cellGridStyle(
		p: DrawnPanel,
		col: ColumnLayout,
		state: CellState
	): string {
		if (state === "collapsed") return "display:none;"
		// A flyout is out of flow entirely (see ./SideMount's `flyoutStyle`).
		if (state === "flyout") return ""
		return `grid-column:1;grid-row:${col.row[p.key] ?? 1};`
	}

	/* ── real placement for a panel's tabs (PLAN 25) ────────────────────────
	 * A widget's `layout.v1` describes the box it is actually in: a zone is a
	 * column of panels, one row each, so a panel's place is its index and its
	 * edges are the column's ends. Its tabs share the panel's one box. */
	function panelPlacement(
		p: DrawnPanel,
		at: { index: number; count: number },
		id: string,
		widthPx: number,
		heightPx?: number
	): PlacementInput {
		const inst = input.inst(id)
		const primary = isInstanceOf(id, "messages")
		const count = Math.max(1, at.count)
		const index = Math.min(Math.max(0, at.index), count - 1)
		return {
			zone: { columns: 1, column: 1, rows: count, row: index + 1 },
			box: {
				cols: 1,
				rows: null,
				edges: {
					top: index === 0,
					left: true,
					right: true,
					bottom: index === count - 1
				},
				// Reported only when BOTH axes were measured: a zero is "not
				// measured yet", never a measurement.
				...(widthPx > 0 && heightPx && heightPx > 0
					? { px: { width: widthPx, height: heightPx } }
					: {})
			},
			tier: tierFor(widthPx),
			// The contract's `pinned`: "not collapsible / closable away". The
			// conversation — and an R71 genre's own primary — never collapses
			// or closes away wherever it is placed; for a panel it is its own
			// declaration.
			pinned:
				primary || inst?.role === "primary"
					? true
					: !(inst?.layout.closable ?? true),
			collapsed: inst?.collapsed ?? false,
			// Nothing in a session zone is drawered — the zone places it.
			drawered: false,
			// Told, not derived: `Panel` paints a card and a title bar for a
			// secondary, and the primary renders full-bleed with neither. A
			// tab's title is its TAB, so a tab of a two-tab panel gets no bar.
			chrome: primary
				? { background: false, wrapper: false, titleBar: false }
				: {
						background: true,
						wrapper: true,
						titleBar: p.tabs.length === 1
					}
		}
	}

	return {
		panelPlacement,
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
		tabIcon,
		groupIcon,
		groupIconName,
		groupTitle,
		columnLayout,
		cellGridStyle
	}
}

export type SideRailModel = ReturnType<typeof createSideRailModel>
