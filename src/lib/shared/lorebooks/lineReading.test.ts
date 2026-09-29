/**
 * The line rule, pure: which rows and which amendments are on the line being
 * read. The SQL form is checked against the same cases in
 * `$lib/server/state/lineSql.int.test.ts`.
 */
import { describe, expect, it } from "vitest"
import {
	amendmentsAheadOnLine,
	amendmentsOnLine,
	isOnLine,
	lineFromFork,
	lineOf,
	MAIN_LINE,
	rowReadsOnLine,
	rowsReadingOnLine,
	uncutLine
} from "./lineReading"
import { amendmentsAsOf, compareLines, entryAsOf, onLine, rowsOnLine } from "./amendments"
import { appearancesOf } from "./presence"
import {
	CASE_BRANCHES,
	CASE_EXPECTED_AT_HEAD,
	CASE_ROWS
} from "./lineReading.cases"

const name = (id: number | null) =>
	id === null ? "main" : CASE_BRANCHES.find((b) => b.id === id)!.name

describe("lineOf — the ancestor chain", () => {
	it("main is main", () => {
		expect(lineOf(null, CASE_BRANCHES)).toBe(MAIN_LINE)
		expect(MAIN_LINE.steps).toEqual([{ branchId: null, cut: null }])
	})

	it("a fork of main at a date cuts main there", () => {
		expect(lineOf(1, CASE_BRANCHES).steps).toEqual([
			{ branchId: 1, cut: null },
			{ branchId: null, cut: { year: 5, month: null, day: null } }
		])
	})

	it("a fork with no date keeps following main — no cut", () => {
		expect(lineOf(2, CASE_BRANCHES).steps).toEqual([
			{ branchId: 2, cut: null },
			{ branchId: null, cut: null }
		])
	})

	it("a fork of a fork reads its parent to its own date, main to the earlier cut", () => {
		expect(lineOf(3, CASE_BRANCHES).steps).toEqual([
			{ branchId: 3, cut: null },
			{ branchId: 1, cut: { year: 7, month: null, day: null } },
			{ branchId: null, cut: { year: 5, month: null, day: null } }
		])
	})

	it("an undated fork of a fork follows its parent, which is still cut from main", () => {
		expect(lineOf(4, CASE_BRANCHES).steps).toEqual([
			{ branchId: 4, cut: null },
			{ branchId: 1, cut: null },
			{ branchId: null, cut: { year: 5, month: null, day: null } }
		])
	})

	it("an early fork cuts every ancestor at its own date", () => {
		const y3 = { year: 3, month: null, day: null }
		expect(lineOf(5, CASE_BRANCHES).steps).toEqual([
			{ branchId: 5, cut: null },
			{ branchId: 3, cut: y3 },
			{ branchId: 1, cut: y3 },
			{ branchId: null, cut: y3 }
		])
	})

	it("a branch not in the list reads its own rows and all of main", () => {
		expect(lineOf(99, CASE_BRANCHES)).toEqual(lineFromFork(99, null))
	})

	it("a missing parent ends the chain at main with the cut so far", () => {
		const orphan = [{ id: 7, forkedFromBranchId: 42, forkYear: 2 }]
		expect(lineOf(7, orphan).steps).toEqual([
			{ branchId: 7, cut: null },
			{ branchId: 42, cut: { year: 2, month: null, day: null } },
			{ branchId: null, cut: { year: 2, month: null, day: null } }
		])
	})

	it("a cycle ends at main instead of spinning", () => {
		const ring = [
			{ id: 1, forkedFromBranchId: 2 },
			{ id: 2, forkedFromBranchId: 1 }
		]
		expect(lineOf(1, ring).steps.map((s) => s.branchId)).toEqual([1, 2, null])
	})

	it("uncutLine lifts every cut (a pipeline's whole-line read)", () => {
		expect(uncutLine(lineOf(3, CASE_BRANCHES)).steps.every((s) => s.cut === null)).toBe(true)
	})
})

