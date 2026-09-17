/**
 * The Move tab's ARRANGEMENT GEOMETRY — pure, and the one place the editor's
 * saved-arrangement maths lives.
 *
 * Four jobs, all of them about the same round trip (persisted blob → the
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
 *
 * They were extracted from SessionLayout.svelte / GridStackZone.svelte so the
 * round trip can be tested without a browser, a gridstack, or a window size.
 */
import type { GsItem, GsLayout, GsPos } from "./GridStackZone.svelte"
import { isRetiredWidget } from "./widgetGrid"

/** The three editor zones' captured arrangements — the persisted blob's shape. */
export type Arranged = { left?: GsLayout; middle?: GsLayout; right?: GsLayout }

export function isGsPos(i: unknown): i is GsPos {
	return (
		!!i &&
		typeof i === "object" &&
		typeof (i as any).id === "string" &&
		["x", "y", "w", "h"].every((k) => typeof (i as any)[k] === "number")
	)
}

export function isGsLayout(z: unknown): z is GsLayout {
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
 * Defensively rehydrate the persisted per-zone geometry (verbatim blob).
 *
 * Retired ids are dropped here, which is the one place every reader of a saved
 * arrangement passes through — the live render, the editor, and the picture a
 * preset draws. An arrangement captured under an older build keeps its cells
 * and loses the cards this build has no widget for.
 */
export function loadArranged(saved: unknown): Arranged {
	if (!saved || typeof saved !== "object") return {}
	const out: Arranged = {}
	for (const key of ["left", "middle", "right"] as const) {
		const z = (saved as any)[key]
		if (isGsLayout(z))
			out[key] = {
				cols: z.cols,
				rows: z.rows,
				items: z.items.filter(isGsPos).filter(isLivePos)
			}
	}
	return out
}

/**
 * Does this arrangement place no widget anywhere?
 *
 * The predicate `commitArrangement` decides Done with. An editor that never had
 * a widget to report leaves `{}` behind, and `{}` is TRUTHY — written to the
 * manager it would satisfy `effectiveArrangedGrid`'s `??` and mask the preset
 * base for good. An arrangement of nothing is not an arrangement, so the seam
 * clears instead of storing one. A zone that reported its cell dims and an empty
 * item list counts as nothing too: that is the same editor, one repaint later.
 */
export function arrangementIsEmpty(a: Arranged): boolean {
	return !(["left", "middle", "right"] as const).some(
		(key) => (a[key]?.items?.length ?? 0) > 0
	)
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
	zone: GsLayout | undefined
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
	zone: GsLayout,
	ids: Iterable<string>,
	pinned: boolean
): GsLayout {
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
 * `frame` is the same per-side slice of `Arranged` the live view keys its own
 * arranged/unarranged branch on, so this mirrors that branch rather than
 * inventing a second definition of "arranged".
 */
export function showZonePin(frame: GsLayout | undefined): boolean {
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
	frame: GsLayout | undefined
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
): GsPos {
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
): GsPos[] {
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
	const out: GsPos[] = []
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
 * `GsLayout` rather than the editor's item list — the RE-MEASURE path, where
 * what is being re-expressed is an arrangement and not a fresh set of cards.
 *
 * It is a pure function of `ref`, which is the whole point: a zone re-drawn at
 * a narrower width and then back again is `reexpress(ref, …)` twice, so it
 * lands exactly where it started. Feeding it back its own narrow output
 * instead — which is what gridstack's `column()` does to the live nodes — keeps
 * only what survived the squeeze, and the arrangement is gone.
 */
export function reexpress(ref: GsLayout, cols: number, rows: number): GsPos[] {
	return seedPositions(
		// `seedPositions` reads cells, not labels; the title is the GsItem shape
		// asking for something a captured position has no need of.
		ref.items.map((p) => ({ ...p, title: "" })),
		cols,
		rows,
		ref
	)
}
