import { describe, expect, test } from "vitest"
import { historyEntryDate } from "./reading"

/**
 * The JS reader dates a history entry exactly as the SQL that cuts a reading
 * does (`historyDateColumns`): only a JSON number is a date part. A legacy
 * string year was counted toward "the present" here but never cut by
 * retrieval (lorebooks plan, Phase D).
 */
describe("historyEntryDate", () => {
	test("reads numeric parts", () => {
		expect(historyEntryDate({ year: 12, month: 3, day: 4 })).toEqual({
			year: 12,
			month: 3,
			day: 4
		})
		expect(historyEntryDate({ year: 12 })).toEqual({ year: 12, month: null, day: null })
	})

	test("a string year is undated, as the SQL reads it", () => {
		expect(historyEntryDate({ year: "1200" })).toBeNull()
		expect(historyEntryDate({ year: "1200", month: 2 })).toBeNull()
	})

	test("a string month or day is absent, as the SQL reads it", () => {
		expect(historyEntryDate({ year: 5, month: "2", day: "9" })).toEqual({
			year: 5,
			month: null,
			day: null
		})
	})

	test("no fields, null year", () => {
		expect(historyEntryDate(null)).toBeNull()
		expect(historyEntryDate({ year: null })).toBeNull()
	})
})
