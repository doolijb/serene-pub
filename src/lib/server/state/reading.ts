/**
 * 🚧 Where a read of a lorebook stands: which LINE, and how far along it.
 *
 * Owner rulings 2026-09-27:
 *
 * - (15) "Start at the most recently used branch, at the head of the
 *   timeline. Add controls for selection/pointing to the session settings
 *   when lorebook is attached."
 * - (16) Reading a branch cuts off main's rows recorded after the fork point —
 *   "Yes, though a pipeline should be able to do some novel/wacky stuff with
 *   custom queries."
 *
 * ## A reading is three things
 *
 * - **the line** — `branchId`, null for main (main is the ABSENCE of a
 *   branch; `project_branches_built_b1_b3`);
 * - **the moment** — a story date on that line, or null for the **head**
 *   (every dated row applies). A session's moment is its **story now**
 *   (DESIGN-story-time P3): its own clock's date (`sessions.story_clock_*`),
 *   else its line's present — the clock the line sets ("Make this the
 *   present"), else the head, which is where a line with no clock stands.
 *   One concept: where the session's story stands is what it reads, what it
 *   writes at (`writeDatingAt`) and what its prompt says the date is;
 * - **the fork cut** — the branch's fork date. Main's dated rows after it do
 *   not reach the branch: past that date the two lines tell different
 *   stories. The same rule `amendmentsAsOf` applies to amendments, by the same
 *   comparator (`compareDates`). A fork made at NOW stores no date and keeps
 *   following main — no cut. A fork of a BRANCH reads through its parent
 *   (owner ruling 5, 2026-09-28): the whole ancestor chain and each step's
 *   cut is `line` — `$lib/shared/lorebooks/lineReading.ts`, the one rule the
 *   workspace applies too, and `./lineSql.ts` its SQL form.
 *
 * ## "Most recently used"
 *
 * **The line of the session on this book that was played most recently** —
 * the session holding the book's newest message (message ids only grow), or,
 * when nothing in the book has been played yet, the newest session on it.
 * Chosen over "the latest write" because a write is not always play: an
 * author correcting a value on main while the story runs on a branch would
 * flip the default back to main, and a pipeline recording onto one line would
 * steer every other reader. A session is the thing that USES a line, and a
 * message is the unit of use. No session at all is main.
 *
 * ## Which rows a reading sees
 *
 * `datedOnReading`: a row on a line outside the chain is never seen; an
 * UNDATED row is always seen — it is "from the beginning", an edit to the
 * base, not a dated change; a dated row on an ancestor (main included) is seen
 * up to the earlier of the moment and that ancestor's fork cut; a dated row
 * on the line itself up to the moment.
 * A row's date is the date of the history entry it hangs from.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import {
	forkDateOf,
	lineOf,
	MAIN_LINE,
	rowReadsOnLine,
	uncutLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import { onLineSql } from "./lineSql"

/** Where a read of a book stands. */
export interface LineReading {
	lorebookId: number
	/** Null is main. */
	branchId: number | null
	/** Null is the head of the timeline. */
	moment: StoryDate | null
	/** The branch's OWN fork date when the fork cut applies; null otherwise. */
	forkedAt: StoryDate | null
	/**
	 * The ancestor chain with every step's cut (`lineOfBook`, or `MAIN_LINE`).
	 * Always given: a branch id alone cannot see a grandparent or a fork cut.
	 */
	line: Line
	/** History entry id → its date, filled as rows are asked about. */
	dates?: Map<number, StoryDate | null>
}

/** How a caller names a line: main, the most recently used one, or a branch id. */
export type BranchPick = "main" | "mostRecent" | number

/** Thrown when a branch is named that is not a branch of the book being read. */
export class BranchRefusal extends Error {}

/** A date a caller handed in, normalized; null when it is not one. */
export function storyDateFrom(raw: unknown): StoryDate | null {
	if (!raw || typeof raw !== "object") return null
	const r = raw as Record<string, unknown>
	if (typeof r.year !== "number" || !Number.isInteger(r.year)) return null
	const month = typeof r.month === "number" && Number.isInteger(r.month) ? r.month : null
	const day = month !== null && typeof r.day === "number" && Number.isInteger(r.day) ? r.day : null
	return { year: r.year, month, day }
}

