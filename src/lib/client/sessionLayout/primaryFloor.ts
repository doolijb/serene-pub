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
 * Three halves, all here so they cannot disagree:
 *
 * - **Readers** (`withPrimaryFloor`): a layout that DRAWS no instance of the
 *   primary gets the bare primary appended to its middle, in the shape the
 *   genre default gives it (`defaultChatLayout`). A saved layout is otherwise
 *   read exactly as saved — the conversation stays in the side it was moved to.
 * - **The editor** (`floorKeeps`): the remove control is hidden on the LAST
 *   placed instance, which says why (`floorNote`) — so the floor is never
 *   something a person meets as a silent undo.
 * - **Done** (`floorRefusal`): the layout Done would commit is asked the
 *   readers' question, and Done refuses rather than commit one the readers
 *   would have to repair.
 *
 * "Placed" means DRAWN (`drawnIdsOf`), never merely named: a grid entry or a
 * zone list that the arrangement shadows puts nothing on screen, so it does
 * not satisfy the floor either.
 *
 * Pure: the session layout feeds it the three places a widget can be placed
 * (the side zone lists, the middle widget grid, the saved arrangement).
 */
import {
	type ArrangedGridV1,
	drawnWidgetIds,
	isInstanceOf,
	primaryPlaced,
	type SessionLayoutV1,
	type WidgetGridV1,
	type ZoneLayoutV1
} from "@serene-pub/sdk"
import { firstSlot, makeRoom } from "./arrangedGeometry"
import { withoutWidget } from "./schema"
import { defaultChatLayout } from "./widgetGrid"

/** The three places a session layout places widgets. */
export interface SessionPlacement {
	/** The side (and strip) zones' lists — the zone template. */
	zones: ZoneLayoutV1
	/** The middle widget grid (it may also name side-zone entries). */
	grid: WidgetGridV1
	/** The saved arrangement: cells per zone, authoritative where it exists. */
	arranged: ArrangedGridV1
}

/** A zone frame's cells, as far as the floor reads them. */
interface FrameCells {
	rows: number
	items: readonly { id: string; x: number; y: number; h: number }[]
}

/**
 * Every id the layout DRAWS, in reading order: middle, left, right, then the
 * strips — the SDK's one reading of the page's precedence (`drawnWidgetIds`),
 * so the floor, a genre's check and any other reader agree on what "placed"
 * means:
 *
 * - the middle draws its arranged frame whenever one exists (an emptied middle
 *   stays empty), else the grid's middle;
 * - a side draws its arranged frame when it places anything, else its zones'
 *   lists — and, folded into them, any grid entry naming that side, but only
 *   when the template has a zone on that side to fold it into;
 * - a strip draws its list.
 *
 * So a grid entry or a list entry the arrangement shadows is named but not
 * drawn, and is not counted.
 */
export function drawnIdsOf(p: SessionPlacement): string[] {
	return drawnWidgetIds(sessionLayoutOf(p))
}

/**
 * The session layout's arrangement these three places are — what the SDK's
 * readers take (`drawnWidgetIds`, `primaryPlaced`), so the floor asks them
 * rather than a second reading of its own.
 */
export function sessionLayoutOf(p: SessionPlacement): SessionLayoutV1 {
	return { zoneLayout: p.zones, widgetGrid: p.grid, arrangedGrid: p.arranged }
}

/** The placed instances of `primaryId` — the bare id and every `#name` copy. */
export function primaryInstances(
	placed: Iterable<string>,
	primaryId: string
): string[] {
	return [...placed].filter((id) => isInstanceOf(id, primaryId))
}

/** The card rows a floor-appended primary takes in an arranged middle. */
const FLOOR_CARD_ROWS = 3

/**
 * The tallest run of rows no card touches, across the frame's whole width —
 * where a card can go without moving anything — or null when every row holds
 * something.
 */
