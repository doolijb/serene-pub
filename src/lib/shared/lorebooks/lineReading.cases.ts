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
 * It also carries the cast-version scenarios (`CASE_VERSIONS`): which version
 * of a member is in force on a line, with session cuts and the retire mark.
 *
 * Test-only: nothing in the app imports this.
 */
import type { SessionCut } from "./lineReading"
import type { StoryDate } from "./storyDate"

/** The book's lines, by local id (the int test maps them to real ids). */
export const CASE_BRANCHES = [
	// A: off main at Y5.
	{
		id: 1,
		name: "A",
		forkedFromBranchId: null,
		forkYear: 5,
		forkMonth: null,
		forkDay: null
	},
	// B: off main at now — no cut, keeps following main.
	{
		id: 2,
		name: "B",
		forkedFromBranchId: null,
		forkYear: null,
		forkMonth: null,
		forkDay: null
	},
	// C: off A at Y7 — reads A up to Y7 and main up to Y5 (the earlier cut).
	{
		id: 3,
		name: "C",
		forkedFromBranchId: 1,
		forkYear: 7,
		forkMonth: null,
		forkDay: null
	},
	// D: off A at now — reads all of A, main up to A's Y5.
	{
		id: 4,
		name: "D",
		forkedFromBranchId: 1,
		forkYear: null,
		forkMonth: null,
		forkDay: null
	},
	// E: off C at Y3 — earlier than both ancestors' cuts, so Y3 cuts all three.
	{
		id: 5,
		name: "E",
		forkedFromBranchId: 3,
		forkYear: 3,
		forkMonth: null,
		forkDay: null
	}
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

/** A cast version on a line (local branch ids, as `CASE_BRANCHES`). */
export interface CaseVersion {
	id: number
	branchId: number | null
	date: StoryDate | null
	personalPosition: number | null
	writeOrder: number
	retiredOrder: number | null
	sourceSessionId: number | null
	sourceMessageId: number | null
	overlayDepth?: number | null
}

export interface CaseVersionReading {
	reader: string
	line: number | null
	sessionCuts: SessionCut[]
	moment: StoryDate | null
	appearance: number | null
	/** Hand-worked: the ids that read (after the appearance filter), ascending. */
	candidates: number[]
	inForce: number | null
}

export interface CaseVersionScenario {
	name: string
	rows: CaseVersion[]
	readings: CaseVersionReading[]
}

// Sessions: P = 101 (the parent), C = 102 (its branch), G = 103 (C's branch),
// C2 = 104 (a later branch of P). Row 1 of a scenario is the member's undated
// base on main unless said otherwise.
const P = 101
const C = 102
const G = 103

/** A version row with the defaults of a plain main row. */
const v = (id: number, rest: Partial<CaseVersion> = {}): CaseVersion => ({
	id,
	branchId: null,
	date: null,
	personalPosition: null,
	writeOrder: id,
	retiredOrder: null,
	sourceSessionId: null,
	sourceMessageId: null,
	...rest
})
const BASE = v(1)
const Y = (year: number): StoryDate => ({ year })

export const CASE_VERSIONS: CaseVersionScenario[] = [
	{
		// P writes after C forked at message 10 / mark 50: C never sees the later rows.
		name: "branch at newest, then write",
		rows: [
			BASE,
			v(2, {
				date: Y(2),
				writeOrder: 30,
				sourceSessionId: P,
				sourceMessageId: 9
			}),
			v(3, {
				date: Y(3),
				writeOrder: 40,
				sourceSessionId: P,
				sourceMessageId: 10
			}),
			// P wrote with no message after the fork: cut by write order alone.
			v(4, { date: Y(3), writeOrder: 55, sourceSessionId: P }),
			// P's next turn: past `through` and past the mark.
			v(5, {
				date: Y(3),
				writeOrder: 60,
				sourceSessionId: P,
				sourceMessageId: 11
			})
		],
		readings: [
			// The source session itself has no cut: every row.
			{
				reader: "P",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 2, 3, 4, 5],
				inForce: 5
			},
			// C reads up to message 10 / mark 50.
			{
				reader: "C",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1, 2, 3],
				inForce: 3
			},
			// The moment cuts by date on top of the session cut.
			{
				reader: "C at Y2",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: Y(2),
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			}
		]
	},
	{
		// Row 2 was retired by a swipe of the fork message; row 3 is the new swipe's write.
		name: "branch, then swipe the fork message",
		rows: [
			BASE,
			v(2, {
				date: Y(3),
				writeOrder: 40,
				retiredOrder: 51,
				sourceSessionId: P,
				sourceMessageId: 10
			}),
			v(3, {
				date: Y(3),
				writeOrder: 52,
				sourceSessionId: P,
				sourceMessageId: 10
			})
		],
		readings: [
			// P sees the live swipe only.
			{
				reader: "P",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 3],
				inForce: 3
			},
			// C forked (mark 50) before the retire (51): it still reads the retired row.
			{
				reader: "C (forked before the swipe)",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			},
			// C2 forked (mark 60) after the retire: the retired row is passed by, the new write reads.
			{
				reader: "C2 (forked after the swipe)",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 60 }],
				moment: null,
				appearance: null,
				candidates: [1, 3],
				inForce: 3
			}
		]
	},
	{
		// An in-place change of message 8's row after C forked: the old row is retired, the changed row is new.
		name: "an in-place change after a branch (retire mark)",
		rows: [
			BASE,
			v(2, {
				date: Y(3),
				writeOrder: 40,
				retiredOrder: 51,
				sourceSessionId: P,
				sourceMessageId: 8
			}),
			v(3, {
				date: Y(3),
				writeOrder: 52,
				sourceSessionId: P,
				sourceMessageId: 8
			})
		],
		readings: [
			{
				reader: "P",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 3],
				inForce: 3
			},
			// C kept the row as it was.
			{
				reader: "C",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			},
			// C went Back past message 8 on its own line: neither row's message is seen.
			{
				reader: "C after its own Back to before message 8",
				line: null,
				sessionCuts: [{ sessionId: P, through: 7, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1],
				inForce: 1
			}
		]
	},
	{
		// P went Back over message 10 (its row is retired) while C still reads it.
		name: "Back while a branch reads the row",
		rows: [
			BASE,
			v(2, {
				date: Y(3),
				writeOrder: 40,
				retiredOrder: 51,
				sourceSessionId: P,
				sourceMessageId: 10
			})
		],
		readings: [
			{
				reader: "P",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1],
				inForce: 1
			},
			{
				reader: "C",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			}
		]
	},
	{
		// Forward cleared the mark: the row reads again for everyone the cuts allow.
		name: "Forward after Back (mark cleared)",
		rows: [
			BASE,
			v(2, {
				date: Y(3),
				writeOrder: 40,
				retiredOrder: null,
				sourceSessionId: P,
				sourceMessageId: 10
			})
		],
		readings: [
			{
				reader: "P",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			},
			{
				reader: "C",
				line: null,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			}
		]
	},
	{
		// One world moment, several life points: the latest row for the asked appearance wins.
		name: "life-point tiers: 34 and 50 at one world moment",
		rows: [
			BASE,
			v(2, { date: Y(10), personalPosition: 34, writeOrder: 2 }),
			v(3, { date: Y(10), personalPosition: 50, writeOrder: 3 }),
			v(4, { date: Y(10), personalPosition: null, writeOrder: 4 }),
			v(5, { date: Y(8), personalPosition: 50, writeOrder: 5 }),
			v(6, { date: Y(10), personalPosition: 50, writeOrder: 6 })
		],
		readings: [
			// No appearance reads every row; the highest write order breaks the tie at the top.
			{
				reader: "Y10, any appearance",
				line: null,
				sessionCuts: [],
				moment: Y(10),
				appearance: null,
				candidates: [1, 2, 3, 4, 5, 6],
				inForce: 6
			},
			// At 50 every row applies; of the Y10 rows pp 50 outranks 34 and none, then write order.
			{
				reader: "Y10, appearance 50",
				line: null,
				sessionCuts: [],
				moment: Y(10),
				appearance: 50,
				candidates: [1, 2, 3, 4, 5, 6],
				inForce: 6
			},
			// At 40 the pp-50 rows drop; pp 34 outranks the world-dated row.
			{
				reader: "Y10, appearance 40",
				line: null,
				sessionCuts: [],
				moment: Y(10),
				appearance: 40,
				candidates: [1, 2, 4],
				inForce: 2
			},
			{
				reader: "Y10, appearance 34",
				line: null,
				sessionCuts: [],
				moment: Y(10),
				appearance: 34,
				candidates: [1, 2, 4],
				inForce: 2
			},
			// At 20 only the world-dated rows remain.
			{
				reader: "Y10, appearance 20",
				line: null,
				sessionCuts: [],
				moment: Y(10),
				appearance: 20,
				candidates: [1, 4],
				inForce: 4
			},
			// Y9: the Y10 rows are in the future; the Y8 row (pp 50) reads at 50 only.
			{
				reader: "Y9, appearance 50",
				line: null,
				sessionCuts: [],
				moment: Y(9),
				appearance: 50,
				candidates: [1, 5],
				inForce: 5
			},
			{
				reader: "Y9, appearance 40",
				line: null,
				sessionCuts: [],
				moment: Y(9),
				appearance: 40,
				candidates: [1],
				inForce: 1
			},
			// The head cuts nothing by moment.
			{
				reader: "head, any appearance",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 2, 3, 4, 5, 6],
				inForce: 6
			}
		]
	},
	{
		// Same date on three lines: the line nearest the reader holds the version in force.
		name: "the nearer holder: line steps nearest first",
		rows: [
			BASE,
			v(2, { date: Y(5), writeOrder: 10 }),
			v(3, { branchId: 2, date: Y(5), writeOrder: 5 }),
			v(4, { branchId: 1, date: Y(5), writeOrder: 3 })
		],
		readings: [
			// Main sees only main's rows.
			{
				reader: "reads main",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			},
			// B holds row 3, nearer than main's row 2 despite its lower write order.
			{
				reader: "reads line B",
				line: 2,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 2, 3],
				inForce: 3
			},
			// C rides A up to Y7 and main up to Y5; A's row 4 is nearer than main's row 2.
			{
				reader: "reads line C",
				line: 3,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 2, 4],
				inForce: 4
			}
		]
	},
	{
		// G (103) reads its attached book on line B, plus its own notes and its ancestors' (C then P).
		name: "the overlay chain",
		rows: [
			BASE,
			v(2, { date: Y(5), writeOrder: 10 }),
			v(3, { branchId: 2, date: Y(5), writeOrder: 11 }),
			v(4, {
				date: Y(5),
				writeOrder: 14,
				sourceSessionId: C,
				sourceMessageId: 20,
				overlayDepth: 1
			}),
			// An edit on G's own notes: a life-point row with no source.
			v(5, {
				date: Y(5),
				personalPosition: 40,
				writeOrder: 13,
				overlayDepth: 0
			}),
			v(6, {
				date: Y(6),
				writeOrder: 15,
				sourceSessionId: C,
				sourceMessageId: 30,
				overlayDepth: 1
			}),
			v(7, {
				date: Y(7),
				writeOrder: 16,
				sourceSessionId: P,
				sourceMessageId: 10,
				overlayDepth: 2
			})
		],
		readings: [
			// Row 6 is past C's `through` 25; row 7 is within P's 15 and 18 mark.
			{
				reader: "G head",
				line: 2,
				sessionCuts: [
					{ sessionId: C, through: 25, mark: 20 },
					{ sessionId: P, through: 15, mark: 18 }
				],
				moment: null,
				appearance: null,
				candidates: [1, 2, 3, 4, 5, 7],
				inForce: 7
			},
			// At Y6 row 7 (Y7) is ahead; the overlay rows beat the line, and G's own (pp 40, depth 0) beats C's.
			{
				reader: "G at Y6",
				line: 2,
				sessionCuts: [
					{ sessionId: C, through: 25, mark: 20 },
					{ sessionId: P, through: 15, mark: 18 }
				],
				moment: Y(6),
				appearance: null,
				candidates: [1, 2, 3, 4, 5],
				inForce: 5
			},
			// At appearance 30 G's own pp-40 row drops: the nearest ancestor's notes outrank the line.
			{
				reader: "G at Y6, appearance 30",
				line: 2,
				sessionCuts: [
					{ sessionId: C, through: 25, mark: 20 },
					{ sessionId: P, through: 15, mark: 18 }
				],
				moment: Y(6),
				appearance: 30,
				candidates: [1, 2, 3, 4],
				inForce: 4
			},
			// Before every dated row only the base reads.
			{
				reader: "G at Y4",
				line: 2,
				sessionCuts: [
					{ sessionId: C, through: 25, mark: 20 },
					{ sessionId: P, through: 15, mark: 18 }
				],
				moment: Y(4),
				appearance: null,
				candidates: [1],
				inForce: 1
			},
			// G went Back past every copied message: ancestor rows with a source message drop; row 5 has no source.
			{
				reader: "G after Back past every copied message",
				line: 2,
				sessionCuts: [
					{ sessionId: C, through: null, mark: 20 },
					{ sessionId: P, through: null, mark: 18 }
				],
				moment: null,
				appearance: null,
				candidates: [1, 2, 3, 5],
				inForce: 5
			}
		]
	},
	{
		// G branched from C before C's first turn (it rides main); P then went Back over message 10 and replayed it; C's first book write forked line B.
		name: "nested branches: a grandchild made before its parent's first turn",
		rows: [
			BASE,
			v(2, {
				date: Y(3),
				writeOrder: 40,
				retiredOrder: 53,
				sourceSessionId: P,
				sourceMessageId: 10
			}),
			v(3, {
				date: Y(3),
				writeOrder: 54,
				sourceSessionId: P,
				sourceMessageId: 10
			}),
			v(4, {
				branchId: 2,
				date: Y(4),
				writeOrder: 55,
				sourceSessionId: C,
				sourceMessageId: 200
			})
		],
		readings: [
			{
				reader: "P",
				line: null,
				sessionCuts: [],
				moment: null,
				appearance: null,
				candidates: [1, 3],
				inForce: 3
			},
			// C forked at mark 50: the retired row 2 still reads, the replay (54) does not; its own line B's row 4 is its own session, uncut.
			{
				reader: "C",
				line: 2,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: null,
				appearance: null,
				candidates: [1, 2, 4],
				inForce: 4
			},
			{
				reader: "C at Y3",
				line: 2,
				sessionCuts: [{ sessionId: P, through: 10, mark: 50 }],
				moment: Y(3),
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			},
			// G rides main with cuts for C (nothing copied) and P: C's line-B row is not on G's line.
			{
				reader: "G",
				line: null,
				sessionCuts: [
					{ sessionId: C, through: null, mark: 52 },
					{ sessionId: P, through: 10, mark: 50 }
				],
				moment: null,
				appearance: null,
				candidates: [1, 2],
				inForce: 2
			}
		]
	}
]

