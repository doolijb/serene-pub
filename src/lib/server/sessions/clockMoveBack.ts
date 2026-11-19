/**
 * 🚧 **A clock moved back past the session's own dated writes** (ruled
 * 2026-11-14, ★12). The session's **On revision** setting answers it
 * (`sessions/revision.ts`): Overwrite leaves everything written and the move is
 * a column write; Branch forks the session at its newest message and sets the
 * branch's clock. A person confirms first; a pipeline's move is refused with a
 * sentence (P1) — never made silently.
 *
 * This module is the ONE decider and the one query ("what did this session
 * write that the move passes"). It takes a `db` handle: the pipeline outlet
 * calls it inside its own transaction.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	bookCalendarOf,
	clockOfNow,
	clockOf,
	storyMoveStartOf,
	storyNowOf,
	StoryClockRefusal
} from "$lib/server/state/storyTime"
import { historyEntryDate, sessionReadingOf } from "$lib/server/state/reading"
import type { ClockMoveCause } from "$lib/server/state/clockMoves"
import { rowReadsOnLine } from "$lib/shared/lorebooks/lineReading"
import {
	advanceStoryTime,
	compareDates,
	formatDate,
	type StoryClock,
	type StoryDate,
	type StoryTimeUnit
} from "$lib/shared/lorebooks/storyDate"
import {
	CLOCK_MOVE_BACK_REFUSALS,
	branchForClockMove,
	clockMoveBackSentence,
	sessionOnRevision
} from "$lib/server/sessions/revision"

export type ClockMoveBackNotice =
	Sockets.Sessions.StoryClock.ClockMoveBackNotice

/** A person's requested move, as the clock door names it. */
export type PersonClockMove =
	| { to: StoryClock }
	| { follow: true }
	| { by: number; unit: StoryTimeUnit }

/** A refusal carrying the notice: thrown by the clock door until the person confirms. */
export class ClockMoveBackRefusal extends StoryClockRefusal {
	constructor(readonly notice: ClockMoveBackNotice) {
		super(notice.sentence)
	}
}

/**
 * The session's own dated writes on its line that read at `from` and not at `to` — what the move from `from`
 * to `to` passes. Read only.
 */
export async function datedWritesPassed(
	db: Db,
	sessionId: number,
	from: StoryDate,
	to: StoryDate
): Promise<{ count: number; latest: StoryDate | null }> {
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading) return { count: 0, latest: null }
	const book = reading.lorebookId
	const line = reading.line
	const rows: Array<{ branchId: number | null; date: StoryDate | null }> = []

	const imprintSubjects = async (kind: "version" | "relationship") => {
		const found = await db
			.select({ subjectId: schema.loreImprints.subjectId })
			.from(schema.loreImprints)
			.where(
				and(
					eq(schema.loreImprints.sessionId, sessionId),
					eq(schema.loreImprints.lorebookId, book),
					eq(schema.loreImprints.subjectKind, kind)
				)
			)
		return [...new Set(found.map((r) => r.subjectId))]
	}

	// The history entries the ties and the scenes are filed under, read once.
	const historyIds = new Set<number>()

	// 1. Entry versions the session wrote.
	const versionIds = await imprintSubjects("version")
	if (versionIds.length) {
		const versions = await db
			.select({
				branchId: schema.entryAmendments.branchId,
				year: schema.entryAmendments.year,
				month: schema.entryAmendments.month,
				day: schema.entryAmendments.day
			})
			.from(schema.entryAmendments)
			.where(
				and(
					inArray(schema.entryAmendments.id, versionIds),
					isNotNull(schema.entryAmendments.year)
				)
			)
		for (const v of versions)
			rows.push({
				branchId: v.branchId,
				date: { year: v.year!, month: v.month, day: v.day }
			})
	}

	// 2. Ties the session wrote, dated by their history entry.
	const tieIds = await imprintSubjects("relationship")
	const ties = tieIds.length
		? await db
				.select({
					branchId: schema.narrativeRelationships.branchId,
					historyEntryId: schema.narrativeRelationships.historyEntryId
				})
				.from(schema.narrativeRelationships)
				.where(inArray(schema.narrativeRelationships.id, tieIds))
		: []
	for (const t of ties)
		if (t.historyEntryId != null) historyIds.add(t.historyEntryId)

	// 3. Cast versions the session wrote.
	const casts = await db
		.select({
			branchId: schema.characterVersions.branchId,
			year: schema.characterVersions.year,
			month: schema.characterVersions.month,
			day: schema.characterVersions.day,
			atHour: schema.characterVersions.atHour
		})
		.from(schema.characterVersions)
		.where(
			and(
				eq(schema.characterVersions.sourceSessionId, sessionId),
				eq(schema.characterVersions.lorebookId, book),
				isNotNull(schema.characterVersions.year)
			)
		)
	for (const c of casts)
		rows.push({
			branchId: c.branchId,
			date: {
				year: c.year!,
				month: c.month,
				day: c.day,
				hour: c.atHour
			} as StoryDate
		})

	// 4. Scenes the session opened.
	const scenes = await db
		.select({
			branchId: schema.scenes.branchId,
			historyEntryId: schema.scenes.historyEntryId,
			year: schema.scenes.openedStoryClockYear,
			month: schema.scenes.openedStoryClockMonth,
			day: schema.scenes.openedStoryClockDay
		})
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.lorebookId, book)
			)
		)
	for (const s of scenes)
		if (s.historyEntryId != null) historyIds.add(s.historyEntryId)

	const historyDates = new Map<number, StoryDate | null>()
	if (historyIds.size) {
		const entries = await db
			.select({
				id: schema.lorebookEntries.id,
				fields: schema.lorebookEntries.fields
			})
			.from(schema.lorebookEntries)
			.where(inArray(schema.lorebookEntries.id, [...historyIds]))
		for (const e of entries)
			historyDates.set(e.id, historyEntryDate(e.fields))
	}
	for (const t of ties)
		rows.push({
			branchId: t.branchId,
			date:
				t.historyEntryId != null
					? (historyDates.get(t.historyEntryId) ?? null)
					: null
		})
	for (const s of scenes) {
		const filed =
			s.historyEntryId != null
				? (historyDates.get(s.historyEntryId) ?? null)
				: null
		rows.push({
			branchId: s.branchId,
			date:
				filed ??
				(s.year != null
					? { year: s.year, month: s.month, day: s.day }
					: null)
		})
	}

	let count = 0
	let latest: StoryDate | null = null
	for (const row of rows) {
		// Undated rows are never cut, so never passed.
		if (!row.date) continue
		if (
			!rowReadsOnLine(row, line, row.date, from) ||
			rowReadsOnLine(row, line, row.date, to)
		)
			continue
		count++
		if (!latest || compareDates(row.date, latest) > 0) latest = row.date
	}
	return { count, latest }
}

