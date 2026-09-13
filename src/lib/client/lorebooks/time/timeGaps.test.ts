/**
 * Gaps: the stretches of story time with nothing recorded in them, measured at
 * the coarsest unit the book actually dates by.
 */
import { describe, expect, it } from "vitest"
import { coarsestUnit, findGaps, gapSentence } from "./timeGaps"

describe("coarsestUnit — how finely the book dates", () => {
	it("is the year when any entry names nothing smaller", () => {
		expect(coarsestUnit([{ year: 1, month: 4, day: 2 }, { year: 2 }])).toBe(
			"year"
		)
	})

	it("is the month when every entry names one and any stops there", () => {
		expect(
			coarsestUnit([
				{ year: 1, month: 4, day: 2 },
				{ year: 2, month: 8 }
			])
		).toBe("month")
	})

	it("is the day when every entry names one", () => {
		expect(
			coarsestUnit([
				{ year: 1, month: 4, day: 2 },
				{ year: 1, month: 4, day: 9 }
			])
		).toBe("day")
	})

	it("is the year for a book with no dates at all", () => {
		expect(coarsestUnit([])).toBe("year")
	})
})

describe("findGaps — nothing recorded in between", () => {
	it("marks a stretch more than one unit wide", () => {
		const gaps = findGaps([{ year: 1 }, { year: 2 }, { year: 5 }])
		expect(gaps.map((g) => [g.after.year, g.before.year])).toEqual([[2, 5]])
	})

	it("leaves consecutive units alone", () => {
		expect(findGaps([{ year: 1 }, { year: 2 }])).toEqual([])
	})

	it("counts months within a year once the book dates by month", () => {
		const gaps = findGaps([
			{ year: 2, month: 1 },
			{ year: 2, month: 8 }
		])
		expect(gaps).toHaveLength(1)
		expect(gaps[0].unit).toBe("month")
	})

	it("reads the turn of a year as one month, not as a gap", () => {
		expect(
			findGaps([
				{ year: 1, month: 11 },
				{ year: 1, month: 12 },
				{ year: 2, month: 1 }
			])
		).toEqual([])
	})

	it("treats two entries at the same date as no distance at all", () => {
		expect(
			findGaps([
				{ year: 3, month: 2 },
				{ year: 3, month: 2 }
			])
		).toEqual([])
	})

	it("has no gap to report with one date or none", () => {
		expect(findGaps([{ year: 3 }])).toEqual([])
		expect(findGaps([])).toEqual([])
	})

	it("orders what it is handed before measuring it", () => {
		const gaps = findGaps([{ year: 9 }, { year: 1 }])
		expect(gaps[0].after.year).toBe(1)
		expect(gaps[0].before.year).toBe(9)
	})
})

describe("gapSentence — what the gap says", () => {
	it("names both sides of the stretch", () => {
		expect(gapSentence({ year: 2, month: 8 }, { year: 3, month: 2 })).toBe(
			"Nothing recorded between Year 2, Mo. 8 and Year 3, Mo. 2."
		)
	})
})
