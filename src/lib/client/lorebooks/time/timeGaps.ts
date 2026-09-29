/**
 * Gaps: the stretches of story time with nothing recorded in them.
 *
 * Measured at the coarsest unit the book actually dates by, because a book
 * dated only to the year has no opinion about months and one dated to the day
 * would report a gap between every pair. The unit is the least precise one any
 * dated entry uses: one entry dated to the year alone makes the whole book's
 * unit the year, since nothing finer can be said about the stretch it sits in.
 *
 * ⚠ **The calendar is inferred from the book** — even when one is declared
 * (a declared calendar's month lengths are not read here yet). In a free-form
 * book how many months a year holds is unknowable; the largest month and day the
 * book records stand in for it, which is what makes the turn of a year read as
 * one month rather than as a gap.
 */

import {
	compareDates,
	dateValue,
	formatDate,
	type StoryDate
} from "../sections/historyDates"

export type DateUnit = "year" | "month" | "day"

export interface TimeGap {
	after: StoryDate
	before: StoryDate
	unit: DateUnit
	sentence: string
}

/** How finely the book dates: the least precise unit any entry stops at. */
export function coarsestUnit(dates: readonly StoryDate[]): DateUnit {
	if (dates.length === 0) return "year"
	if (dates.some((d) => d.month == null)) return "year"
	if (dates.some((d) => d.day == null)) return "month"
	return "day"
}

interface Scale {
	months: number
	days: number
}

function scaleOf(dates: readonly StoryDate[]): Scale {
	return {
		months: Math.max(1, ...dates.map((d) => d.month ?? 0)),
		days: Math.max(1, ...dates.map((d) => d.day ?? 0))
	}
}

/** How far apart two dates are, counted in whole units of `unit`. */
export function unitDistance(
	after: StoryDate,
	before: StoryDate,
	unit: DateUnit,
	scale: Scale
): number {
	const years = before.year - after.year
	if (unit === "year") return years
	const months =
		years * scale.months + ((before.month ?? 0) - (after.month ?? 0))
	if (unit === "month") return months
	return months * scale.days + ((before.day ?? 0) - (after.day ?? 0))
}

/** What a gap says about the stretch it covers. */
export function gapSentence(after: StoryDate, before: StoryDate): string {
	return `Nothing recorded between ${formatDate(after)} and ${formatDate(before)}.`
}

/**
 * Every stretch of more than one unit with nothing in it.
 *
 * The dates are ordered before they are measured, and two entries sharing a
 * date are one point on the line rather than a stretch of no width.
 */
export function findGaps(dates: readonly StoryDate[]): TimeGap[] {
	if (dates.length < 2) return []
	const unit = coarsestUnit(dates)
	const scale = scaleOf(dates)
	const sorted = [...dates].sort(compareDates)
	const points: StoryDate[] = []
	for (const date of sorted)
		if (
			points.length === 0 ||
			compareDates(points[points.length - 1], date) !== 0
		)
			points.push(date)

	const gaps: TimeGap[] = []
	for (let i = 1; i < points.length; i++) {
		const after = points[i - 1]
		const before = points[i]
		if (unitDistance(after, before, unit, scale) <= 1) continue
		gaps.push({
			after,
			before,
			unit,
			sentence: gapSentence(after, before)
		})
	}
	return gaps
}