/** 🚧 Where a person's move starts and lands: `from` the session's present, `to` the date it names (follow: its line's present; step: the stepped date; null when none lands). Null when the session has no clock to move. */
export async function personMoveDestination(
	db: Db,
	sessionId: number,
	move: PersonClockMove
): Promise<{ from: StoryClock; to: StoryClock | null } | null> {
	const [row] = await db
		.select({
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading || reading.timelineOff) return null
	const book = reading.lorebookId
	const from = await storyMoveStartOf(db, sessionId, row)
	if (!from) return null

	let to: StoryClock | null
	if ("to" in move) to = move.to
	else if ("follow" in move) {
		const now = await storyNowOf(db, book, reading.branchId, {
			line: reading.line
		})
		to = now ? clockOfNow(now) : null
	} else {
		const stepped = advanceStoryTime(
			from,
			move.by,
			move.unit,
			await bookCalendarOf(db, book)
		)
		to = stepped.problem !== undefined ? null : stepped.time
	}
	return { from, to }
}

/** THE decider for a person's move: null = proceed exactly as today; else the notice to confirm. */
export async function clockMoveBackNotice(
	db: Db,
	sessionId: number,
	move: PersonClockMove
): Promise<ClockMoveBackNotice | null> {
	const moved = await personMoveDestination(db, sessionId, move)
	if (!moved) return null
	const { from, to: destination } = moved
	if (!destination || compareDates(destination, from) >= 0) return null
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading) return null
	const calendar = await bookCalendarOf(db, reading.lorebookId)

	const passed = await datedWritesPassed(db, sessionId, from, destination)
	if (passed.count === 0 || !passed.latest) return null
	const mode = await sessionOnRevision(db, sessionId)
	const latestLabel = formatDate(passed.latest, calendar)
	const toLabel = formatDate(destination, calendar)
	return {
		mode,
		count: passed.count,
		latestLabel,
		toLabel,
		sentence: clockMoveBackSentence(
			mode,
			passed.count,
			latestLabel,
			toLabel
		)
	}
}

/** For a pipeline's move, inside its transaction: the refusal sentence, or null. */
export async function clockMoveBackRefusal(
	db: Db,
	sessionId: number,
	from: StoryClock,
	to: StoryClock,
	cause: ClockMoveCause
): Promise<string | null> {
	if (compareDates(to, from) >= 0) return null
	if ((await datedWritesPassed(db, sessionId, from, to)).count === 0)
		return null
	return cause === "action"
		? CLOCK_MOVE_BACK_REFUSALS.action
		: CLOCK_MOVE_BACK_REFUSALS.run
}

/** A confirmed move under Branch: branch at the newest message (`branchForClockMove`), then set the BRANCH's clock to `to` (null = follow its line's present). The parent session is not written. */
export async function moveClockBackOnBranch(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		to: StoryClock | null
		io?: unknown
	}
): Promise<
	| { ok: true; sessionId: number; from: StoryClock | null }
	| { ok: false; error: string }
> {
	const branched = await branchForClockMove(db, {
		sessionId: opts.sessionId,
		userId: opts.userId,
		...(opts.io ? { io: opts.io } : {})
	})
	if (!branched.ok) return branched
	const id = branched.sessionId
	const [before] = await db
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
		.where(eq(schema.sessions.id, id))
		.limit(1)
	if (!before)
		return { ok: false, error: "The session could not be branched." }
	const { sessionLinePatch } = await import("$lib/server/sockets/sessions")
	await db.transaction(async (tx) => {
		const patch = await sessionLinePatch(tx as unknown as Db, {
			before: {
				lorebookId: before.lorebookId,
				lorebookBranchId: before.lorebookBranchId
			},
			session: { id, name: null },
			clock: opts.to
		})
		await tx
			.update(schema.sessions)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(schema.sessions.id, id))
	})
	return { ok: true, sessionId: id, from: clockOf(before) }
}
