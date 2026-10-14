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
	type ArrangedItem,
	type ArrangedZone,
	isInstanceOf,
	pinnedOf,
	type SessionLayoutV1,
	type WidgetGridV1,
	ZONE_IDS,
	type ZoneId,
	type ZoneLayoutV1
} from "@serene-pub/sdk"
import { arrangementIsEmpty, loadArranged } from "./arrangedGeometry"
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

/* ── the round trip: what Done writes, and when it writes nothing ────────
 *
 * Opening the editor and pressing Done with no change must write NOTHING
 * (lane E1, 2026-10-11). Two things stood in the way.
 *
 * 1. A zone the stored layout does NOT arrange — a middle drawn from its grid,
 *    a side drawn from its zone list and the width ladder — still reports a
 *    frame the moment its gridstack zone is seeded (`GridStackZone`'s first
 *    `emit`): its default placement at the editor's own measure. Done wrote
 *    that frame, and the zone was then drawn FROM it. For the middle that
 *    re-drew a `fixed`-height strip as its seed's three cells of a
 *    proportional grid (Adventure's World State, 29px → 223px); for a side it
 *    turned an unpinned icon strip into a docked column, since a seed's cards
 *    carried no pin and absent means pinned. `arrangementAtDone` keeps a
 *    zone's working frame only where the stored layout arranged that zone or
 *    a hand wrote it during this edit (an AUTHORED zone).
 * 2. Done rebuilt the side lists and always wrote the arrangement, so even a
 *    restore re-wrote every slot. `changedSlots` compares what Done would
 *    write with what is stored through ONE normaliser (`normalisedSlots`) and
 *    returns only the slots that differ.
 */

/**
 * The arrangement Done writes: the editor's working frames, less every frame
 * of a zone that the stored layout does not arrange and that no hand wrote
 * during this edit.
 *
 * Such a frame is the zone's seed and nothing else — what its gridstack zone
 * reported when it was drawn, at the editor's measure — so it says nothing
 * the zone's own membership (its list, or the middle's grid) does not
 * already say, and writing it would change how the zone is DRAWN (an
 * arrangement is a proportional grid with per-group pins; a list is the
 * ladder's rail, a grid draws a `fixed` strip at its own height). Its
 * membership still counts: `placementAtDone` reads it from the whole
 * arrangement before this, so nothing a frame holds is lost by dropping it.
 *
 * `authored`: the zones a hand wrote — a drag, resize, drop in or out, fit,
 * dock, anchor or group in that zone (`GridStackZone`'s `onGesture`), a group
 * pinned in the Move tab's rail preview, a row moved in the phone editor.
 * Adding, duplicating or removing a widget is membership, not authorship: it
 * lands in the zone's list or the middle's grid either way.
 */
export function arrangementAtDone(
	working: ArrangedGridV1,
	stored: ArrangedGridV1,
	authored: ReadonlySet<ZoneId>
): ArrangedGridV1 {
	const out: ArrangedGridV1 = {}
	for (const key of ZONE_IDS) {
		const frame = working[key]
		if (frame && (stored[key] || authored.has(key))) out[key] = frame
	}
	return out
}

/** The three slots Done may write. */
type LayoutSlots = Pick<
	SessionLayoutV1,
	"zoneLayout" | "widgetGrid" | "arrangedGrid"
>
const SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid"] as const

/** A JSON value with every object's keys in one order, so two spellings of one value compare equal. */
function sortedKeys(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(sortedKeys)
	if (!v || typeof v !== "object") return v
	const out: Record<string, unknown> = {}
	for (const k of Object.keys(v as object).sort()) {
		const x = (v as Record<string, unknown>)[k]
		if (x !== undefined) out[k] = sortedKeys(x)
	}
	return out
}

/** One arranged cell as the round trip compares it. */
function cellForm(i: ArrangedItem): ArrangedItem {
	const anchor = i.anchor
		? Object.fromEntries(
				Object.entries(i.anchor).filter(([, on]) => on === true)
			)
		: {}
	return {
		id: i.id,
		x: i.x,
		y: i.y,
		w: i.w,
		h: i.h,
		...(Object.keys(anchor).length ? { anchor } : {}),
		...(typeof i.group === "string" && i.group ? { group: i.group } : {}),
		// The SDK's one pin rule: absent and `true` are one value (pinned).
		...(pinnedOf(i) ? {} : { pinned: false })
	}
}

/**
 * The round trip's ONE normaliser: the three stored slots in the form Done
 * compares them in, so a value spelled two ways is one value.
 *
 * - The arrangement is read the way every reader reads it (`loadArranged`:
 *   retired ids dropped, cells clamped into their frame), its cells in
 *   reading order (row, then column), a pin of `true` written as absent, an
 *   anchor of no edges as none — and an arrangement placing nothing as no
 *   arrangement (`arrangementIsEmpty`).
 * - The zone template and the grid keep their order (a list's order is its
 *   reading order) and lose only the spelling: object keys sorted, undefined
 *   fields gone.
 */
export function normalisedSlots(layout: LayoutSlots): LayoutSlots {
	const out: LayoutSlots = {}
	if (layout.zoneLayout !== undefined)
		out.zoneLayout = sortedKeys(layout.zoneLayout) as ZoneLayoutV1
	if (layout.widgetGrid !== undefined)
		out.widgetGrid = sortedKeys(layout.widgetGrid) as WidgetGridV1
	const arranged = loadArranged(layout.arrangedGrid)
	if (!arrangementIsEmpty(arranged)) {
		const a: ArrangedGridV1 = {}
		for (const key of ZONE_IDS) {
			const z: ArrangedZone | undefined = arranged[key]
			if (!z) continue
			a[key] = {
				cols: z.cols,
				rows: z.rows,
				items: [...z.items]
					.sort(
						(p, q) =>
							p.y - q.y || p.x - q.x || (p.id < q.id ? -1 : 1)
					)
					.map(cellForm)
			}
		}
		out.arrangedGrid = sortedKeys(a) as ArrangedGridV1
	}
	return out
}

/**
 * The patch Done emits: each slot of `next` whose normalised form differs
 * from `stored`'s (`normalisedSlots`), and nothing else. An empty patch is a
 * Done that changed nothing — the caller writes nothing at all.
 *
 * A slot `next` leaves out is not compared (Done did not touch it); a slot
 * it names as `undefined` is a value — unset — and is written when the
 * stored one is set.
 */
export function changedSlots(
	stored: LayoutSlots,
	next: LayoutSlots
): LayoutSlots {
	const a = normalisedSlots(stored)
	const b = normalisedSlots(next)
	const patch: LayoutSlots = {}
	for (const slot of SLOTS) {
		if (!(slot in next)) continue
		if (JSON.stringify(a[slot]) === JSON.stringify(b[slot])) continue
		;(patch as Record<string, unknown>)[slot] = next[slot]
	}
	return patch
}
