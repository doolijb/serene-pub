/**
 * The Move tab's ARRANGEMENT GEOMETRY — pure, and the one place the editor's
 * saved-arrangement maths lives.
 *
 * Five jobs, all of them about the same round trip (persisted blob → the
 * editor's gridstack zones → back to the blob):
 *
 *   1. `loadArranged` / `withGeometry` — rehydrate the verbatim blob and lay it
 *      back over the editor's id-keyed items, so re-opening the editor restores
 *      what was arranged instead of re-laying-out from defaults.
 *   2. `seedPositions` — resolve every item's cells for the zone as MEASURED
 *      NOW. A zone is only as many whole cells as the current window gives it,
 *      so a restored arrangement routinely arrives describing a bigger grid
 *      than the one it is being drawn in.
 *   3. `frameCovers` — whether a saved frame accounts for exactly the items on
 *      screen, i.e. whether this zone is a faithful RESTORE (nothing added,
 *      nothing removed) and so has nothing of its own to report yet.
 *   4. `itemPinned` / `unitPinned` / `withPins` — the per-group PIN, which is a
 *      field on the arranged items rather than geometry, and the one rule the
 *      whole blob's forward compatibility hangs on (absent means pinned).
 *   5. `firstSlot` / `fits` / `makeRoom` — where a frame has a SLOT for one
 *      more card, and how a full one gives it up. The tray has to be able to
 *      place a widget in a zone that is out of room; see `MIN_CARD_ROWS`.
 *
 * They were extracted from SessionLayout.svelte / GridStackZone.svelte so the
 * round trip can be tested without a browser, a gridstack, or a window size.
 */
import {
	ZONE_IDS,
	type ArrangedGridV1,
	type ArrangedItem,
	type ArrangedZone,
	type ZoneId
} from "@serene-pub/sdk"
import type { GsItem } from "./gsItem"
import { isRetiredWidget } from "./widgetGrid"

/*
 * The three zones' arrangements are the session layout's `arrangedGrid` slot,
 * typed by the SDK (`ArrangedGridV1`; each zone an `ArrangedZone`) and
 * imported from `@serene-pub/sdk` wherever they are used.
 */

export function isArrangedItem(i: unknown): i is ArrangedItem {
	return (
		!!i &&
		typeof i === "object" &&
		typeof (i as any).id === "string" &&
		["x", "y", "w", "h"].every((k) => typeof (i as any)[k] === "number")
	)
}

export function isArrangedZone(z: unknown): z is ArrangedZone {
	return (
		!!z &&
		typeof z === "object" &&
		typeof (z as any).cols === "number" &&
		typeof (z as any).rows === "number" &&
		Array.isArray((z as any).items)
	)
}

/** A saved position naming a widget this build still places. */
const isLivePos = (pos: { id: string }): boolean => !isRetiredWidget(pos.id)

/**
 * Put one saved cell back inside the frame that describes it.
 *
 * A captured position is only meaningful in its own `cols` × `rows` grid, and
 * nothing guarantees it stayed there: gridstack reports whatever its engine
 * holds, and a card that arrived from another zone can be reported at a cell
 * this zone does not have. The EDITOR never saw that, because `seedPositions`
 * ends with exactly this clamp — but the live view spends the cells directly as
 * `grid-column: x + 1 / span w`, and a column past `cols` does not overflow: it
 * makes CSS grid add IMPLICIT tracks, and the explicit `1fr` ones then resolve
 * to 0px. One out-of-bounds cell therefore collapses every other widget in the
 * zone to nothing. (Seen live: `scene-portraits` at x = 7 in a 7-column frame
 * gave `grid-column: 8 / span 7`, seven implicit tracks, and a 38px `stats`.)
 *
 * So the clamp belongs where every reader passes, not in one renderer.
 */
