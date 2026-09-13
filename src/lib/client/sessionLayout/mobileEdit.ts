/**
 * The MOBILE layout editor's model (ruled 2026-09-10) — pure, and the whole of
 * what a narrow-screen edit may do to an arrangement.
 *
 * Below the app's breakpoint a session draws no side-by-side widgets: every
 * render unit gets its own row, in the order `collapsedOrder` resolves (see
 * ./sideRail). The editor there edits exactly that — an ordered list per zone,
 * an order inside each tab group, and the per-group pin — because a free-form
 * 2D grid is not a thing a phone can draw or a thumb can drag.
 *
 * ## One arrangement, both editors
 *
 * There is no mobile layout blob. Every function here takes a captured
 * `GsLayout` and returns one, so a layout arranged on a phone is the same
 * `arrangedGrid` a desktop opens, travels through the same presets, and commits
 * through the same path. Two rules keep that honest:
 *
 *   1. A move is only ever accepted when it produces EXACTLY the order asked
 *      for and leaves the cells drawable — no unit overlapping another, none
 *      outside the zone's own grid. A move with no such expression returns the
 *      arrangement it was given, by reference.
 *   2. A move that changes nothing changes no bytes. Untouched items are
 *      returned by reference and untouched fields keep their key order, so a
 *      move and its inverse round-trip to the original JSON.
 *
 * ## Anchors are order here, and only order
 *
 * A top/bottom anchor is what puts a group first or last in one column, so it
 * surfaces as a group's RANK (first / between / last) and moving across a rank
 * boundary writes it. The left/right edges of the same anchor are a desktop
 * alignment and are carried through untouched.
 *
 * ## What a cross-row move costs
 *
 * Two widgets arranged side by side are one row of the grid and two rows of the
 * phone. Reordering them against each other trades their columns and keeps the
 * row. Moving one of them past the row above or below cannot keep it, so that
 * widget takes a row of its own — which is what the phone was already drawing.
 */
import type { GsAnchor, GsLayout, GsPos } from "./GridStackZone.svelte"
import { unitPinned, withPins } from "./arrangedGeometry"
import { collapsedOrder } from "./sideRail"
import { unitsOf, type RenderUnit } from "./tabGroups"

/** Where a group sits in one column: 0 first, 1 between, 2 last. */
export type OrderRank = 0 | 1 | 2

/** One row of the phone editor's list: a render unit and what it can be told. */
export interface MobileRow {
	/** The render unit's key — a group id, or a lone widget's id. */
	key: string
	/** The widget ids in it, in tab order. One entry for a lone widget. */
	members: string[]
	/** Expanded by default, and it keeps its height (see ./sideRail rule (b)). */
	pinned: boolean
	rank: OrderRank
	/** The cells the unit holds, for the caller that draws a size hint. */
	box: { x: number; y: number; w: number; h: number }
}

/** The rank a widget's anchor means in one column — `collapsedOrder`'s ranking. */
function rankOf(a?: GsAnchor): OrderRank {
	return a?.top ? 0 : a?.bottom ? 2 : 1
}

/**
 * The zone's render units in the order a narrow screen draws them.
 *
 * The order is `collapsedOrder`'s, read through the same `unitsOf` the live
 * view uses, so the list is the render rather than a second reading of it.
 */
export function mobileRows(zone: GsLayout | null | undefined): MobileRow[] {
	if (!zone?.items?.length) return []
	const units = unitsOf(zone.items)
	const byKey = new Map(units.map((u) => [u.key, u]))
	return collapsedOrder(
		units.map((u) => ({
			key: u.key,
			box: u.box,
			anchor: u.members[0]?.anchor
		}))
	)
		.map((k) => byKey.get(k))
		.filter((u): u is RenderUnit => !!u)
		.map((u) => ({
			key: u.key,
			members: u.members.map((m) => m.id),
			pinned: unitPinned(u.members),
			rank: rankOf(u.members[0]?.anchor),
			box: u.box
		}))
}

/** Rewrite the items a mapper changes, keeping the zone itself when none do. */
function withItems(
	zone: GsLayout,
	map: (it: GsPos) => GsPos,
	rows?: number
): GsLayout {
	const items = zone.items.map(map)
	const nextRows = rows ?? zone.rows
	if (nextRows === zone.rows && items.every((it, i) => it === zone.items[i]))
		return zone
	return { ...zone, rows: nextRows, items }
}

/**
 * The zone's ROWS: units that share cell rows, top to bottom.
 *
 * A row of the grid is one row of the column — two widgets side by side are one
 * band, not two — and it is the unit a re-stack moves, so a reorder never
 * silently un-pairs widgets it did not touch.
 */
