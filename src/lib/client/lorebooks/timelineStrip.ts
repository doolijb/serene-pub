/**
 * The standing timeline strip, as arithmetic.
 *
 * Story dates become an axis, a drag becomes a position, and a position says
 * which rows are not true yet at that moment. Pure, because the strip runs
 * under every section and a rule about what a reader can see is a rule worth
 * testing without a browser.
 *
 * ⚠ This lane's strip is a **viewer**. Setting the position re-orders the pool
 * and dims what is dated after it; it does not filter cast state as of that
 * moment and it draws no branches. Both wait on the temporal-moment registry —
 * until that lands there is nothing to read validity out of, and drawing a
 * branch line with no branch behind it would be an invented fact.
 */

import {
	dateValue,
	formatDateValue,
	type StoryDate
} from "./sections/historyDates"

/** A dated row — a history entry, as the axis reads it. */
export interface DatedRow extends StoryDate {
	id: number
}

export interface TimelineTick {
	id: number
	/** `year×10000 + month×100 + day`, which is the position's own unit. */
	value: number
	label: string
	/** Where the tick sits along the axis, 0 at the start and 1 at the end. */
	ratio: number
}

/**
 * The axis: one tick per dated row, oldest first.
 *
 * Placed by date rather than by count, so a decade of silence reads as a gap
 * instead of as one more step. Rows that all share a date have no span to
 * spread across, so they fall back to even spacing — otherwise they would
 * stack into a single unclickable tick.
 */
export function buildTicks(rows: readonly DatedRow[]): TimelineTick[] {
	const sorted = [...rows].sort(
		(a, b) => dateValue(a) - dateValue(b) || a.id - b.id
	)
	if (sorted.length === 0) return []
	const values = sorted.map(dateValue)
	const min = values[0]
	const span = values[values.length - 1] - min
	const last = sorted.length - 1
	return sorted.map((row, i) => ({
		id: row.id,
		value: values[i],
		label: formatDateValue(values[i]),
		ratio: last === 0 ? 0 : span > 0 ? (values[i] - min) / span : i / last
	}))
}

/** The tick a click or a drag at this fraction of the axis lands on. */
export function tickAtRatio(
	ticks: readonly TimelineTick[],
	ratio: number
): TimelineTick | null {
	if (ticks.length === 0) return null
	const clamped = Math.min(1, Math.max(0, ratio))
	let best = ticks[0]
	for (const tick of ticks)
		if (Math.abs(tick.ratio - clamped) < Math.abs(best.ratio - clamped))
			best = tick
	return best
}

/**
 * Where the cursor is drawn.
 *
 * No position is **now** — the end of the axis — because the strip is a way to
 * look back, not a mode that has to be dismissed.
 */
export function ratioOf(
	ticks: readonly TimelineTick[],
	position: number | null
): number {
	if (position == null || ticks.length === 0) return 1
	let best = 1
	for (const tick of ticks) if (tick.value <= position) best = tick.ratio
	return position < ticks[0].value ? ticks[0].ratio : best
}

/** The rows dated after the cursor: true later, not yet true here. */
export function keysAfter(
	items: readonly { key: string; order: number }[],
	position: number | null
): string[] {
	if (position == null) return []
	return items.filter((i) => i.order > position).map((i) => i.key)
}

/**
 * The list with the moment's rows first.
 *
 * A stable partition rather than a sort: the toolbar's ordering is the reader's
 * choice and stays intact inside each half.
 */
export function orderByMoment<T extends { key: string }>(
	items: readonly T[],
	after: ReadonlySet<string>
): T[] {
	if (after.size === 0) return [...items]
	const now: T[] = []
	const later: T[] = []
	for (const item of items) (after.has(item.key) ? later : now).push(item)
	return [...now, ...later]
}
