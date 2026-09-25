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

export interface StoryDate {
	year: number
	month?: number | null
	day?: number | null
}

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
	return (
		a.year - b.year ||
		part(a.month) - part(b.month) ||
		part(a.day) - part(b.day)
	)
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

export function formatDateValue(value: number): string {
	const y = Math.floor(value / 10000)
	const m = Math.floor((value % 10000) / 100)
	const d = value % 100
	return `Year ${y}${m ? `, Mo. ${m}` : ""}${d ? `, Day ${d}` : ""}`
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

/** The heading one dated entry carries. */
export function formatDate(date: StoryDate): string {
	return formatDateValue(dateValue(date))
}
