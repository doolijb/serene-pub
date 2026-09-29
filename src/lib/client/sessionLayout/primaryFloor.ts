/**
 * The **primary floor** (layout plan M.3.10 / M.4, brief 7a, 2026-09-29): the
 * one placement rule left once placement is free.
 *
 * A session layout places at least one instance of its genre's **primary
 * widget** — `messages`, or the widget an R71 genre names when it withholds the
 * conversation (Battleship's board) — ANYWHERE: the middle, a side, a tab
 * group. It is a rule about the whole layout, never about a zone, and it
 * replaces the widget grid's retired `required` flag, which pinned the
 * conversation to the middle in seven places.
 *
 * Two halves, both here so they cannot disagree:
 *
 * - **Readers** (`withPrimaryFloor`): a layout that places no instance of the
 *   primary anywhere gets the bare primary appended to its middle, in the
 *   shape the genre default gives it (`defaultChatLayout`). A saved layout is
 *   otherwise read exactly as saved — the conversation stays in the side it
 *   was moved to.
 * - **The editor** (`floorKeeps`): the remove control is hidden on the LAST
 *   placed instance, which says why (`floorNote`) — so the floor is never
 *   something a person meets as a silent undo.
 *
 * Pure: the session layout feeds it the three places a widget can be placed
 * (the side zone lists, the middle widget grid, the saved arrangement).
 */
import { isInstanceOf } from "$lib/shared/widgets/instanceId"
import {
	firstSlot,
	makeRoom,
	ZONE_KEYS,
	type Arranged
} from "./arrangedGeometry"
import { placedWidgetIds, type ZoneLayout } from "./schema"
import { defaultChatLayout, type GridLayout } from "./widgetGrid"

/** The three places a session layout places widgets. */
export interface SessionPlacement {
	/** The side (and strip) zones' lists — the zone template. */
	zones: ZoneLayout
	/** The middle widget grid (it may also name side-zone entries). */
	grid: GridLayout
	/** The saved arrangement: cells per zone, authoritative where it exists. */
	arranged: Arranged
}

/** Every id the layout places, in reading order: middle, left, right. */
export function placedIdsOf(p: SessionPlacement): string[] {
	const out: string[] = []
	const add = (id: string) => {
		if (!out.includes(id)) out.push(id)
	}
	for (const key of ZONE_KEYS)
		for (const item of p.arranged[key]?.items ?? []) add(item.id)
	for (const w of p.grid.widgets) add(w.id)
	for (const id of placedWidgetIds(p.zones)) add(id)
	return out
}

/** The placed instances of `primaryId` — the bare id and every `#name` copy. */
export function primaryInstances(
	placed: Iterable<string>,
	primaryId: string
): string[] {
	return [...placed].filter((id) => isInstanceOf(id, primaryId))
}

/** Does this layout place any instance of its primary widget, anywhere? */
export function primaryPlaced(p: SessionPlacement, primaryId: string): boolean {
	return primaryInstances(placedIdsOf(p), primaryId).length > 0
}

/** The card rows a floor-appended primary takes in an arranged middle. */
const FLOOR_CARD_ROWS = 3

/**
 * The layout, with the primary floor applied: returned BY REFERENCE when an
 * instance of `primaryId` is placed anywhere, else with the bare primary
 * appended to the middle.
 *
 * Appended to BOTH middle models, because either can be the one drawn: the
 * grid (in the floor's shape, after what it already holds) and, when the
 * arrangement has a middle frame — which the live view draws in preference to
 * the grid — a cell there too: the whole frame when it is empty, else a
 * full-width slot made the way the tray makes one (`makeRoom` / `firstSlot`).
 * A middle frame with no room even then is dropped, so the grid (which does
 * hold the primary) is what draws, rather than a middle without it.
 */
export function withPrimaryFloor(
	p: SessionPlacement,
	primaryId: string
): SessionPlacement {
	if (primaryPlaced(p, primaryId)) return p
	const floor = defaultChatLayout(primaryId).widgets[0]
	const order =
		p.grid.widgets
			.filter((w) => w.zone === "middle")
			.reduce((n, w) => Math.max(n, w.order), -1) + 1
	const grid: GridLayout = {
		...p.grid,
		widgets: [...p.grid.widgets, { ...floor, order }]
	}
	const frame = p.arranged.middle
	if (!frame) return { ...p, grid }
	if (!frame.items.length)
		return {
			...p,
			grid,
			arranged: {
				...p.arranged,
				middle: {
					...frame,
					items: [
						{ id: primaryId, x: 0, y: 0, w: frame.cols, h: frame.rows }
					]
				}
			}
		}
	const need = { w: frame.cols, h: FLOOR_CARD_ROWS }
	const roomy = makeRoom(frame, need)
	const slot = firstSlot(roomy, need)
	const arranged: Arranged = { ...p.arranged }
	if (slot)
		arranged.middle = {
			...roomy,
			items: [
				...roomy.items,
				{
					id: primaryId,
					x: slot.x,
					y: slot.y,
					w: Math.min(need.w, roomy.cols),
					h: Math.min(need.h, roomy.rows)
				}
			]
		}
	else delete arranged.middle
	return { ...p, grid, arranged }
}

/**
 * Does the floor keep `id` in the layout — is it the LAST placed instance of
 * the primary widget? The editor hides that card's remove control (and says
 * why, `floorNote`); every other widget, and every instance but the last, may
 * go.
 */
export function floorKeeps(
	id: string,
	placed: Iterable<string>,
	primaryId: string
): boolean {
	if (!isInstanceOf(id, primaryId)) return false
	// No OTHER instance would be left to stand in for it.
	return primaryInstances(placed, primaryId).every((other) => other === id)
}

/** What the card the floor keeps says in place of its remove control. */
export function floorNote(widgetTitle: string): string {
	return `A session needs one ${widgetTitle} widget`
}
