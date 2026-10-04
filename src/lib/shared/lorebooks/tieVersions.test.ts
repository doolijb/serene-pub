/**
 * Which version of a cast tie a line reads (plan A3, review round).
 *
 * A branch that tells a tie differently at a date its ancestor also told it
 * reads its own telling; the ancestor's stays as it was for every other line.
 */
import { describe, expect, it } from "vitest"
import { nearestTieVersions } from "./tieVersions"
import { MAIN_LINE, lineOf, type LineBranch } from "./lineReading"

// 7 forks from main; 8 forks from 7; 9 is 7's sibling.
const branches = [
	{ id: 7, forkedFromBranchId: null },
	{ id: 8, forkedFromBranchId: 7 },
	{ id: 9, forkedFromBranchId: null }
] satisfies LineBranch[]

const tie = (
	id: number,
	branchId: number | null,
	historyEntryId: number | null,
	over: Record<string, unknown> = {}
) => ({
	id,
	branchId,
	historyEntryId,
	fromNodeId: 1,
	toNodeId: 2,
	fromEntryId: null,
	toEntryId: null,
	relationshipType: "ally",
	...over
})

const ids = (rows: readonly { id: number }[]) => rows.map((r) => r.id)

describe("nearestTieVersions", () => {
	it("a branch's version at a date replaces its ancestor's at that date, on the branch", () => {
		const rows = [tie(1, null, 5), tie(2, 7, 5)]
		expect(ids(nearestTieVersions(rows, lineOf(7, branches)))).toEqual([2])
	})

	it("undated is a date: a branch's undated version replaces main's undated one", () => {
		const rows = [tie(1, null, null), tie(2, 7, null)]
		expect(ids(nearestTieVersions(rows, lineOf(7, branches)))).toEqual([2])
	})

	it("versions at different dates are all read: they are the tie's history", () => {
		const rows = [tie(1, null, 5), tie(2, 7, 6), tie(3, null, null)]
		expect(ids(nearestTieVersions(rows, lineOf(7, branches)))).toEqual([1, 2, 3])
	})

	it("a fork of a fork reads the nearest telling: its own, then its parent's, then main's", () => {
		const rows = [tie(1, null, 5), tie(2, 7, 5), tie(3, 8, 5), tie(4, null, 6), tie(5, 7, 6)]
		expect(ids(nearestTieVersions(rows, lineOf(8, branches)))).toEqual([3, 5])
	})

	it("another tie is never replaced: other words, the other way round, or another pair", () => {
		const rows = [
			tie(1, null, 5),
			tie(2, 7, 5, { relationshipType: "rival" }),
			tie(3, 7, 5, { fromNodeId: 2, toNodeId: 1 }),
			tie(4, 7, 5, { toNodeId: 3 })
		]
		expect(ids(nearestTieVersions(rows, lineOf(7, branches)))).toEqual([1, 2, 3, 4])
	})

	it("a link with an entry at either end is passed through untouched", () => {
		const rows = [
			tie(1, null, 5, { toNodeId: null, toEntryId: 40 }),
			tie(2, 7, 5, { toNodeId: null, toEntryId: 40 })
		]
		expect(ids(nearestTieVersions(rows, lineOf(7, branches)))).toEqual([1, 2])
	})

	it("on main there is one line, and every version is kept", () => {
		const rows = [tie(1, null, 5), tie(2, null, 5)]
		expect(ids(nearestTieVersions(rows, MAIN_LINE))).toEqual([1, 2])
	})

	it("keeps the order it was given", () => {
		const rows = [tie(3, 7, 6), tie(1, null, 5), tie(2, null, null)]
		expect(ids(nearestTieVersions(rows, lineOf(7, branches)))).toEqual([3, 1, 2])
	})
})
