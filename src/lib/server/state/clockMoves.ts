/**
 * 🚧 **Clock moves** — every move of a session's story clock, kept as a
 * `state_proposals` row of kind `clock`, anchored to the message it rode with
 * (PROPOSAL-live-scenes §15 G5/G7, 2026-10-13).
 *
 * ## Why here, and not a store of their own
 *
 * The session's clock is five columns on `sessions`. A moved clock therefore
 * has no value row for the ledger to read back, and no row a deleted message
 * cascades away — the two things that make a value readable and revertible
 * with its message. The table that already holds a clock move anchored to
 * its message is `state_proposals` (lane F's clock proposals), and every path
 * that copies or drops a session's anchored state already carries it: a
 * retract, a retake, a fork, a member story. So the moves that never waited
 * at the gate are written there too:
 *
 *  · `applied` — *Advance story clock* moved the clock: the state-keeper's
 *    move under Trust the narrator, a *Time passes…* press, a reply's tick
 *    (`recordClockMove`);
 *  · `accepted` — a person accepted the keeper's proposal
 *    (`decideClockProposal`, which stamps `from` and `to` on it);
 *  · `skipped` — asked for and not made, because the story has no clock yet:
 *    the ledger says why, and nothing is taken back.
 *
 * ## Taking one back
 *
 * A message's moves go with it, as its values do: a delete or a retake
 * (`revertClockMovesAnchoredTo`, before the rows go), a swipe or a regenerate
 * (`retractStateAnchoredTo`). The one exception is a reply's **tick** on a
 * swipe or a regenerate: the re-driven reply never ticks again, so its tick
 * stands. The clock moves back by each recorded step, newest first
 * (`stepBackSessionStoryClock`): a delta, so a person's own move since is
 * kept. A step the calendar cannot place refuses the whole retraction, in
 * words.
 */

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { storyTimePartsOf, type StoryTimeParts } from "@serene-pub/core-catalog/session-state"
import { anchorFor } from "$lib/server/state/write"
import { ownBookOf } from "$lib/server/lorebooks/ownBook"
import {
	bookCalendarOf,
	clockOf,
	sessionStoryNowOf,
	StoryClockRefusal,
	stepBackSessionStoryClock
} from "$lib/server/state/storyTime"
import {
	advanceStoryTime,
	clockSpanWords,
	formatDate,
	STORY_TIME_UNITS,
	type StoryClock,
	type StoryTimeUnit
} from "$lib/shared/lorebooks/storyDate"

/** 🚧 Why the clock moved — the outlet's `cause` literal (§15 G4). */
export const CLOCK_MOVE_CAUSES = ["action", "keeper", "tick"] as const
export type ClockMoveCause = (typeof CLOCK_MOVE_CAUSES)[number]

/**
 * The outlet's `cause`, read: unwired is `action` (the contract's default),
 * anything else not one of the three is null — a spec's typo, refused by the
 * caller rather than guessed at.
 */
export function readClockMoveCause(raw: unknown): ClockMoveCause | null {
	if (raw === undefined || raw === null || raw === "") return "action"
	return (CLOCK_MOVE_CAUSES as readonly unknown[]).includes(raw) ? (raw as ClockMoveCause) : null
}

/** What a clock row's payload holds. `from`/`to` once it moved; `skipped` when it did not. */
export interface ClockMovePayload {
	kind: "clock"
	by: number
	unit: StoryTimeUnit
	cause?: ClockMoveCause
	from?: StoryClock
	to?: StoryClock
	skipped?: string
}

/** 🚧 The sentence a skipped move leaves when the story has no clock to move (§15 G7). */
export const NO_STORY_CLOCK_YET =
	"This story has no clock yet: set one in the lorebook to track time."

/**
 * Why a refused move is skipped, in the person's words: no clock yet, else
 * the clock's own sentence (a result the calendar cannot place). Every
 * session has a book (its own, when none is shared), so there is no
 * "no lorebook" reason.
 */
export async function clockSkipReason(
	db: Db,
	sessionId: number,
	refusal: string
): Promise<string> {
	if (!(await sessionStoryNowOf(db, sessionId))) return NO_STORY_CLOCK_YET
	return refusal
}

