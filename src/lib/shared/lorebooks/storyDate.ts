/**
 * The book's own calendar, as arithmetic.
 *
 * A history entry is not named, it is dated — the kind declares an `order`
 * role and no title — so the date is its heading, its ordering and the one
 * rule its editor enforces.
 *
 * `compareDates` is the ordering. `dateValue` packs the same three numbers into
 * one scalar for PLACEMENT only — spacing a tick, measuring a gap — and is not
 * safe to sort on. An absent month or day sorts before a present one in both.
 *
 * ⚠ **Shared, not client.** This was `client/lorebooks/sections/historyDates.ts`
 * until 2026-09-23, when amendments needed the same ordering on the server —
 * retrieval resolves an entry as-of the session's branch. Two comparators for
 * one calendar is exactly the drift NOMENCLATURE R5 is about, so the
 * arithmetic moved here and the editor's own `editBounds` stayed behind.
 */

import {
	advanceStoryTime,
	compareStoryTimes,
	formatStoryTime,
	nextStoryTime,
	parseStoryCalendar,
	storyTimeProblem,
	type StoryCalendar,
	type StoryTimeUnit
} from "@serene-pub/sdk"

export type { StoryCalendar, StoryTimeUnit } from "@serene-pub/sdk"
export { STORY_TIME_UNITS } from "@serene-pub/sdk"

export interface StoryDate {
	year: number
	month?: number | null
	day?: number | null
}

/**
 * A clock reading: a date, and optionally a time of day (24-hour). What the
 * book, each line and each session store as `story_clock_*`
 * (DESIGN-story-time §3, P3).
 */
export interface StoryClock extends StoryDate {
	hour?: number | null
	minute?: number | null
}

/**
 * A clock moved by `by` of `unit` through the book's calendar — the SDK's
 * `advanceStoryTime` itself, re-exported under its own name (one step, one
 * name, R1), so the session settings' step and a pipeline's
 * `advance-story-clock` land on the same time. Free-form moves only the part
 * named (the smallest-part rule); a result that does not land is refused with
 * a sentence (`problem`), never clamped.
 */
export { advanceStoryTime }

/** A month or day the author did not give. Sorts before one they did. */
const part = (value: number | null | undefined) => value ?? 0

/**
 * Which of two dates comes first. **The ordering key — use this to sort.**
 *
 * Element-wise, so it is correct for any magnitude. `dateValue` below packs
 * three numbers into one at radix 100, which is a *placement* value and a
 * silent liar as an ordering one: nothing bounds month or day at input, so a
 * book numbering days of the year — "Year 3, day 250", a perfectly ordinary
 * free-form habit — carries month and day past 100 and sorts wrongly. Day 250
 * of year 3 and day 50 of year 5 compare as equal.
 *
 * ⚠ An absent month or day is 0, which sorts BEFORE a present one: "Year 2" is
 * the whole year and comes before "Year 2, Mo. 5" inside it.
 */
export function compareDates(a: StoryDate, b: StoryDate): number {
	// The SDK's comparator (attributes phase 2): a story-time stat and a
	// dated entry are one calendar, so they are ordered by one function.
	return compareStoryTimes(a, b)
}

/**
 * The date as one number, for PLACEMENT — spacing a tick along an axis,
 * measuring the gap between two dates.
 *
 * ⚠ **Not an ordering key.** It assumes month and day are each under 100 and
 * says nothing useful when they are not; `compareDates` is the comparator.
 * Kept because placement genuinely needs a scalar — a ratio cannot be computed
 * from a comparison — and because a free-form book has no real intervals
 * anyway, so an approximate placement is the honest most it can offer.
 */
export function dateValue(date: StoryDate): number {
	return date.year * 10000 + part(date.month) * 100 + part(date.day)
}

/** A placement value, spelled — through the book's calendar when it has one. */
export function formatDateValue(
	value: number,
	calendar?: StoryCalendar | null
): string {
	return formatDate(dateFromValue(value), calendar)
}

/**
 * The date one encoded value stands for.
 *
 * The inverse of `dateValue`, and the one place the encoding is taken apart:
 * a month or a day of zero is an absent one rather than a real zeroth, so the
 * date that comes back is the date that went in.
 */
export function dateFromValue(value: number): StoryDate {
	return {
		year: Math.floor(value / 10000),
		month: Math.floor((value % 10000) / 100) || null,
		day: value % 100 || null
	}
}

/**
 * The date one step after `from` — what "Add the next date in sequence" dates
 * its new history entry. The SDK's `nextStoryTime`, so a story-time stat and a
 * dated entry step alike.
 *
 * The step is one more of the FINEST part the entry gives, and no coarser part
 * is invented (a year-and-month date steps a month):
 *
 *  - **Free-form** (no calendar, every book's default): nothing rolls over.
 *    Day 31 of month 1 is followed by day 32 of month 1 — a book numbering
 *    days of the year is ordinary free-form practice.
 *  - **A declared calendar**: a day past its month's length (the leap day
 *    included) rolls into the next month, a month past the last into the next
 *    year.
 *
 * Always sorts after `from` under `compareDates`.
 */
export function nextStoryDate(
	from: StoryDate,
	calendar?: StoryCalendar | null
): {
	year: number
	month: number | null
	day: number | null
} {
	return nextStoryTime(from, calendar)
}

/**
 * The heading one dated entry carries — spelled through the book's calendar
 * when it declares one, and free-form (`Year 412, Mo. 3, Day 5`, exactly as
 * always) when it does not. Straight from the parts: packing them first
 * (`dateValue`) would garble a day past 99.
 */
export function formatDate(
	date: StoryDate,
	calendar?: StoryCalendar | null
): string {
	return formatStoryTime(date, calendar)
}

/**
 * A stored `lorebooks.story_calendar` value, read for use: the calendar, or
 * `null` for free-form.
 *
 * ⚠ A malformed stored value reads as FREE-FORM rather than throwing: this is
 * on every read path, and one bad row must not take its book down. The write
 * (`lorebooks:setCalendar`) refuses a malformed calendar, so this is a guard,
 * never an ordinary path.
 */
export function readStoryCalendar(value: unknown): StoryCalendar | null {
	try {
		return parseStoryCalendar(value)
	} catch {
		return null
	}
}

/** Why one date does not land in a calendar, or `null` when it does. */
export function dateProblem(
	date: StoryDate,
	calendar: StoryCalendar | null | undefined
): string | null {
	return storyTimeProblem(date, calendar)
}

/** One dated row, named for the preflight list. */
export interface DatedRow extends StoryDate {
	/** Stable across the list — `entry:12`, `amendment:4`, `clock:main`. */
	key: string
	/** What the author calls it, for the list. */
	label: string
}

/**
 * **The preflight** (DESIGN-story-time §0, "Climbing a rung"): every dated
 * row a proposed calendar cannot place, each with the reason.
 *
 * The calendar is saved only when this is empty, and dates are validated at
 * entry afterwards, so the list cannot refill. Free-form places everything.
 */
export function datesThatDoNotLand<T extends DatedRow>(
	rows: readonly T[],
	calendar: StoryCalendar | null | undefined
): (T & { problem: string })[] {
	const out: (T & { problem: string })[] = []
	for (const row of rows) {
		const problem = storyTimeProblem(row, calendar)
		if (problem) out.push({ ...row, problem })
	}
	return out
}