export function clampPos(pos: ArrangedItem, cols: number, rows: number): ArrangedItem {
	const maxCols = Math.max(1, Math.floor(cols))
	const maxRows = Math.max(1, Math.floor(rows))
	const w = Math.min(Math.max(1, pos.w), maxCols)
	const h = Math.min(Math.max(1, pos.h), maxRows)
	const x = Math.min(Math.max(0, pos.x), maxCols - w)
	const y = Math.min(Math.max(0, pos.y), maxRows - h)
	return x === pos.x && y === pos.y && w === pos.w && h === pos.h
		? pos
		: { ...pos, x, y, w, h }
}

/** Every cell in a zone, back inside that zone. */
export function clampFrame(zone: ArrangedZone): ArrangedZone {
	const items = zone.items.map((i) => clampPos(i, zone.cols, zone.rows))
	return items.every((i, n) => i === zone.items[n]) ? zone : { ...zone, items }
}

/**
 * Defensively rehydrate the persisted per-zone geometry (verbatim blob).
 *
 * Retired ids are dropped here, which is the one place every reader of a saved
 * arrangement passes through — the live render, the editor, and the picture a
 * preset draws. An arrangement captured under an older build keeps its cells
 * and loses the cards this build has no widget for.
 *
 * And every cell is clamped into its own frame (see `clampPos`), for the same
 * reason and at the same seam: a blob written by an older build — or by a zone
 * that reported a cross-zone drop before this clamp existed — must draw as the
 * arrangement it describes rather than shredding the zone it lands in.
 */
export function loadArranged(saved: unknown): ArrangedGridV1 {
	if (!saved || typeof saved !== "object") return {}
	const out: ArrangedGridV1 = {}
	for (const key of ["left", "middle", "right"] as const) {
		const z = (saved as any)[key]
		if (isArrangedZone(z))
			out[key] = clampFrame({
				cols: z.cols,
				rows: z.rows,
				items: z.items.filter(isArrangedItem).filter(isLivePos)
			})
	}
	return out
}

/**
 * Does this arrangement place no widget anywhere?
 *
 * The predicate `commitArrangement` decides Done with. An editor that never had
 * a widget to report leaves `{}` behind, and `{}` is TRUTHY — stored, it would
 * read as "this layout has an arrangement" to every reader that asks whether
 * the slot is set. An arrangement of nothing is not an arrangement, so the seam
 * stores none instead. A zone that reported its cell dims and an empty item
 * list counts as nothing too: that is the same editor, one repaint later.
 */
export function arrangementIsEmpty(a: ArrangedGridV1): boolean {
	return !ZONE_IDS.some(
		(key) => (a[key]?.items?.length ?? 0) > 0
	)
}


/**
 * The middle editor panel's place target. The middle has no zone id — its
 * membership is the widget GRID's, and `layout.zones` never names it — so the
 * drag-over highlight and the routing need a name for it, in the same sentinel
 * idiom as the palette's own `__palette__` drop target.
 *
 * Here rather than in the editor because SessionLayout routes a drop by it and
 * LayoutEditCanvas names the zone with it; one word, one place.
 */
export const MIDDLE_TARGET = "__middle__"

/**
 * Every widget this arrangement places, in any zone.
 *
 * "Is this widget placed?" has two answers while the editor is open, and this
 * is the one the EDITOR has to use: the committed membership is what the live
 * view draws, but an arrangement in progress is what the user has actually
 * done. A card dragged from one zone into another is reported by both zones'
 * frames long before anything is committed.
 */
export function arrangedIds(a: ArrangedGridV1): Set<string> {
	const ids = new Set<string>()
	for (const key of ZONE_IDS)
		for (const item of a[key]?.items ?? []) ids.add(item.id)
	return ids
}

/** A widget that was found in more than one zone, and what was done about it. */
export interface ArrangedDuplicate {
	id: string
	/** The zone it was left in. */
	kept: ZoneId
	/** The zones it was taken out of. */
	dropped: ZoneId[]
}

export interface DedupedArrangement {
	arranged: ArrangedGridV1
	duplicates: ArrangedDuplicate[]
}

