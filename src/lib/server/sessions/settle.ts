/**
 * 🚧 **The settle line** (pr-6 B4, rulings 2026-10-24; shapes:
 * ~/.claude/plans/briefs/pr6-A-shapes.md §A-3).
 *
 * `sessions.settled_message_id` is the newest message Back and every
 * retraction may not reach: what is at or before it is in the lorebook now
 * ("This part of the story is in the lorebook now."). It moves forward only —
 * at a generated write (one with `sources`, R-a: the NEWEST attributed
 * message fixes the line) or a person's touch — and as it moves, what lies
 * below it is compacted: each attribute slot folds to one timeline-anchored
 * row (the anchor swap, pass 12), decided proposals and old zone snapshots
 * drop, standing imprints settle, annex deltas and consumed session changes
 * go. A genre that says `history.settle: 'on-write'` settles every line as it
 * lands (G2, R-m): Back is refused there with its own sentence; Hide and
 * Branch still work.
 *
 * ⚠ `settleThrough` takes the writer's `tx`; nothing here imports
 * `$lib/server/db`, and nothing emits inside a transaction.
 */

import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm"
import {
	getGenre,
	historySettleOf,
	sessionEvents,
	type EventCause,
	type HistorySettle
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"
import { REWIND_REFUSALS } from "$lib/shared/sessions/rewind"

/** Back's sentence below the line, and every retraction's (pass 4, ruled) — spelled once, in `REWIND_REFUSALS`. */
export const SETTLED_SENTENCE = REWIND_REFUSALS.settled

/** Back's sentence in a genre whose history settles as it is written (`history.settle: 'on-write'`, G2). */
export const EVERY_TURN_KEPT_SENTENCE = REWIND_REFUSALS.everyTurnKept

/**
 * Thrown by `assertRetractable` when a retraction would reach the settled
 * stretch. A caller that catches `StoryClockRefusal` catches this beside it
 * and answers with `.message`.
 */
export class SettledRefusal extends Error {
	constructor(
		readonly messageId: number,
		readonly settledMessageId: number | null,
		sentence: string = SETTLED_SENTENCE as string
	) {
		super(sentence)
		this.name = "SettledRefusal"
	}
}

/**
 * The session's settle line: the greater of `sessions.settled_message_id` and
 * the newest message any applied scene summary was written from (its close,
 * or the greatest id of its selection, over scenes whose summary is `done`);
 * null when neither says anything.
 */
export async function settledLineOf(db: Db, sessionId: number): Promise<number | null> {
	const [session] = await db
		.select({ settled: schema.sessions.settledMessageId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	let line: number | null = session?.settled ?? null
	const done = await db
		.select({
			closed: schema.scenes.closedAtMessageId,
			selected: schema.scenes.selectedMessageIds
		})
		.from(schema.scenes)
		.where(and(eq(schema.scenes.sessionId, sessionId), eq(schema.scenes.summaryStatus, "done")))
	for (const scene of done) {
		const ids = [scene.closed, ...((scene.selected as number[] | null) ?? [])].filter(
			(n): n is number => typeof n === "number"
		)
		for (const n of ids) if (line == null || n > line) line = n
	}
	return line
}

/**
 * The session's genre's settle mode — the genre's alone, never a preset's
 * (`historySettleOf(getGenre(<the session's genre>))`); a genre the registry
 * does not know settles `on-commit`.
 */
export async function sessionHistorySettle(db: Db, sessionId: number): Promise<HistorySettle> {
	return historySettleOf(getGenre(await sessionGenreOf(db, sessionId)))
}

/**
 * The one guard the retraction entry points call: throws `SettledRefusal`
 * when `messageId` is at or before its session's settle line, and resolves
 * otherwise (a message that does not exist resolves).
 */
export async function assertRetractable(db: Db, messageId: number): Promise<void> {
	const [row] = await db
		.select({ sessionId: schema.sessionMessages.sessionId })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row) return
	const line = await settledLineOf(db, row.sessionId)
	if (line == null || messageId > line) return
	const sentence =
		(await sessionHistorySettle(db, row.sessionId)) === "on-write"
			? EVERY_TURN_KEPT_SENTENCE
			: SETTLED_SENTENCE
	throw new SettledRefusal(messageId, line, sentence as string)
}

/**
 * A generated write (one with `sources`) landed, or a person touched the
 * story: inside the writer's transaction, move the line to
 * `max(current, throughMessageId)` — never past the forward stack (below its
 * lowest rewound row) and never backwards — and compact what lies at or
 * before it. Never emits: the writer calls `announceHistorySettled` once its
 * transaction has committed.
 */
export async function settleThrough(
	tx: Db,
	sessionId: number,
	throughMessageId: number,
	_cause: { runId?: string; userId?: number }
): Promise<{ moved: boolean; settledMessageId: number | null; previousSettledMessageId: number | null }> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext('settle'), ${sessionId})`)
	let through = throughMessageId
	const [rewound] = await tx
		.select({ lowest: sql<number | null>`min(${schema.sessionMessages.id})` })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				isNotNull(schema.sessionMessages.rewindOrdinal)
			)
		)
	if (rewound?.lowest != null) through = Math.min(through, rewound.lowest - 1)
	const [session] = await tx
		.select({ settled: schema.sessions.settledMessageId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const previous = session?.settled ?? null
	if (through <= (previous ?? 0))
		return { moved: false, settledMessageId: previous, previousSettledMessageId: previous }
	await tx
		.update(schema.sessions)
		.set({ settledMessageId: through })
		.where(eq(schema.sessions.id, sessionId))
	await compactThrough(tx, sessionId, through)
	return { moved: true, settledMessageId: through, previousSettledMessageId: previous }
}

/** The history entry the anchor swap files a folded row under: the story scene holding `line`, else the newest scene's. */
async function historyEntryAt(tx: Db, sessionId: number, line: number): Promise<number | null> {
	const scenes = await tx
		.select()
		.from(schema.scenes)
		.where(and(eq(schema.scenes.sessionId, sessionId), eq(schema.scenes.channel, "main")))
	let best: (typeof scenes)[number] | undefined
	for (const scene of scenes) {
		const opened = scene.openedAtMessageId
		const inRange =
			opened != null &&
			opened <= line &&
			(scene.closedAtMessageId == null || line <= scene.closedAtMessageId)
		const selected = ((scene.selectedMessageIds as number[] | null) ?? []).includes(line)
		if ((inRange || selected) && (!best || scene.id > best.id)) best = scene
	}
	if (best?.historyEntryId != null) return best.historyEntryId
	const { newestHistoryEntryOf } = await import("$lib/server/state/durable")
	return (await newestHistoryEntryOf(tx, sessionId)).historyEntryId
}

/** What lies at or before the new line, folded (A-3 compaction), in the listed order. `tx` only. */
async function compactThrough(tx: Db, sessionId: number, line: number): Promise<void> {
	const { inForce } = await import("$lib/server/state/resolve")
	const { sessionReadingOf, loadEntryDates } = await import("$lib/server/state/reading")
	const reading = await sessionReadingOf(tx, sessionId)
	const entryId = await historyEntryAt(tx, sessionId, line)

	for (const table of [schema.attributeValues, schema.attributeConfigs] as const) {
		const rows = await tx
			.select()
			.from(table)
			.where(eq(table.sessionId, sessionId))
		const groups = new Map<string, typeof rows>()
		for (const row of rows) {
			if (row.validFromMessageId != null && row.validFromMessageId > line) continue
			const key = `${row.ownerKind}\u0000${row.ownerId}\u0000${row.slotId}`
			const g = groups.get(key)
			if (g) g.push(row)
			else groups.set(key, [row])
		}
		for (const group of groups.values()) {
			if (!group.some((r) => r.validFromMessageId != null)) continue
			const dates = reading
				? await loadEntryDates(
						tx,
						reading,
						group.map((r) => r.historyEntryId).filter((n): n is number => n != null)
					)
				: undefined
			const keep = inForce(group, dates)!
			await tx
				.update(table)
				.set({
					validFromMessageId: null,
					historyEntryId: entryId ?? keep.historyEntryId,
					branchId: reading?.branchId ?? keep.branchId,
					sourceSessionId: sessionId,
					sourceMessageId: keep.sourceMessageId ?? keep.validFromMessageId
				})
				.where(eq(table.id, keep.id))
			const drop = group.filter((r) => r.id !== keep.id).map((r) => r.id)
			if (drop.length) await tx.delete(table).where(inArray(table.id, drop))
		}
	}

	await tx
		.delete(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				lte(schema.stateProposals.messageId, line),
				ne(schema.stateProposals.status, "pending")
			)
		)

	const zones = await tx
		.select()
		.from(schema.zoneContents)
		.where(
			and(
				eq(schema.zoneContents.sessionId, sessionId),
				lte(schema.zoneContents.validFromMessageId, line)
			)
		)
	const newest = new Map<string, number>()
	for (const z of zones) {
		const key = [z.rulesetId, z.ownerKind, z.ownerId, z.zoneType].join("\u0000")
		if ((newest.get(key) ?? 0) < z.id) newest.set(key, z.id)
	}
	const dropZones = zones
		.filter(
			(z) =>
				newest.get([z.rulesetId, z.ownerKind, z.ownerId, z.zoneType].join("\u0000")) !== z.id
		)
		.map((z) => z.id)
	if (dropZones.length)
		await tx.delete(schema.zoneContents).where(inArray(schema.zoneContents.id, dropZones))

	await tx
		.update(schema.loreImprints)
		.set({ before: null, status: "settled" })
		.where(
			and(
				eq(schema.loreImprints.sessionId, sessionId),
				lte(schema.loreImprints.messageId, line),
				eq(schema.loreImprints.status, "standing")
			)
		)
	await tx
		.delete(schema.annexDeltas)
		.where(
			and(eq(schema.annexDeltas.sessionId, sessionId), lte(schema.annexDeltas.messageId, line))
		)
	await tx
		.delete(schema.sessionChanges)
		.where(
			and(
				eq(schema.sessionChanges.sessionId, sessionId),
				lte(schema.sessionChanges.messageId, line),
				isNotNull(schema.sessionChanges.consumedByRunId)
			)
		)
}

/**
 * After the writer's transaction committed: `core:event/history-settled@1`
 * (`messageId` = where the line stands now, `previousSettledMessageId`).
 * Nothing when `moved` is false. A moved line also re-sends the session
 * (`sessions:refresh`, to every member) unless `refresh` is false: the strip's
 * Back and the settle line ride that payload.
 */
export async function announceHistorySettled(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		moved: boolean
		settledMessageId: number | null
		previousSettledMessageId: number | null
		cause?: EventCause
		io?: SessionIo
		/** Re-send the session to every member (default true). */
		refresh?: boolean
	}
): Promise<void> {
	if (!opts.moved) return
	const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	await emitSessionEvent(db, {
		sessionId: opts.sessionId,
		userId: opts.userId,
		event: sessionEvents.historySettled,
		payload: {
			sessionId: opts.sessionId,
			messageId: opts.settledMessageId,
			previousSettledMessageId: opts.previousSettledMessageId,
			cause: opts.cause ?? { kind: "edit", userId: opts.userId }
		},
		io: opts.io
	})
	if (opts.refresh !== false && opts.io) {
		try {
			const { pushSessionToParticipants } = await import("$lib/server/sockets/sessions")
			await pushSessionToParticipants(opts.io, opts.sessionId, opts.userId)
		} catch (e) {
			console.warn("[settle] the session re-send after a moved line failed:", e)
		}
	}
}

/**
 * A line landed (`noteLineLanded`): in a genre whose history settles
 * `on-write`, settle through it (its own transaction, then the announcement).
 * Nothing for `on-commit`. Never throws.
 */
export async function settleOnWrite(
	db: Db,
	opts: { sessionId: number; messageId: number; userId: number; io?: SessionIo }
): Promise<void> {
	try {
		if ((await sessionHistorySettle(db, opts.sessionId)) !== "on-write") return
		const moved = await db.transaction((tx) =>
			settleThrough(tx, opts.sessionId, opts.messageId, { userId: opts.userId })
		)
		await announceHistorySettled(db, { ...opts, ...moved, refresh: false })
	} catch (e) {
		console.warn("[settle] settleOnWrite failed:", e)
	}
}
