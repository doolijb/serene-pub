/**
 * **Retake** — Regenerate the last turn, as a whole (lair pass R2, owner
 * 2026-09-28; `core#retake`, label _Regenerate_, `/retake`).
 *
 * A turn in a genre like the Lair writes several rows — the planner's, then
 * each delver's. Rewriting its last row alone (the row regenerate, `retry`)
 * leaves the rest of the turn answering a line that has been replaced. A
 * retake deletes the turn's **yield** (`turnYield.ts`) and takes the
 * same turn again:
 *
 * 1. the yield is deleted in ONE transaction — the anchored state and
 *    proposals cascade off the deleted rows (`state/write.ts`: every anchored
 *    row cascades off `messages.id`). What the turn's own run wrote goes with
 *    it; what somebody else wrote against those rows (a Nudge, a whisper, a
 *    proposal the person applied afterwards) is re-anchored first, so it
 *    survives (`keepLaterState`);
 * 2. `message-deleted` is emitted for each row, queued like every write's
 *    event — with an `edit` cause, so auto-advance never fires off it (the
 *    fire below is the retake's one reply);
 * 3. the same entry fires again — the run's own speaker (null: the
 *    pipeline's own voice) on the same channel, with the run's own `via` when
 *    its inlet published one, else `pick`.
 *
 * `preview` stops after the yield is read and writes nothing: it is what the
 * confirm dialog lists.
 *
 * The door (whether this person may press it at all) is the caller's: the
 * turn control's offered → present → enabled verdict, then the owner check.
 */

import {
	and,
	desc,
	eq,
	inArray,
	lt,
	ne,
	notInArray,
	or,
	sql,
	type SQL
} from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { lastTurnOf, type TurnYield, type TurnYieldRow } from "$lib/server/sessions/turnYield"

export interface RetakeOutcome {
	ok: boolean
	/** A preview: the rows a retake would delete, and nothing written. */
	preview?: boolean
	/** The yield — what was (or, on a preview, would be) deleted and rewritten. */
	rows?: TurnYieldRow[]
	/** The new turn's run, when it started. */
	runId?: string
	error?: string
	/** 🚧 What the retake does to the timeline (PLAN-rulesets §28); on a preview, the confirm's sentence. */
	revision?: import("$lib/server/sessions/revision").RevisionNotice
	/** 🚧 On revision `branch`: the new session the turn was taken again in. */
	branchedTo?: number
}