/**
 * The commit's invariant: **a widget id lives in exactly one zone**.
 *
 * Nothing in the arrangement's shape enforces it — each zone reports its own
 * items and the three are only assembled at Done — so a zone that fails to
 * report a card LEAVING it leaves that card in two zones at once, and the
 * commit writes it into two zones' widget lists. The live view then draws the
 * widget twice and the editor re-opens on both copies.
 *
 * `preferred` is the last cross-zone drop: the one event that names a widget
 * AND the zone that now holds it, so it is the honest answer to "which copy is
 * the one the user made". Without it (or for any other duplicate) the first
 * zone in `ZONE_IDS` order wins — deterministic, and not a judgement.
 *
 * Pure: it returns a new arrangement and the duplicates it resolved, and says
 * nothing. The caller logs.
 */
export function dedupeArranged(
	a: ArrangedGridV1,
	preferred?: { id: string; zone: ZoneId } | null
): DedupedArrangement {
	const seen = new Map<string, ZoneId[]>()
	for (const key of ZONE_IDS)
		for (const item of a[key]?.items ?? [])
			seen.set(item.id, [...(seen.get(item.id) ?? []), key])

	const duplicates: ArrangedDuplicate[] = []
	const keeper = new Map<string, ZoneId>()
	for (const [id, zones] of seen) {
		if (zones.length < 2) continue
		const kept =
			preferred?.id === id && zones.includes(preferred.zone)
				? preferred.zone
				: zones[0]
		keeper.set(id, kept)
		duplicates.push({ id, kept, dropped: zones.filter((z) => z !== kept) })
	}
	if (!duplicates.length) return { arranged: a, duplicates }

	const arranged: ArrangedGridV1 = {}
	for (const key of ZONE_IDS) {
		const zone = a[key]
		if (!zone) continue
		arranged[key] = {
			...zone,
			items: zone.items.filter(
				(i) => (keeper.get(i.id) ?? key) === key
			)
		}
	}
	return { arranged, duplicates }
}

/**
 * Merge captured x/y/w/h from a persisted zone layout onto the editor's
 * id-keyed GsItems, so re-opening the editor restores the arrangement instead
 * of re-laying-out from defaults. An item with no saved geometry keeps its
 * default `place`/`h`. The editor keys its zones by id alone, so laying
 * geometry over them never re-instantiates a grid — the cells are read once,
 * when the zone is seeded.
 */
export function withGeometry(
	items: GsItem[],
	zone: ArrangedZone | undefined
): GsItem[] {
	if (!zone) return items
	const pos = new Map(zone.items.map((i) => [i.id, i]))
	return items.map((it) => {
		const p = pos.get(it.id)
		return p
			? {
					...it,
					x: p.x,
					y: p.y,
					w: p.w,
					h: p.h,
					...(p.anchor ? { anchor: p.anchor } : {}),
					...(p.group ? { group: p.group } : {}),
					...(p.pinned === false ? { pinned: false } : {})
				}
			: it
	})
}

/* ── the per-group pin (ruled 2026-09-10) ───────────────────────────────
 *
 * A side column's groups each toggle on their own, and which of them are
 * PINNED — expanded by default, keeping their height when a sibling expands
 * (./sideRail rule (b)) — is the user's decision and has to survive a reload.
 * It used to be the ZONE's single pin, so every group in a column shared it and
 * the Move tab's per-group toggle died with the page.
 *
 * It lives on the arranged ITEM, beside `anchor` and `group`, for the same
 * reason those do: it is a fact about that widget in that arrangement, so it
 * rides along through a preset, a cross-zone drag and a re-group without a
 * second store to keep in step. A GROUP's pin is its members' — the writer
 * always sets all of them at once — and a tab group re-formed out of a pinned
 * widget and an unpinned one reads as pinned, which is the same answer the
 * default gives.
 *
 * ABSENT MEANS PINNED, and `true` is never written. That is the whole
 * compatibility guarantee: every arrangement saved before the field existed
 * reads as all groups pinned, which is exactly what it rendered as, so nothing
 * changes for a saved layout until someone toggles a pin.
 */

