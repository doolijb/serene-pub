/**
 * A lorebook's story time: its declared calendar and its clock.
 *
 * Design of record `~/.claude/plans/DESIGN-story-time.md` — P5 (the calendar
 * editor and its preflight) and the lorebook clock (§3: "the clock must be
 * stored").
 *
 * ## What is stored where
 *
 * - `lorebooks.story_calendar` — the declared `StoryCalendar`, or NULL for
 *   **free-form**, the bottom rung and every book's default.
 * - `lorebooks.story_clock_*` — main's clock.
 * - `lorebook_branches.story_clock_*` — each branch's own clock.
 * - `sessions.story_clock_*` — each **session's** own clock (P3, 2026-09-28):
 *   the session's story now. NULL follows its line's present.
 *
 * ## The story's now
 *
 * The line's stored clock when it has one; otherwise the newest history entry
 * the line can see (`onLine`), which is exactly what the present always was —
 * and on a branch, main's entries only up to its fork date (ruling 16,
 * `state/reading.ts`). That is the **book's present** on the line.
 *
 * A session with a clock of its own stands there instead (§4c: "the clock
 * settles onto the session"). Attaching a book stores no clock: the session
 * follows its line's present until the owner sets or steps its clock in the
 * settings, or a pipeline advances it — and that first move starts FROM the
 * line's present (owner, 2026-09-28). Moving it NEVER moves the book's
 * present: a time-travelling session must not drag the line's present back
 * for every other session on it.
 *
 * ⚠ The book's present is NOT derived from its sessions' clocks (§3's
 * recommendation predates the stored line clock, P5): that would let one
 * session's advance move the present every other reader sees.
 *
 * ⚠ **A branch never inherits main's clock.** Main may have moved past the
 * fork; a branch standing at main's present would stand at a date its own line
 * never reached. With no clock of its own it reads its newest visible entry,
 * as before.
 *
 * ⚠ **The clock is a reading, not a gate.** Resolution is unchanged (ruled
 * 2026-09-24, §7): "now" still applies every dated amendment. The clock is what
 * `age` is measured against and what the prompt's current date says.
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { datedOnReading, lineOfBook, sessionReadingOf } from "$lib/server/state/reading"
import { lineFromFork, MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import {
	advanceStoryTime,
	compareDates,
	dateProblem,
	formatDate,
	readStoryCalendar,
	type DatedRow,
	type StoryCalendar,
	type StoryClock,
	type StoryDate,
	type StoryTimeUnit
} from "$lib/shared/lorebooks/storyDate"

/** The story's present, with where it came from. */
export interface StoryNow {
	year: number
	month?: number
	day?: number
	hour?: number
	minute?: number
	/**
	 * `clock` = the line's stored clock; `history` = its newest history entry;
	 * `session` = the session's own clock (P3).
	 */
	from: "clock" | "history" | "session"
	/** Spelled through the book's calendar — present only when one is declared. */
	label?: string
}

interface ClockColumns {
	storyClockYear: number | null
	storyClockMonth: number | null
	storyClockDay: number | null
	storyClockHour: number | null
	storyClockMinute: number | null
}

/** The clock a row stores (a book, a line or a session), or null when it stores none. */
export function clockOf(row: ClockColumns | null | undefined): StoryClock | null {
	if (!row || row.storyClockYear == null) return null
	return {
		year: row.storyClockYear,
		month: row.storyClockMonth,
		day: row.storyClockDay,
		hour: row.storyClockHour,
		minute: row.storyClockMinute
	}
}

/** A clock as the columns that store it; `null` clears all five. */
export function clockColumns(clock: StoryClock | null): ClockColumns {
	return {
		storyClockYear: clock?.year ?? null,
		storyClockMonth: clock?.month ?? null,
		storyClockDay: clock?.month != null ? (clock?.day ?? null) : null,
		storyClockHour: clock?.hour ?? null,
		storyClockMinute: clock?.hour != null ? (clock?.minute ?? 0) : null
	}
}

/**
 * What is wrong with a clock value before it is stored, or null.
 *
 * The date must land in the book's calendar (free-form takes any positive
 * parts); a time of day is 24-hour, and a minute needs an hour.
 */
