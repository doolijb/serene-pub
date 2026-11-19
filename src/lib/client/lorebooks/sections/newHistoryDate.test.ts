import { describe, expect, test } from "vitest"
import { SECTION_DESCRIPTORS, newHistoryDate } from "./index"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

const presents = {
	main: { year: 5, month: 2, day: 3, hour: 9, minute: 1 },
	branches: [{ branchId: 4, present: null }]
}
const start = { date: { year: 2026, month: 6, day: 15, hour: 8, minute: 0 } }

describe("a new history entry opens on the line's present", () => {
	test("the history door's blank draft has no year", () => {
		const door = SECTION_DESCRIPTORS.find((d) => d.kind === HISTORY_TYPE_ID)!
		expect(door.newDraft(1)).toMatchObject({ year: null, month: null, day: null })
	})
	test("the line's present, date parts only", () => {
		expect(newHistoryDate({ presents, start }, null)).toEqual({ year: 5, month: 2, day: 3 })
	})
	test("no present on the line: where a new session would start", () => {
		expect(newHistoryDate({ presents, start }, 4)).toEqual({ year: 2026, month: 6, day: 15 })
	})
	test("neither: nothing, never Year 1", () => {
		expect(newHistoryDate({ presents: null, start: null }, null)).toBeNull()
		expect(newHistoryDate({ presents, start: { date: null } }, 4)).toBeNull()
	})
})
