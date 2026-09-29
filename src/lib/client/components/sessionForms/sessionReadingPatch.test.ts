import { describe, expect, it } from "vitest"
import { stripUnmovedReading } from "./sessionReadingPatch"

const clock = {
	storyClockYear: 3,
	storyClockMonth: 2,
	storyClockDay: null,
	storyClockHour: null,
	storyClockMinute: null
}

describe("stripUnmovedReading — only what the person moved is sent (#136)", () => {
	it("an untouched line is not posted back, so a deleted line cannot refuse the save", () => {
		const sent = stripUnmovedReading(
			{ name: "x", lorebookBranchId: 9, ...clock },
			{ lorebookBranchId: 9, ...clock }
		)
		expect(sent).toEqual({ name: "x" })
	})

	it("a line the person changed is sent, main included", () => {
		expect(
			stripUnmovedReading({ lorebookBranchId: null }, { lorebookBranchId: 9 })
		).toEqual({ lorebookBranchId: null })
		expect(
			stripUnmovedReading({ lorebookBranchId: 4 }, { lorebookBranchId: null })
		).toEqual({ lorebookBranchId: 4 })
	})

	it("the clock goes whole when any part of it moved", () => {
		const sent = stripUnmovedReading(
			{ ...clock, storyClockDay: 5 },
			{ ...clock }
		)
		expect(sent).toEqual({ ...clock, storyClockDay: 5 })
	})
})