/**
 * Write one clock move — applied, or skipped with its reason — anchored where
 * the world's changes are: the session's newest message (`anchorFor` for the
 * world), so a Time passes press files beside the keeper's values and a reply
 * tick beside the reply. Inside the caller's transaction when it has one, so
 * the move and its line land together.
 *
 * 🚧 Before anything is said (live scenes §15 G13) the anchor is the
 * session's newest message whatever it is — a greeting counts — and with
 * no message at all, none: the line is the conversation's **ledger head**
 * (`ledgerHeadLines`), drawn above the first message.
 *
 * `messageId`: a row this run wrote, named by the caller (`set-state`'s
 * `worldRow`), files there as the world's changes do. `once`: a skipped
 * row already standing at the same anchor for the same step and cause is
 * not written again — an extend re-runs the keeper over the reply whose
 * skipped line already says it (§15 G16).
 */
export async function recordClockMove(
	db: Db,
	move: {
		sessionId: number
		by: number
		unit: StoryTimeUnit
		cause: ClockMoveCause
		updatedBy: string
		messageId?: number
		once?: boolean
	} & ({ from: StoryClock; to: StoryClock } | { skipped: string })
): Promise<number> {
	const anchor = await anchorFor(
		db,
		{
			sessionId: move.sessionId,
			updatedBy: move.updatedBy,
			...(move.messageId !== undefined ? { messageId: move.messageId, ownAnchor: true } : {})
		},
		{ kind: "session", id: move.sessionId }
	)
	const skipped = "skipped" in move
	if (skipped && move.once) {
		const [standing] = await db
			.select({ id: schema.stateProposals.id })
			.from(schema.stateProposals)
			.where(
				and(
					eq(schema.stateProposals.sessionId, move.sessionId),
					anchor === null
						? isNull(schema.stateProposals.messageId)
						: eq(schema.stateProposals.messageId, anchor),
					eq(schema.stateProposals.kind, "clock"),
					eq(schema.stateProposals.status, "skipped"),
					sql`${schema.stateProposals.payload}->>'cause' = ${move.cause}`,
					sql`(${schema.stateProposals.payload}->>'by')::int = ${move.by}`,
					sql`${schema.stateProposals.payload}->>'unit' = ${move.unit}`
				)
			)
			.limit(1)
		if (standing) return standing.id
	}
	const payload: ClockMovePayload = {
		kind: "clock",
		by: move.by,
		unit: move.unit,
		cause: move.cause,
		...(skipped ? { skipped: move.skipped } : { from: move.from, to: move.to })
	}
	const now = new Date()
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: move.sessionId,
			messageId: anchor,
			kind: "clock",
			payload: payload as unknown as Record<string, unknown>,
			status: skipped ? "skipped" : "applied",
			proposedBy: move.updatedBy,
			decidedAt: now
		})
		.returning({ id: schema.stateProposals.id })
	return row!.id
}

/** A tick, on the terms a swipe keeps it by: applied with `cause: 'tick'`. */
const isTickSql = sql`(${schema.stateProposals.status} = 'applied' AND ${schema.stateProposals.payload}->>'cause' = 'tick')`

/**
 * The SQL that keeps a reply's tick out of what a swipe or a regenerate takes
 * back — `retractStateAnchoredTo`'s delete reads it, so the tick's line stays
 * under the reply whose clock it still moved.
 */
export const notATickSql = sql`NOT (${schema.stateProposals.kind} = 'clock' AND ${isTickSql})`

/** The moves in force anchored to these messages, newest first. */
async function movesInForce(
	db: Db,
	messageIds: readonly number[],
	opts: { keepTicks?: boolean }
) {
	if (!messageIds.length) return []
	return await db
		.select({
			id: schema.stateProposals.id,
			sessionId: schema.stateProposals.sessionId,
			payload: schema.stateProposals.payload
		})
		.from(schema.stateProposals)
		.where(
			and(
				inArray(schema.stateProposals.messageId, [...messageIds]),
				eq(schema.stateProposals.kind, "clock"),
				inArray(schema.stateProposals.status, ["applied", "accepted"]),
				...(opts.keepTicks ? [sql`NOT ${isTickSql}`] : [])
			)
		)
		.orderBy(
			desc(sql`coalesce(${schema.stateProposals.decidedAt}, ${schema.stateProposals.createdAt})`),
			desc(schema.stateProposals.id)
		)
}

/** A row's step, when it is one a clock can take back. */
function stepOf(payload: unknown): { by: number; unit: StoryTimeUnit } | null {
	const p = (payload ?? {}) as Partial<ClockMovePayload>
	if (typeof p.by !== "number" || !Number.isInteger(p.by) || p.by === 0) return null
	if (!(STORY_TIME_UNITS as readonly unknown[]).includes(p.unit)) return null
	return { by: p.by, unit: p.unit as StoryTimeUnit }
}

