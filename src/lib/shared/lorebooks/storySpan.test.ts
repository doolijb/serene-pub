import { describe, expect, it } from "vitest"
import type { StoryCalendar } from "@serene-pub/sdk"
import { storyDateDeltaOf } from "./storySpan"
import { compareDates, type StoryClock } from "./storyDate"

const odd: StoryCalendar = {
	months: [
		{ name: "A", days: 30 },
		{ name: "B", days: 31 },
		{ name: "C", days: 28 },
		{ name: "D", days: 35 }
	]
}
const leap: StoryCalendar = {
	months: Array.from({ length: 12 }, (_, i) => ({
		name: `M${i + 1}`,
		days: i === 1 ? 28 : 31
	})),
	leap: { every: 4, month: 2 }
}

describe("storyDateDeltaOf", () => {
	it("a past date is negative, a future one positive, equal is zero", () => {
		expect(storyDateDeltaOf({ year: 7 }, { year: 10 }, null)).toEqual({
			sign: -1,
			year: 3,
			month: null,
			day: null,
			time: null
		})
		expect(storyDateDeltaOf({ year: 10 }, { year: 7 }, null)).toMatchObject({
			sign: 1,
			year: 3
		})
		expect(
			storyDateDeltaOf({ year: 7, month: 2, day: 3 }, { year: 7, month: 2, day: 3 }, odd)
		).toEqual({ sign: 0, year: 0, month: 0, day: 0, time: null })
	})

	it("across a year, a calendar borrows the month count", () => {
		expect(
			storyDateDeltaOf({ year: 7, month: 4 }, { year: 8, month: 2 }, odd)
		).toEqual({ sign: -1, year: 0, month: 2, day: null, time: null })
	})

	it("month forward, day backward: exact under a calendar", () => {
		// Month before C is B (31 days): 5 - 20 + 31 = 16, month 2 - 1 = 1.
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 1, day: 20 },
				{ year: 7, month: 3, day: 5 },
				odd
			)
		).toMatchObject({ sign: -1, year: 0, month: 1, day: 16 })
	})

	it("a day still negative after one month borrows the month before that too", () => {
		// D day 1 back to B day 30: 1 - 30 + C (28) = -1, + B (31) = 30; month 2 - 2 = 0.
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 2, day: 30 },
				{ year: 7, month: 4, day: 1 },
				odd
			)
		).toMatchObject({ sign: -1, year: 0, month: 0, day: 30 })
	})

	it("month 1 borrows from the previous year's last month", () => {
		// Month before month 1 is D of year 6 (35 days): 3 - 30 + 35 = 8.
		expect(
			storyDateDeltaOf(
				{ year: 6, month: 4, day: 30 },
				{ year: 7, month: 1, day: 3 },
				odd
			)
		).toMatchObject({ year: 0, month: 0, day: 8 })
	})

	it("free-form: the coarser part less one, finer parts null", () => {
		expect(
			storyDateDeltaOf({ year: 7, month: 11 }, { year: 8, month: 2 }, null)
		).toEqual({ sign: -1, year: 0, month: null, day: null, time: null })
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 3, day: 20 },
				{ year: 7, month: 5, day: 5 },
				null
			)
		).toEqual({ sign: -1, year: 0, month: 1, day: null, time: null })
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 3, day: 20 },
				{ year: 9, month: 5, day: 5 },
				null
			)
		).toEqual({ sign: -1, year: 2, month: 1, day: null, time: null })
	})

	it("mixed precision compares only what both carry", () => {
		expect(
			storyDateDeltaOf({ year: 5 }, { year: 7, month: 3, day: 9 }, odd)
		).toEqual({ sign: -1, year: 2, month: null, day: null, time: null })
		expect(
			storyDateDeltaOf({ year: 5, month: 2 }, { year: 5, month: 4, day: 9 }, null)
		).toMatchObject({ month: 2, day: null })
	})

	it("times borrow exactly across midnight", () => {
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 2, day: 4, hour: 22, minute: 30 },
				{ year: 7, month: 2, day: 5, hour: 1, minute: 15 },
				odd
			)
		).toEqual({
			sign: -1,
			year: 0,
			month: 0,
			day: 0,
			time: { hour: 2, minute: 45 }
		})
	})

	it("a time borrowing a free-form day that needs a month cascades", () => {
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 2, day: 5, hour: 22 },
				{ year: 7, month: 3, day: 5, hour: 1 },
				null
			)
		).toEqual({ sign: -1, year: 0, month: 0, day: null, time: null })
		// Exact under a calendar: month B, 31 days, minus a day.
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 2, day: 5, hour: 22 },
				{ year: 7, month: 3, day: 5, hour: 1 },
				odd
			)
		).toEqual({
			sign: -1,
			year: 0,
			month: 0,
			day: 30,
			time: { hour: 3, minute: 0 }
		})
	})

	it("time is compared only when both carry an hour", () => {
		expect(
			storyDateDeltaOf(
				{ year: 7, month: 2, day: 4, hour: 2 },
				{ year: 7, month: 2, day: 6 },
				odd
			)
		).toMatchObject({ day: 2, time: null })
	})

	it("a negative year", () => {
		expect(storyDateDeltaOf({ year: -3 }, { year: 4 }, null)).toMatchObject({
			sign: -1,
			year: 7
		})
		expect(storyDateDeltaOf({ year: 2 }, { year: -1 }, null)).toMatchObject({
			sign: 1,
			year: 3
		})
	})

	it("the leap day counts under a leap rule", () => {
		// Month before 3 in year 4 is February, 29 days: 1 - 28 + 29 = 2.
		expect(
			storyDateDeltaOf(
				{ year: 4, month: 2, day: 28 },
				{ year: 4, month: 3, day: 1 },
				leap
			)
		).toMatchObject({ month: 0, day: 2 })
		expect(
			storyDateDeltaOf(
				{ year: 5, month: 2, day: 28 },
				{ year: 5, month: 3, day: 1 },
				leap
			)
		).toMatchObject({ month: 0, day: 1 })
	})

	it("missing inputs give null", () => {
		expect(storyDateDeltaOf(null, { year: 1 }, null)).toBeNull()
		expect(storyDateDeltaOf({ year: 1 }, undefined, null)).toBeNull()
		expect(
			storyDateDeltaOf({} as { year: number }, { year: 1 }, null)
		).toBeNull()
	})

	it("a date the calendar cannot place is read free-form, for the whole delta", () => {
		// Day 200 of a four-month calendar does not land.
		expect(
			storyDateDeltaOf(
				{ year: 412, month: 1, day: 200 },
				{ year: 412, month: 2, day: 1 },
				odd
			)
		).toEqual({ sign: -1, year: 0, month: 0, day: null, time: null })
	})
})