/**
 * A stored clock's date — a session's, or a line's: null when it stores
 * none. A time of day does not cut — rows are dated by day.
 */
export function momentOf(row: {
	storyClockYear: number | null
	storyClockMonth: number | null
	storyClockDay: number | null
} | null | undefined): StoryDate | null {
	if (!row || row.storyClockYear == null) return null
	return {
		year: row.storyClockYear,
		month: row.storyClockMonth ?? null,
		day: row.storyClockMonth != null ? (row.storyClockDay ?? null) : null
	}
}

/** The most recently used line of a book — see the header. Null is main. */
export async function mostRecentBranchOf(db: Db, lorebookId: number): Promise<number | null> {
	const [played] = await db
		.select({ branchId: schema.sessions.lorebookBranchId })
		.from(schema.sessionMessages)
		.innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionMessages.sessionId))
		.where(eq(schema.sessions.lorebookId, lorebookId))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	if (played) return played.branchId ?? null
	const [newest] = await db
		.select({ branchId: schema.sessions.lorebookBranchId })
		.from(schema.sessions)
		.where(eq(schema.sessions.lorebookId, lorebookId))
		.orderBy(desc(schema.sessions.id))
		.limit(1)
	return newest?.branchId ?? null
}

/**
 * A branch of THIS book and its fork date; refuses one of another book (or
 * none at all) with a sentence — never read as main.
 */
export async function branchOfBook(
	db: Db,
	lorebookId: number,
	branchId: number
): Promise<{ id: number; forkedAt: StoryDate | null }> {
	const [branch] = await db
		.select({
			id: schema.lorebookBranches.id,
			lorebookId: schema.lorebookBranches.lorebookId,
			forkYear: schema.lorebookBranches.forkYear,
			forkMonth: schema.lorebookBranches.forkMonth,
			forkDay: schema.lorebookBranches.forkDay
		})
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.id, branchId))
		.limit(1)
	if (!branch || branch.lorebookId !== lorebookId)
		throw new BranchRefusal(`branch ${branchId} is not a branch of lorebook ${lorebookId}.`)
	return { id: branch.id, forkedAt: forkDateOf(branch) }
}

/**
 * The line a branch of THIS book reads: its ancestor chain, from the book's
 * branches. Main (null) is `MAIN_LINE`. Refuses a branch of another book (or
 * none at all) with a sentence — never read as main.
 */
export async function lineOfBook(
	db: Db,
	lorebookId: number,
	branchId: number | null
): Promise<Line> {
	if (branchId === null) return MAIN_LINE
	const branches = await db
		.select({
			id: schema.lorebookBranches.id,
			forkedFromBranchId: schema.lorebookBranches.forkedFromBranchId,
			forkYear: schema.lorebookBranches.forkYear,
			forkMonth: schema.lorebookBranches.forkMonth,
			forkDay: schema.lorebookBranches.forkDay
		})
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, lorebookId))
	if (!branches.some((b) => b.id === branchId))
		throw new BranchRefusal(`branch ${branchId} is not a branch of lorebook ${lorebookId}.`)
	return lineOf(branchId, branches)
}

/**
 * **Where main is cut for this reading** — the date its documents publish as
 * `forkedAt` (`core:query/lorebook-state@1`, `stat-trail@1`): the EARLIEST
 * fork date along the line's parent chain (main's step of `line`), not the
 * branch's own fork date. A fork of a fork made at year 9, whose parent forked
 * at year 5, reads main only to year 5. Null when nothing cuts main (main
 * itself, a fork at now, `forkCut: false`).
 */
export function mainCutOf(reading: Pick<LineReading, "line">): StoryDate | null {
	const steps = reading.line.steps
	const last = steps[steps.length - 1]
	return last && last.branchId === null ? last.cut : null
}

/**
 * Build a reading. `branch` absent takes `fallback` (a session's own line);
 * `forkCut: false` lets all of main through — a pipeline reading main's whole
 * line from a branch.
 */