export function clockProblem(
	clock: StoryClock,
	calendar: StoryCalendar | null
): string | null {
	if (!Number.isInteger(clock.year)) return "The clock needs a whole year."
	if (clock.day != null && clock.month == null)
		return "The clock's day needs a month."
	const problem = dateProblem(clock, calendar)
	if (problem) return problem
	if (clock.hour != null) {
		if (!Number.isInteger(clock.hour) || clock.hour < 0 || clock.hour > 23)
			return "An hour is 0 to 23."
		const minute = clock.minute ?? 0
		if (!Number.isInteger(minute) || minute < 0 || minute > 59)
			return "A minute is 0 to 59."
	} else if (clock.minute != null) return "A minute needs an hour."
	return null
}

/** The book's declared calendar, or null for free-form (or no such book). */
export async function bookCalendarOf(
	db: Db,
	lorebookId: number
): Promise<StoryCalendar | null> {
	const [row] = await db
		.select({ storyCalendar: schema.lorebooks.storyCalendar })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	return readStoryCalendar(row?.storyCalendar ?? null)
}

/**
 * Refuses a date the book's calendar cannot place — the "validated at entry"
 * half of the preflight (§0): once a calendar is declared, every dated write
 * passes through here, so the preflight list can never refill.
 *
 * Throws with the calendar's own sentence; a no-op in a free-form book beyond
 * the shape rules every date already had.
 */
export async function assertDateLands(
	db: Db,
	lorebookId: number,
	date: StoryDate | null | undefined,
	what = "That date"
): Promise<void> {
	if (!date || date.year == null) return
	const calendar = await bookCalendarOf(db, lorebookId)
	if (!calendar) return
	const problem = dateProblem(date, calendar)
	if (problem) throw new Error(`${what} does not fit this book's calendar: ${problem}`)
}

/** The book's whole story time, as the wire carries it. */
export interface BookStoryTime {
	lorebookId: number
	calendar: StoryCalendar | null
	clocks: {
		main: StoryClock | null
		branches: { branchId: number; clock: StoryClock | null }[]
	}
}

export async function readBookStoryTime(
	db: Db,
	lorebookId: number
): Promise<BookStoryTime> {
	const [book] = await db
		.select({
			storyCalendar: schema.lorebooks.storyCalendar,
			storyClockYear: schema.lorebooks.storyClockYear,
			storyClockMonth: schema.lorebooks.storyClockMonth,
			storyClockDay: schema.lorebooks.storyClockDay,
			storyClockHour: schema.lorebooks.storyClockHour,
			storyClockMinute: schema.lorebooks.storyClockMinute
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	const branches = await db
		.select({
			id: schema.lorebookBranches.id,
			storyClockYear: schema.lorebookBranches.storyClockYear,
			storyClockMonth: schema.lorebookBranches.storyClockMonth,
			storyClockDay: schema.lorebookBranches.storyClockDay,
			storyClockHour: schema.lorebookBranches.storyClockHour,
			storyClockMinute: schema.lorebookBranches.storyClockMinute
		})
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, lorebookId))
	return {
		lorebookId,
		calendar: readStoryCalendar(book?.storyCalendar ?? null),
		clocks: {
			main: clockOf(book),
			branches: branches.map((b) => ({ branchId: b.id, clock: clockOf(b) }))
		}
	}
}

/** A history entry's date, from its `fields`; null when it carries none. */
function historyDate(fields: unknown): StoryDate | null {
	const f = (fields ?? {}) as Record<string, unknown>
	const year = Number(f.year)
	if (f.year == null || !Number.isFinite(year)) return null
	const month = f.month != null && Number.isFinite(Number(f.month)) ? Number(f.month) : null
	const day = f.day != null && Number.isFinite(Number(f.day)) ? Number(f.day) : null
	return { year, month, day }
}

/**
 * **The story's now** on one line of one book: the line's stored clock, else
 * the newest history entry the line can see, else null.
 *
 * `branchId` null is main. The label is set only when the book declares a
 * calendar — free-form callers keep spelling the parts as they always have.
 */
