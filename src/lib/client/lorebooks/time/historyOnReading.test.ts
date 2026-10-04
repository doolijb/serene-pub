import { describe, expect, test } from "vitest"
import { lineOf, MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import { historyEntriesOnReading } from "./historyOnReading"

/**
 * Main, "north" forked from main at Year 3, and a sibling "south". Main holds
 * Years 1 and 5, north its own Year 4, south its own Year 2, plus one undated.
 */
const branches = [
	{ id: 7, forkedFromBranchId: null, forkYear: 3 },
	{ id: 8, forkedFromBranchId: null }
]
const entries = [
	{ id: 1, branchId: null, year: 1, month: 6, day: 1 },
	{ id: 2, branchId: null, year: 5, month: null, day: null },
	{ id: 3, branchId: 7, year: 4, month: 2, day: null },
	{ id: 4, branchId: 8, year: 2, month: null, day: null },
	{ id: 5, branchId: null, year: null, month: null, day: null }
]
const ids = (rows: { id: number }[]) => rows.map((r) => r.id)

describe("historyEntriesOnReading — what a session can file a scene under", () => {
	test("a branch session sees its own and main's up to the fork, never a sibling's; newest first, undated last", () => {
		expect(
			ids(historyEntriesOnReading(entries, lineOf(7, branches), null))
		).toEqual([3, 1, 5])
	})

	test("a session clock leaves out what is dated after it", () => {
		expect(
			ids(
				historyEntriesOnReading(entries, lineOf(7, branches), {
					year: 3,
					month: 12,
					day: 30
				})
			)
		).toEqual([1, 5])
	})

	test("main sees shared rows only", () => {
		expect(ids(historyEntriesOnReading(entries, MAIN_LINE, null))).toEqual([
			2, 1, 5
		])
	})
})
