/**
 * The moment: which date the book is being read as of, what is in the story by
 * then, and what a drag onto the line lands on.
 */
import { describe, expect, it } from "vitest"
import { buildTicks } from "../timelineStrip"
import {
	asOfKey,
	castAsOf,
	castMomentSentence,
	countNotInStory,
	dateAtRatio,
	isInStoryAsOf,
	amendmentsAheadSentence,
	momentBannerSentence,
	momentChipLabel,
	momentKey,
	momentValue,
	notYetKeys,
	parseMoment,
	poolAsOfSentence
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
	const rows = [
		{ key: "entry#1", value: 10000 },
		{ key: "entry#2", value: 30202 },
		{ key: "entry#7", value: null }
	]

	it("keeps an entry dated at or before the moment", () => {
		expect(isInStoryAsOf(10000, 20800)).toBe(true)
		expect(isInStoryAsOf(20800, 20800)).toBe(true)
	})

	it("holds back an entry dated after it", () => {
		expect(isInStoryAsOf(30202, 20800)).toBe(false)
	})

	it("keeps an undated entry at every moment", () => {
		expect(isInStoryAsOf(null, 20800)).toBe(true)
	})

	it("holds nothing back at now", () => {
		expect(notYetKeys(rows, null)).toEqual([])
	})

	it("names what is not in the story yet", () => {
		expect(notYetKeys(rows, 20800)).toEqual(["entry#2"])
	})
})

describe("cast as of — who has arrived", () => {
	const cast = [
		{ id: 20, name: "Verity", arrival: 10000 },
		{ id: 21, name: "Wren", arrival: 30202 },
		{ id: 22, name: "Hollis", arrival: null }
	]

	it("marks a member whose first dated mention is later", () => {
		const seen = castAsOf(cast, 20800)
		expect(seen.map((m) => m.inStory)).toEqual([true, false, true])
	})

	it("counts a member nothing dates as in the story, having nothing to say otherwise", () => {
		expect(countNotInStory(cast, 10000)).toBe(1)
	})

	it("has everybody in the story at now", () => {
		expect(countNotInStory(cast, null)).toBe(0)
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
})
