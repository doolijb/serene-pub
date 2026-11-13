import { describe, expect, test } from "vitest"
import {
	NO_STORY_CLOCK_YET,
	clockMoveText,
	clockSkipKindOf
} from "./ledgerLines"

describe("clockMoveText", () => {
	test("a skipped move that moves nothing (by 0) reads as its sentence alone", () => {
		const sentence = "The story has no clock yet; hourly routines wait."
		expect(clockMoveText({ by: 0, unit: "hours", skipped: sentence } as never)).toBe(sentence)
	})
	test("a skipped step keeps its head (no reason, another sentence: not moved)", () => {
		expect(
			clockMoveText({
				by: 3,
				unit: "hours",
				skipped: "No clock."
			} as never)
		).toMatch(/^Time passes: .*, not moved\. No clock\.$/)
	})
	test("a no-clock reason reads not on the clock; a refused one reads not moved", () => {
		expect(
			clockMoveText({
				by: 3,
				unit: "hours",
				skipped: "x",
				reason: "no-clock"
			})
		).toMatch(/, not on the clock\. x$/)
		expect(
			clockMoveText({
				by: 3,
				unit: "hours",
				skipped: "x",
				reason: "refused"
			})
		).toMatch(/, not moved\. x$/)
	})
	test("a row with no reason is read from its sentence", () => {
		expect(
			clockMoveText({ by: 3, unit: "hours", skipped: NO_STORY_CLOCK_YET })
		).toMatch(/, not on the clock\. /)
		expect(
			clockMoveText({ by: 3, unit: "hours", skipped: "Other." })
		).toMatch(/, not moved\. Other\.$/)
	})
	test("the kind is read off the sentence, the one fact every row carries", () => {
		expect(clockSkipKindOf({ skipped: NO_STORY_CLOCK_YET })).toBe(
			"no-clock"
		)
		expect(clockSkipKindOf({ skipped: "Other." })).toBe("refused")
	})
	test("an applied move has no skip kind", () => {
		expect(clockSkipKindOf({})).toBeNull()
		expect(clockSkipKindOf({ skipped: null })).toBeNull()
	})
})
