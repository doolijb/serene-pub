/**
 * The book's own calendar, as arithmetic.
 *
 * A history entry is not named, it is dated — the kind declares an `order`
 * role and no title — so the date is its heading, its ordering and the one
 * rule its editor enforces.
 *
 * `compareDates` is the ordering. `dateValue` packs the same three numbers into
 * one scalar for PLACEMENT — spacing a tick, measuring a gap. It never places a
 * later date before an earlier one, but it is not exact at every magnitude, so
 * nothing sorts or identifies by it. An absent month or day sorts before a
 * present one in both.
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
 * Element-wise, so it is exact for any magnitude. `dateValue` below packs
 * three numbers into one for *placement*: a month or a day has no ceiling (a
 * free-form book numbering days of the year, a calendar with 1000-day months),
 * so past 99 it squeezes a part into the last hundredth before the next one —
 * still in order, but too close together to tell apart once the parts grow
 * large enough. Sort and compare with this, never with the packed value.
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
 * Where a month or a day sits inside its parent's hundred units: at its own
 * number up to 99, and past that squeezed toward 100 without reaching it
 * (`100 − 1/(n − 98)`: 99.5, 99.67, 99.75 …).
 */
const slot = (n: number): number => (n <= 99 ? n : 100 - 1 / (n - 98))

/** How many of its parent's units part `n` owns: the gap to part `n + 1`. */
const width = (n: number): number => slot(n + 1) - slot(n)

/** The part whose slot a (slot-exact) number of units names. */
const unslot = (units: number): number =>
	units < 98.5 ? Math.round(units) : Math.round(98 + 1 / (100 - units))

/**
 * The date as one number, for PLACEMENT — spacing a tick along an axis,
 * measuring the gap between two dates.
 *
 * `year×10000 + month×100 + day` while month and day are under 99 — the
 * spelling every stored axis position and test relies on. From 99 on a part
 * does not own a whole unit: it is squeezed into what is left before the next
 * one (`slot` above), so the value stays **monotone** under `compareDates`
 * however large the day or month. A plain radix-100 packing is not: it puts
 * Mo. 1 Day 150 after Mo. 2 Day 1, and history days past 99 are storable
 * (A15).
 *
 * ⚠ **Still not an ordering key.** Squeezed parts crowd together and, at large
 * enough years and parts, meet inside a float's precision — so sort and
 * identify with `compareDates` and `momentKey`, and read this only to space
 * things out. A free-form book has no real intervals anyway, so an
 * approximate, order-keeping placement is the honest most it can offer.
 */
export function dateValue(date: StoryDate): number {
	const month = part(date.month)
	return date.year * 10000 + slot(month) * 100 + width(month) * slot(part(date.day))
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
 * date that comes back is the date that went in — squeezed parts included,
 * within a float's precision.
 */
export function dateFromValue(value: number): StoryDate {
	const year = Math.floor(value / 10000)
	const rest = value - year * 10000
	// The month is the last slot at or below `rest`; the estimate is exact
	// under 99 and at most a step off past it.
	let month =
		rest < 9900 ? Math.floor(rest / 100) : Math.floor(98 + 1 / (100 - rest / 100))
	while (month > 0 && slot(month) * 100 > rest) month--
	while (slot(month + 1) * 100 <= rest) month++
	const day = unslot((rest - slot(month) * 100) / width(month))
	return { year, month: month || null, day: day || null }
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

/**
 * Why one date — or clock reading — does not land in a calendar, or `null`
 * when it does. The SDK's `storyTimeProblem`: every rung's ranges and
 * narrowing rule first, then the calendar's own.
 */
export function dateProblem(
	date: StoryClock,
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