export async function retakeTurn(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		channel?: string
		preview?: boolean
		io?: SessionIo
		socket?: unknown
		emitToUser?: (event: string, data: unknown) => void
		/** Told once the yield is gone, before the new turn starts — the page's re-read. */
		onDeleted?: () => void | Promise<void>
	}
): Promise<RetakeOutcome> {
	const channel = opts.channel ?? "main"
	const last = await lastTurnOf(db, opts.sessionId, channel)
	if (!last.ok) return { ok: false, error: last.refusal }
	const { rows, entry } = last.yield
	const { revisionNotice, sessionOnRevision, branchForRevision } = await import(
		"$lib/server/sessions/revision"
	)
	const revision = revisionNotice(await sessionOnRevision(db, opts.sessionId), 1)
	if (opts.preview) return { ok: true, preview: true, rows, revision }
	if (!rows.length)
		return {
			ok: false,
			error: "The last turn left nothing to regenerate."
		}
	// 🚧 Replace on write (RF fix 5): a retake of the now-newest turn while
	// rewound replaces the forward stack, before the live turn goes.
	{
		const { discardForwardStack } = await import("$lib/server/messages/store")
		await discardForwardStack(db, opts.sessionId)
	}

	/**
	 * 🚧 On revision `branch` (PLAN-rulesets §28): nothing is deleted here —
	 * the session is forked before the turn and the turn is taken again in
	 * the branch, the old one kept where it was.
	 */
	let firedIn = opts.sessionId
	if (revision.mode === "branch") {
		const first = Math.min(...rows.map((r) => r.messageId))
		const branched = await branchForRevision(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			firstRevisedId: first,
			// 🚧 The revised turn's writes stay out of the branch (B8).
			runs: last.yield.runs,
			...(opts.io ? { io: opts.io } : {})
		})
		if (!branched.ok) return { ok: false, rows, revision, error: branched.error }
		firedIn = branched.sessionId
	} else {
		// 1–2. The yield goes, in one transaction, and says so.
		const gone = await deleteTurnYield(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			turn: last.yield,
			...(opts.io ? { io: opts.io } : {})
		})
		if (!gone.ok) return { ok: false, error: gone.error }
		await opts.onDeleted?.()
	}
	const branchedTo = firedIn !== opts.sessionId ? { branchedTo: firedIn } : {}

	// 3. The same turn again.
	const { fireTurnEntry } = await import("$lib/server/sessions/fireTurn")
	const fired = await fireTurnEntry(db, {
		sessionId: firedIn,
		userId: opts.userId,
		entry: {
			ref: entry.ref as import("@serene-pub/sdk").ParticipantRef | null,
			via: entry.via,
			...(channel !== "main" ? { channel } : {})
		},
		// A press: the person's cause.
		cause: { kind: "user", userId: opts.userId },
		...(opts.io ? { io: opts.io } : {}),
		...(opts.socket ? { socket: opts.socket } : {}),
		...(opts.emitToUser ? { emitToUser: opts.emitToUser } : {})
	})
	if (!fired.fired)
		return {
			ok: false,
			rows,
			revision,
			...branchedTo,
			error:
				revision.mode === "branch"
					? `The branch was made, but the new turn did not start: ${fired.reason ?? "the turn produced no reply"}.`
					: `The last turn was deleted, but the new one did not start: ${fired.reason ?? "the turn produced no reply"}.`
		}
	return { ok: true, rows, revision, ...branchedTo, ...(fired.runId ? { runId: fired.runId } : {}) }
}

/**
 * Steps 1 and 2 of a retake, on their own: a turn's **yield** deleted in ONE
 * transaction (what outlives it re-anchored first, its clock moves taken
 * back, the anchored state and proposals cascading off the rows), then one
 * `message-deleted` per row with an `edit` cause — so auto-advance never
 * fires off it. 🚧 Also the delete of a whole latest story turn in a genre
 * that keeps its turns (`turnDeleteRefusal`, owner rulings 2026-10-15): the
 * same rows go, and nothing is fired again.
 */
