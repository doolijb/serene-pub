/** Lines: main <- A (Year 3) <- B (Year 5); C forked from main (Year 2). */
import { describe, expect, test } from "vitest"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { LineBranch } from "$lib/shared/lorebooks/lineReading"
import type { TreeRow } from "$lib/shared/lorebooks/moveDownTheTree"
import {
	couldExistWhy,
	forkedLineRows,
	linesForkedFrom,
	moveHereProblem
} from "./couldExistHere"

const A = 1
const B = 2
const C = 3
const branches: LineBranch[] = [
	{ id: A, forkedFromBranchId: null, forkYear: 3 },
	{ id: B, forkedFromBranchId: A, forkYear: 5 },
	{ id: C, forkedFromBranchId: null, forkYear: 2 }
]

describe("linesForkedFrom", () => {
	test("main = every line; A = [B]; B = []; C never under A", () => {
		expect(linesForkedFrom(null, branches)).toEqual([A, B, C])
		expect(linesForkedFrom(A, branches)).toEqual([B])
		expect(linesForkedFrom(B, branches)).toEqual([])
		expect(linesForkedFrom(A, branches)).not.toContain(C)
	})
})

describe("forkedLineRows", () => {
	const r = (id: number, typeId: string, branchId: number | null) => ({
		id,
		typeId,
		branchId
	})
	const rawRows = {
		character: [
			r(1, "character", B),
			r(2, "character", A),
			r(3, "character", null)
		],
		location: [r(4, "location", B), r(5, "location", C)],
		[HISTORY_TYPE_ID]: [r(6, HISTORY_TYPE_ID, B)]
	}
	test("B's rows only, History left out", () => {
		const out = forkedLineRows({ rawRows, kinds: null, line: A, branches })
		expect(out.map((x) => x.id)).toEqual([1, 4])
	})
	test("kinds are honoured", () => {
		const out = forkedLineRows({
			rawRows,
			kinds: ["location"],
			line: A,
			branches
		})
		expect(out.map((x) => x.id)).toEqual([4])
	})
	test("main reads every line's rows but main's own", () => {
		const out = forkedLineRows({
			rawRows,
			kinds: null,
			line: null,
			branches
		})
		expect(out.map((x) => x.id)).toEqual([1, 2, 4, 5])
	})
})

describe("couldExistWhy", () => {
	const words = {
		lineName: (id: number | null) => (id == null ? "main" : `line ${id}`),
		date: (d: { year: number }) => `Year ${d.year}`
	}
	test("both words", () => {
		expect(couldExistWhy({ kind: "line", branchId: B }, words)).toBe(
			"On line 2"
		)
		expect(couldExistWhy({ kind: "later", date: { year: 9 } }, words)).toBe(
			"Begins in Year 9"
		)
	})
})

describe("moveHereProblem", () => {
	const row = (id: number, over: Partial<TreeRow> = {}): TreeRow => ({
		id,
		name: `E${id}`,
		isHistory: false,
		branchId: B,
		anchorEntryId: null,
		date: null,
		...over
	})
	const words = {
		lineName: (id: number | null) =>
			id == null ? "main" : ({ 1: "A", 2: "B", 3: "C" } as any)[id],
		date: (d: { year: number }) => `Year ${d.year}`,
		timeline: true
	}
	const ask = (rows: TreeRow[], id: number, target: number | null) =>
		moveHereProblem({ id, rows, target, branches, words })

	test("a perpetual entry on B reaches A and main", () => {
		const rows = [row(1)]
		expect(ask(rows, 1, A)).toBeNull()
		expect(ask(rows, 1, null)).toBeNull()
	})
	test("an entry that began at Year 6 is cut for A", () => {
		expect(ask([row(1, { date: { year: 6 } })], 1, A)).toBe(
			"E1 began at Year 6; B left A at Year 5."
		)
	})
	test("a parent on B moves with it", () => {
		expect(ask([row(1, { anchorEntryId: 2 }), row(2)], 1, A)).toBeNull()
	})
	test("a History entry gives the History sentence", () => {
		expect(ask([row(1, { isHistory: true })], 1, A)).toBe(
			"E1 is a History entry. History entries stay on their line, one for each date."
		)
	})
	test("an unknown id is null", () => {
		expect(ask([], 9, A)).toBeNull()
	})
})