export async function readingOf(
	db: Db,
	lorebookId: number,
	pick: {
		branch?: BranchPick | null
		moment?: StoryDate | null
		forkCut?: boolean
	} = {}
): Promise<LineReading> {
	const branch = pick.branch ?? "main"
	const branchId =
		branch === "main" ? null : branch === "mostRecent" ? await mostRecentBranchOf(db, lorebookId) : branch
	let forkedAt: StoryDate | null = null
	let line: Line = MAIN_LINE
	if (branchId !== null) {
		const found = await branchOfBook(db, lorebookId, branchId)
		line = await lineOfBook(db, lorebookId, branchId)
		if (pick.forkCut !== false) forkedAt = found.forkedAt
		else line = uncutLine(line)
	}
	return { lorebookId, branchId, moment: pick.moment ?? null, forkedAt, line }
}

/** The reading a session stands at: its line and its clock, fork cut on. */
export async function sessionReadingOf(db: Db, sessionId: number): Promise<LineReading | null> {
	const [session] = await db
		.select({
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session?.lorebookId) return null
	const own = momentOf(session)
	try {
		const reading = await readingOf(db, session.lorebookId, {
			branch: session.lorebookBranchId ?? "main",
			moment: own
		})
		// Following its line: the line's present when the line sets one.
		if (!own) reading.moment = await linePresentOf(db, session.lorebookId, reading.branchId)
		return reading
	} catch (e) {
		// A stale branch id (it cannot be another book's: the handler checks,
		// and deleting a branch moves its sessions to the line it left) reads
		// main rather than failing a turn.
		if (e instanceof BranchRefusal)
			return {
				lorebookId: session.lorebookId,
				branchId: null,
				moment: own ?? (await linePresentOf(db, session.lorebookId, null)),
				forkedAt: null,
				line: MAIN_LINE
			}
		throw e
	}
}

/**
 * A line's **present** as a moment: the clock the line sets — main's on the
 * book, a branch's on the branch (a branch never stands at main's present) —
 * or null, the head, when it sets none: with no clock a line stands at its
 * newest entry, and the head reads exactly that.
 */
async function linePresentOf(db: Db, lorebookId: number, branchId: number | null): Promise<StoryDate | null> {
	const clock = {
		storyClockYear: schema.lorebooks.storyClockYear,
		storyClockMonth: schema.lorebooks.storyClockMonth,
		storyClockDay: schema.lorebooks.storyClockDay
	}
	const [row] =
		branchId == null
			? await db.select(clock).from(schema.lorebooks).where(eq(schema.lorebooks.id, lorebookId)).limit(1)
			: await db
					.select({
						storyClockYear: schema.lorebookBranches.storyClockYear,
						storyClockMonth: schema.lorebookBranches.storyClockMonth,
						storyClockDay: schema.lorebookBranches.storyClockDay
					})
					.from(schema.lorebookBranches)
					.where(eq(schema.lorebookBranches.id, branchId))
					.limit(1)
	return momentOf(row)
}

/** The chain a reading reads. */
export function lineOfReading(reading: Pick<LineReading, "line">): Line {
	return reading.line
}

/**
 * Whether a row dated `date` (null = undated) on `branchId` is seen by the
 * reading — `rowReadsOnLine`, the shared rule, at the reading's moment.
 */
export function datedOnReading(
	row: { branchId?: number | null },
	date: StoryDate | null,
	reading: Pick<LineReading, "branchId" | "moment" | "forkedAt" | "line">
): boolean {
	return rowReadsOnLine(row, lineOfReading(reading), date, reading.moment)
}

/**
 * A history entry's date from its fields; null when it carries none.
 *
 * Only a JSON number counts as a part, exactly as the SQL that cuts a reading
 * does (`historyDateColumns`, lineSql.ts): a legacy row whose year is the
 * string "1200" is undated on both sides, never counted toward the present by
 * this reader while retrieval leaves it uncut.
 */
export function historyEntryDate(fields: unknown): StoryDate | null {
	const f = (fields ?? {}) as Record<string, unknown>
	const part = (v: unknown) =>
		typeof v === "number" && Number.isFinite(v) ? v : null
	const year = part(f.year)
	if (year === null) return null
	return { year, month: part(f.month), day: part(f.day) }
}

/** A history entry, and the story date it carries. */
export interface StoryDating {
	historyEntryId: number
	date: StoryDate
}

/**
 * **The dating a write made at this reading carries** (plan A22, ruled
 * 2026-09-30): the LATEST dated history entry the reading sees — on its
 * line, at or before its moment, main's cut at each fork — or null when it
 * sees none. A session's reading stands at its story now
 * (`sessionReadingOf`): its own clock, else its line's present. At the head
 * (moment null) that is the line's newest dated entry. Two entries on one
 * date: the lower id.
 *
 * Null — undated, "from the beginning" — is also what a write made BEFORE
 * the line's first dated entry gets: a dating hangs from a history entry, and
 * there is none that early. Such a write reads on every line that reads this
 * one's undated rows (an owner question, plan A22 review).
 *
 * A row filed here is in force at the reading, and from that date on: dated
 * rows order by story date, undated earliest (`resolve.ts inForce`), so a
 * session write left undated would sit under every dated value the author
 * wrote and never be read — the defect this closes. Which entries count is
 * `datedOnReading`, the rule every dated row is read by.
 *
 * The one dating helper. A session's durable writes (`write.ts`, `durable.ts`)
 * take it whole; a place's stats (`placeStats.ts`, L4) take it only when it
 * falls exactly on the moment being read, and otherwise keep the date of the
 * value they change — authoring at now edits the value in force, from its
 * own date.
 */
export async function writeDatingAt(db: Db, reading: LineReading): Promise<StoryDating | null> {
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			branchId: schema.lorebookEntries.branchId,
			fields: schema.lorebookEntries.fields
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, reading.lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID),
				onLineSql(schema.lorebookEntries.branchId, lineOfReading(reading))
			)
		)
		.orderBy(asc(schema.lorebookEntries.id))
	let best: StoryDating | null = null
	for (const row of rows) {
		const date = historyEntryDate(row.fields)
		if (!date || !datedOnReading(row, date, reading)) continue
		if (!best || compareDates(date, best.date) > 0) best = { historyEntryId: row.id, date }
	}
	return best
}

