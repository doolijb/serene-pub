/**
 * The delta between two story dates, in story time.
 *
 * `storyDateDeltaOf(date, now, calendar)` is the row date minus now, as parts:
 * a `sign` (-1 the row is before now, +1 after, 0 equal) and non-negative
 * magnitudes. Pure: the same inputs give the same result, and the wall clock
 * is never read.
 *
 * **Compared parts.** The year always; the month only when both carry one; the
 * day only when both carry a month and a day; the time only when the day is
 * compared and both carry an hour (minute defaults 0). A part not compared is
 * `null` in the result, never `0`. `sign` is `compareDates` over the compared
 * parts alone.
 *
 * **Borrowing**, finest part first, subtracting the earlier from the later.
 * Minutes from hours (60) and hours from days (24) are exact. Under a declared
 * calendar a day borrows the length of the month before the later date's month
 * (right year, leap day included; month 1 reads the previous year's last
 * month), and the one before that while it is still negative; a month borrows
 * the calendar's month count, again while it is still negative.
 *
 * **Free-form** has no lengths: a part that would borrow from a coarser one
 * takes one from it and every part finer than that coarser part becomes `null`
 * (known to be at least that much, no more exactly). A cascade follows the same
 * rule. The free-form rule also applies to the whole delta when a calendar is
 * given and either date does not land in it (`storyTimeProblem`): the month
 * lengths of a date the calendar cannot place are not known. No part is ever
 * negative.
 */

import {
	storyDaysInMonth,
	storyTimeProblem,
	type StoryDateDelta
} from "@serene-pub/sdk"
import { compareDates, type StoryCalendar, type StoryClock } from "./storyDate"

const hasYear = (date: StoryClock | null | undefined): date is StoryClock =>
	!!date && typeof date.year === "number" && Number.isFinite(date.year)

// Levels, coarse to fine.
const YEAR = 0
const MONTH = 1
const DAY = 2
const HOUR = 3
const MINUTE = 4

export function storyDateDeltaOf(
	date: StoryClock | null | undefined,
	now: StoryClock | null | undefined,
	calendar: StoryCalendar | null
): StoryDateDelta | null {
	if (!hasYear(date) || !hasYear(now)) return null
	// A calendar that cannot place both dates has no month lengths to borrow
	// from them: the whole delta follows the free-form rule.
	if (
		calendar &&
		(storyTimeProblem(date, calendar) !== null ||
			storyTimeProblem(now, calendar) !== null)
	)
		calendar = null
	const monthed = date.month != null && now.month != null
	const dayed = monthed && date.day != null && now.day != null
	const timed = dayed && date.hour != null && now.hour != null
	const depth = timed ? MINUTE : dayed ? DAY : monthed ? MONTH : YEAR

	const cut = (d: StoryClock): StoryClock => ({
		year: d.year,
		month: monthed ? d.month : null,
		day: dayed ? d.day : null,
		hour: timed ? d.hour : null,
		minute: timed ? (d.minute ?? 0) : null
	})
	const a = cut(date)
	const b = cut(now)
	const order = compareDates(a, b)
	const sign = order < 0 ? -1 : order > 0 ? 1 : 0
	const [early, late] = sign > 0 ? [b, a] : [a, b]

	const read = (d: StoryClock, level: number): number =>
		[d.year, d.month, d.day, d.hour, d.minute][level] ?? 0
	const vals: (number | null)[] = []
	for (let level = 0; level <= depth; level++)
		vals[level] = read(late, level) - read(early, level)

	for (let level = depth; level > YEAR; level--) {
		let v = vals[level]
		if (v === null || v >= 0) continue
		const parent = level - 1
		if (level === MINUTE) v += 60
		else if (level === HOUR) v += 24
		else if (calendar && level === DAY) {
			// Month lengths backwards from the month before the later date's,
			// one month taken for each, until the day is not negative.
			let year = late.year
			let month = late.month!
			for (;;) {
				month -= 1
				if (month < 1) {
					month = calendar.months.length
					year -= 1
				}
				v += storyDaysInMonth(year, month, calendar)
				if (v >= 0) break
				vals[parent] = (vals[parent] ?? 0) - 1
			}
		} else if (calendar && level === MONTH) {
			// One year borrowed (below), repaid in months; more while still negative.
			v += calendar.months.length
			while (v < 0) {
				v += calendar.months.length
				vals[parent] = (vals[parent] ?? 0) - 1
			}
		} else {
			// Free-form: nothing finer than the coarser part can be known.
			for (let finer = level; finer <= depth; finer++) vals[finer] = null
			vals[parent] = (vals[parent] ?? 0) - 1
			continue
		}
		vals[level] = v
		vals[parent] = (vals[parent] ?? 0) - 1
	}

	const at = (level: number): number | null => (level <= depth ? vals[level] : null)
	const hour = at(HOUR)
	const minute = at(MINUTE)
	return {
		sign,
		year: vals[YEAR] ?? 0,
		month: at(MONTH),
		day: at(DAY),
		time: hour !== null && minute !== null ? { hour, minute } : null
	}
}
