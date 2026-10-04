import { describe, expect, it } from "vitest"
import {
	compareDates,
	dateFromValue,
	dateValue,
	datesThatDoNotLand,
	formatDate,
	formatDateValue,
	nextStoryDate,
	readStoryCalendar,
	type StoryCalendar
} from "./storyDate"

/** Three months, a three-day week, a leap day every 4th year, two eras. */
const THAW: StoryCalendar = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	weekdays: ["Moonday", "Ashday", "Restday"],
	firstWeekday: 0,
	yearLabel: "Year",
	leap: { every: 4, month: 3 },
	eras: [
		{ name: "BR", start: null, backwards: true },
		{ name: "AR", start: 1 }
	]
}

describe("the book's calendar — round trip", () => {
	it("reads back what was stored, and null is free-form", () => {
		expect(readStoryCalendar(JSON.parse(JSON.stringify(THAW)))).toEqual(THAW)
		expect(readStoryCalendar(null)).toBeNull()
	})

	it("reads a malformed stored value as free-form rather than throwing", () => {
		// A row is read on every page load; a bad one must not take the book
		// down with it. The editor refuses to WRITE a malformed one.
		expect(readStoryCalendar({ months: [] })).toBeNull()
		expect(readStoryCalendar("nonsense")).toBeNull()
	})
})

describe("formatting through the calendar", () => {
	it("free-form spells exactly as today", () => {
		expect(formatDate({ year: 412, month: 3, day: 5 })).toBe(
			"Year 412, Mo. 3, Day 5"
		)
		expect(formatDate({ year: 412, month: 3, day: 5 }, null)).toBe(
			"Year 412, Mo. 3, Day 5"
		)
	})

	it("a declared calendar names the weekday, month and era", () => {
		expect(formatDate({ year: 1, month: 1, day: 2 }, THAW)).toBe(
			"Ashday, 2 Thaw, Year 1 AR"
		)
		expect(formatDate({ year: -299 }, THAW)).toBe("Year 300 BR")
	})

	it("a packed placement value is spelled through the calendar too", () => {
		expect(formatDateValue(10102, THAW)).toBe("Ashday, 2 Thaw, Year 1 AR")
		expect(formatDateValue(10102)).toBe("Year 1, Mo. 1, Day 2")
	})
})

describe("the next date in sequence", () => {
	it("free-form never rolls over", () => {
		expect(nextStoryDate({ year: 1, month: 1, day: 31 })).toEqual({
			year: 1,
			month: 1,
			day: 32
		})
		expect(nextStoryDate({ year: 1, month: 12 })).toEqual({
			year: 1,
			month: 13,
			day: null
		})
	})

	it("a declared calendar rolls over by month length and leap day", () => {
		expect(nextStoryDate({ year: 1, month: 1, day: 30 }, THAW)).toEqual({
			year: 1,
			month: 2,
			day: 1
		})
		expect(nextStoryDate({ year: 3, month: 3, day: 28 }, THAW)).toEqual({
			year: 4,
			month: 1,
			day: 1
		})
		expect(nextStoryDate({ year: 4, month: 3, day: 28 }, THAW)).toEqual({
			year: 4,
			month: 3,
			day: 29
		})
	})
})

describe("the preflight: which dated rows would not land", () => {
	it("lists every row a proposed calendar cannot place, with why", () => {
		const rows = [
			{ key: "entry:1", label: "The fire", year: 3, month: 1, day: 30 },
			{ key: "entry:2", label: "The flood", year: 3, month: 1, day: 31 },
			{ key: "amendment:4", label: "Keeper", year: 3, month: 4 },
			{ key: "entry:3", label: "Leap", year: 5, month: 3, day: 29 },
			{ key: "entry:5", label: "Year only", year: 9 }
		]
		const out = datesThatDoNotLand(rows, THAW)
		expect(out.map((r) => r.key)).toEqual([
			"entry:2",
			"amendment:4",
			"entry:3"
		])
		expect(out[0].problem).toMatch(/Thaw has 30 days/)
		expect(out[1].problem).toMatch(/no month 4/)
	})

	it("free-form lands everything", () => {
		expect(
			datesThatDoNotLand([{ key: "a", label: "", year: 1, month: 99, day: 400 }], null)
		).toEqual([])
	})
})

describe("one comparator", () => {
	it("compareDates takes no calendar, so a calendar edit cannot reorder", () => {
		expect(compareDates.length).toBe(2)
		const sorted = [
			{ year: 1, month: 2, day: 1 },
			{ year: 0, month: 3, day: 29 },
			{ year: 1, month: 1, day: 30 }
		].sort(compareDates)
		expect(sorted).toEqual([
			{ year: 0, month: 3, day: 29 },
			{ year: 1, month: 1, day: 30 },
			{ year: 1, month: 2, day: 1 }
		])
	})
})

/**
 * `dateValue` is placement, and placement never contradicts the order.
 *
 * Every month and day under 99 packs exactly as it always has
 * (`year×10000 + month×100 + day`); from 99 on, a part is squeezed into the
 * last hundredth before the next one, so a later date never lands before an
 * earlier one however large its day or month.
 */
describe("dateValue — monotone placement for any magnitude", () => {
	it("packs a date with small parts exactly as before", () => {
		expect(dateValue({ year: 3, month: 2, day: 12 })).toBe(30212)
		expect(dateValue({ year: 4 })).toBe(40000)
		expect(dateValue({ year: -2, month: 98, day: 98 })).toBe(-20000 + 9898)
	})

	it("never places a later date before an earlier one", () => {
		const dates = [
			{ year: 3, month: 1, day: 98 },
			{ year: 3, month: 1, day: 99 },
			{ year: 3, month: 1, day: 150 },
			{ year: 3, month: 1, day: 1000 },
			{ year: 3, month: 2 },
			{ year: 3, month: 2, day: 1 },
			{ year: 3, month: 99 },
			{ year: 3, month: 99, day: 500 },
			{ year: 3, month: 100 },
			{ year: 3, month: 400, day: 400 },
			{ year: 4 }
		]
		for (let i = 1; i < dates.length; i++) {
			expect(compareDates(dates[i - 1], dates[i])).toBeLessThan(0)
			expect(dateValue(dates[i])).toBeGreaterThan(dateValue(dates[i - 1]))
		}
	})

	it("reads back the date a value stands for, past 99 too", () => {
		for (const date of [
			{ year: 3, month: 1, day: 150 },
			{ year: 3, month: 99, day: 99 },
			{ year: 3, month: 120, day: 1000 },
			{ year: -7, month: 100, day: null }
		])
			expect(dateFromValue(dateValue(date))).toEqual(date)
	})
})