/** Load (and cache on the reading) the dates of these history entries. */
export async function loadEntryDates(
	db: Db,
	reading: LineReading,
	entryIds: Iterable<number>
): Promise<Map<number, StoryDate | null>> {
	const dates = (reading.dates ??= new Map())
	const missing = [...new Set(entryIds)].filter((id) => !dates.has(id))
	if (missing.length) {
		for (const e of await db
			.select({ id: schema.lorebookEntries.id, fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(
				and(
					inArray(schema.lorebookEntries.id, missing),
					eq(schema.lorebookEntries.lorebookId, reading.lorebookId)
				)
			))
			dates.set(e.id, historyEntryDate(e.fields))
		// An entry of another book, or a deleted one, dates nothing.
		for (const id of missing) if (!dates.has(id)) dates.set(id, null)
	}
	return dates
}

/**
 * The durable rows the reading sees (see the header). Rows that belong to a
 * session (`sessionId` set) are passed through untouched — a session's own
 * rows are its own, not an inheritance.
 *
 * Leaves every dated row's date on `reading.dates`, cuts or none: which of
 * several rows is in force is decided by their dates (`resolve.ts inForce`),
 * at the head as much as at a moment.
 */
export async function rowsOnReading<
	T extends { branchId?: number | null; historyEntryId?: number | null; sessionId?: number | null }
>(db: Db, rows: T[], reading: LineReading): Promise<T[]> {
	const durable = rows.filter((r) => r.sessionId == null)
	const dates = await loadEntryDates(
		db,
		reading,
		durable.map((r) => r.historyEntryId).filter((id): id is number => id != null)
	)
	return rows.filter(
		(r) =>
			r.sessionId != null ||
			datedOnReading(r, r.historyEntryId != null ? (dates.get(r.historyEntryId) ?? null) : null, reading)
	)
}
