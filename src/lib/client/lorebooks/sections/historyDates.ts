/**
 * History's dates, as arithmetic.
 *
 * A history entry is not named, it is dated — the kind declares an `order`
 * role and no title — so the date is its heading, its ordering and the one
 * rule its editor enforces. Encoded as `year×10000 + month×100 + day` so all
 * three comparisons are one integer comparison, and an absent month or day
 * sorts before a present one.
 */

export interface StoryDate {
	year: number
	month?: number | null
	day?: number | null
}

export function dateValue(date: StoryDate): number {
	return date.year * 10000 + (date.month || 0) * 100 + (date.day || 0)
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

/**
 * The exclusive range an existing entry's date must stay inside.
 *
 * The list is ordered by date and nothing renumbers it, so a date that
 * crosses a neighbour reorders the story silently. The bounds are the
 * immediate neighbours' dates; a new entry and the only entry have none.
 */
export function editBounds(
	entries: readonly (StoryDate & { id: number })[],
	id: number | undefined
): { min: number; max: number } {
	if (id == null || entries.length < 2)
		return { min: -Infinity, max: Infinity }
	const sorted = [...entries].sort((a, b) => dateValue(a) - dateValue(b))
	const idx = sorted.findIndex((e) => e.id === id)
	if (idx === -1) return { min: -Infinity, max: Infinity }
	return {
		min: idx > 0 ? dateValue(sorted[idx - 1]) : -Infinity,
		max: idx < sorted.length - 1 ? dateValue(sorted[idx + 1]) : Infinity
	}
}
