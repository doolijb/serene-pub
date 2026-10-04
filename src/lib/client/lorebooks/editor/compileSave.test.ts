import { describe, expect, test } from "vitest"
import { compileActivityAt, compileSaveOf } from "./compileSave"

const entry = { branchId: null, year: 4, month: 2, day: 9 }

describe("compileSaveOf — where a compile's review saves", () => {
	test("at a moment: an amendment on the line, dated then", () => {
		expect(
			compileSaveOf(entry, { branchId: 7, moment: { year: 6 } })
		).toEqual({
			kind: "amendment",
			branchId: 7,
			date: { year: 6 },
			atEntryDate: false
		})
	})

	test("at now, the line's own entry: the entry itself", () => {
		expect(compileSaveOf(entry, { branchId: null, moment: null })).toEqual({
			kind: "entry"
		})
		expect(
			compileSaveOf({ ...entry, branchId: 7 }, { branchId: 7, moment: null })
		).toEqual({ kind: "entry" })
	})

	test("at now, an entry the line reads from another line: an amendment at the entry's own date", () => {
		expect(compileSaveOf(entry, { branchId: 7, moment: null })).toEqual({
			kind: "amendment",
			branchId: 7,
			date: { year: 4, month: 2, day: 9 },
			atEntryDate: true
		})
	})
})

describe("compileActivityAt — one compile per reading", () => {
	const activities = [
		{ id: "b", historyEntryId: 21, branchId: 7, moment: null },
		{ id: "c", historyEntryId: 21, branchId: 9, moment: null },
		{ id: "b5", historyEntryId: 21, branchId: 7, moment: { year: 5 } }
	]

	test("finds the compile asked at this line and moment, never another line's", () => {
		expect(
			compileActivityAt(activities, 21, { branchId: 9, moment: null })?.id
		).toBe("c")
		expect(
			compileActivityAt(activities, 21, {
				branchId: 7,
				moment: { year: 5, month: null, day: null }
			})?.id
		).toBe("b5")
		expect(
			compileActivityAt(activities, 21, { branchId: null, moment: null })
		).toBeUndefined()
	})
})