/** Is this arranged item pinned? Absent means pinned — see above. */
export function itemPinned(p: { pinned?: boolean }): boolean {
	return p.pinned !== false
}

/**
 * Is a render unit pinned — a tab group's members, or a lone widget's one?
 *
 * Pinned unless EVERY member says otherwise, so the default survives a group
 * formed out of a mix. An empty list is pinned, for the same reason.
 */
export function unitPinned(members: readonly { pinned?: boolean }[]): boolean {
	return members.length ? members.some(itemPinned) : true
}

/**
 * Write one group's pin onto the items it is made of, immutably.
 *
 * Pinning DELETES the field rather than storing `true` — absent is the value,
 * so a pinned arrangement is byte-identical to one saved before the field
 * existed. Items not named are returned by reference, untouched.
 */
export function withPins(
	zone: ArrangedZone,
	ids: Iterable<string>,
	pinned: boolean
): ArrangedZone {
	const set = new Set(ids)
	return {
		...zone,
		items: zone.items.map((it) => {
			if (!set.has(it.id)) return it
			const { pinned: _was, ...rest } = it
			return pinned ? rest : { ...rest, pinned: false }
		})
	}
}

/**
 * Should the layout editor's ZONE-wide pin control (the card-toolbar button
 * that flips `layout.zones[id].pinned`) show for this side?
 *
 * That control only ever governed the UN-arranged rail — docked rail vs icon
 * strip. Once a side has a saved frame, the live view renders it with
 * `arrangedSide` instead, which reads the per-group pin (`itemPinned` /
 * `unitPinned`, carried on the arrangement itself) and never looks at the
 * zone's pin at all. Showing the button there would be a control with no
 * visible effect, so it hides instead of being left to do nothing.
 *
 * `frame` is the same per-side slice of `ArrangedGridV1` the live view keys its own
 * arranged/unarranged branch on, so this mirrors that branch rather than
 * inventing a second definition of "arranged".
 */
export function showZonePin(frame: ArrangedZone | undefined): boolean {
	return !frame
}

/**
 * Does `frame` account for exactly these items — same ids, nothing more?
 *
 * That is the test for "this zone is a RESTORE, not an edit": every card on
 * screen came out of the saved frame and no card has been added or removed
 * since. A zone in that state has nothing of its own to say, which is what
 * lets the editor open in a window of any size without reporting the size it
 * happened to be opened at as the user's arrangement.
 */
export function frameCovers(
	items: GsItem[],
	frame: ArrangedZone | undefined
): boolean {
	if (!frame) return false
	const ids = new Set(items.map((i) => i.id))
	return (
		ids.size === frame.items.length &&
		frame.items.every((p) => ids.has(p.id))
	)
}

/**
 * Map one edge of a saved cell grid onto the zone being drawn now.
 *
 * BOUNDARIES are mapped, never lengths: an item's far edge is the image of
 * `start + span`, not `start` plus a separately-rounded span. Two cards that
 * shared an edge in the saved frame therefore still share one here, so a
 * re-expressed arrangement cannot round its way into an overlap.
 */
function mapEdge(v: number, scale: number): number {
	return Math.round(v * scale)
}

/**
 * Resolve one EXPLICITLY placed item's final cells, mirroring exactly what
 * the seeding loop below does for it. Used only to find where the
 * already-placed items land, before any default-placed item is seeded.
 */
function resolveExplicit(
	it: GsItem,
	cols: number,
	rows: number,
	scaleX: number,
	scaleY: number
): ArrangedItem {
	let x = it.x ?? 0
	let y = it.y ?? 0
	let w = it.w ?? cols
	let h = it.h ?? 3
	if (scaleX !== 1 || scaleY !== 1) {
		const x0 = mapEdge(x, scaleX)
		const y0 = mapEdge(y, scaleY)
		w = Math.max(1, mapEdge(x + w, scaleX) - x0)
		h = Math.max(1, mapEdge(y + h, scaleY) - y0)
		x = x0
		y = y0
	}
	w = Math.min(w, cols)
	h = Math.min(h, rows)
	x = Math.min(Math.max(0, x), Math.max(0, cols - w))
	y = Math.min(Math.max(0, y), Math.max(0, rows - h))
	return { id: it.id, x, y, w, h }
}