/**
 * Why taking back these messages' clock moves would be refused, or null — a
 * dry run of `revertClockMovesAnchoredTo`, every step applied in turn to the
 * clock as it stands. Asked before a write that cannot be half-done (a swipe
 * records its alternative before it retracts).
 */
export async function clockRetractProblem(
	db: Db,
	messageIds: readonly number[],
	opts: { keepTicks?: boolean } = {}
): Promise<string | null> {
	const moves = await movesInForce(db, messageIds, opts)
	const bySession = new Map<number, typeof moves>()
	for (const m of moves) bySession.set(m.sessionId, [...(bySession.get(m.sessionId) ?? []), m])
	for (const [sessionId, list] of bySession) {
		const [row] = await db
			.select({
				lorebookId: schema.sessions.lorebookId,
				storyClockYear: schema.sessions.storyClockYear,
				storyClockMonth: schema.sessions.storyClockMonth,
				storyClockDay: schema.sessions.storyClockDay,
				storyClockHour: schema.sessions.storyClockHour,
				storyClockMinute: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		let clock = clockOf(row)
		if (!row || !clock) continue
		const book = row.lorebookId ?? (await ownBookOf(db, sessionId))?.id ?? null
		if (book == null) continue
		const calendar = await bookCalendarOf(db, book)
		for (const move of list) {
			const step = stepOf(move.payload)
			if (!step) continue
			const back = advanceStoryTime(clock, -step.by, step.unit, calendar)
			if (back.problem !== undefined)
				return `The story clock can't be taken back by ${clockSpanWords(step.by, step.unit)}: ${back.problem}`
			clock = back.time
		}
	}
	return null
}

/**
 * Take back the clock moves anchored to these messages — newest first, each
 * by its own step — before the messages (or their rows) go. `keepTicks`: a
 * swipe or a regenerate, whose re-driven reply never ticks again. Throws
 * `StoryClockRefusal` with the sentence, and moves nothing, when the
 * calendar cannot place a step; nothing to take back is not a refusal.
 *
 * Returns the sessions whose clock moved, for the caller to announce.
 */
export async function revertClockMovesAnchoredTo(
	db: Db,
	messageIds: readonly number[],
	opts: { keepTicks?: boolean } = {}
): Promise<{ sessionIds: number[] }> {
	const moves = await movesInForce(db, messageIds, opts)
	if (!moves.length) return { sessionIds: [] }
	const moved = new Set<number>()
	await db.transaction(async (tx) => {
		for (const move of moves) {
			const step = stepOf(move.payload)
			if (!step) continue
			const back = await stepBackSessionStoryClock(tx, move.sessionId, step.by, step.unit)
			if (back) moved.add(move.sessionId)
		}
	})
	return { sessionIds: [...moved] }
}

/**
 * 🚧 **A branch's clock, as of its fork** (live scenes §15 G15): the new
 * session starts with its parent's own clock (`branchSession`), which is the
 * parent's clock NOW — so every move in force anchored AFTER the fork message
 * is stepped back off it, newest first, by its own step
 * (`stepBackSessionStoryClock`, the arithmetic a retraction uses): the clock
 * as it stood when the fork message's turn ended. Moves anchored to the fork
 * message itself, or before it, stand — they are the branch's past. A parent
 * that follows its line's present gave the branch no clock of its own, so
 * the branch follows the present too and nothing is stepped.
 *
 * ⚠ A delta, so only RECORDED moves come off: a person's own hand move since
 * the fork (the Chronicle's step or *Set the clock*) writes no clock row and
 * stays in the branch's clock. Throws `StoryClockRefusal` with the sentence
 * when the calendar cannot place a step back; call it inside the branch's
 * transaction, so a refusal leaves no branch behind. Returns the steps taken.
 */
export async function stepBranchClockToFork(
	tx: Db,
	input: { parentSessionId: number; branchSessionId: number; forkMessageId: number }
): Promise<Array<{ by: number; unit: StoryTimeUnit }>> {
	const after = await tx
		.select({ payload: schema.stateProposals.payload })
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, input.parentSessionId),
				eq(schema.stateProposals.kind, "clock"),
				inArray(schema.stateProposals.status, ["applied", "accepted"]),
				gt(schema.stateProposals.messageId, input.forkMessageId)
			)
		)
		.orderBy(
			desc(sql`coalesce(${schema.stateProposals.decidedAt}, ${schema.stateProposals.createdAt})`),
			desc(schema.stateProposals.id)
		)
	const taken: Array<{ by: number; unit: StoryTimeUnit }> = []
	for (const move of after) {
		const step = stepOf(move.payload)
		if (!step) continue
		// Null: the branch has no clock of its own (its parent followed its
		// line's present) — nothing of the branch's to step, now or after.
		if (!(await stepBackSessionStoryClock(tx, input.branchSessionId, step.by, step.unit))) break
		taken.push(step)
	}
	return taken
}

