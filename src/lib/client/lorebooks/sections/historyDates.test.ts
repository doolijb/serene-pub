/**
 * History's dates, as arithmetic: one integer, and the date it stands for.
 */
import { describe, expect, it } from "vitest"
import { dateFromValue, dateValue, formatDate } from "./historyDates"

describe("dateFromValue — the date one encoded value stands for", () => {
	it("reads a year, a month and a day back out", () => {
		expect(dateFromValue(30212)).toEqual({ year: 3, month: 2, day: 12 })
	})

	it("reads an absent month and day as absent, not as zero", () => {
		expect(dateFromValue(40000)).toEqual({
			year: 4,
			month: null,
			day: null
		})
	})

	it("round-trips every date the axis can hold", () => {
		for (const date of [
			{ year: 1, month: null, day: null },
			{ year: 2, month: 8, day: null },
			{ year: 3, month: 12, day: 31 }
		])
			expect(dateFromValue(dateValue(date))).toEqual(date)
	})

	it("reads back a date its own heading agrees with", () => {
		expect(formatDate(dateFromValue(20800))).toBe("Year 2, Mo. 8")
	})
})