/**
 * Who owns a dated history day on a line (`historyOwnerStep`, rule C, owner
 * 2026-11-10), over `CASE_BRANCHES`: a line owns a day only strictly after its
 * fork date; a dateless fork owns none. Line and owner are line names ("main"
 * or a `CASE_BRANCHES` name).
 */
export const CASE_HISTORY_OWNERS: ReadonlyArray<{
	line: string
	date: StoryDate
	owner: string
}> = [
	{ line: "main", date: { year: 1 }, owner: "main" },
	{ line: "main", date: { year: 99 }, owner: "main" },
	{ line: "A", date: { year: 6 }, owner: "A" },
	{ line: "A", date: { year: 5 }, owner: "main" },
	{ line: "A", date: { year: 4 }, owner: "main" },
	{ line: "A", date: { year: 5, month: 1 }, owner: "A" },
	{ line: "A", date: { year: 5, month: 5, day: 3 }, owner: "A" },
	{ line: "B", date: { year: 9 }, owner: "main" },
	{ line: "B", date: { year: 1 }, owner: "main" },
	{ line: "C", date: { year: 8 }, owner: "C" },
	{ line: "C", date: { year: 7 }, owner: "A" },
	{ line: "C", date: { year: 6 }, owner: "A" },
	{ line: "C", date: { year: 5 }, owner: "main" },
	{ line: "D", date: { year: 9 }, owner: "A" },
	{ line: "D", date: { year: 3 }, owner: "main" },
	{ line: "E", date: { year: 4 }, owner: "E" },
	{ line: "E", date: { year: 3 }, owner: "main" },
	{ line: "E", date: { year: 2 }, owner: "main" }
] as ReadonlyArray<{ line: string; date: StoryDate; owner: string }>
