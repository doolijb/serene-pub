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
	compareDates,
	dateValue,
	formatDate,
	type StoryDate
} from "./sections/historyDates"
import { momentKey } from "$lib/shared/lorebooks/loreRoute"

/** A dated row — a history entry, as the axis reads it. */
export interface DatedRow extends StoryDate {
	id: number
}

export interface TimelineTick {
	id: number
	/** The tick's own date — what a click on it lands on. */
	date: StoryDate
	/** `momentKey(date)`: the tick's identity and the address it writes. */
	key: string
	/**
	 * `dateValue(date)` — PLACEMENT only. It keeps the calendar's order (a
	 * part past 99 is squeezed, not overflowed), but squeezed parts crowd
	 * together, so it never identifies a tick: `key` does.
	 */
	value: number
	label: string
	/** Where the tick sits along the axis, 0 at the start and 1 at the end. */
	ratio: number
}

/**
 * Every date the story knows, for the Moment bar's axis.
 *
 * ⚠ A history entry is not the only thing with a date any more. An entry
 * amended at Y4 makes Y4 a moment worth standing at — the book reads
 * differently there — so the bar has to be able to land on it. Before this the
 * bar could say "Nothing is dated yet" while an amendment sat at Y4 and the
 * banner above it said "Reading as of Year 4".
 *
 * ⚠ Deduped by DATE (its lossless key, never the packed value, which
 * merges Mo. 1 Day 150 with Mo. 2 Day 50), not by row: several amendments on one day, or an
 * amendment dated at a history entry's date, are one place to stand. The
 * history entry wins the tick's id where both exist, so a tick keeps naming a
 * row the reader can open.
 *
 * ⚠ **The tick id is not unique on this axis, and nothing may treat it as an
 * identity.** Rows arrive from three tables — history entries, entry
 * amendments, cast amendments — whose ids collide freely. The DATE is the
 * identity here, because the axis holds one tick per date; `MomentBar` keys its
 * `{#each}` on `tick.key` for exactly this reason. Keying on the id raised
 * `each_key_duplicate` the moment a cast amendment shared an id with an entry
 * amendment, which is to say almost immediately.
 */
export function momentAxisRows(
	history: readonly DatedRow[],
	amendments: readonly DatedRow[]
): DatedRow[] {
	const byDate = new Map<string, DatedRow>()
	// History first, so it wins the id on a shared date.
	for (const row of [...history, ...amendments]) {
		const key = momentKey(row)
		if (!byDate.has(key)) byDate.set(key, row)
	}
	return [...byDate.values()].sort(compareDates)
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
	const sorted = [...rows].sort((a, b) => compareDates(a, b) || a.id - b.id)
	if (sorted.length === 0) return []
	const values = sorted.map(dateValue)
	const min = values[0]
	const span = values[values.length - 1] - min
	const last = sorted.length - 1
	return sorted.map((row, i) => {
		const date: StoryDate = {
			year: row.year,
			month: row.month ?? null,
			day: row.month != null ? (row.day ?? null) : null
		}
		return {
			id: row.id,
			date,
			key: momentKey(date),
			value: values[i],
			label: formatDate(date),
			ratio: last === 0 ? 0 : span > 0 ? (values[i] - min) / span : i / last
		}
	})
}

/** The tick a click or a drag at this fraction of the axis lands on. */
/**
 * Where along a track a pointer is, as a fraction of the part the ticks are
 * drawn on (plan B7). Ticks sit at `calc(inset + ratio * (100% - 2·inset))`
 * — the strip, the moment bar and the Time lens's axis all inset them by
 * half a rem — so the box's own width over-reads near both ends: a drop at
 * the last tick read as short of it. Clamped to [0, 1]; null when the track
 * has no room to read.
 */
export function ratioAlongTrack(
	clientX: number,
	track: { left: number; width: number },
	insetPx: number
): number | null {
	const span = track.width - 2 * insetPx
	if (!(span > 0)) return null
	return Math.min(1, Math.max(0, (clientX - track.left - insetPx) / span))
}

/** Half a rem in pixels: the inset every timeline track draws its ticks in. */
export function trackInsetPx(): number {
	if (typeof document === "undefined") return 8
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
	return (Number.isFinite(rem) && rem > 0 ? rem : 16) / 2
}

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

/**
 * The tick an arrow key moves to from `current` (a date, or null for now).
 *
 * By DATE, never by index: from now, back is the newest tick (not the one
 * before it); from a moment between ticks, back is the last tick before it
 * and forward the first after it. Forward past the newest tick is now
 * (`null`); back from the oldest stays there. `undefined` = no ticks.
 */
export function stepTick(
	ticks: readonly TimelineTick[],
	current: StoryDate | null,
	direction: "back" | "forward"
): TimelineTick | null | undefined {
	if (ticks.length === 0) return undefined
	if (direction === "back") {
		if (current === null) return ticks[ticks.length - 1]
		let found: TimelineTick | null = null
		for (const tick of ticks)
			if (compareDates(tick.date, current) < 0) found = tick
		return found ?? ticks[0]
	}
	if (current === null) return null
	return ticks.find((tick) => compareDates(tick.date, current) > 0) ?? null
}

/**
 * The rows dated after the moment: true later, not yet true here.
 *
 * ⚠ By `compareDates` on each row's own DATE against the cursor's KEY (its
 * lossless address) — never the packed placement value, which collides once
 * a month or a day passes 100 and then dims the wrong rows. An undated row
 * is never later than anything.
 */
export function keysAfter(
	items: readonly { key: string; date: StoryDate | null }[],
	at: StoryDate | null
): string[] {
	if (at == null) return []
	return items
		.filter((i) => i.date != null && compareDates(i.date, at) > 0)
		.map((i) => i.key)
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
