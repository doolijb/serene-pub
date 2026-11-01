import { describe, expect, test } from "vitest"
import type { StoryCalendar } from "@serene-pub/sdk"
import { hoursCrossed } from "./clockHours"

const THAW = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	yearLabel: "Year"
} as unknown as StoryCalendar

describe("hoursCrossed", () => {
	test("the same day counts whole hour marks", () => {
		expect(hoursCrossed({ year: 5, month: 1, day: 3, hour: 8, minute: 30 }, { year: 5, month: 1, day: 3, hour: 11, minute: 10 }, THAW)).toBe(3)
		expect(hoursCrossed({ year: 5, month: 1, day: 3, hour: 0, minute: 30 }, { year: 5, month: 1, day: 3, hour: 0, minute: 50 }, THAW)).toBe(0)
	})
	test("across midnight at a month's end, with a calendar", () => {
		expect(hoursCrossed({ year: 5, month: 1, day: 30, hour: 22 }, { year: 5, month: 2, day: 1, hour: 2 }, THAW)).toBe(4)
	})
	test("free-form: the same month counts, another month cannot be placed", () => {
		expect(hoursCrossed({ year: 5, month: 2, day: 3, hour: 22 }, { year: 5, month: 2, day: 4, hour: 7 }, null)).toBe(9)
		expect(hoursCrossed({ year: 5, month: 2, day: 30, hour: 22 }, { year: 5, month: 3, day: 1, hour: 2 }, null)).toBeUndefined()
	})
	test("backwards is 0", () => {
		expect(hoursCrossed({ year: 5, month: 1, day: 3, hour: 11 }, { year: 5, month: 1, day: 3, hour: 8 }, THAW)).toBe(0)
	})
})