export async function storyNowOf(
	db: Db,
	lorebookId: number | null,
	branchId: number | null = null,
	/**
	 * `sessionStoryClock`: a session with a clock of its own stands there — it IS
	 * the session's story now (P3). `forkedAt`: main's history entries after
	 * the fork are not the branch's past (ruling 16); omitted, it is read from
	 * the branch; `null` lets all of main through.
	 */
	opts: {
		sessionStoryClock?: StoryClock | null
		forkedAt?: StoryDate | null
		/** The ancestor chain (ruling 5); wins over `forkedAt` when given. */
		line?: Line | null
	} = {}
): Promise<StoryNow | null> {
	if (!lorebookId) return null
	const time = await readBookStoryTime(db, lorebookId)
	const clock =
		branchId == null
			? time.clocks.main
			: (time.clocks.branches.find((b) => b.branchId === branchId)?.clock ??
				null)
	let now: StoryNow | null = null
	if (opts.sessionStoryClock) now = nowOfClock(opts.sessionStoryClock, "session")
	else if (clock) now = nowOfClock(clock, "clock")
	else {
		const rows = await db
			.select({
				fields: schema.lorebookEntries.fields,
				branchId: schema.lorebookEntries.branchId
			})
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
		// The chain: given, or read from the book's branches (a fork of a
		// branch reads through its parent — ruling 5); an explicit
		// `forkedAt` alone is a one-level line.
		const line: Line =
			opts.line ??
			(branchId == null
				? MAIN_LINE
				: opts.forkedAt !== undefined
					? lineFromFork(branchId, opts.forkedAt)
					: await lineOfBook(db, lorebookId, branchId).catch(() =>
							lineFromFork(branchId, null)
						))
		const reading = { branchId, moment: null, forkedAt: null, line }
		let best: StoryDate | null = null
		for (const row of rows) {
			const date = historyDate(row.fields)
			if (!datedOnReading(row, date, reading)) continue
			if (date && (!best || compareDates(date, best) > 0)) best = date
		}
		if (best) {
			now = { year: best.year, from: "history" }
			if (best.month != null) now.month = best.month
			if (best.day != null) now.day = best.day
		}
	}
	if (now && time.calendar) now.label = formatDate(now, time.calendar)
	return now
}

function nowOfClock(clock: StoryClock, from: "clock" | "session"): StoryNow {
	const now: StoryNow = { year: clock.year, from }
	if (clock.month != null) now.month = clock.month
	if (clock.month != null && clock.day != null) now.day = clock.day
	if (clock.hour != null) {
		now.hour = clock.hour
		now.minute = clock.minute ?? 0
	}
	return now
}

/** A story now as the clock that would store it — `from` and `label` dropped. */
export function clockOfNow(now: StoryNow): StoryClock {
	return {
		year: now.year,
		month: now.month ?? null,
		day: now.day ?? null,
		hour: now.hour ?? null,
		minute: now.hour != null ? (now.minute ?? 0) : null
	}
}