/**
 * Resolve each item's cells for a zone measured at `cols` × `rows`.
 *
 * Items with no saved geometry take their DEFAULT placement: bottom-docked
 * items reserve rows from the bottom, a fill item takes what is left between,
 * the rest stack from the top — everything full-width unless it states a `w`.
 *
 * A saved item is re-expressed PROPORTIONALLY from the frame it was captured
 * in (`frame`) into the one being drawn now. A zone is only as many whole
 * cells as the current window affords it, so a restored arrangement routinely
 * describes a bigger grid than the one it is landing in; clamping each item
 * into the smaller grid on its own collapses distinct cards onto the same rows
 * (a full-height card and a bottom-docked one both end at the floor), and what
 * the user then sees is not their arrangement squeezed but their arrangement
 * broken. Scaling the whole frame keeps every card's share of the zone and the
 * order they were arranged in. Without a `frame` there is nothing to scale
 * from, and the clamp below is the whole of it — as before.
 *
 * Everything is finally clamped to what the zone can actually hold.
 */
export function seedPositions(
	items: GsItem[],
	cols: number,
	rows: number,
	frame?: { cols: number; rows: number }
): ArrangedItem[] {
	const scaleX = frame && frame.cols > 0 ? cols / frame.cols : 1
	const scaleY = frame && frame.rows > 0 ? rows / frame.rows : 1
	const bottomReserve = items
		.filter((it) => it.place === "bottom")
		.reduce((s, it) => s + (it.h ?? 3), 0)
	// An explicitly placed item never touches topY/bottomY below, so a
	// default-placed item seeded from y=0 would land on top of one that is
	// already there. Start below the lowest explicit item in the same column
	// band (x=0 — where every default item lands) instead.
	let topY = items.reduce((max, it) => {
		if (it.x == null && it.y == null) return max
		const p = resolveExplicit(it, cols, rows, scaleX, scaleY)
		return p.x === 0 ? Math.max(max, p.y + p.h) : max
	}, 0)
	let bottomY = rows
	const out: ArrangedItem[] = []
	for (const it of items) {
		const fullW = it.w ?? cols
		let x = it.x ?? 0
		let y = it.y ?? 0
		let w = fullW
		let h = it.h ?? 3
		if (it.x == null && it.y == null) {
			if (it.place === "bottom") {
				h = it.h ?? 3
				bottomY -= h
				x = 0
				y = bottomY
				w = fullW
			} else if (it.place === "fill") {
				x = 0
				y = topY
				w = fullW
				h = Math.max(1, rows - bottomReserve - topY)
				topY = y + h
			} else {
				x = 0
				y = topY
				w = fullW
				topY += h
			}
		} else if (scaleX !== 1 || scaleY !== 1) {
			const x0 = mapEdge(x, scaleX)
			const y0 = mapEdge(y, scaleY)
			w = Math.max(1, mapEdge(x + w, scaleX) - x0)
			h = Math.max(1, mapEdge(y + h, scaleY) - y0)
			x = x0
			y = y0
		}
		// Clamp to what THIS zone can hold: a restored arrangement may carry
		// geometry captured in a wider/taller zone (different viewport), and an
		// out-of-bounds w/x would overflow or clip. A no-op for the default
		// place branches, which already fit.
		w = Math.min(w, cols)
		h = Math.min(h, rows)
		x = Math.min(Math.max(0, x), Math.max(0, cols - w))
		y = Math.min(Math.max(0, y), Math.max(0, rows - h))
		out.push({ id: it.id, x, y, w, h })
	}
	return out
}

