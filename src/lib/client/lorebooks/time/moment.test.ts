/**
 * The moment: which date the book is being read as of, what is in the story by
 * then, and what a drag onto the line lands on.
 */
import { describe, expect, it } from "vitest"
import { buildTicks } from "../timelineStrip"
import {
	asOfKey,
	markCastArrived,
	castMomentSentence,
	countNotInStory,
	dateAtRatio,
	isInStoryAsOf,
	amendmentsAheadSentence,
	castArrivalDates,
	momentDate,
	momentBannerSentence,
	momentChipLabel,
	momentKey,
	momentValue,
	notYetKeys,
	parseMoment,
	poolAsOfSentence,
	goToDate,
	againstPresent
} from "./moment"

describe("momentKey — a story date as an address", () => {
	it("writes a year on its own", () => {
		expect(momentKey({ year: 3 })).toBe("Y3")
	})

	it("writes a month and a day when the date carries them", () => {
		expect(momentKey({ year: 3, month: 2, day: 12 })).toBe("Y3-2-12")
	})

	it("reads back exactly what it wrote", () => {
		expect(parseMoment(momentKey({ year: 2, month: 8 }))).toEqual({
			year: 2,
			month: 8,
			day: null
		})
	})

	it("reads an address that is not one as no moment at all", () => {
		expect(parseMoment("harvest")).toBeNull()
		expect(parseMoment(undefined)).toBeNull()
	})

	it("compares as one number, the way the axis does", () => {
		expect(momentValue("Y3-2-12")).toBe(30212)
		expect(momentValue(undefined)).toBeNull()
	})

	it("keys now as now, so a drawing can tell the two apart", () => {
		expect(asOfKey(undefined)).toBe("now")
		expect(asOfKey("Y3-2-12")).toBe("Y3-2-12")
	})
})

describe("as of — what is in the story at this moment", () => {
	const Y1 = { year: 1 }
	const Y2M8 = { year: 2, month: 8 }
	const Y3M2D2 = { year: 3, month: 2, day: 2 }
	const rows = [
		{ key: "entry#1", date: Y1 },
		{ key: "entry#2", date: Y3M2D2 },
		{ key: "entry#7", date: null }
	]

	it("keeps an entry dated at or before the moment", () => {
		expect(isInStoryAsOf(Y1, Y2M8)).toBe(true)
		expect(isInStoryAsOf(Y2M8, Y2M8)).toBe(true)
	})

	it("holds back an entry dated after it", () => {
		expect(isInStoryAsOf(Y3M2D2, Y2M8)).toBe(false)
	})

	it("keeps an undated entry at every moment", () => {
		expect(isInStoryAsOf(null, Y2M8)).toBe(true)
	})

	it("holds nothing back at now", () => {
		expect(notYetKeys(rows, null)).toEqual([])
	})

	it("names what is not in the story yet", () => {
		expect(notYetKeys(rows, Y2M8)).toEqual(["entry#2"])
	})

	// The packed value (year×10000 + month×100 + day) lies once a part
	// passes 100: it puts Mo.1 Day 150 (30250) after Mo.2 Day 1 (30201).
	// `compareDates` does not.
	it("orders by compareDates, never the packed value", () => {
		expect(
			isInStoryAsOf({ year: 3, month: 1, day: 150 }, { year: 3, month: 2, day: 1 })
		).toBe(true)
		expect(
			isInStoryAsOf({ year: 3, month: 2, day: 1 }, { year: 3, month: 1, day: 150 })
		).toBe(false)
		expect(isInStoryAsOf({ year: 3, month: 12, day: 250 }, { year: 5, month: 1, day: 50 })).toBe(true)
		expect(momentDate("Y3-1-150")).toEqual({ year: 3, month: 1, day: 150 })
	})
})

describe("cast as of — who has arrived", () => {
	const cast = [
		{ id: 20, name: "Verity", arrival: { year: 1 } },
		{ id: 21, name: "Wren", arrival: { year: 3, month: 2, day: 2 } },
		{ id: 22, name: "Hollis", arrival: null }
	]

	it("marks a member whose first dated mention is later", () => {
		const seen = markCastArrived(cast, { year: 2, month: 8 })
		expect(seen.map((m) => m.inStory)).toEqual([true, false, true])
	})

	it("counts a member nothing dates as in the story, having nothing to say otherwise", () => {
		expect(countNotInStory(cast, { year: 1 })).toBe(1)
	})

	it("has everybody in the story at now", () => {
		expect(countNotInStory(cast, null)).toBe(0)
	})
})

