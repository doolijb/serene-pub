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
 * the line can see (`rowReadsOnLine`), which is exactly what the present always was —
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
import type { ClockTargetV1 } from "@serene-pub/contracts"
import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm"
import { getAttributeSlot, i18nText, parseStoryTime, slotField } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { attachedOrOwnBookOf, ownBookOf } from "$lib/server/lorebooks/ownBook"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import {
	datedOnReading,
	historyEntryDate,
	lineOfBook,
	sessionReadingOf
} from "$lib/server/state/reading"
import { MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import { memberFormOn } from "$lib/server/state/memberForm"
import {
	advanceStoryTime,
	compareDates,
	dateProblem,
	clockSpanWords,
	datesThatDoNotLand,
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
 * The one story-time rule every dated writer answers with (`dateProblem` →
 * the SDK's `storyTimeProblem`): whole parts in `STORY_TIME_PART_RANGES` — a
 * 24-hour time of day included — a day only beside a month and a minute only
 * beside an hour, and then the book's calendar. No clock-only copy of any of
 * it, so a clock and a dated entry can never disagree about one date.
 */
export function clockProblem(
	clock: StoryClock,
	calendar: StoryCalendar | null
): string | null {
	return dateProblem(clock, calendar)
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
 * The book's write lock, taken inside `tx` — the
 * `pg_advisory_xact_lock(lorebookId)` the book's other writes share — so a
 * calendar change and a dated write never interleave (plan A18(d)). A dated
 * write takes it, checks its date (`assertDateLands`) and writes its row in
 * one transaction; `lorebooks:setCalendar` takes it, checks every dated row
 * (`datedRowsOf`) and writes the calendar in one. Checked apart from its
 * write, a date could pass the old calendar while the new one is declared
 * over a book that does not hold it yet.
 */
export async function lockBookCalendar(tx: Db, lorebookId: number): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
}

/**
 * Refuses a date the book's calendar cannot place — the "validated at entry"
 * half of the preflight (§0): once a calendar is declared, every dated write
 * passes through here, so the preflight list can never refill.
 *
 * Throws with the calendar's own sentence. A free-form book is held to the
 * rule every rung shares (`storyTimeProblem`: a whole year, a month and a day
 * of 1 or more with no ceiling, a day only beside a month) — refused here
 * first so a person reads a sentence rather than a constraint error (A15).
 * The handlers that call this are `refusable`, so the sentence reaches them
 * as their `:error` rather than the socket's generic one. A writer calls it
 * inside the transaction that writes the row, after `lockBookCalendar`.
 */
export async function assertDateLands(
	db: Db,
	lorebookId: number,
	date: StoryDate | null | undefined,
	what = "That date"
): Promise<void> {
	if (!date || date.year == null) return
	const calendar = await bookCalendarOf(db, lorebookId)
	const problem = dateProblem(date, calendar)
	if (!problem) return
	throw new Error(
		calendar
			? `${what} does not fit this book's calendar: ${problem}`
			: `${what} can't be saved: ${problem}`
	)
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

/** A history entry's date, from its `fields` (`historyEntryDate`: JSON numbers only). */
const historyDate = historyEntryDate

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
	 * the session's story now (P3). `line`: the reading's chain (ruling 5) —
	 * main's history entries after the fork are not the branch's past (ruling
	 * 16); omitted, it is read from the book's branches.
	 */
	opts: {
		sessionStoryClock?: StoryClock | null
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
		// branch reads through its parent — ruling 5). A line the book does
		// not have is refused (`BranchRefusal`): a present read off the wrong
		// line is worse than none.
		const line: Line =
			opts.line ??
			(branchId == null ? MAIN_LINE : await lineOfBook(db, lorebookId, branchId))
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
	if (!row) return null
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const book = row.lorebookId ?? (await ownBookOf(db, sessionId))?.id ?? null
	if (book == null) return null
	const reading = await sessionReadingOf(db, sessionId)
	return storyNowOf(db, book, reading?.branchId ?? null, {
		sessionStoryClock: clockOf(row),
		line: reading?.line ?? null
	})
}

/** 🚧 Where a clock starts when its story has neither a clock nor a present: Year 1, month 1, day 1, 00:00. */
const FIRST_STORY_DAY: StoryClock = { year: 1, month: 1, day: 1, hour: 0, minute: 0 }

/** A refusal to move a session's clock, as a sentence a person can read. */
export class StoryClockRefusal extends Error {}

/**
 * **Advance a session's story clock** by `by` of `unit` (§5 `advance(n, unit)`):
 * through the book's calendar, by the smallest-part rule in a free-form book
 * (`advanceStoryTime`). A session with no clock of its own starts from its
 * line's present; a story with neither a clock nor a present starts on its
 * first day (`FIRST_STORY_DAY`) and the clock is stored. Writes the session's
 * clock only — never the book's.
 *
 * Throws `StoryClockRefusal` — and writes nothing — with no session or a
 * result that does not land.
 */
export async function advanceSessionStoryClock(
	db: Db,
	sessionId: number,
	by: number,
	unit: StoryTimeUnit
): Promise<{ clock: StoryClock; label: string; from: StoryClock }> {
	const done = await moveSessionStoryClock(db, sessionId, () => ({ by, unit }))
	return { clock: done.clock, label: done.label, from: done.from }
}

/**
 * **Move a session's story clock to a moment of the day** (M0, lane T1;
 * `advance-story-clock@1`'s `to`): `to` is read against the clock's start
 * INSIDE the transaction — never a pre-read — and the move is by the
 * minutes between them, so it is one ledger move that Back takes back.
 * `next` (the default) is the coming `hour:minute`, tomorrow's when today's
 * has passed; `tomorrow` is always tomorrow's; `today` is a no-op (`by: 0`, nothing
 * written) when the clock stands at the moment and refused with a sentence when it is past it. A clock with
 * no time of day reads as 00:00. Same refusals and locks as
 * `advanceSessionStoryClock`. A story with no clock and no present starts on
 * its first day (`FIRST_STORY_DAY`) and the clock is stored, as any later move
 * from a present stores it (M1 E-fix T-4: a genre's create move set no clock,
 * and every later move began from a dated entry's 00:00 instead); a move by an
 * amount starts it the same way.
 */
export async function advanceSessionStoryClockTo(
	db: Db,
	sessionId: number,
	to: ClockTargetV1
): Promise<{ clock: StoryClock; label: string; from: StoryClock; by: number; unit: "minutes" }> {
	const done = await moveSessionStoryClock(db, sessionId, (start) => {
		const now = (start.hour ?? 0) * 60 + (start.minute ?? 0)
		const target = to.hour * 60 + (to.minute ?? 0)
		const d = target - now
		const day = to.day ?? "next"
		let by: number
		if (day === "tomorrow") by = d + 1440
		else if (day === "today") {
			if (d === 0) return { by: 0, unit: "minutes", noop: true }
			if (d < 0) {
				const two = (n: number) => String(n).padStart(2, "0")
				throw new StoryClockRefusal(
					`The clock already stands at or past ${two(to.hour)}:${two(to.minute ?? 0)} today, and a clock target never moves it back.`
				)
			}
			by = d
		} else by = d > 0 ? d : d + 1440
		return { by, unit: "minutes" }
	})
	return { ...done, unit: "minutes" }
}

/**
 * Where a session's clock move starts: its own clock, else its line's present,
 * else the story's first day. `present` is null when the first day is the
 * start, so the caller knows the story had no clock. The one reader: the move
 * itself and the dry run (`clockMoveProblem`) both ask here.
 */
export async function storyMoveStartOf(
	db: Db,
	sessionId: number,
	row: ClockColumns
): Promise<{ start: StoryClock; present: StoryClock | null }> {
	const present =
		clockOf(row) ?? (await sessionStoryNowOf(db, sessionId).then((n) => (n ? clockOfNow(n) : null)))
	return { start: present ?? FIRST_STORY_DAY, present }
}

async function moveSessionStoryClock(
	db: Db,
	sessionId: number,
	step: (start: StoryClock) => { by: number; unit: StoryTimeUnit; noop?: boolean }
): Promise<{ clock: StoryClock; label: string; from: StoryClock; by: number; unit: StoryTimeUnit }> {
	const found = await sessionStoryClockRow(db, sessionId)
	if (!found) throw new StoryClockRefusal(`There is no session ${sessionId}.`)
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const lorebookId = found.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (lorebookId == null) throw new StoryClockRefusal(`There is no session ${sessionId}.`)
	// Read, stepped through the calendar and written under the book's lock
	// (`lockBookCalendar`, A18(d)), as every dated write is — and the
	// session's row locked with it. Read apart from the write, two advances
	// each stepped from the same start and the second wrote over the first:
	// two days forward landed one.
	return await db.transaction(async (tx) => {
		await lockBookCalendar(tx, lorebookId)
		await tx.execute(
			sql`select 1 from ${schema.sessions} where ${schema.sessions.id} = ${sessionId} for update`
		)
		const row = await sessionStoryClockRow(tx, sessionId)
		if (!row) throw new StoryClockRefusal(`There is no session ${sessionId}.`)
		if ((row.lorebookId ?? (await ownBookOf(tx, sessionId))?.id ?? null) !== lorebookId)
			throw new StoryClockRefusal(
				"This session's lorebook changed while its clock was being advanced. Try again."
			)
		const { start, present } = await storyMoveStartOf(tx, sessionId, row)
		const calendar = await bookCalendarOf(tx, lorebookId)
		const planned = step(compactClock(start))
		// 🚧 A `to` move that does not move (`today` at this very minute): nothing written.
		if (planned.noop) {
			// … but a clock that starts here is stored: the story has one from now on.
			if (!present) await tx.update(schema.sessions).set(clockColumns(start)).where(eq(schema.sessions.id, sessionId))
			return { clock: compactClock(start), label: formatDate(start, calendar), from: compactClock(start), by: 0, unit: planned.unit }
		}
		const { by, unit } = planned
		const moved = advanceStoryTime(start, by, unit, calendar)
		if (moved.problem !== undefined) throw new StoryClockRefusal(moved.problem)
		const clock: StoryClock = {
			year: moved.time.year,
			month: moved.time.month ?? null,
			day: moved.time.day ?? null,
			hour: moved.time.hour ?? null,
			minute: moved.time.minute ?? null
		}
		await tx.update(schema.sessions).set(clockColumns(clock)).where(eq(schema.sessions.id, sessionId))
		return { clock: compactClock(clock), label: formatDate(clock, calendar), from: compactClock(start), by, unit }
	})
}

/**
 * 🚧 **Take a clock move back** (live scenes §15 G5, 2026-10-13): move the
 * session's OWN clock back by the step a recorded move made — `by` of `unit`
 * the other way, through the book's calendar, under the lock
 * `advanceSessionStoryClock` takes. A delta, not a restore: a person who
 * moved the clock since keeps their move.
 *
 * Null — and nothing written — when there is nothing of the session's to
 * move back: no clock of its own (it follows its line's
 * present, so the move is already gone from what it reads). Throws
 * `StoryClockRefusal` with a sentence when the calendar cannot place the
 * result.
 */
export async function stepBackSessionStoryClock(
	db: Db,
	sessionId: number,
	by: number,
	unit: StoryTimeUnit
): Promise<{ clock: StoryClock; from: StoryClock } | null> {
	const found = await sessionStoryClockRow(db, sessionId)
	if (!found || !clockOf(found)) return null
	const lorebookId = found.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (lorebookId == null) return null
	return await db.transaction(async (tx) => {
		await lockBookCalendar(tx, lorebookId)
		await tx.execute(
			sql`select 1 from ${schema.sessions} where ${schema.sessions.id} = ${sessionId} for update`
		)
		const row = await sessionStoryClockRow(tx, sessionId)
		const start = clockOf(row)
		if (!row || !start) return null
		if ((row.lorebookId ?? (await ownBookOf(tx, sessionId))?.id ?? null) !== lorebookId) return null
		const moved = advanceStoryTime(start, -by, unit, await bookCalendarOf(tx, lorebookId))
		if (moved.problem !== undefined)
			throw new StoryClockRefusal(
				`The story clock can't be taken back by ${clockSpanWords(by, unit)}: ${moved.problem}`
			)
		const clock: StoryClock = {
			year: moved.time.year,
			month: moved.time.month ?? null,
			day: moved.time.day ?? null,
			hour: moved.time.hour ?? null,
			minute: moved.time.minute ?? null
		}
		await tx.update(schema.sessions).set(clockColumns(clock)).where(eq(schema.sessions.id, sessionId))
		return { clock: compactClock(clock), from: compactClock(start) }
	})
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
 * proposed calendar: history entries, entry amendments and the cast members'
 * dated versions, branch fork dates, presences (both ends), the clocks, and
 * story-time stats (`storyTimeStatRows`).
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
	const places = entries.filter((e) => e.typeId === LOCATION_TYPE_ID).map((e) => e.id)
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
	for (const a of entryAmendments) {
		// A held amendment is the session's own and may be undated: not a point on the book's clock.
		if (a.base != null || a.year == null) continue
		out.push({
			key: `entryAmendment:${a.id}`,
			label: `Amendment to “${titleOf.get(a.entryId) || `entry ${a.entryId}`}”`,
			year: a.year,
			month: a.month,
			day: a.day
		})
	}
	const members = await db
		.select({ id: schema.lorebookBindings.id, name: schema.lorebookBindings.name })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	const nameOf = new Map(members.map((m) => [m.id, m.name ?? ""]))
	// The members' dated cast versions, on any line. The old cast amendments
	// are frozen and lifted into versions (listing both would show each
	// change twice); the Changes list keeps its words.
	const dated = await db
		.select({
			id: schema.characterVersions.id,
			castMemberId: schema.characterVersions.castMemberId,
			year: schema.characterVersions.year,
			month: schema.characterVersions.month,
			day: schema.characterVersions.day
		})
		.from(schema.characterVersions)
		.where(
			and(
				eq(schema.characterVersions.lorebookId, lorebookId),
				isNotNull(schema.characterVersions.castMemberId),
				isNotNull(schema.characterVersions.year)
			)
		)
		.orderBy(schema.characterVersions.id)
	for (const v of dated)
		out.push({
			key: `castVersion:${v.id}`,
			label: `Amendment to ${nameOf.get(v.castMemberId!) || "a cast member"}`,
			year: v.year!,
			month: v.month,
			day: v.day
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
	out.push(
		...(await storyTimeStatRows(db, lorebookId, {
			members: nameOf,
			places: new Map(places.map((id) => [id, titleOf.get(id) ?? ""])),
			sessions: new Map(sessions.map((s) => [s.id, s.name || `#${s.id}`]))
		}))
	)
	return out
}

/**
 * The book's story-time stats as dated rows (plan A18(a)): every stored value
 * of a slot whose field is a story time, held by an owner of this book — the
 * book itself, its cast members, its places (the owners `bookStatOwners`
 * names) — or by the session layers of a session reading it. A calendar that
 * could not place one would leave a stat reading a date the book cannot name.
 *
 * ⚠ A card's layer is no book's: a card is shared between books, and its
 * stats belong to none of them. A configuration holds no story time — a
 * story-time slot is configured by `maxLength` and `entryTypes` — so only
 * values are listed. `lorebookId` null lists the named owners' rows alone.
 */
async function storyTimeStatRows(
	db: Db,
	lorebookId: number | null,
	names: {
		members: ReadonlyMap<number, string>
		places: ReadonlyMap<number, string>
		sessions: ReadonlyMap<number, string>
	}
): Promise<DatedRow[]> {
	const v = schema.attributeValues
	const held: SQL[] = []
	if (lorebookId != null) held.push(and(eq(v.ownerKind, "lorebook"), eq(v.ownerId, lorebookId))!)
	if (names.members.size)
		held.push(and(eq(v.ownerKind, "cast_member"), inArray(v.ownerId, [...names.members.keys()]))!)
	if (names.places.size)
		held.push(
			and(
				inArray(v.ownerKind, ["location", "session_location"]),
				inArray(v.ownerId, [...names.places.keys()])
			)!
		)
	if (names.sessions.size)
		held.push(
			and(
				// 🚧 ⏳ Flip on (`memberForm.ts`): a seat's rows are `seated_member` / `player_seat`.
				inArray(v.ownerKind, memberFormOn() ? ["session", "session_cast", "seated_member", "player_seat"] : ["session", "session_cast"]),
				inArray(v.sessionId, [...names.sessions.keys()])
			)!
		)
	if (!held.length) return []
	const rows = await db
		.select({
			id: v.id,
			ownerKind: v.ownerKind,
			ownerId: v.ownerId,
			sessionId: v.sessionId,
			slotId: v.slotId,
			value: v.value
		})
		.from(v)
		.where(or(...held))
	const out: DatedRow[] = []
	for (const row of rows) {
		const decl = getAttributeSlot(row.slotId)
		if (!decl || slotField(decl)?.format !== "story-time") continue
		const time = parseStoryTime(row.value?.v)
		if (!time) continue
		const stat = `The stat “${i18nText(decl.label) || row.slotId}”`
		const session = `the session “${names.sessions.get(row.sessionId ?? 0) ?? `#${row.sessionId}`}”`
		const of =
			row.ownerKind === "lorebook"
				? "of the book"
				: row.ownerKind === "cast_member"
					? `of ${names.members.get(row.ownerId) || "a cast member"}`
					: row.ownerKind === "location"
						? `of ${names.places.get(row.ownerId) || "a place"}`
						: row.ownerKind === "session_location"
							? `of ${names.places.get(row.ownerId) || "a place"} in ${session}`
							: row.ownerKind === "session_cast" || row.ownerKind === "seated_member" || row.ownerKind === "player_seat"
								? `of a cast member in ${session}`
								: `in ${session}`
		out.push({ key: `stat:${row.id}`, label: `${stat} ${of}`, ...time })
	}
	return out
}

/**
 * The story-time stats a session's own layers hold that `calendar` cannot
 * place. A session starting to read a book brings them with it: the book's
 * preflight lists them from then on (`datedRowsOf`, A18(a)), so the move is a
 * dated write and is checked as one (`sessionLinePatch`), under the book's
 * lock.
 */
export async function sessionStatsThatDoNotLand(
	db: Db,
	session: { id: number; name: string | null },
	calendar: StoryCalendar | null
): Promise<(DatedRow & { problem: string })[]> {
	const rows = await storyTimeStatRows(db, null, {
		members: new Map(),
		places: new Map(),
		sessions: new Map([[session.id, session.name || `#${session.id}`]])
	})
	return datesThatDoNotLand(rows, calendar)
}