export async function deleteTurnYield(
	db: Db,
	opts: { sessionId: number; userId: number; turn: TurnYield; io?: SessionIo }
): Promise<{ ok: true; deleted: number[] } | { ok: false; error: string }> {
	// 1. The yield, in one transaction: what outlives it moved off it first,
	// then both message worlds, and the cascade.
	const ids = opts.turn.rows.map((r) => r.messageId)
	const { deleteLegacyWhere } = await import("$lib/server/messages/store")
	const { revertClockMovesAnchoredTo, StoryClockRefusal } = await import(
		"$lib/server/state/clockMoves"
	)
	let deleted: Awaited<ReturnType<typeof deleteLegacyWhere>>
	let clockMoved = false
	try {
		deleted = await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			await keepLaterState(t, {
				sessionId: opts.sessionId,
				yieldIds: ids,
				runs: opts.turn.runs
			})
			// 🚧 And what the turn wrote anchored elsewhere — a seated card's
			// change filed under its player's line (the 100-turn walk, B8).
			await dropTurnWritesElsewhere(t, {
				sessionId: opts.sessionId,
				runs: opts.turn.runs,
				yieldIds: ids
			})
			// 🚧 The turn's own clock moves go with it, tick included — the
			// turn is taken again and ticks again (live scenes §15 G5). Taken
			// back by their steps before the cascade drops their rows; what
			// `keepLaterState` re-anchored above stands.
			clockMoved = (await revertClockMovesAnchoredTo(t, ids)).sessionIds.length > 0
			// 🚧 What the turn wrote on a lorebook — the session's own notes'
			// entries (PLAN-rulesets §28 `overwrite`), its lore imprints on a
			// real book by the one rule (RF fix 4) — goes with it inside the
			// store's delete below (`deleteLegacyWhere`): their anchors are
			// plain ints, so the message cascade cannot take them.
			// 🚧 The annex goes back to where it stood before the turn
			// (`annexRevisionPoints.ts`): what the turn wrote there — a
			// genre's last telling, its leads — goes with it.
			const { reviseAnnexInPlace } = await import(
				"$lib/server/sessions/annexRevisionPoints"
			)
			await reviseAnnexInPlace(t, opts.sessionId, Math.min(...ids))
			return deleteLegacyWhere(t, inArray(schema.sessionMessages.id, ids))
		})
	} catch (e) {
		if (e instanceof StoryClockRefusal) return { ok: false, error: e.message }
		throw e
	}
	if (clockMoved && opts.io) {
		const { broadcastSessionRow } = await import("$lib/server/sessions/rowPush")
		broadcastSessionRow(opts.io, opts.sessionId)
	}
	// 🚧 The turn's writes went with it (PLAN-dc-after-walk2 Q1-3, the walk's
	// N8): every sheet re-reads now — a Delete left the live sheet holding
	// the undone change until a reload.
	if (opts.io) {
		try {
			const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
			await broadcastToSessionUsers(opts.io as any, opts.sessionId, "state:changed", { sessionId: opts.sessionId })
		} catch (e) {
			console.warn("[deleteTurnYield] telling the session its state moved failed:", e)
		}
	}

	// 2. One `message-deleted` per row, with what it held — the event every
	// delete emits (`core:outlet/delete-message@1`), so the next reply's
	// inlet and the turn-order recompute read a retake as the deletes it is.
	const { emitSessionEvent } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const { speakerRefOf } = await import("$lib/server/messages/sessionChanges")
	const { clearReplyFailed } = await import(
		"$lib/server/utils/generationStatus"
	)
	for (const row of deleted) {
		await emitSessionEvent(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			event: "core:event/message-deleted@1",
			payload: {
				sessionId: opts.sessionId,
				messageId: row.id,
				lost: {
					content: row.content,
					role: row.role,
					speaker: speakerRefOf(row),
					channel: row.channel,
					metadata: row.metadata
				},
				cause: { kind: "edit", userId: opts.userId }
			},
			...(opts.io ? { io: opts.io } : {})
		})
		await clearReplyFailed(opts.sessionId, row.id)
	}
	return { ok: true, deleted: deleted.map((r) => r.id) }
}

/**
 * Before a yield is deleted: move every state row anchored to it that the
 * turn's own run did NOT write onto the surviving anchor, so the delete's
 * cascade takes only the turn's own work (R2 hazard, owner ruling 2026-09-28,
 * option b). No schema change: the facts are the rows' own.
 *
 * **Written by the turn's run** = the writer is that run (`run:<run_id>`, the
 * keeper's applied values and proposals) AND the row landed before the run
 * ended. Those cascade. A turn whose planned character turns wrote rows of
 * the yield (🚧 Lair character turns) has several runs (`TurnYield.runs`),
 * and each one's own work is the turn's. "Ended" is when the run's own record was written
 * (`pipeline_runs.created_at`: `saveReceipt` runs once, at the end) — the
 * database's clock, the same one that stamps the state rows, so no host
 * time zone can skew the comparison.
 *
 * Everything else anchored to a yield row survives:
 *  - a Nudge (`direction`) or a whisper — an action run's writes;
 *  - a person's own edit (`user`);
 *  - a proposal the person applied after the turn — `decideProposal` writes
 *    it under the proposal's `proposed_by`, so it carries the run's name, but
 *    it landed after the run ended. The proposal row itself was the run's and
 *    goes.
 *
 * **The surviving anchor** is the newest message in the session, before the
 * row it was anchored to, that is not in the yield. Session-wide, not
 * per-channel: the turn lock (`turnMessages`) and the resolver's "highest
 * anchor wins" both read every channel, so a per-channel anchor could drop a
 * row below an older one filed on another channel's message. When nothing
 * survives before it (a retake of the first turn) the anchor is NULL — "from
 * the beginning", which the resolver ranks below every anchored row and the
 * turn lock treats as open.
 *
 * Kept rows keep their ids, so on a tie at the new anchor the later write
 * still wins — the order the resolver read before the retake.
 */