describe("rowReadsOnLine — the table of cases", () => {
	for (const [lineName, expected] of Object.entries(CASE_EXPECTED_AT_HEAD)) {
		it(`${lineName} at the head`, () => {
			const id =
				lineName === "main"
					? null
					: CASE_BRANCHES.find((b) => b.name === lineName)!.id
			const line = lineOf(id, CASE_BRANCHES)
			const seen = CASE_ROWS.filter((r) => rowReadsOnLine(r, line, r.date))
			expect(seen.map((r) => r.id).sort((a, b) => a - b)).toEqual(
				[...expected].sort((a, b) => a - b)
			)
			expect(name(id)).toBe(lineName)
		})
	}

	it("a moment cuts the line's own rows and tightens every ancestor's cut", () => {
		const line = lineOf(3, CASE_BRANCHES)
		const seen = rowsReadingOnLine(CASE_ROWS, line, (r) => r.date, { year: 6 })
		expect(seen.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 4, 7, 9, 11])
	})

	it("membership alone ignores dates", () => {
		const line = lineOf(1, CASE_BRANCHES)
		expect(isOnLine({ branchId: null }, line)).toBe(true)
		expect(isOnLine({ branchId: 1 }, line)).toBe(true)
		expect(isOnLine({ branchId: 2 }, line)).toBe(false)
		// A child line's rows are never an ancestor's.
		expect(isOnLine({ branchId: 3 }, line)).toBe(false)
	})

	it("rowsOnLine / onLine accept the chain (and a bare id as one level)", () => {
		const rows = [{ branchId: null }, { branchId: 1 }, { branchId: 3 }, { branchId: 2 }]
		expect(rowsOnLine(rows, lineOf(3, CASE_BRANCHES))).toHaveLength(3)
		expect(rowsOnLine(rows, 3)).toHaveLength(2)
		expect(onLine({ branchId: 1 }, lineOf(4, CASE_BRANCHES))).toBe(true)
		expect(onLine({ branchId: 1 }, null)).toBe(false)
	})
})

describe("amendmentsOnLine — which overlays apply, in apply order", () => {
	const a = (id: number, branchId: number | null, year: number, month?: number) => ({
		id,
		branchId,
		year,
		month: month ?? null,
		day: null,
		fields: { content: `#${id}` }
	})
	const all = [
		a(1, null, 4),
		a(2, null, 6), // after C's main cut (Y5)
		a(3, 1, 6), // A, before C's fork (Y7)
		a(4, 1, 8), // A, after C's fork
		a(5, 3, 1), // C's own, early
		a(6, 2, 2), // a sibling line
		a(7, null, 5, 3) // Y5 Mo.3: after a year-only Y5 cut
	]

	it("main first, then each ancestor, then the line itself — nearer wins", () => {
		const line = lineOf(3, CASE_BRANCHES)
		expect(amendmentsOnLine(all, line).map((x) => x.id)).toEqual([1, 3, 5])
		// C's own Y1 amendment beats A's Y6 one: the nearer line wins.
		expect(entryAsOf({ content: "base" }, all, { line }).content).toBe("#5")
	})

	it("an undated fork of a fork reads its parent whole", () => {
		const line = lineOf(4, CASE_BRANCHES)
		expect(amendmentsOnLine(all, line).map((x) => x.id)).toEqual([1, 3, 4])
	})

	it("the moment cuts on top of the forks", () => {
		const line = lineOf(1, CASE_BRANCHES)
		expect(amendmentsOnLine(all, line, { year: 5 }).map((x) => x.id)).toEqual([1])
		expect(amendmentsOnLine(all, line).map((x) => x.id)).toEqual([1, 3, 4])
	})

	it("main reads main's only, all of it at the head", () => {
		expect(amendmentsOnLine(all, MAIN_LINE).map((x) => x.id)).toEqual([1, 7, 2])
	})

	it("amendmentsAsOf with a bare branch id is still the one-level reading", () => {
		expect(
			amendmentsAsOf(all, { branchId: 3, forkedAt: { year: 5 } }).map((x) => x.id)
		).toEqual([1, 5])
	})

	it("ahead: on this line, after the moment, never past a fork cut", () => {
		const line = lineOf(3, CASE_BRANCHES)
		// Y2 on C: A's Y6 is ahead (it happens here at Y6); A's Y8 and main's
		// Y6 never happen on C, so they are not "not yet".
		expect(
			amendmentsAheadOnLine(all, line, { year: 2 }).map((x) => x.id)
		).toEqual([1, 3])
		expect(amendmentsAheadOnLine(all, line, null)).toEqual([])
	})
})

describe("compareLines reads through the chain", () => {
	it("an ancestor branch's own row is `only` on the child; a sibling's is skipped", () => {
		const rows = [
			{ id: 1, branchId: null },
			{ id: 2, branchId: 1 },
			{ id: 3, branchId: 2 },
			{ id: 4, branchId: 3 }
		]
		const out = compareLines(rows, () => [], 3, { line: lineOf(3, CASE_BRANCHES) })
		expect(out.map((d) => [d.id, d.kind])).toEqual([
			[2, "only"],
			[4, "only"]
		])
	})
})

describe("presences read through the chain", () => {
	const p = (id: number, branchId: number | null, fromYear: number) => ({
		id,
		castId: 9,
		branchId,
		personalPosition: id,
		fromYear
	})

	it("an ancestor's presence counts only if it began by the fork cut", () => {
		const presences = [p(1, null, 1), p(2, null, 6), p(3, 1, 2), p(4, 2, 1)]
		const here = appearancesOf(9, presences, { line: lineOf(3, CASE_BRANCHES) })
		expect(here.map((a) => a.presenceId)).toEqual([1, 3])
	})
})
