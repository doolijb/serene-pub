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
	gt,
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
import { lastTurnOf, type TurnYieldRow } from "$lib/server/sessions/turnYield"

export interface RetakeOutcome {
	ok: boolean
	/** A preview: the rows a retake would delete, and nothing written. */
	preview?: boolean
	/** The yield — what was (or, on a preview, would be) deleted and rewritten. */
	rows?: TurnYieldRow[]
	/** The new turn's run, when it started. */
	runId?: string
	error?: string
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
	const { rows, entry, runs } = last.yield
	if (opts.preview) return { ok: true, preview: true, rows }
	if (!rows.length)
		return {
			ok: false,
			error: "The last turn left nothing to regenerate."
		}

	// 1. The yield, in one transaction: what outlives it moved off it first,
	// then both message worlds, and the cascade.
	const ids = rows.map((r) => r.messageId)
	const { deleteLegacyWhere } = await import("$lib/server/messages/store")
	const deleted = await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		await keepLaterState(t, {
			sessionId: opts.sessionId,
			yieldIds: ids,
			runs
		})
		return deleteLegacyWhere(t, inArray(schema.sessionMessages.id, ids))
	})

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
	await opts.onDeleted?.()

	// 3. The same turn again.
	const { fireTurnEntry } = await import("$lib/server/sessions/fireTurn")
	const fired = await fireTurnEntry(db, {
		sessionId: opts.sessionId,
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
			error: `The last turn was deleted, but the new one did not start: ${fired.reason ?? "the turn produced no reply"}.`
		}
	return { ok: true, rows, ...(fired.runId ? { runId: fired.runId } : {}) }
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
	const notTheRuns = (by: AnyPgColumn, at: AnyPgColumn): SQL =>
		and(
			...opts.runs.map(
				(r) =>
					or(
						ne(by, `run:${r.runUuid}`),
						gt(
							at,
							sql`(SELECT ${schema.pipelineRuns.createdAt} FROM ${schema.pipelineRuns} WHERE ${schema.pipelineRuns.id} = ${r.runId})`
						)
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
					schema.stateProposals.createdAt
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
