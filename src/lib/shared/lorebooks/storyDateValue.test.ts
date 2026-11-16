import { describe, expect, it } from "vitest"
import type { StoryCalendar } from "@serene-pub/sdk"
import { formatStoryTime } from "@serene-pub/sdk"
import { storyDateValueOf } from "./storyDate"
import { storyDateDeltaText, storyDateText } from "./storyDateText"

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
const PLAIN: StoryCalendar = { months: [{ name: "One", days: 20 }, { name: "Two", days: 20 }] }

describe("storyDateValueOf", () => {
	it("year only, year-month, full, with a time (free-form: numbers only)", () => {
		expect(storyDateValueOf({ year: 3 }, null)).toEqual({
			year: { number: 3 },
			month: null,
			day: null,
			time: null
		})
		expect(storyDateValueOf({ year: 3, month: 2 }, null)).toEqual({
			year: { number: 3 },
			month: { number: 2 },
			day: null,
			time: null
		})
		expect(
			storyDateValueOf({ year: 3, month: 2, day: 5, hour: 9 }, null)
		).toEqual({
			year: { number: 3 },
			month: { number: 2 },
			day: { number: 5 },
			time: { hour: 9, minute: 0 }
		})
	})

	it("a day without a month is dropped", () => {
		expect(storyDateValueOf({ year: 3, day: 5 }, null).day).toBeNull()
	})

	it("a declared calendar names the parts", () => {
		const v = storyDateValueOf({ year: 412, month: 2, day: 5, hour: 22, minute: 30 }, THAW)
		expect(v.year.name).toBe("Year 412 AR")
		expect(v.month).toEqual({ number: 2, name: "Bloom" })
		expect(v.day?.number).toBe(5)
		expect(typeof v.day?.name).toBe("string")
		expect(v.time).toEqual({ hour: 22, minute: 30 })
		expect(storyDateValueOf({ year: 412 }, THAW).year).toEqual({
			number: 412,
			name: "Year 412 AR"
		})
		expect("name" in storyDateValueOf({ year: 3 }, null).year).toBe(false)
	})

	it("a date that does not land gets no names", () => {
		const v = storyDateValueOf({ year: 412, month: 9, day: 5 }, THAW)
		expect(v.year).toEqual({ number: 412 })
		expect(v.month).toEqual({ number: 9 })
		expect(v.day).toEqual({ number: 5 })
	})

	it("no weekday without weekdays", () => {
		const v = storyDateValueOf({ year: 2, month: 1, day: 4 }, PLAIN)
		expect(v.month?.name).toBe("One")
		expect(v.day).toEqual({ number: 4 })
	})
})

describe("storyDateText", () => {
	it("prints exactly formatStoryTime for dates that land", () => {
		const dates = [
			{ year: 412 },
			{ year: -30 },
			{ year: 0 },
			{ year: 412, month: 2 },
			{ year: 412, month: 2, day: 5 },
			{ year: 4, month: 3, day: 29 },
			{ year: 412, month: 1, day: 30, hour: 7, minute: 5 },
			{ year: 412, month: 3, day: 1, hour: 0 },
			{ year: -2, month: 1, day: 1, hour: 23, minute: 59 },
			{ year: 412, hour: 8 }
		]
		for (const cal of [THAW, PLAIN]) {
			for (const d of dates) {
				if (cal === PLAIN && d.month === 3) continue
				if (cal === PLAIN && (d.day ?? 0) > 20) continue
				expect(storyDateText(storyDateValueOf(d, cal))).toBe(formatStoryTime(d, cal))
			}
		}
	})

	it("numeric when there are no names", () => {
		expect(storyDateText(storyDateValueOf({ year: 7 }, null))).toBe("Year 7")
		expect(storyDateText(storyDateValueOf({ year: 7, hour: 3 }, null))).toBe("Year 7 03:00")
		expect(storyDateText(storyDateValueOf({ year: 7, month: 3 }, null))).toBe("7-03")
		expect(
			storyDateText(storyDateValueOf({ year: 7, month: 3, day: 9, hour: 14, minute: 5 }, null))
		).toBe("7-03-09 14:05")
	})

	it("not a date value gives an empty string", () => {
		for (const v of [null, undefined, 3, "x", {}, { year: 3 }, { year: { number: "3" } }])
			expect(storyDateText(v)).toBe("")
	})
})

describe("storyDateDeltaText", () => {
	const t = null
	it("prints signed parts", () => {
		expect(storyDateDeltaText({ sign: -1, year: 0, month: 2, day: 3, time: t })).toBe("-0y 2m 3d")
		expect(storyDateDeltaText({ sign: 1, year: 1, month: 0, day: 0, time: t })).toBe("+1y 0m 0d")
		expect(storyDateDeltaText({ sign: 0, year: 0, month: 0, day: 0, time: t })).toBe("0y 0m 0d")
		expect(storyDateDeltaText({ sign: -1, year: 3, month: t, day: t, time: t })).toBe("-3y")
		expect(
			storyDateDeltaText({ sign: -1, year: 0, month: 0, day: 2, time: { hour: 3, minute: 15 } })
		).toBe("-0y 0m 2d 3h 15min")
	})

	it("anything else gives an empty string", () => {
		for (const v of [null, undefined, 4, {}, { sign: 2, year: 1 }, { sign: 1, year: "1" }])
			expect(storyDateDeltaText(v)).toBe("")
	})
})
