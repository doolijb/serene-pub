/**
 * Each panel's PLACEMENT and its tab's icon — the half of ./sessionLayoutModel
 * the live zone columns decide with. The rail is gone (PLAN 2026-11-05 ★1:
 * every panel is always open), so what is left of the old side rail model is
 * these two. The session layout's model builds one (`rail`) and hands it out.
 */
import * as Icons from "@lucide/svelte"
import type { PanelInstance } from "$lib/client/surfaces/types"
import { tierFor } from "$lib/client/surfaces/types"
import type { PlacementInput } from "$lib/shared/widgets/context"
import { type DrawnPanel } from "@serene-pub/sdk"
import { conversationKindOf } from "./conversationTarget"

export interface SideRailModelInput {
	inst(id: string): PanelInstance | undefined
	iconOf(p: PanelInstance): any
	middleWidgetIcon(id: string): any
}

export function createSideRailModel(input: SideRailModelInput) {
	/** A tab's icon: the conversation's, or its widget's. */
	function tabIcon(id: string) {
		if (conversationKindOf(id) === "messages") return input.middleWidgetIcon(id)
		const p = input.inst(id)
		return p ? input.iconOf(p) : Icons.LayoutPanelTop
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
		const conversation = conversationKindOf(id) !== null
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
			// The envelope's `pinned` / `collapsed` / `drawered` stay on the
			// wire as true / false / false (PLAN 2026-11-05 D4): every panel
			// is always open and there is no pin.
			pinned: true,
			collapsed: false,
			drawered: false,
			// Told, not derived: `Panel` paints a card and a title bar for a
			// widget, and the conversation family (Messages, Composer, Turn
			// line) renders full-bleed with neither. A tab's title is its TAB,
			// so a tab of a two-tab panel gets no bar.
			chrome: conversation
				? { background: false, wrapper: false, titleBar: false }
				: {
						background: true,
						wrapper: true,
						titleBar: p.tabs.length === 1
					}
		}
	}

	return { panelPlacement, tabIcon }
}

export type SideRailModel = ReturnType<typeof createSideRailModel>