function bandsOf(units: RenderUnit[]): RenderUnit[][] {
	const sorted = [...units].sort(
		(a, b) => a.box.y - b.box.y || a.box.x - b.box.x
	)
	const bands: RenderUnit[][] = []
	for (const u of sorted) {
		const last = bands[bands.length - 1]
		if (last?.some((v) => u.box.y < v.box.y + v.box.h)) last.push(u)
		else bands.push([u])
	}
	return bands
}

/**
 * Stack the zone's bands top to bottom in `order`, each keeping its own height,
 * its widgets' columns and their offsets inside it.
 *
 * Consecutive units that already shared a band stay in it, so re-stacking a
 * zone in its own order is a no-op down to the bytes — which is what makes an
 * ordering edit cost only the ordering. `split` names the unit a move is about:
 * it always takes a band of its own, since a widget cannot be ordered against a
 * widget it is drawn beside.
 *
 * The zone keeps its declared `rows` unless the new stack needs more.
 */
export function restackZone(
	zone: GsLayout,
	order?: string[],
	split?: string
): GsLayout {
	const units = unitsOf(zone.items)
	const byKey = new Map(units.map((u) => [u.key, u]))
	const bandIndex = new Map<string, number>()
	bandsOf(units).forEach((b, i) => b.forEach((u) => bandIndex.set(u.key, i)))

	const keys = order ?? mobileRows(zone).map((r) => r.key)
	const bands: RenderUnit[][] = []
	// -2 marks "nothing may join this": the band a split unit occupies alone.
	let prev = -1
	for (const k of keys) {
		const u = byKey.get(k)
		if (!u) continue
		const band = bandIndex.get(k) ?? -1
		const alone = k === split
		if (!alone && bands.length && band === prev)
			bands[bands.length - 1].push(u)
		else bands.push([u])
		prev = alone ? -2 : band
	}

	const dy = new Map<string, number>()
	let top = 0
	for (const b of bands) {
		const bandTop = Math.min(...b.map((u) => u.box.y))
		const bandEnd = Math.max(...b.map((u) => u.box.y + u.box.h))
		for (const u of b) {
			const d = top + (u.box.y - bandTop) - u.box.y
			for (const m of u.members) dy.set(m.id, d)
		}
		top += bandEnd - bandTop
	}

	return withItems(
		zone,
		(it) => {
			const d = dy.get(it.id)
			return d ? { ...it, y: it.y + d } : it
		},
		Math.max(top, zone.rows)
	)
}

/**
 * Trade two units' columns inside the row they share.
 *
 * Their column spans exchange places within the span the two of them already
 * covered, so nothing else in the row moves and neither can land on it. Null
 * when their columns interleave, which no exchange of two blocks can express.
 */
function swapColumns(
	zone: GsLayout,
	u: MobileRow,
	v: MobileRow
): GsLayout | null {
	const a = u.box
	const b = v.box
	if (!(a.x + a.w <= b.x || b.x + b.w <= a.x)) return null
	const [lo, hi] = a.x < b.x ? [u, v] : [v, u]
	const end = hi.box.x + hi.box.w
	const shift = new Map<string, number>()
	for (const id of lo.members) shift.set(id, end - lo.box.w - lo.box.x)
	for (const id of hi.members) shift.set(id, lo.box.x - hi.box.x)
	return withItems(zone, (it) => {
		const d = shift.get(it.id)
		return d ? { ...it, x: it.x + d } : it
	})
}

/**
 * The anchor a widget wears at `rank`, written in one canonical key order so
 * an anchor set and cleared again is the anchor that was there. An anchor with
 * nothing left in it is absent, never `{}`.
 */
function anchorAt(
	a: GsAnchor | undefined,
	rank: OrderRank
): GsAnchor | undefined {
	const next: GsAnchor = {}
	if (rank === 0) next.top = true
	if (a?.right) next.right = true
	if (rank === 2) next.bottom = true
	if (a?.left) next.left = true
	return Object.keys(next).length ? next : undefined
}

/** Put a unit's widgets in `rank`, keeping their left/right edges. */
function withRank(
	zone: GsLayout,
	ids: Iterable<string>,
	rank: OrderRank
): GsLayout {
	const set = new Set(ids)
	return withItems(zone, (it) => {
		if (!set.has(it.id)) return it
		const next = anchorAt(it.anchor, rank)
		if (JSON.stringify(next ?? null) === JSON.stringify(it.anchor ?? null))
			return it
		const { anchor: _drop, ...rest } = it
		return next ? { ...rest, anchor: next } : rest
	})
}

