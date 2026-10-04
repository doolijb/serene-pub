/**
 * The line rule, pure: which rows and which amendments are on the line being
 * read. The SQL form is checked against the same cases in
 * `$lib/server/state/lineSql.int.test.ts`.
 */
import { describe, expect, it } from "vitest"
import {
	amendmentsAheadOnLine,
	amendmentsOnLine,
	clockPastDeleted,
	forkPastDeleted,
	forksThrough,
	isOnLine,
	lineOf,
	MAIN_LINE,
	type LineBranch,
	rowReadsOnLine,
	rowsReadingOnLine,
	survivingLineOf,
	uncutLine
} from "./lineReading"
import { amendmentsAsOf, compareLines, entryAsOf } from "./amendments"
import { appearancesOf } from "./presence"
import {
	CASE_BRANCHES,
	CASE_EXPECTED_AT_HEAD,
	CASE_LINES,
	CASE_MOMENTS,
	CASE_ROWS
} from "./lineReading.cases"
import type { StoryDate } from "./storyDate"

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

	it("a branch not in the list reads its own rows only, until the list names its chain", () => {
		expect(lineOf(99, CASE_BRANCHES)).toEqual({
			branchId: 99,
			steps: [{ branchId: 99, cut: null }]
		})
		expect(lineOf(3, []).steps).toEqual([{ branchId: 3, cut: null }])
	})

	it("before the list arrives, a line reads nothing the line itself does not", () => {
		for (const id of CASE_LINES) {
			const known = lineOf(id, CASE_BRANCHES)
			const early = lineOf(id, [])
			for (const moment of [null, { year: 6 }, { year: 3 }])
				for (const row of CASE_ROWS)
					if (rowReadsOnLine(row, early, row.date, moment))
						expect(
							rowReadsOnLine(row, known, row.date, moment),
							`row ${row.id} on line ${id ?? "main"}`
						).toBe(true)
		}
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

	it("membership reads the whole chain: a grandparent's rows too", () => {
		const rows = [{ branchId: null }, { branchId: 1 }, { branchId: 3 }, { branchId: 2 }]
		expect(rowsReadingOnLine(rows, lineOf(3, CASE_BRANCHES))).toHaveLength(3)
		expect(isOnLine({ branchId: 1 }, lineOf(4, CASE_BRANCHES))).toBe(true)
		expect(isOnLine({ branchId: 1 }, MAIN_LINE)).toBe(false)
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

	it("amendmentsAsOf reads the line it is handed; with none it reads main", () => {
		expect(
			amendmentsAsOf(all, { line: lineOf(3, CASE_BRANCHES) }).map((x) => x.id)
		).toEqual([1, 3, 5])
		expect(amendmentsAsOf(all).map((x) => x.id)).toEqual([1, 7, 2])
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
		const out = compareLines(rows, () => [], { line: lineOf(3, CASE_BRANCHES) })
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

describe("forkPastDeleted — deleting a line keeps its children's past", () => {
	type Branch = (typeof CASE_BRANCHES)[number] | LineBranch

	/** The book's lines once `gone` is deleted, its children moved past it. */
	function without(gone: number, fork: (child: Branch, deleted: Branch) => Partial<LineBranch>) {
		const deleted = CASE_BRANCHES.find((b) => b.id === gone)!
		return CASE_BRANCHES.filter((b) => b.id !== gone).map((b) =>
			b.forkedFromBranchId === gone ? { ...b, ...fork(b, deleted) } : b
		)
	}

	/** What a line reads, the deleted line's own rows left out (they go with it). */
	function reading(line: number, branches: readonly Branch[], gone: number, moment: StoryDate | null) {
		const rows = CASE_ROWS.filter((r) => r.branchId !== gone)
		return rowsReadingOnLine(rows, lineOf(line, branches), (r) => r.date, moment).map((r) => r.id)
	}

	it("a child leaves from the deleted line's parent, at the earlier fork date", () => {
		// C (off A at Y7), A off main at Y5: C now leaves main at Y5.
		expect(forkPastDeleted(CASE_BRANCHES[2], CASE_BRANCHES[0])).toEqual({
			forkedFromBranchId: null,
			forkYear: 5,
			forkMonth: null,
			forkDay: null
		})
		// E (off C at Y3), C off A at Y7: E now leaves A — the grandparent — at Y3.
		expect(forkPastDeleted(CASE_BRANCHES[4], CASE_BRANCHES[2])).toEqual({
			forkedFromBranchId: 1,
			forkYear: 3,
			forkMonth: null,
			forkDay: null
		})
		// D forked A at now: it takes A's own date, not "now" off main.
		expect(forkPastDeleted(CASE_BRANCHES[3], CASE_BRANCHES[0])).toMatchObject({
			forkedFromBranchId: null,
			forkYear: 5
		})
	})

	it("the earlier date keeps its month and day; a later one's are dropped with it", () => {
		const parent = { id: 20, forkedFromBranchId: null, forkYear: 5, forkMonth: 3, forkDay: 9 }
		expect(
			forkPastDeleted({ id: 21, forkedFromBranchId: 20, forkYear: 5, forkMonth: 3, forkDay: 2 }, parent)
		).toEqual({ forkedFromBranchId: null, forkYear: 5, forkMonth: 3, forkDay: 2 })
		expect(
			forkPastDeleted({ id: 21, forkedFromBranchId: 20, forkYear: 5, forkMonth: 4, forkDay: 1 }, parent)
		).toEqual({ forkedFromBranchId: null, forkYear: 5, forkMonth: 3, forkDay: 9 })
		// Two forks at now stay at now: the child keeps following.
		expect(
			forkPastDeleted({ id: 21, forkedFromBranchId: 20 }, { id: 20, forkedFromBranchId: 7 })
		).toEqual({ forkedFromBranchId: 7, forkYear: null, forkMonth: null, forkDay: null })
	})

	it("every other line reads what it read before, at every moment, whichever line goes", () => {
		for (const gone of CASE_BRANCHES.map((b) => b.id)) {
			const after = without(gone, forkPastDeleted)
			for (const line of after.map((b) => b.id))
				for (const moment of CASE_MOMENTS)
					expect(
						reading(line, after, gone, moment),
						`${name(line)} after deleting ${name(gone)}, at ${JSON.stringify(moment)}`
					).toEqual(reading(line, CASE_BRANCHES, gone, moment))
		}
	})

	it("the column's own SET NULL alone would not: a fork of a fork would read main past its cut", () => {
		const orphaned = without(1, () => ({ forkedFromBranchId: null }))
		// C forked A at Y7; A left main at Y5. Orphaned, C reads main's Y6 row (3).
		expect(reading(3, orphaned, 1, null)).toContain(3)
		expect(reading(3, CASE_BRANCHES, 1, null)).not.toContain(3)
	})
})

describe("forksThrough — what deleting a line hands each of its children", () => {
	it("groups every line whose chain runs through it under the child it passes", () => {
		// A's children: C (with E, forked off C) and D. C's: E. B has none.
		expect(forksThrough(1, CASE_BRANCHES)).toEqual(
			new Map([
				[3, [3, 5]],
				[4, [4]]
			])
		)
		expect(forksThrough(3, CASE_BRANCHES)).toEqual(new Map([[5, [5]]]))
		expect(forksThrough(2, CASE_BRANCHES)).toEqual(new Map())
	})

	const DATES: (StoryDate | null)[] = [
		null,
		...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((year) => ({ year })),
		{ year: 5, month: 2, day: 1 }
	]
	const MOMENTS: (StoryDate | null)[] = [...CASE_MOMENTS, ...DATES.filter((d) => d != null)]

	it("a row of the deleted line moved onto a child it read on reads where it read before, and nowhere else", () => {
		for (const gone of CASE_BRANCHES.map((b) => b.id)) {
			const deleted = CASE_BRANCHES.find((b) => b.id === gone)!
			const after = CASE_BRANCHES.filter((b) => b.id !== gone).map((b) =>
				b.forkedFromBranchId === gone ? { ...b, ...forkPastDeleted(b, deleted) } : b
			)
			for (const [child, group] of forksThrough(gone, CASE_BRANCHES))
				for (const date of DATES) {
					const row = { branchId: gone }
					if (!rowReadsOnLine(row, lineOf(child, CASE_BRANCHES), date, null)) {
						// Not kept: no line of the group ever read it, so none loses it.
						for (const line of group)
							for (const moment of MOMENTS)
								expect(rowReadsOnLine(row, lineOf(line, CASE_BRANCHES), date, moment)).toBe(false)
						continue
					}
					const moved = { branchId: child }
					for (const line of [null, ...after.map((b) => b.id)])
						for (const moment of MOMENTS)
							expect(
								rowReadsOnLine(moved, lineOf(line, after), date, moment),
								`${name(gone)} deleted, row at ${JSON.stringify(date)} kept by ${name(child)}: ${line == null ? "main" : name(line)} at ${JSON.stringify(moment)}`
							).toBe(
								line != null &&
									group.includes(line) &&
									rowReadsOnLine(row, lineOf(line, CASE_BRANCHES), date, moment)
							)
				}
		}
	})
})

describe("survivingLineOf — where a session goes when its line is deleted", () => {
	// main ─ A ─ B ─ C ; main ─ S
	const lines: LineBranch[] = [
		{ id: 1, forkedFromBranchId: null },
		{ id: 2, forkedFromBranchId: 1 },
		{ id: 3, forkedFromBranchId: 2 },
		{ id: 9, forkedFromBranchId: null }
	]
	const without = (...ids: number[]) => lines.filter((b) => !ids.includes(b.id))

	it("a line still there keeps its sessions", () => {
		expect(survivingLineOf(3, lines, without(2))).toBe(3)
		expect(survivingLineOf(null, lines, without(1))).toBeNull()
	})
	it("a session on a deleted line goes to the line that one left", () => {
		expect(survivingLineOf(2, lines, without(2))).toBe(1)
		expect(survivingLineOf(1, lines, without(1))).toBeNull()
	})
	it("past several deletes, to the nearest line of its chain still there", () => {
		expect(survivingLineOf(3, lines, without(3, 2))).toBe(1)
		expect(survivingLineOf(3, lines, without(3, 2, 1))).toBeNull()
	})
	it("never to a sibling", () => {
		expect(survivingLineOf(2, lines, without(2, 1))).toBeNull()
	})
	it("a line the list before never had goes to main", () => {
		expect(survivingLineOf(42, lines, lines)).toBeNull()
	})
})

describe("clockPastDeleted — the clock a session keeps when its line is deleted", () => {
	// The deleted line left its parent at Year 3, Mo. 2, Day 10.
	const deleted: LineBranch = { id: 2, forkedFromBranchId: 1, forkYear: 3, forkMonth: 2, forkDay: 10 }
	const clock = (year: number, month: number | null = null, day: number | null = null, hour: number | null = null) => ({
		year,
		month,
		day,
		hour,
		minute: hour == null ? null : 0
	})

	it("a line forked at now cut nothing, so every clock stays", () => {
		const late = clock(90, 1, 1, 12)
		expect(clockPastDeleted(late, { id: 2, forkedFromBranchId: 1 })).toBe(late)
	})
	it("a clock at or before the fork date stays as it is, its time of day included", () => {
		for (const kept of [clock(1), clock(3, 2), clock(3, 2, 10), clock(3, 2, 10, 23)])
			expect(clockPastDeleted(kept, deleted)).toBe(kept)
	})
	it("a clock after it goes back to the fork date: the parent reads the same up to there, and not past it", () => {
		expect(clockPastDeleted(clock(9), deleted)).toEqual(clock(3, 2, 10))
		expect(clockPastDeleted(clock(3, 2, 11, 6), deleted)).toEqual(clock(3, 2, 10))
		// A year-only fork date is the start of that year: a month in it is later.
		expect(clockPastDeleted(clock(3, 5), { id: 2, forkYear: 3 })).toEqual(clock(3))
	})
})