/**
 * Re-express a whole captured arrangement in a zone measured at `cols` × `rows`.
 *
 * The same proportional maths `seedPositions` does, entered from a captured
 * `ArrangedZone` rather than the editor's item list — the RE-MEASURE path, where
 * what is being re-expressed is an arrangement and not a fresh set of cards.
 *
 * It is a pure function of `ref`, which is the whole point: a zone re-drawn at
 * a narrower width and then back again is `reexpress(ref, …)` twice, so it
 * lands exactly where it started. Feeding it back its own narrow output
 * instead — which is what gridstack's `column()` does to the live nodes — keeps
 * only what survived the squeeze, and the arrangement is gone.
 */
export function reexpress(ref: ArrangedZone, cols: number, rows: number): ArrangedItem[] {
	return seedPositions(
		// `seedPositions` reads cells, not labels; the title is the GsItem shape
		// asking for something a captured position has no need of.
		ref.items.map((p) => ({ ...p, title: "" })),
		cols,
		rows,
		ref
	)
}

/* ── making room for one more card (2026-09-17) ─────────────────────────
 *
 * A zone whose cells are all taken has nowhere to seed a newcomer, and until
 * now nothing anywhere acted on that. `seedPositions` clamps the new card's
 * `y` back inside the grid, so it arrives ON TOP of whatever already holds the
 * bottom rows; gridstack's engine is capped by `maxRow`, so `_fixCollisions`
 * cannot push that card out of the way and gives up. Nothing is dropped and
 * nothing throws — the two cards simply OVERLAP, live and saved.
 *
 * A card DRAGGED from another zone keeps that answer and says it out loud: the
 * zone header's Full note is the warning and the drag snaps back, which is
 * gridstack's own behaviour and honest. A card placed from the TRAY has no
 * drag to snap back — the user asked for it and it has to land somewhere — so
 * the zone makes room for it instead, here.
 *
 * Rows come off the BIGGEST card first, from its BOTTOM edge: it keeps its `y`
 * and therefore its top edge, which is the edge a column is read by. Nothing
 * is taken past `MIN_CARD_ROWS` — a card squeezed to one row is not a card —
 * and a frame that could only make room by producing one has honestly run out:
 * it comes back unchanged, the caller falls back to what it did before, and
 * the Full note stays true.
 */

/** The fewest rows a card may be shrunk to while making room for another. */
export const MIN_CARD_ROWS = 2

/** Does the box at `x,y,w,h` share a cell with this item? */
function hits(
	i: ArrangedItem,
	x: number,
	y: number,
	w: number,
	h: number
): boolean {
	return i.x < x + w && x < i.x + i.w && i.y < y + h && y < i.y + i.h
}

/**
 * WHERE in `frame` a card of `need` cells could go — top-left-most first, or
 * null when nowhere could.
 *
 * The packing question `zoneIsFull` deliberately leaves alone: free CELLS are
 * not a free SLOT, and a frame with a quarter of its cells free in four
 * corners has room for nothing. Every origin the rectangle could take is
 * tried, so the answer is exact rather than an estimate — the frames are a
 * couple of dozen cells on a side.
 *
 * It answers WHERE rather than whether because the caller needs both: the
 * seeding rules (`seedPositions`) place a card with no saved cells at the foot
 * of the x = 0 stack, which is not where `makeRoom` frees rows, so the slot
 * has to be WRITTEN onto the newcomer rather than hoped for.
 *
 * `need` is clamped to the frame the way a seeded card is (`seedPositions`
 * ends with exactly that clamp), so asking for something wider than the zone
 * asks about the card the zone would actually draw.
 */
export function firstSlot(
	frame: ArrangedZone,
	need: { w: number; h: number }
): { x: number; y: number } | null {
	const w = Math.max(1, Math.min(Math.floor(need.w), frame.cols))
	const h = Math.max(1, Math.min(Math.floor(need.h), frame.rows))
	for (let y = 0; y + h <= frame.rows; y++)
		for (let x = 0; x + w <= frame.cols; x++)
			if (!frame.items.some((i) => hits(i, x, y, w, h))) return { x, y }
	return null
}