describe("storyDateDeltaOf, over a spread of dates", () => {
	const twelve: StoryCalendar = {
		months: Array.from({ length: 12 }, (_, i) => ({ name: `T${i + 1}`, days: 30 }))
	}
	const calendars: Array<[string, StoryCalendar | null]> = [
		["free-form", null],
		["four months, leap", { ...odd, leap: { every: 4, month: 3 } }],
		["twelve months", twelve]
	]
	const dates: StoryClock[] = []
	for (const year of [411, 412]) {
		dates.push({ year })
		for (const month of [1, 3, 4, 13]) {
			dates.push({ year, month })
			for (const day of [1, 20, 31, 200]) {
				dates.push({ year, month, day })
				for (const [hour, minute] of [
					[0, 0],
					[23, 59]
				])
					dates.push({ year, month, day, hour, minute })
			}
		}
	}
	// A date at mixed precision against a finer one is covered by the pairs.

	for (const [label, calendar] of calendars)
		it(`never has a negative part, and its sign is the order (${label})`, () => {
			let checked = 0
			for (const a of dates)
				for (const b of dates) {
					const delta = storyDateDeltaOf(a, b, calendar)!
					const at = `${JSON.stringify(a)} -> ${JSON.stringify(b)}`
					for (const part of [
						delta.year,
						delta.month,
						delta.day,
						delta.time?.hour ?? null,
						delta.time?.minute ?? null
					])
						expect(part === null || part >= 0, at).toBe(true)
					const monthed = a.month != null && b.month != null
					const dayed = monthed && a.day != null && b.day != null
					const timed = dayed && a.hour != null && b.hour != null
					const cut = (d: StoryClock): StoryClock => ({
						year: d.year,
						month: monthed ? d.month : null,
						day: dayed ? d.day : null,
						hour: timed ? d.hour : null,
						minute: timed ? (d.minute ?? 0) : null
					})
					expect(delta.sign, at).toBe(Math.sign(compareDates(cut(a), cut(b))))
					checked++
				}
			expect(checked).toBe(dates.length * dates.length)
		})
})
