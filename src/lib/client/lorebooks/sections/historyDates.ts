/**
 * History's dates, for the editor.
 *
 * ⚠ The arithmetic moved to `$lib/shared/lorebooks/storyDate.ts` on
 * 2026-09-23: amendments resolve as-of a story date on the SERVER too, and one
 * calendar must not have two comparators. It is re-exported here so every
 * existing call site keeps working and nobody has to learn a second import.
 *
 * What stayed is the one thing only the editor needs: the bounds a date may be
 * dragged between.
 */
export {
	compareDates,
	dateFromValue,
	dateValue,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"

import {
	compareDates,
	formatDate as formatThrough,
	formatDateValue as formatValueThrough,
	type StoryCalendar,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import { openBookTime } from "../time/bookTime.svelte"

/**
 * A date as the open book spells it — through its declared calendar, or
 * free-form (`Year 3, Mo. 2, Day 12`) when it declares none. Pass a calendar
 * to spell for some other book.
 */
export function formatDate(
	date: StoryDate,
	calendar: StoryCalendar | null = openBookTime.calendar
): string {
	return formatThrough(date, calendar)
}

/** A placement value, spelled the same way. */
export function formatDateValue(
	value: number,
	calendar: StoryCalendar | null = openBookTime.calendar
): string {
	return formatValueThrough(value, calendar)
}

/**
 * The exclusive range an existing entry's date must stay inside.
 *
 * ⚠ Returns the neighbouring DATES, not packed scalars. It returned scalars
 * until 2026-09-24, which meant the caller compared with `<=` on a packed
 * value and then tore the number back apart to print it — both of which the
 * radix-100 collision made unsafe.
 *
 * The list is ordered by date and nothing renumbers it, so a date that
 * crosses a neighbour reorders the story silently. The bounds are the
 * immediate neighbours' dates; a new entry and the only entry have none.
 */
export function editBounds(
	entries: readonly (StoryDate & { id: number })[],
	id: number | undefined
): { min: StoryDate | null; max: StoryDate | null } {
	if (id == null || entries.length < 2) return { min: null, max: null }
	const sorted = [...entries].sort(compareDates)
	const idx = sorted.findIndex((e) => e.id === id)
	if (idx === -1) return { min: null, max: null }
	return {
		min: idx > 0 ? sorted[idx - 1] : null,
		max: idx < sorted.length - 1 ? sorted[idx + 1] : null
	}
}