/** Is there anywhere in `frame` a card of `need` cells could go? */
export function fits(frame: ArrangedZone, need: { w: number; h: number }): boolean {
	return firstSlot(frame, need) !== null
}

/**
 * Make room in a full frame for one more card of `need` cells: shrink the
 * largest card (by area) along its height by `need.h` rows, never below
 * `MIN_CARD_ROWS`, then the next largest, until a `need`-sized slot exists.
 *
 * Returns the SAME object when a slot already exists, and the same object
 * again when no sequence of shrinks frees one — the caller tells the two apart
 * by identity and needs to do nothing in either case.
 *
 * Each pass takes at least one row off exactly one card, so the heights are a
 * strictly decreasing sum bounded below by `MIN_CARD_ROWS` per card: the loop
 * ends either at a slot or at the frame it was given.
 */
export function makeRoom(
	frame: ArrangedZone,
	need: { w: number; h: number }
): ArrangedZone {
	if (fits(frame, need)) return frame
	const want = Math.max(1, Math.floor(need.h))
	let items = frame.items
	for (;;) {
		// The largest card with rows left to give. Area decides and the
		// earlier item wins a tie, so the same frame always makes room the
		// same way.
		let pick = -1
		let largest = 0
		items.forEach((it, n) => {
			if (it.h <= MIN_CARD_ROWS) return
			const area = it.w * it.h
			if (area > largest) {
				largest = area
				pick = n
			}
		})
		// Every card is at the floor: the zone is out of room for real.
		if (pick < 0) return frame
		items = items.map((it, n) =>
			n === pick
				? { ...it, h: Math.max(MIN_CARD_ROWS, it.h - want) }
				: it
		)
		const next = { ...frame, items }
		if (fits(next, need)) return next
	}
}

/**
 * Seat one more card, `id`, in a zone's working frame — the layout editor's
 * tray add and Duplicate (brief 7b): make room, then WRITE the newcomer's
 * cells at the slot that opens. `sizes` are tried in order, and the first
 * that fits once room is made wins: a Duplicate asks for its source's size,
 * then the newcomer's footprint.
 *
 * Both halves are needed. `makeRoom` frees rows under the biggest card, which
 * is not where `seedPositions` puts a card with no saved cells (the foot of
 * the x = 0 stack, clamped back onto whatever holds the bottom rows), so the
 * slot is written onto the newcomer rather than hoped for — and the frame then
 * accounts for exactly the cards on screen, so the re-seeded zone draws them.
 *
 * **Null when no size fits**, even after `makeRoom`: every card is down to
 * `MIN_CARD_ROWS`, or the rows the cards gave up are scattered between them
 * (each keeps its top edge, so no gap closes) and none is tall enough. The
 * caller must then refuse the add.
 * Seating the card anyway lands it on top of the bottom card, and a third
 * overlapping card sends gridstack's `_fixCollisions` into unbounded
 * recursion (`RangeError`, found in the brief 7b walk) — so a truly full zone
 * says so instead (brief 7b review).
 */
export function seatCard(
	frame: ArrangedZone,
	id: string,
	sizes: readonly { w: number; h: number }[]
): ArrangedZone | null {
	for (const size of sizes) {
		const need = { w: Math.min(size.w, frame.cols), h: size.h }
		const roomy = makeRoom(frame, need)
		const slot = firstSlot(roomy, need)
		if (!slot) continue
		return {
			...roomy,
			// `clampPos` rather than the raw size: it is the clamp `firstSlot`
			// measured the slot with and the one `seedPositions` ends on, so
			// the card written here is the card the zone draws.
			items: [
				...roomy.items,
				clampPos({ id, x: slot.x, y: slot.y, ...need }, roomy.cols, roomy.rows)
			]
		}
	}
	return null
}
