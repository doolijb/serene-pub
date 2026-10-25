/**
 * **Retake** — Regenerate the last turn, as a whole (lair pass R2, owner
 * 2026-09-28; `core#retake`, label _Regenerate_, `/retake`).
 *
 * A turn in a genre like the Lair writes several rows — the planner's, then
 * each delver's. Rewriting its last row alone (the row regenerate, `retry`)
 * leaves the rest of the turn answering a line that has been replaced.
 * 🚧 pr-6 R-c: **Regenerate = Back + fire.** The turn is the one reader's
 * (`turnUnitOf`, `sessions/rewind.ts`), taken back the way Back takes it
 * (`rewindTurn`, never a person's line) and taken again:
 *
 * 1. the unit is taken out of the history in ONE transaction, with what the
 *    turn's own run wrote; what somebody else wrote against its rows (a
 *    Nudge, a whisper, a proposal the person applied afterwards) is
 *    re-anchored first, so it survives (`keepLaterState`);
 * 2. one `message-hidden` (rewind `back`) is emitted, with an `edit` cause, so
 *    auto-advance never fires off it (the fire below is the retake's one reply);
 * 3. the same entry fires again — the run's own speaker (null: the
 *    pipeline's own voice) on the same channel, with the run's own `via` when
 *    its inlet published one, else `pick`. Its first write replaces the
 *    rewound rows for good.
 *
 * `preview` stops after the unit is read and writes nothing: it is what the
 * confirm dialog lists.
 *
 * The door (whether this person may press it at all) is the caller's: the
 * turn control's offered → present → enabled verdict, then the owner check.
 */

import { inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { keepLaterState, takeRunWritesElsewhere, rewindTurn, turnUnitOf } from "$lib/server/sessions/rewind"
import type { TurnYield, TurnYieldRow } from "$lib/server/sessions/turnYield"

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
	const verdict = await turnUnitOf(db, opts.sessionId, { includePersonLines: false })
	if (!verdict.ok) return { ok: false, error: verdict.refusal }
	const { unit } = verdict
	const { rows } = unit
	const { revisionNotice, sessionOnRevision, branchForRevision } = await import(
		"$lib/server/sessions/revision"
	)
	const revision = revisionNotice(await sessionOnRevision(db, opts.sessionId), 1)
	if (opts.preview)
		return {
			ok: true,
			preview: true,
			rows,
			...(revision.mode === "branch" ? { revision } : {})
		}
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
	 * 🚧 On revision `branch` (PLAN-rulesets §28): nothing is taken back here
	 * — the session is forked before the turn and the turn is taken again in
	 * the branch, the old one kept where it was.
	 */
	let firedIn = opts.sessionId
	if (revision.mode === "branch") {
		const branched = await branchForRevision(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			firstRevisedId: unit.firstId,
			// 🚧 The revised turn's writes stay out of the branch (B8).
			runs: unit.runs,
			...(opts.io ? { io: opts.io } : {})
		})
		if (!branched.ok) return { ok: false, rows, revision, error: branched.error }
		firedIn = branched.sessionId
	} else {
		// 1–2. The unit goes the way Back takes it, and says so.
		const gone = await rewindTurn(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			includePersonLines: false,
			...(opts.io ? { io: opts.io } : {})
		})
		if (!gone.ok) return { ok: false, rows, error: gone.error }
		await opts.onDeleted?.()
	}
	const branchedTo = firedIn !== opts.sessionId ? { branchedTo: firedIn } : {}

	// 3. The same turn again.
	const entry = unit.entry ?? { ref: null, via: "pick" }
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
	// 🚧 pr-6 (R-l): only a branch is a revision now; in place, Regenerate rides Back.
	const branchNotice = revision.mode === "branch" ? { revision } : {}
	if (!fired.fired)
		return {
			ok: false,
			rows,
			...branchNotice,
			...branchedTo,
			error:
				revision.mode === "branch"
					? `The branch was made, but the new turn did not start: ${fired.reason ?? "the turn produced no reply"}.`
					: `The last turn was taken back, but the new one did not start: ${fired.reason ?? "the turn produced no reply"}.`
		}
	return { ok: true, rows, ...branchNotice, ...branchedTo, ...(fired.runId ? { runId: fired.runId } : {}) }
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
			await takeRunWritesElsewhere(t, {
				sessionId: opts.sessionId,
				runs: opts.turn.runs,
				unitIds: ids,
				landedBefore: true
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
			// 🚧 The annex deltas anchored to the turn go with it, newest first
			// (`annexChanges.ts`): what the turn wrote there — a genre's last
			// telling, its leads — goes back unless a later writer stands.
			const { retractAnnexDeltasAnchoredTo } = await import(
				"$lib/server/sessions/annexChanges"
			)
			for (const id of [...ids].sort((a, b) => b - a)) await retractAnnexDeltasAnchoredTo(t, id)
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