function tallestFreeBand(frame: FrameCells): { y: number; h: number } | null {
	let best: { y: number; h: number } | null = null
	let start = -1
	for (let y = 0; y <= frame.rows; y++) {
		const free =
			y < frame.rows && !frame.items.some((i) => y >= i.y && y < i.y + i.h)
		if (free) {
			if (start < 0) start = y
			continue
		}
		if (start >= 0 && (!best || y - start > best.h)) best = { y: start, h: y - start }
		start = -1
	}
	return best
}

/**
 * The layout, with the primary floor applied: returned BY REFERENCE when an
 * instance of `primaryId` is drawn anywhere, else with the bare primary
 * appended to the middle.
 *
 * Appended to BOTH middle models, because either can be the one drawn: the
 * grid (in the floor's shape, after what it already holds) and, when the
 * arrangement has a middle frame — which the live view draws in preference to
 * the grid — a cell there too:
 *
 * - the whole frame when it is empty;
 * - else the tallest band of rows nothing touches, full width, so the log has
 *   the room it would have had (a 3-row sliver under a strip read as a broken
 *   log, and came back on every read, since the floor is never saved);
 * - else, with no band that tall, a full-width slot made the way the tray
 *   makes one (`makeRoom` / `firstSlot`).
 *
 * A middle frame with no room even then is dropped, so the grid (which does
 * hold the primary) is what draws, rather than a middle without it.
 *
 * Where the bare primary was named but not drawn — a grid entry or a zone list
 * the arrangement shadows — that entry goes, so the layout names it once.
 */
export function withPrimaryFloor(
	p: SessionPlacement,
	primaryId: string
): SessionPlacement {
	if (primaryPlaced(sessionLayoutOf(p), primaryId)) return p
	const floor = defaultChatLayout(primaryId).widgets[0]
	const kept = p.grid.widgets.filter((w) => w.id !== primaryId)
	const order =
		kept
			.filter((w) => w.zone === "middle")
			.reduce((n, w) => Math.max(n, w.order), -1) + 1
	const grid: WidgetGridV1 = {
		...p.grid,
		widgets: [...kept, { ...floor, order }]
	}
	const named = Object.values(p.zones.zones).some((z) => z.widgets.includes(primaryId))
	const zones = named ? withoutWidget(p.zones, primaryId) : p.zones
	const frame = p.arranged.middle
	if (!frame) return { ...p, zones, grid }
	const arranged: ArrangedGridV1 = { ...p.arranged }
	if (!frame.items.length) {
		arranged.middle = {
			...frame,
			items: [{ id: primaryId, x: 0, y: 0, w: frame.cols, h: frame.rows }]
		}
		return { ...p, zones, grid, arranged }
	}
	const band = tallestFreeBand(frame)
	if (band && band.h >= FLOOR_CARD_ROWS) {
		arranged.middle = {
			...frame,
			items: [
				...frame.items,
				{ id: primaryId, x: 0, y: band.y, w: frame.cols, h: band.h }
			]
		}
		return { ...p, zones, grid, arranged }
	}
	const need = { w: frame.cols, h: FLOOR_CARD_ROWS }
	const roomy = makeRoom(frame, need)
	const slot = firstSlot(roomy, need)
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
	return { ...p, zones, grid, arranged }
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

/**
 * The one instance the floor keeps, when exactly one is placed — the card
 * whose × is hidden — else null. The editor re-seeds its zones when this
 * changes, since a card's controls are drawn once, at seed.
 */
export function floorKeptId(
	placed: Iterable<string>,
	primaryId: string
): string | null {
	const all = new Set(primaryInstances(placed, primaryId))
	return all.size === 1 ? [...all][0] : null
}

/** What the card the floor keeps says in place of its remove control. */
export function floorNote(widgetTitle: string): string {
	return `A session needs one ${widgetTitle} widget`
}

/**
 * What Done says when the layout it would commit draws no instance of the
 * primary, else null. The editor never offers to remove the last one, so this
 * is the backstop for a card lost some other way: refused, and said, rather
 * than committed for every reader to repair with a card the person never
 * arranged.
 */
export function floorRefusal(
	p: SessionPlacement,
	primaryId: string,
	widgetTitle: string
): string | null {
	return primaryPlaced(sessionLayoutOf(p), primaryId) ? null : floorNote(widgetTitle)
}
