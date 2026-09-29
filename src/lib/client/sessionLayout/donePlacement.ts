/**
 * What the layout editor's **Done** writes for MEMBERSHIP — which widget is in
 * which zone — read off the arrangement the editor's zones reported. Pure, so
 * the rule is tested away from the page (`SessionLayout`'s `commitArrangement`
 * spends it, and QF's empty-middle check reads its `middle`).
 *
 * The two halves of the membership model meet here:
 *
 * - a SIDE's list lives in the zone template, and a side zone that reported a
 *   frame has it replaced wholesale, in row order;
 * - the MIDDLE's lives in the chat widget grid, reconciled against the middle
 *   frame by `withGridMembership` (an absent frame is no opinion).
 *
 * Placement is free (brief 7a): the conversation is written wherever its card
 * was left, a side included. Nothing here strips it back out — the only rule
 * left is the primary floor, which the editor keeps by never offering to
 * remove the last instance (./primaryFloor).
 *
 * A grid entry that names a SIDE zone (a hand-written or preset blob; the grid
 * editor never writes one) is folded into that side's list when the page reads
 * the layout. Once that side has reported a frame here the list is the truth,
 * so the grid's copy of the entry is dropped rather than left to draw twice.
 */
import type { Arranged } from "./arrangedGeometry"
import type { ZoneLayout } from "./schema"
import {
	widgetsInZone,
	withGridMembership,
	withoutGridWidget,
	type GridLayout
} from "./widgetGrid"

export interface DoneInput {
	/** The zone template as it stands (side lists). */
	zones: ZoneLayout
	/** The chat widget grid as it stands (the middle's membership). */
	grid: GridLayout
	/** The editor's arrangement, already deduplicated (`dedupeArranged`). */
	arrangement: Arranged
	/** The zone template ids the editor's Left and Right zones edit. */
	sideZoneIds: { left: string | null; right: string | null }
}

export interface DonePlacement {
	zones: ZoneLayout
	grid: GridLayout
	/** The middle's membership as committed, in row order — what QF checks. */
	middle: string[]
}

/** A frame's ids, top to bottom — the order a saved list is written in. */
function rowOrder(items: readonly { id: string; y: number }[]): string[] {
	return [...items].sort((p, q) => p.y - q.y).map((i) => i.id)
}

/**
 * The zones and the grid Done commits. Each is returned BY REFERENCE when
 * nothing about it changed, so the caller writes only what moved.
 */
export function placementAtDone(o: DoneInput): DonePlacement {
	let zones = o.zones
	let grid = o.grid
	for (const key of ["left", "right"] as const) {
		const frame = o.arrangement[key]
		const zid = o.sideZoneIds[key]
		if (!frame || !zid || !zones.zones[zid]) continue
		zones = {
			...zones,
			zones: {
				...zones.zones,
				[zid]: { ...zones.zones[zid], widgets: rowOrder(frame.items) }
			}
		}
		for (const w of widgetsInZone(grid, key)) grid = withoutGridWidget(grid, w.id)
	}
	const middleFrame = o.arrangement.middle
	grid = withGridMembership(
		grid,
		"middle",
		middleFrame ? rowOrder(middleFrame.items) : null
	)
	const middle = middleFrame
		? rowOrder(middleFrame.items)
		: widgetsInZone(grid, "middle").map((w) => w.id)
	return { zones, grid, middle }
}
