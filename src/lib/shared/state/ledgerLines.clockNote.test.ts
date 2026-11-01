import { describe, expect, test } from "vitest"
import { clockMoveText } from "./ledgerLines"

describe("clockMoveText", () => {
	test("a skipped move that moves nothing (by 0) reads as its sentence alone", () => {
		const sentence = "The story has no clock yet; hourly routines wait."
		expect(clockMoveText({ by: 0, unit: "hours", skipped: sentence } as never)).toBe(sentence)
	})
	test("a skipped step keeps its head", () => {
		expect(clockMoveText({ by: 3, unit: "hours", skipped: "No clock." } as never)).toMatch(/^Time passes: .*, not on the clock\. No clock\.$/)
	})
})
