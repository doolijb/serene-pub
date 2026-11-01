/**
 * Day periods, time of day and season, read off the story clock and the
 * book's calendar (M0, lane T2).
 */
import { describe, expect, test } from "vitest"
import { defineAttributeSlot, derivations, type StoryCalendar } from "@serene-pub/sdk"
import { deriveValue, type DerivationInputs } from "$lib/server/state/derive"

const slot = (derivation: string, id: string) =>
	defineAttributeSlot(id, {
		type: "derived",
		descriptor: "A derived reading.",
		appliesTo: ["world"],
		config: { derivation }
	})

const DAY_PERIOD = slot(derivations.dayPeriod.id, "test:slot/dp@1")
const TIME_OF_DAY = slot(derivations.timeOfDay.id, "test:slot/tod@1")
const SEASON = slot(derivations.season.id, "test:slot/season@1")

const inputs = (
	clock: DerivationInputs["clock"],
	calendar: StoryCalendar | null = null
): DerivationInputs => ({ storyDate: null, clock, calendar, read: async () => undefined })

const at = (hour: number | null) => ({ year: 1, month: 1, day: 1, hour })

describe("day-period", () => {
	test("defaults: morning 5, day 12, dusk 18, night 22", async () => {
		const read = async (h: number) => deriveValue(DAY_PERIOD, inputs(at(h)))
		expect(await read(5)).toBe("morning")
		expect(await read(11)).toBe("morning")
		expect(await read(12)).toBe("day")
		expect(await read(18)).toBe("dusk")
		expect(await read(23)).toBe("night")
	})

	test("before the first period wraps to the last", async () => {
		expect(await deriveValue(DAY_PERIOD, inputs(at(3)))).toBe("night")
	})

	test("the book's own periods win", async () => {
		const calendar: StoryCalendar = {
			months: [{ name: "Thaw", days: 30 }],
			periods: [
				{ id: "first-light", label: "First light", from: 4 },
				{ id: "high-sun", label: "High sun", from: 13 }
			]
		}
		expect(await deriveValue(DAY_PERIOD, inputs(at(4), calendar))).toBe("first-light")
		expect(await deriveValue(DAY_PERIOD, inputs(at(15), calendar))).toBe("high-sun")
		expect(await deriveValue(DAY_PERIOD, inputs(at(2), calendar))).toBe("high-sun")
	})

	test("no hour, no clock: no value", async () => {
		expect(await deriveValue(DAY_PERIOD, inputs(at(null)))).toBeUndefined()
		expect(await deriveValue(DAY_PERIOD, inputs(null))).toBeUndefined()
	})
})

describe("time-of-day", () => {
	test("always the default periods, whatever the calendar says", async () => {
		const calendar: StoryCalendar = {
			months: [{ name: "Thaw", days: 30 }],
			periods: [{ id: "first-light", label: "First light", from: 4 }]
		}
		expect(await deriveValue(TIME_OF_DAY, inputs(at(13), calendar))).toBe("day")
		expect(await deriveValue(DAY_PERIOD, inputs(at(13), calendar))).toBe("first-light")
	})
})

describe("season", () => {
	const calendar: StoryCalendar = {
		months: [
			{ name: "Thaw", days: 30 },
			{ name: "Ember", days: 30 }
		],
		seasons: { days: 30, labels: ["Spring", { en: "Summer", fr: "Ete" }, { en: "Autumn" }, "Winter"] }
	}
	const on = (year: number, month: number, day: number) => ({ year, month, day, hour: 9 })

	test("steps every `days` days, and turns over with the year", async () => {
		expect(await deriveValue(SEASON, inputs(on(1, 1, 1), calendar))).toBe("Spring")
		expect(await deriveValue(SEASON, inputs(on(1, 2, 1), calendar))).toBe("Summer")
		// Year 2 starts at day index 60: the third season.
		expect(await deriveValue(SEASON, inputs(on(2, 1, 1), calendar))).toBe("Autumn")
		expect(await deriveValue(SEASON, inputs(on(2, 2, 1), calendar))).toBe("Winter")
		expect(await deriveValue(SEASON, inputs(on(3, 1, 1), calendar))).toBe("Spring")
	})

	test("a locale map reads its en", async () => {
		expect(await deriveValue(SEASON, inputs(on(1, 2, 5), calendar))).toBe("Summer")
	})

	test("free-form, no seasons, or no month and day: no value", async () => {
		expect(await deriveValue(SEASON, inputs(on(1, 1, 1), null))).toBeUndefined()
		expect(
			await deriveValue(SEASON, inputs(on(1, 1, 1), { months: calendar.months }))
		).toBeUndefined()
		expect(
			await deriveValue(SEASON, inputs({ year: 1, month: null, day: null, hour: 9 }, calendar))
		).toBeUndefined()
	})
})