async function keepLaterState(
	db: Db,
	opts: {
		sessionId: number
		yieldIds: number[]
		runs: Array<{ runId: number; runUuid: string }>
	}
): Promise<void> {
	if (!opts.yieldIds.length) return
	/** Not any of the turn's runs' own work: for each, another writer, or landed after it ended. */
	const notTheRuns = (by: AnyPgColumn, at: AnyPgColumn | SQL): SQL =>
		and(
			...opts.runs.map(
				(r) =>
					or(
						ne(by, `run:${r.runUuid}`),
						sql`${at} > (SELECT ${schema.pipelineRuns.createdAt} FROM ${schema.pipelineRuns} WHERE ${schema.pipelineRuns.id} = ${r.runId})`
					)!
			)
		)!

	const values = await db
		.select({
			id: schema.attributeValues.id,
			anchor: schema.attributeValues.validFromMessageId
		})
		.from(schema.attributeValues)
		.where(
			and(
				inArray(
					schema.attributeValues.validFromMessageId,
					opts.yieldIds
				),
				notTheRuns(
					schema.attributeValues.updatedBy,
					schema.attributeValues.createdAt
				)
			)
		)
	const configs = await db
		.select({
			id: schema.attributeConfigs.id,
			anchor: schema.attributeConfigs.validFromMessageId
		})
		.from(schema.attributeConfigs)
		.where(
			and(
				inArray(
					schema.attributeConfigs.validFromMessageId,
					opts.yieldIds
				),
				notTheRuns(
					schema.attributeConfigs.updatedBy,
					schema.attributeConfigs.createdAt
				)
			)
		)
	const proposals = await db
		.select({
			id: schema.stateProposals.id,
			anchor: schema.stateProposals.messageId
		})
		.from(schema.stateProposals)
		.where(
			and(
				inArray(schema.stateProposals.messageId, opts.yieldIds),
				notTheRuns(
					schema.stateProposals.proposedBy,
					// 🚧 An accepted CLOCK proposal landed when it was decided
					// (live scenes §15 G5): the row is its own move, with no
					// value row beside it, so one accepted after the turn's
					// run is kept the way that run's accepted value is.
					sql`(CASE WHEN ${schema.stateProposals.kind} = 'clock' AND ${schema.stateProposals.status} = 'accepted' THEN coalesce(${schema.stateProposals.decidedAt}, ${schema.stateProposals.createdAt}) ELSE ${schema.stateProposals.createdAt} END)`
				)
			)
		)

	const anchors = new Set(
		[...values, ...configs, ...proposals]
			.map((r) => r.anchor)
			.filter((a): a is number => a !== null)
	)
	for (const anchor of anchors) {
		const [kept] = await db
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(
				and(
					eq(schema.messages.sessionId, opts.sessionId),
					lt(schema.messages.id, anchor),
					notInArray(schema.messages.id, opts.yieldIds)
				)
			)
			.orderBy(desc(schema.messages.id))
			.limit(1)
		const to = kept?.id ?? null
		const on = (rs: Array<{ id: number; anchor: number | null }>) =>
			rs.filter((r) => r.anchor === anchor).map((r) => r.id)
		const v = on(values)
		if (v.length)
			await db
				.update(schema.attributeValues)
				.set({ validFromMessageId: to })
				.where(inArray(schema.attributeValues.id, v))
		const c = on(configs)
		if (c.length)
			await db
				.update(schema.attributeConfigs)
				.set({ validFromMessageId: to })
				.where(inArray(schema.attributeConfigs.id, c))
		const p = on(proposals)
		if (p.length)
			await db
				.update(schema.stateProposals)
				.set({ messageId: to })
				.where(inArray(schema.stateProposals.id, p))
	}
}

