/**
 * One table of line-reading cases, shared by the pure test
 * (`lineReading.test.ts`), the reader conformance tests
 * (`$lib/client/lorebooks/lineConformance.test.ts`: the shared readers;
 * `lineConformance.screens.dom.test.ts`: the screens it mounts) and the SQL
 * agreement test (`$lib/server/state/lineSql.int.test.ts`: the SQL form and
 * the server readers it names) — the client and server forms of the rule are
 * checked against the SAME rows, so they cannot drift apart without one of
 * the suites saying so.
 *
 * Test-only: nothing in the app imports this.
 */
import type { StoryDate } from "./storyDate"

/** The book's lines, by local id (the int test maps them to real ids). */
export const CASE_BRANCHES = [
	// A: off main at Y5.
	{ id: 1, name: "A", forkedFromBranchId: null, forkYear: 5, forkMonth: null, forkDay: null },
	// B: off main at now — no cut, keeps following main.
	{ id: 2, name: "B", forkedFromBranchId: null, forkYear: null, forkMonth: null, forkDay: null },
	// C: off A at Y7 — reads A up to Y7 and main up to Y5 (the earlier cut).
	{ id: 3, name: "C", forkedFromBranchId: 1, forkYear: 7, forkMonth: null, forkDay: null },
	// D: off A at now — reads all of A, main up to A's Y5.
	{ id: 4, name: "D", forkedFromBranchId: 1, forkYear: null, forkMonth: null, forkDay: null },
	// E: off C at Y3 — earlier than both ancestors' cuts, so Y3 cuts all three.
	{ id: 5, name: "E", forkedFromBranchId: 3, forkYear: 3, forkMonth: null, forkDay: null }
] as const

/** A dated (or undated) row on a line. `date` null = undated, never cut. */
export interface CaseRow {
	id: number
	branchId: number | null
	date: StoryDate | null
}

export const CASE_ROWS: CaseRow[] = [
	{ id: 1, branchId: null, date: null },
	{ id: 2, branchId: null, date: { year: 4 } },
	{ id: 3, branchId: null, date: { year: 6 } },
	{ id: 4, branchId: 1, date: { year: 6 } },
	{ id: 5, branchId: 1, date: { year: 8 } },
	{ id: 6, branchId: 2, date: { year: 9 } },
	{ id: 7, branchId: 3, date: { year: 2 } },
	{ id: 8, branchId: 3, date: { year: 10 } },
	// Exactly at A's cut: in (the cut is inclusive).
	{ id: 9, branchId: null, date: { year: 5 } },
	// Y5 Mo.3 is AFTER a year-only Y5 cut (an absent month counts as 0).
	{ id: 10, branchId: null, date: { year: 5, month: 3 } },
	{ id: 11, branchId: 1, date: null },
	{ id: 12, branchId: 4, date: { year: 1 } },
	// Day 250 of month 1 is BEFORE month 2 — the packed value says otherwise.
	{ id: 13, branchId: null, date: { year: 5, month: 1, day: 250 } }
]

/** The lines to read (null = main) and the moments to read them at. */
export const CASE_LINES: (number | null)[] = [null, 1, 2, 3, 4, 5]
export const CASE_MOMENTS: (StoryDate | null)[] = [
	null,
	{ year: 6 },
	{ year: 5, month: 2, day: 1 }
]

/** Hand-worked expectations for the head (moment null), by line. */
export const CASE_EXPECTED_AT_HEAD: Record<string, number[]> = {
	main: [1, 2, 3, 9, 10, 13],
	// Main up to Y5 (13 is Y5 Mo.1 Day 250 — also after a year-only Y5).
	A: [1, 2, 9, 4, 5, 11],
	B: [1, 2, 3, 9, 10, 13, 6],
	C: [1, 2, 9, 4, 11, 7, 8],
	D: [1, 2, 9, 4, 5, 11, 12],
	E: [1, 11, 7]
}
