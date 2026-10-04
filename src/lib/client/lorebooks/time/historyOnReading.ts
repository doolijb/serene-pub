/**
 * The history entries a reading sees, newest first — what a session can file
 * a scene under.
 *
 * On the line (`rowsReadingOnLine`, the one rule): the line's own entries and
 * each ancestor's only up to its fork cut, never a sibling line's. With a
 * moment (a session holding a clock of its own), nothing dated after it — a
 * scene cannot be filed under a day the story has not reached. Undated
 * entries make no claim about when, so they are always seen, and listed last.
 *
 * Ordered by `compareDates`, never by a packed number.
 */
import { rowsReadingOnLine, type Line } from "$lib/shared/lorebooks/lineReading"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"

/** A history row as far as its place in time goes. */
export interface HistoryOnLine {
	branchId?: number | null
	year?: number | null
	month?: number | null
	day?: number | null
}

const dateOf = (e: HistoryOnLine): StoryDate | null =>
	typeof e.year === "number"
		? { year: e.year, month: e.month ?? null, day: e.day ?? null }
		: null

export function historyEntriesOnReading<T extends HistoryOnLine>(
	entries: readonly T[],
	line: Line,
	moment: StoryDate | null
): T[] {
	return rowsReadingOnLine(entries, line, dateOf, moment).sort((a, b) => {
		const da = dateOf(a)
		const db = dateOf(b)
		if (!da || !db) return da ? -1 : db ? 1 : 0
		return compareDates(db, da)
	})
}