/**
 * 🚧 Copy a session's **recorded clock moves** into its branch (live scenes
 * §15 G15): applied, accepted and skipped `clock` rows anchored at or before
 * the fork, each re-anchored to its message's copy (`remap`) — one anchored
 * to no message stays at the ledger head. They are records, not decisions,
 * so they come across where a pending proposal never does: the branch's
 * ledger reads its past moves under the same lines, and deleting a copied
 * line in the branch takes its move back off the branch's clock.
 */
export async function copyClockMovesToBranch(
	tx: Db,
	input: {
		parentSessionId: number
		branchSessionId: number
		forkMessageId: number
		remap: ReadonlyMap<number, number>
	}
): Promise<number> {
	const rows = await tx
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, input.parentSessionId),
				eq(schema.stateProposals.kind, "clock"),
				inArray(schema.stateProposals.status, ["applied", "accepted", "skipped"])
			)
		)
		.orderBy(schema.stateProposals.id)
	let copied = 0
	for (const row of rows) {
		const anchor =
			row.messageId === null
				? null
				: row.messageId > input.forkMessageId
					? undefined
					: input.remap.get(row.messageId)
		if (anchor === undefined) continue
		const { id: _id, sessionId: _sessionId, messageId: _messageId, ...rest } = row
		await tx.insert(schema.stateProposals).values({
			...rest,
			sessionId: input.branchSessionId,
			messageId: anchor
		})
		copied++
	}
	return copied
}

/** 🚧 A clock move as the ledger reads it (`Sockets.State.LedgerRow`, kind `clock`). */
export interface ClockLedgerRow {
	id: number
	messageId: number | null
	updatedBy: string
	createdAt: string
	by: number
	unit: string
	cause: ClockMoveCause | null
	fromLabel: string | null
	toLabel: string | null
	/** 🚧 The same two readings as parts, named through the calendar (`storyTimePartsOf`). */
	from: StoryTimeParts | null
	to: StoryTimeParts | null
	skipped: string | null
}

/**
 * This session's clock moves for the ledger: applied, accepted and skipped,
 * each `from`/`to` spelled through the book's calendar as it reads now — a
 * month renamed since reads by its new name, as an entry does.
 */
export async function clockLedgerRows(
	db: Db,
	sessionId: number,
	lorebookId: number | null
): Promise<ClockLedgerRow[]> {
	const rows = await db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				eq(schema.stateProposals.kind, "clock"),
				inArray(schema.stateProposals.status, ["applied", "accepted", "skipped"])
			)
		)
	if (!rows.length) return []
	const calendar = lorebookId ? await bookCalendarOf(db, lorebookId) : null
	const label = (clock: unknown): string | null =>
		clock && typeof clock === "object" && typeof (clock as StoryClock).year === "number"
			? formatDate(clock as StoryClock, calendar)
			: null
	const parts = (clock: unknown): StoryTimeParts | null =>
		clock && typeof clock === "object" && typeof (clock as StoryClock).year === "number"
			? storyTimePartsOf(clock as StoryClock, calendar)
			: null
	const out: ClockLedgerRow[] = []
	for (const row of rows) {
		const p = (row.payload ?? {}) as Partial<ClockMovePayload>
		const step = stepOf(p)
		if (!step) continue
		out.push({
			id: row.id,
			messageId: row.messageId,
			updatedBy: row.proposedBy ?? "",
			createdAt: new Date(row.decidedAt ?? row.createdAt).toISOString(),
			by: step.by,
			unit: step.unit,
			cause: (CLOCK_MOVE_CAUSES as readonly unknown[]).includes(p.cause)
				? (p.cause as ClockMoveCause)
				: row.status === "accepted"
					? "keeper"
					: null,
			fromLabel: label(p.from),
			toLabel: label(p.to),
			from: parts(p.from),
			to: parts(p.to),
			skipped: row.status === "skipped" ? (p.skipped ?? NO_STORY_CLOCK_YET) : null
		})
	}
	return out
}

export { StoryClockRefusal }
