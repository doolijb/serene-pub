/**
 * Move down the tree: which lines are below, how far a date reaches, what moves
 * along, who starts reading, and the sentences.
 */
import { describe, expect, test } from "vitest"
import {
	forkThatCuts,
	isBelow,
	linesBelow,
	linesStartingToRead,
	moveDownProblems,
	moveDownSentence,
	reachesBelow,
	takenAlong,
	type TreeRow
} from "./moveDownTheTree"
import { lineOf, rowReadsOnLine, type LineBranch } from "./lineReading"

// main ← A (Year 3) ← B (Year 5) ← D (Year 10); A ← C (Year 2), B's sibling.
const A = 1
const B = 2
const C = 3
const D = 4
const branches: LineBranch[] = [
	{ id: A, forkedFromBranchId: null, forkYear: 3 },
	{ id: B, forkedFromBranchId: A, forkYear: 5 },
	{ id: C, forkedFromBranchId: A, forkYear: 2 },
	{ id: D, forkedFromBranchId: B, forkYear: 10 }
]
const Y = (year: number) => ({ year, month: null, day: null })
const row = (over: Partial<TreeRow> & { id: number }): TreeRow => ({
	name: `Entry ${over.id}`,
	isHistory: false,
	branchId: B,
	anchorEntryId: null,
	date: null,
	...over
})
const words = {
	lineName: (id: number | null) =>
		id == null
			? "main"
			: ({ 1: "A", 2: "B", 3: "C", 4: "D" } as Record<number, string>)[
					id
				],
	date: (d: { year: number }) => `Year ${d.year}`,
	timeline: true
}

describe("the lines below", () => {
	test("run from the parent to main, and main has none", () => {
		expect(linesBelow(B, branches)).toEqual([A, null])
		expect(linesBelow(D, branches)).toEqual([B, A, null])
		expect(linesBelow(null, branches)).toEqual([])
		expect(isBelow(B, A, branches)).toBe(true)
		expect(isBelow(B, C, branches)).toBe(false)
		expect(isBelow(A, B, branches)).toBe(false)
	})
})

describe("how far a date reaches", () => {
	test("an undated entry reaches every line below", () => {
		expect(reachesBelow(null, D, B, branches)).toBe(true)
		expect(reachesBelow(null, D, A, branches)).toBe(true)
		expect(reachesBelow(null, D, null, branches)).toBe(true)
	})
	test("a date must be on or before every fork on the way", () => {
		expect(reachesBelow(Y(4), B, A, branches)).toBe(true)
		expect(reachesBelow(Y(5), B, A, branches)).toBe(true)
		expect(reachesBelow(Y(4), B, null, branches)).toBe(false)
		expect(forkThatCuts(B, null, branches)).toEqual({
			line: A,
			leftFrom: null,
			at: Y(3)
		})
		expect(reachesBelow(Y(6), B, A, branches)).toBe(false)
		expect(forkThatCuts(B, A, branches)).toEqual({
			line: B,
			leftFrom: A,
			at: Y(5)
		})
		// Across two forks: D left B at 10, B left A at 5.
		expect(reachesBelow(Y(7), D, B, branches)).toBe(true)
		expect(reachesBelow(Y(7), D, A, branches)).toBe(false)
		expect(forkThatCuts(D, A, branches)).toEqual({
			line: B,
			leftFrom: A,
			at: Y(5)
		})
	})
	test("the line it leaves still reads it on the line below", () => {
		expect(rowReadsOnLine({ branchId: A }, lineOf(B, branches), Y(4))).toBe(
			true
		)
		expect(rowReadsOnLine({ branchId: A }, lineOf(D, branches), Y(4))).toBe(
			true
		)
	})
})

describe("what moves along", () => {
	const parent = row({ id: 10 })
	const child = row({ id: 11, anchorEntryId: 10 })
	const grandchild = row({ id: 12, anchorEntryId: 11 })
	const sibling = row({ id: 13, anchorEntryId: 10 })
	const sharedParent = row({ id: 20, branchId: null })
	const underShared = row({ id: 21, anchorEntryId: 20 })
	const rows = [parent, child, grandchild, sibling, sharedParent, underShared]

	test("parents on the line, and everything filed under a moving entry there", () => {
		const along = takenAlong([11], rows, B)
		expect(along.map((a) => [a.row.id, a.as])).toEqual([
			[10, "parent"],
			[12, "child"],
			[13, "child"]
		])
	})
	test("a shared parent stays where it is", () => {
		expect(takenAlong([21], rows, B)).toEqual([])
		expect(
			moveDownProblems({ ids: [21], rows, target: A, branches })
		).toEqual([])
	})
	test("a child without its parent is refused; with it, nothing is", () => {
		const problems = moveDownProblems({
			ids: [11],
			rows,
			target: A,
			branches
		})
		expect(problems.map((p) => p.kind)).toEqual([
			"leftBehind",
			"leftBehind",
			"leftBehind"
		])
		expect(moveDownSentence(problems[0], words)).toBe(
			"Entry 11 is filed under Entry 10: move Entry 10 with it."
		)
		expect(moveDownSentence(problems[1], words)).toBe(
			"Entry 12 is filed under Entry 11: move it with Entry 11."
		)
		expect(
			moveDownProblems({
				ids: [10, 11, 12, 13],
				rows,
				target: A,
				branches
			})
		).toEqual([])
	})
})

describe("refusals", () => {
	test("main, mixed lines, not below, history, a date that does not reach", () => {
		const onMain = row({ id: 1, branchId: null })
		expect(
			moveDownProblems({
				ids: [1],
				rows: [onMain],
				target: null,
				branches
			})[0].kind
		).toBe("onMain")
		const mixed = [row({ id: 1 }), row({ id: 2, branchId: D })]
		expect(
			moveDownProblems({ ids: [1, 2], rows: mixed, target: A, branches })
		).toEqual([{ kind: "mixedLines" }])
		const p = moveDownProblems({
			ids: [1],
			rows: [row({ id: 1 })],
			target: C,
			branches
		})
		expect(moveDownSentence(p[0], words)).toBe(
			"C is not a line B was forked from. An entry moves only down the tree, toward main."
		)
		const history = row({ id: 1, isHistory: true, name: "Day 4" })
		expect(
			moveDownSentence(
				moveDownProblems({
					ids: [1],
					rows: [history],
					target: A,
					branches
				})[0],
				words
			)
		).toBe(
			"Day 4 is a History entry. History entries stay on their line, one for each date."
		)
		const late = row({ id: 1, date: Y(6), name: "The tower" })
		const cut = moveDownProblems({
			ids: [1],
			rows: [late],
			target: A,
			branches
		})
		expect(moveDownSentence(cut[0], words)).toBe(
			"The tower began at Year 6; B left A at Year 5."
		)
		expect(moveDownSentence(cut[0], { ...words, timeline: false })).toBe(
			"B left A before The tower began."
		)
	})
})

describe("who starts reading", () => {
	test("an undated entry: the target and the lines forked from it that did not read it", () => {
		expect(linesStartingToRead([row({ id: 1 })], B, A, branches)).toEqual([
			A,
			C
		])
		expect(
			linesStartingToRead([row({ id: 1 })], B, null, branches)
		).toEqual([null, A, C])
	})
	test("a dated entry: only where every cut on the way reaches its date", () => {
		expect(
			linesStartingToRead([row({ id: 1, date: Y(4) })], B, A, branches)
		).toEqual([A])
		expect(
			linesStartingToRead([row({ id: 1, date: Y(2) })], B, null, branches)
		).toEqual([null, A, C])
	})
})