function overlapCount(zone: GsLayout): number {
	const boxes = unitsOf(zone.items).map((u) => u.box)
	let n = 0
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			if (
				a.x < b.x + b.w &&
				a.x + a.w > b.x &&
				a.y < b.y + b.h &&
				a.y + a.h > b.y
			)
				n++
		}
	return n
}

function withinGrid(zone: GsLayout): boolean {
	return zone.items.every(
		(it) =>
			it.x >= 0 &&
			it.y >= 0 &&
			it.x + it.w <= zone.cols &&
			it.y + it.h <= zone.rows
	)
}

/** Is this candidate drawable — no worse than the arrangement it came from? */
function drawable(next: GsLayout, from: GsLayout): boolean {
	return (
		overlapCount(next) <= overlapCount(from) &&
		(withinGrid(next) || !withinGrid(from))
	)
}

function sameOrder(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((k, i) => k === b[i])
}

/**
 * Move one group a step up (`-1`) or down (`1`) in the zone's phone order.
 *
 * The first expression that lands the asked-for order and stays drawable wins:
 * the rank alone where the neighbour holds a different one, a column trade
 * where the two share a row, and otherwise a re-stack that gives the moved
 * group a row of its own. Nothing else in the zone moves that does not have to.
 */
export function moveRow(zone: GsLayout, key: string, delta: number): GsLayout {
	if (!delta) return zone
	const rows = mobileRows(zone)
	const i = rows.findIndex((r) => r.key === key)
	if (i < 0) return zone
	const j = i + delta
	if (j < 0 || j >= rows.length) return zone

	const want = rows.map((r) => r.key)
	;[want[i], want[j]] = [want[j], want[i]]
	const moved = rows[i]
	const past = rows[j]

	const base =
		moved.rank === past.rank
			? zone
			: withRank(zone, moved.members, past.rank)
	const shareRow =
		moved.box.y < past.box.y + past.box.h &&
		past.box.y < moved.box.y + moved.box.h

	for (const cand of [
		base,
		shareRow ? swapColumns(base, moved, past) : null,
		restackZone(base, want, moved.key)
	]) {
		if (!cand || cand === zone) continue
		if (!drawable(cand, zone)) continue
		if (
			!sameOrder(
				mobileRows(cand).map((r) => r.key),
				want
			)
		)
			continue
		return cand
	}
	return zone
}

/**
 * Drop a group at `index` in the zone's phone order — the drag handle's answer.
 *
 * Spent as single steps, so a drag can express nothing a pair of move buttons
 * cannot, and a step that finds no drawable expression stops the drag there.
 */
export function moveRowTo(
	zone: GsLayout,
	key: string,
	index: number
): GsLayout {
	let cur = zone
	for (;;) {
		const rows = mobileRows(cur)
		const at = rows.findIndex((r) => r.key === key)
		if (at < 0 || !rows.length) return cur
		const want = Math.min(Math.max(0, Math.round(index)), rows.length - 1)
		if (at === want) return cur
		const next = moveRow(cur, key, want > at ? 1 : -1)
		if (next === cur) return cur
		cur = next
	}
}

/** Pin or unpin one group — the arrangement's own field (see `withPins`). */
export function setRowPinned(
	zone: GsLayout,
	key: string,
	pinned: boolean
): GsLayout {
	const row = mobileRows(zone).find((r) => r.key === key)
	if (!row) return zone
	return withPins(zone, row.members, pinned)
}

/**
 * Move one widget a step within its tab group.
 *
 * The two widgets trade cells outright, so the group's footprint, and every
 * other unit's, is exactly what it was — a group's members share one footprint
 * in the live view, and their cells decide only which tab comes first.
 */
export function moveMember(
	zone: GsLayout,
	key: string,
	id: string,
	delta: number
): GsLayout {
	if (!delta) return zone
	const row = mobileRows(zone).find((r) => r.key === key)
	if (!row || row.members.length < 2) return zone
	const i = row.members.indexOf(id)
	if (i < 0) return zone
	const j = i + delta
	if (j < 0 || j >= row.members.length) return zone

	const want = [...row.members]
	;[want[i], want[j]] = [want[j], want[i]]
	const a = zone.items.find((it) => it.id === row.members[i])
	const b = zone.items.find((it) => it.id === row.members[j])
	if (!a || !b) return zone
	const cells = new Map<string, GsPos>([
		[a.id, b],
		[b.id, a]
	])
	const next = withItems(zone, (it) => {
		const c = cells.get(it.id)
		return c ? { ...it, x: c.x, y: c.y, w: c.w, h: c.h } : it
	})
	if (!drawable(next, zone)) return zone
	const after = mobileRows(next).find((r) => r.key === key)
	return after && sameOrder(after.members, want) ? next : zone
}