describe("castArrivalDates — the first dated thing naming each member", () => {
	it("takes the EARLIEST date by compareDates, whatever the item order", () => {
		const arrivals = castArrivalDates([
			{ date: { year: 3, month: 2, day: 1 }, present: [7] },
			{ date: { year: 3, month: 1, day: 150 }, present: [7, 8] },
			{ date: null, present: [9] }
		])
		expect(arrivals.get(7)).toEqual({ year: 3, month: 1, day: 150 })
		expect(arrivals.get(8)).toEqual({ year: 3, month: 1, day: 150 })
		expect(arrivals.has(9)).toBe(false)
	})
})

describe("the moment, said out loud", () => {
	it("counts the pool and what is not in the story yet", () => {
		expect(poolAsOfSentence(30, 3)).toBe(
			"30 entries · 3 not in the story yet at this moment"
		)
	})

	it("says nothing about arrivals when everything has arrived", () => {
		expect(poolAsOfSentence(30, 0)).toBe("30 entries")
	})

	it("names the moment on the bar's chip", () => {
		expect(momentChipLabel(undefined)).toBe("Moment · now")
		expect(momentChipLabel("Y2-8")).toBe("Moment · Year 2, Mo. 8")
	})

	it("counts the cast still to arrive", () => {
		expect(castMomentSentence(2, 7)).toBe(
			"2 of 7 cast not in the story yet"
		)
	})

	it("counts an entry's amendments still ahead of the moment", () => {
		expect(amendmentsAheadSentence(1, 3)).toBe(
			"1 of 3 has not happened yet at this moment"
		)
		expect(amendmentsAheadSentence(4, 4)).toBe(
			"4 of 4 have not happened yet at this moment"
		)
	})

	it("names the choice a save here presents", () => {
		expect(momentBannerSentence("Y2-8")).toBe(
			"Reading as of Year 2, Mo. 8. A change saved here can begin at this date, or change it everywhere."
		)
	})
})

describe("dateAtRatio — where a drop onto the line lands", () => {
	const ticks = buildTicks([
		{ id: 1, year: 1, month: null, day: null },
		{ id: 2, year: 3, month: 2, day: 2 }
	])

	it("lands on the date nearest the drop", () => {
		expect(dateAtRatio(ticks, 0.1)).toEqual({
			year: 1,
			month: null,
			day: null
		})
		expect(dateAtRatio(ticks, 0.9)).toEqual({ year: 3, month: 2, day: 2 })
	})

	it("clamps a drop past either end of the line", () => {
		expect(dateAtRatio(ticks, -2)?.year).toBe(1)
		expect(dateAtRatio(ticks, 4)?.year).toBe(3)
	})

	it("has nowhere to land on a line with no dates", () => {
		expect(dateAtRatio([], 0.5)).toBeNull()
	})

	it("lands on the tick's own date, day 250 included (no packed round trip)", () => {
		const long = buildTicks([
			{ id: 1, year: 3, month: 1, day: 250 },
			{ id: 2, year: 4, month: null, day: null }
		])
		expect(dateAtRatio(long, 0)).toEqual({ year: 3, month: 1, day: 250 })
	})
})

describe("goToDate — a moment can land on a date with no row (#164)", () => {
	const THREE_MONTHS = {
		months: [
			{ name: "Thaw", days: 30 },
			{ name: "Bloom", days: 31 },
			{ name: "Ember", days: 28 }
		],
		weekdays: [],
		firstWeekday: 0,
		yearLabel: "Year"
	} as any

	it("any date the calendar holds becomes a moment address", () => {
		expect(goToDate({ year: 7, month: 2, day: 30 }, THREE_MONTHS)).toEqual({
			key: "Y7-2-30",
			date: { year: 7, month: 2, day: 30 }
		})
		expect(goToDate({ year: 7, month: null, day: null }, null)).toEqual({
			key: "Y7",
			date: { year: 7, month: null, day: null }
		})
	})

	it("refuses what the calendar does not have, never clamping it", () => {
		expect("problem" in goToDate({ year: 7, month: 4, day: 1 }, THREE_MONTHS)).toBe(true)
		expect("problem" in goToDate({ year: 7, month: 3, day: 29 }, THREE_MONTHS)).toBe(true)
	})

	it("a date needs a year, and a day needs a month", () => {
		expect(goToDate({ year: null, month: 1, day: 1 }, null)).toEqual({
			problem: "A date needs a year."
		})
		expect(goToDate({ year: 3, month: null, day: 4 }, null)).toEqual({
			problem: "A day needs a month."
		})
	})

	it("says when the date is past the story's present, by compareDates", () => {
		// Radix-100 packing would put Y1-M150 after Y2; the calendar order does not.
		expect(againstPresent({ year: 1, month: 150 }, { year: 2 })).toBeNull()
		expect(againstPresent({ year: 3 }, { year: 2, month: 5 })).toBe(
			"after the story's present"
		)
		expect(againstPresent({ year: 2 }, null)).toBeNull()
	})
})