/**
 * 🚧 What the turn's own runs wrote **outside** its yield goes with it
 * (2026-10-18, the 100-turn walk B8): a seated card's changes keep that
 * member's own open anchor — the declaration line the player sent, which is
 * no row of the turn's — so "Wren Ashdown Health 12 → 10" outlived the
 * deleted (or branched-away) turn, and the sheet never went back. Every
 * state row of this session a turn's run wrote — its values, its stat
 * configurations, its proposals — is removed wherever it is anchored.
 *
 * `landedBefore` (the in-place delete and retake): only what landed before
 * the run ended is the run's, `keepLaterState`'s rule — a proposal the
 * person accepted afterwards carries the run's name and stays. Off for a
 * branch made to take the turn again: its copied rows were all stamped at
 * the copy, and nothing of the revised turn belongs in it.
 */
export async function dropTurnWritesElsewhere(
	db: Db,
	opts: {
		sessionId: number
		runs: Array<{ runId: number; runUuid: string }>
		/** The yield's rows: their own anchored rows cascade with them. */
		yieldIds?: number[]
		landedBefore?: boolean
	}
): Promise<void> {
	if (!opts.runs.length) return
	const landed = opts.landedBefore !== false
	/** Written by one of the turn's runs (and, in place, before it ended). */
	const byTheRuns = (by: AnyPgColumn, at: AnyPgColumn | SQL): SQL =>
		or(
			...opts.runs.map(
				(r) =>
					landed
						? and(
								eq(by, `run:${r.runUuid}`),
								sql`${at} <= (SELECT ${schema.pipelineRuns.createdAt} FROM ${schema.pipelineRuns} WHERE ${schema.pipelineRuns.id} = ${r.runId})`
							)!
						: eq(by, `run:${r.runUuid}`)
			)
		)!
	const notTheYield = (anchor: AnyPgColumn): SQL | undefined =>
		opts.yieldIds?.length ? or(sql`${anchor} IS NULL`, notInArray(anchor, opts.yieldIds)) : undefined
	await db
		.delete(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, opts.sessionId),
				byTheRuns(schema.attributeValues.updatedBy, schema.attributeValues.createdAt),
				notTheYield(schema.attributeValues.validFromMessageId)
			)
		)
	await db
		.delete(schema.attributeConfigs)
		.where(
			and(
				eq(schema.attributeConfigs.sessionId, opts.sessionId),
				byTheRuns(schema.attributeConfigs.updatedBy, schema.attributeConfigs.createdAt),
				notTheYield(schema.attributeConfigs.validFromMessageId)
			)
		)
	await db
		.delete(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, opts.sessionId),
				byTheRuns(schema.stateProposals.proposedBy, schema.stateProposals.createdAt),
				notTheYield(schema.stateProposals.messageId)
			)
		)
	// 🚧 And what the runs wrote on a lorebook, wherever it is anchored (RF
	// fix 4): their lore imprints, by the one rule. A run's imprints are
	// always written during the run, so no landed-before test applies; a
	// branch's session holds none of the parent's.
	const { retractImprints } = await import("$lib/server/lorebooks/imprints")
	await retractImprints(db, {
		sessionId: opts.sessionId,
		runIds: opts.runs.map((r) => r.runUuid)
	})
}
