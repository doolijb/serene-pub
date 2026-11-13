import { describe, expect, test } from "vitest"
import { dayOnly } from "$lib/shared/lorebooks/storyDate"
import { sceneDayOf, unfiledScenesByDay } from "./unfiledScenes"

const scene = (id: number, over: Record<string, unknown> = {}) => ({
	id,
	historyEntryId: null,
	branchId: null,
	...over
})
const at = (year: number, month?: number, day?: number, hour?: number) => ({
	openedStoryClockYear: year,
	openedStoryClockMonth: month ?? null,
	openedStoryClockDay: day ?? null,
	openedStoryClockHour: hour ?? null
})

describe("sceneDayOf — the one dayOnly", () => {
	test("no clock is no day", () => {
		expect(sceneDayOf(scene(1))).toBe(null)
	})
	test("the hour is dropped", () => {
		const day = sceneDayOf(scene(1, at(4, 2, 9, 17)))
		expect(day).toEqual({ year: 4, month: 2, day: 9 })
		expect(day).toEqual(dayOnly({ year: 4, month: 2, day: 9 }))
	})
	test("a day without a month is dropped", () => {
		const day = sceneDayOf(scene(1, at(4, undefined, 9)))
		expect(day).toEqual({ year: 4, month: null, day: null })
		expect(day).toEqual(dayOnly({ year: 4, month: null, day: 9 }))
	})
	test("a month without a day dates by its month", () => {
		const day = sceneDayOf(scene(1, at(4, 2)))
		expect(day).toEqual({ year: 4, month: 2, day: null })
		expect(day).toEqual(dayOnly({ year: 4, month: 2, day: null }))
	})
})

describe("unfiledScenesByDay", () => {
	test("groups by day in story order, Undated last, scenes by id", () => {
		const groups = unfiledScenesByDay(
			[
				scene(5),
				scene(4, at(4, 2, 9, 8)),
				scene(2, at(3, 1, 1)),
				scene(3, at(4, 2, 9, 20)),
				scene(1)
			],
			null
		)
		expect(groups.map((g) => g.scenes.map((s) => s.id))).toEqual([
			[2],
			[3, 4],
			[1, 5]
		])
		expect(groups.map((g) => g.date)).toEqual([
			{ year: 3, month: 1, day: 1 },
			{ year: 4, month: 2, day: 9 },
			null
		])
	})
	test("filed scenes and another line's scenes are left out", () => {
		const rows = [
			scene(1, at(1, 1, 1)),
			scene(2, { ...at(1, 1, 1), historyEntryId: 9 }),
			scene(3, { ...at(1, 1, 1), branchId: 7 })
		]
		expect(
			unfiledScenesByDay(rows, null).flatMap((g) =>
				g.scenes.map((s) => s.id)
			)
		).toEqual([1])
		expect(
			unfiledScenesByDay(rows, 7).flatMap((g) =>
				g.scenes.map((s) => s.id)
			)
		).toEqual([3])
	})
	test("nothing waiting is no groups", () => {
		expect(unfiledScenesByDay([], null)).toEqual([])
	})
})
