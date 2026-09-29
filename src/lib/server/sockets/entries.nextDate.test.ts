/**
 * "Move the story's clock forward" on a free-form calendar.
 *
 * No calendar is declared yet, so nothing rolls over: a day past 31 or a
 * month past 12 is an ordinary date in a book that numbers them that way, and
 * the next one is simply one more of the finest part the entry gives.
 */
import { describe, expect, test } from "vitest"
import { compareDates, nextStoryDate } from "$lib/shared/lorebooks/storyDate"

describe("nextStoryDate — free-form, no rollover", () => {
	test("day 31 of month 1 is followed by day 32 of month 1", () => {
		expect(nextStoryDate({ year: 5, month: 1, day: 31 })).toEqual({
			year: 5,
			month: 1,
			day: 32
		})
	})

	test("a month past 12 is kept, and the day counts on", () => {
		expect(nextStoryDate({ year: 5, month: 13, day: 40 })).toEqual({
			year: 5,
			month: 13,
			day: 41
		})
	})

	test("day 28 of month 2 in a Gregorian leap year is day 29, not rolled", () => {
		expect(nextStoryDate({ year: 2023, month: 2, day: 28 })).toEqual({
			year: 2023,
			month: 2,
			day: 29
		})
	})

	test("a year-only entry advances the year and invents no month or day", () => {
		expect(nextStoryDate({ year: 3, month: null, day: null })).toEqual({
			year: 4,
			month: null,
			day: null
		})
	})

	test("a year-and-month entry advances the month and invents no day", () => {
		expect(nextStoryDate({ year: 3, month: 12, day: null })).toEqual({
			year: 3,
			month: 13,
			day: null
		})
	})

	test("the next date always sorts after its source by the shared comparator", () => {
		for (const from of [
			{ year: 5, month: 1, day: 31 },
			{ year: 5, month: 13, day: 250 },
			{ year: -2, month: null, day: null },
			{ year: 3, month: 99, day: null },
			{ year: 3, month: 1, day: 99 }
		]) {
			expect(compareDates(nextStoryDate(from), from)).toBeGreaterThan(0)
		}
	})
})
