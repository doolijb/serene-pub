/**
 * What each of the layout editor's three zones is SEEDED with, and when a zone
 * re-seeds (brief 7a review, 2026-09-29).
 *
 * A zone's gridstack reads its cards once, at seed. After that the zone reports
 * its arrangement into the editor's WORKING copy (`editArranged`), while the
 * COMMITTED membership — the side zones' lists, the middle's widget grid —
 * moves only when the tray adds a widget, a × removes one, or Done commits. A
 * card dragged from one zone into another lives in the working arrangement
 * alone until Done.
 *
 * Two rules follow, one per function:
 *
 * - **What a zone is seeded with** (`editorZoneIds`): its committed members,
 *   less any that another zone's working frame now holds, plus any its own
 *   working frame holds that it does not list. Seeded from the committed list
 *   alone, a zone that re-seeded mid-edit (a tray add, a removal) dropped every
 *   card dragged into it — the conversation included, which then existed
 *   nowhere — and a stored arrangement that drew a widget its list did not
 *   name (every Chat session saved before free placement: the log in the
 *   middle frame, the grid empty) opened with the card missing.
 * - **When a zone re-seeds** (`editorSeedKey`): when its committed membership
 *   changes, or the card the primary floor keeps changes (its × is drawn once,
 *   at seed), or a widget reaches or leaves its cap (its cards' Duplicate is
 *   too) — never on a drag, which changes the seed list and nothing else.
 *   Keyed on the seed list itself, a zone would reload on every cross-zone
 *   drop; keyed on the floor's answer while the floor read the zone's own
 *   report, the middle reloaded for ever.
 *
 * Pure, so the loop that once lived between these and the page is tested away
 * from it (./editorSeed.test.ts).
 */
import {
	pinnedOf,
	ZONE_IDS,
	type ArrangedGridV1,
	type ZoneId
} from "@serene-pub/sdk"

/** A working frame's cell, as far as the seed reads it. */
interface Cell {
	id: string
	x: number
	y: number
}

/** Each editor zone's committed members, in the order the zone lists them. */
export type ZoneMembers = Record<ZoneId, readonly string[]>

/**
 * The ids editor zone `zone` is seeded with: `committed[zone]` in its own
 * order, less any id another zone's working frame holds and this one's does
 * not, then — in reading order — the ids this zone's working frame holds that
 * its committed list does not name.
 *
 * A zone with no working frame yet (not mounted, never reported) claims
 * nothing, so it moves nothing out of the others.
 */
export function editorZoneIds(
	zone: ZoneId,
	committed: ZoneMembers,
	working: ArrangedGridV1
): string[] {
	const cells = (key: ZoneId): readonly Cell[] => working[key]?.items ?? []
	const own = new Set(cells(zone).map((i) => i.id))
	const elsewhere = new Set<string>()
	for (const key of ZONE_IDS)
		if (key !== zone)
			for (const item of cells(key)) elsewhere.add(item.id)
	const listed = committed[zone]
	const kept = listed.filter((id) => own.has(id) || !elsewhere.has(id))
	const incoming = [...cells(zone)]
		.sort((a, b) => a.y - b.y || a.x - b.x)
		.map((i) => i.id)
		.filter((id) => !listed.includes(id))
	return [...kept, ...incoming]
}

/**
 * The key a zone re-seeds on: its committed members, the id the primary
 * floor keeps (./primaryFloor `floorKeptId`), or none, and the widgets at
 * their `maxInstances` cap (brief 7b review) — a card's Duplicate, or the
 * note that replaces it at the cap, is drawn once, at seed, so a widget
 * reaching or leaving its cap re-seeds every zone holding one of its cards
 * rather than leave a stale button there. A drag moves a card and changes no
 * count, so none of the three moves on a drag.
 */
export function editorSeedKey(
	committed: readonly string[],
	floorKept: string | null,
	capped: readonly string[] = []
): string {
	return `${committed.join(",")}|${floorKept ?? ""}|${capped.join(",")}`
}

/**
 * The pin a SIDE's cards are seeded with: the zone's own (lane E1). A side
 * drawn from its zone list is docked or an icon strip AS A WHOLE — the zone's
 * `pinned` — while a side drawn from an arrangement pins each card
 * (`pinnedOf` on the item). Seeded with no pin, every card of an unpinned
 * side read as pinned, so the first frame Done wrote for it turned the icon
 * strip into a docked column. A card the working frame holds takes the
 * frame's pin over this one (./arrangedGeometry `withGeometry`).
 */
export function sideSeedPin(zone: { pinned?: unknown } | null | undefined): {
	pinned?: false
} {
	return pinnedOf(zone) ? {} : { pinned: false }
}

/**
 * Where a MIDDLE card sits in its zone's seed when no frame places it: a
 * grow-height widget FILLS what is left; a fixed one docks three cells deep
 * against the edge it anchors to (the bottom when it says so, else the top).
 * Both full-width. `entry` is its grid entry, if the grid has one; without
 * one (a card the working arrangement brought in) it fills when it is a log
 * — the floor's shape — and is a strip otherwise.
 *
 * The seed is only the editor's picture of the grid: Done never writes it
 * (./donePlacement `arrangementAtDone`), so the grid keeps drawing a `fixed`
 * strip at its own height until a hand arranges the middle.
 */
export function middleSeedPlace(
	entry: { size: { h: unknown }; anchor: { bottom?: boolean } } | undefined,
	isLog: boolean
): { place: "fill" } | { place: "top" | "bottom"; h: number } {
	const grows = entry ? entry.size.h === "grow" : isLog
	if (grows) return { place: "fill" }
	return { place: entry?.anchor.bottom ? "bottom" : "top", h: 3 }
}
