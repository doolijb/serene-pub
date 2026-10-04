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
import {
	type ArrangedGridV1,
	isInstanceOf,
	type WidgetGridV1,
	type ZoneLayoutV1
} from "@serene-pub/sdk"
import {
	defaultChatLayout,
	updateWidget,
	widgetsInZone,
	withGridMembership,
	withoutGridWidget
} from "./widgetGrid"

export interface DoneInput {
	/** The zone template as it stands (side lists). */
	zones: ZoneLayoutV1
	/** The chat widget grid as it stands (the middle's membership). */
	grid: WidgetGridV1
	/** The editor's arrangement, already deduplicated (`dedupeArranged`). */
	arrangement: ArrangedGridV1
	/** The zone template ids the editor's Left and Right zones edit. */
	sideZoneIds: { left: string | null; right: string | null }
	/**
	 * The genre's primary widget (./primaryFloor). An instance of it that JOINS
	 * the middle's grid takes the floor's shape — grow, anchored on every edge —
	 * rather than a newcomer's strip, so the grid draws a log that fills.
	 */
	primaryId?: string
}

export interface DonePlacement {
	zones: ZoneLayoutV1
	grid: WidgetGridV1
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
	const before = new Set(widgetsInZone(grid, "middle").map((w) => w.id))
	grid = withGridMembership(
		grid,
		"middle",
		middleFrame ? rowOrder(middleFrame.items) : null
	)
	const primaryId = o.primaryId
	if (primaryId) {
		const { size, anchor } = defaultChatLayout(primaryId).widgets[0]
		for (const w of widgetsInZone(grid, "middle"))
			if (!before.has(w.id) && isInstanceOf(w.id, primaryId))
				grid = updateWidget(grid, w.id, { size, anchor: { ...anchor } })
	}
	const middle = middleFrame
		? rowOrder(middleFrame.items)
		: widgetsInZone(grid, "middle").map((w) => w.id)
	return { zones, grid, middle }
}