/** The session row's clock columns and where it reads its book. */
async function sessionStoryClockRow(db: Db, sessionId: number) {
	const [row] = await db
		.select({
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row ?? null
}

/**
 * **A session's story now** (P3): its own clock when it has one, else its
 * line's present — on its line, with the fork cut. Null with no book, or a
 * book with no present. What the prompt's `currentDate` reads.
 */
export async function sessionStoryNowOf(db: Db, sessionId: number): Promise<StoryNow | null> {
	const row = await sessionStoryClockRow(db, sessionId)
	if (!row?.lorebookId) return null
	const reading = await sessionReadingOf(db, sessionId)
	return storyNowOf(db, row.lorebookId, reading?.branchId ?? null, {
		sessionStoryClock: clockOf(row),
		forkedAt: reading?.forkedAt ?? null,
		line: reading?.line ?? null
	})
}

/** A refusal to move a session's clock, as a sentence a person can read. */
export class StoryClockRefusal extends Error {}

/**
 * **Advance a session's story clock** by `by` of `unit` (§5 `advance(n, unit)`):
 * through the book's calendar, by the smallest-part rule in a free-form book
 * (`advanceStoryTime`). A session with no clock of its own starts from its
 * line's present. Writes the session's clock only — never the book's.
 *
 * Throws `StoryClockRefusal` — and writes nothing — with no book, no present
 * to start from, or a result that does not land.
 */
export async function advanceSessionStoryClock(
	db: Db,
	sessionId: number,
	by: number,
	unit: StoryTimeUnit
): Promise<{ clock: StoryClock; label: string; from: StoryClock }> {
	const row = await sessionStoryClockRow(db, sessionId)
	if (!row) throw new StoryClockRefusal(`There is no session ${sessionId}.`)
	if (!row.lorebookId)
		throw new StoryClockRefusal("This session has no lorebook, so it has no story clock to advance.")
	const start = clockOf(row) ?? (await sessionStoryNowOf(db, sessionId).then((n) => (n ? clockOfNow(n) : null)))
	if (!start)
		throw new StoryClockRefusal(
			"This session's lorebook has no present to start from: nothing on its line is dated and no clock is set. Set the session's story clock first."
		)
	const calendar = await bookCalendarOf(db, row.lorebookId)
	const moved = advanceStoryTime(start, by, unit, calendar)
	if (moved.problem !== undefined) throw new StoryClockRefusal(moved.problem)
	const clock: StoryClock = {
		year: moved.time.year,
		month: moved.time.month ?? null,
		day: moved.time.day ?? null,
		hour: moved.time.hour ?? null,
		minute: moved.time.minute ?? null
	}
	await db.update(schema.sessions).set(clockColumns(clock)).where(eq(schema.sessions.id, sessionId))
	return { clock: compactClock(clock), label: formatDate(clock, calendar), from: compactClock(start) }
}

/** A clock with only the parts it has — what a port carries. */
function compactClock(clock: StoryClock): StoryClock {
	const out: StoryClock = { year: clock.year }
	if (clock.month != null) out.month = clock.month
	if (clock.month != null && clock.day != null) out.day = clock.day
	if (clock.hour != null) {
		out.hour = clock.hour
		out.minute = clock.minute ?? 0
	}
	return out
}

/**
 * Every dated row in the book, named — what the preflight projects through a
 * proposed calendar. Five tables and the clocks: history entries, both
 * amendment tables, branch fork dates, presences (both ends).
 */
export async function datedRowsOf(
	db: Db,
	lorebookId: number
): Promise<DatedRow[]> {
	const out: DatedRow[] = []
	const entries = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			typeId: schema.lorebookEntries.typeId,
			fields: schema.lorebookEntries.fields
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	const titleOf = new Map(entries.map((e) => [e.id, e.title ?? ""]))
	for (const e of entries) {
		if (e.typeId !== HISTORY_TYPE_ID) continue
		const date = historyDate(e.fields)
		if (date)
			out.push({
				key: `entry:${e.id}`,
				label: `History entry${e.title ? ` “${e.title}”` : ""}`,
				...date
			})
	}
	const entryAmendments = await db
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.lorebookId, lorebookId))
	for (const a of entryAmendments)
		out.push({
			key: `entryAmendment:${a.id}`,
			label: `Amendment to “${titleOf.get(a.entryId) || `entry ${a.entryId}`}”`,
			year: a.year,
			month: a.month,
			day: a.day
		})
	const members = await db
		.select({ id: schema.lorebookBindings.id, name: schema.lorebookBindings.name })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const nameOf = new Map(members.map((m) => [m.id, m.name ?? ""]))
	const castAmendments = await db
		.select()
		.from(schema.castAmendments)
		.where(eq(schema.castAmendments.lorebookId, lorebookId))
	for (const a of castAmendments)
		out.push({
			key: `castAmendment:${a.id}`,
			label: `Amendment to ${nameOf.get(a.lorebookBindingId) || "a cast member"}`,
			year: a.year,
			month: a.month,
			day: a.day
		})
	const presences = await db
		.select()
		.from(schema.castPresences)
		.where(eq(schema.castPresences.lorebookId, lorebookId))
	for (const p of presences) {
		const who = nameOf.get(p.lorebookBindingId) || "a cast member"
		out.push({
			key: `presence:${p.id}:from`,
			label: `${who} arrives`,
			year: p.fromYear,
			month: p.fromMonth,
			day: p.fromDay
		})
		if (p.untilYear != null)
			out.push({
				key: `presence:${p.id}:until`,
				label: `${who} leaves`,
				year: p.untilYear,
				month: p.untilMonth,
				day: p.untilDay
			})
	}
	const branches = await db
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, lorebookId))
	for (const b of branches) {
		if (b.forkYear != null)
			out.push({
				key: `fork:${b.id}`,
				label: `Where “${b.name}” forked`,
				year: b.forkYear,
				month: b.forkMonth,
				day: b.forkDay
			})
		const clock = clockOf(b)
		if (clock)
			out.push({ key: `clock:${b.id}`, label: `The clock on “${b.name}”`, ...clock })
	}
	const time = await readBookStoryTime(db, lorebookId)
	if (time.clocks.main)
		out.push({ key: "clock:main", label: "The clock on main", ...time.clocks.main })
	// Each session's own clock (P3): a calendar that strands one would leave
	// that session standing on a date the book cannot name.
	const sessions = await db
		.select({
			id: schema.sessions.id,
			name: schema.sessions.name,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.lorebookId, lorebookId))
	for (const s of sessions) {
		const clock = clockOf(s)
		if (clock)
			out.push({
				key: `sessionStoryClock:${s.id}`,
				label: `The story clock of the session “${s.name || `#${s.id}`}”`,
				...clock
			})
	}
	return out
}
