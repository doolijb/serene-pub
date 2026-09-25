/**
 * Session changes — the ledger of session events, for the next reply to read
 * (R-15, ruled 2026-09-15, built 2026-09-16; every session event since
 * PLAN-turn-order A2, 2026-09-22).
 *
 * *Anything that alters message state is a built-in*: core performs the
 * write and it always emits an event carrying what changed and what was
 * lost. That event lands in two places — on the run's receipt as `emitted`,
 * which the executor records from the outlet's `causesEvent` — and HERE, so
 * the next reply's inlet can publish it on `sessionChanges` and a pipeline
 * knows the history it is about to read has moved. Since A2 the same rows
 * hold every session event core emits — a row that landed
 * (`message-completed`), a setting that moved (`session-updated`), a seat
 * that changed (`cast-changed`) — each with the `cause` §4.1 names, so one
 * ledger answers "what happened in this session, and why".
 *
 * ## One writer per write, at the write — through one emitter
 *
 * `recordSessionChange` is called by `emitSessionEvent`
 * (`pipelines/runtime/sessionEvents.ts`), which is the emitter for every
 * session event: the host's commit for each built-in outlet, the finishing
 * branch of `update-message`, whichever release finalised a stopped reply,
 * the socket handlers for a send, a settings save and a cast toggle. Never
 * reconstructed afterwards from a receipt. A write that failed records
 * nothing, because nothing changed. The one direct caller is
 * `recordFormSuperseded` (`messages/blocks.ts`), whose once-guarantee is a
 * transaction around check-and-insert that the emitter's fan-out must not
 * sit inside.
 *
 * ## Read once — and marked read only once the run has read them
 *
 * `pendingSessionChanges` is the reply road's read: the unconsumed rows and
 * their ids. The run receives the list; `markSessionChangesConsumed` stamps
 * the ids AFTER the run, and the road calls it only when the run produced a
 * reply (U5b review W1) — a run that errs or is cancelled never saw them in
 * any sense that matters, and the next one must. Each change is delivered to
 * at most one run: the mark is by id AND still-unconsumed
 * (`consumedByRunId IS NULL`), so when two runs race on the same unread rows
 * only the first to mark wins them — the loser's mark touches nothing and its
 * count of marked rows comes back short. A change written while the run ran
 * is not among the ids either way and is left for the next. `peekSessionChanges` is
 * the preview's — the same list, nothing marked — so a token estimate on
 * every keystroke never eats what the real turn should see.
 *
 * ## The cap
 *
 * Both reads cap at the newest `SESSION_CHANGES_CAP`. Past it, the newest
 * fifty are delivered and the list ends with a
 * `core:event/session-changes-truncated@1` entry saying how many older ones
 * were not (U5b review S1) — so a pipeline can tell a full list from a cut
 * one. A consume marks the overflow as read too: dropped, rather than
 * delivered late and out of order.
 *
 * ## What a delete leaves behind, and for how long
 *
 * `lost.content` and `previous.content` exist so the NEXT run can see what
 * went. Once a run has consumed the change they have done their job: the
 * mark nulls them on the stored row (U5b review W4) and keeps the event, the
 * ids and the rest of the payload, so the ledger still says a line was
 * deleted without holding the line indefinitely. The run's receipt keeps
 * what the outlet published, under the receipt's own retention.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type {
	CastChangePayload,
	SessionChangePayload,
	TurnOrderChangedPayload
} from "@serene-pub/sdk"

/** The most changes one run is handed. Said so on the inlet's port. */
export const SESSION_CHANGES_CAP = 50

/** The marker a truncated list ends with. Registered in the SDK's `CORE_EVENTS`. */
export const SESSION_CHANGES_TRUNCATED_EVENT =
	"core:event/session-changes-truncated@1"

export type SessionChange = SessionChangePayload

/**
 * What a ledger row holds: any session event's payload (PLAN-turn-order
 * §4.1). `SessionChangePayload` is the message-shaped one the reply road's
 * port publishes; a cast change and a turn-order change are the same row
 * with their own shape.
 */
export type SessionEventPayload =
	| SessionChangePayload
	| CastChangePayload
	| TurnOrderChangedPayload

/** `Omit` over each member of a union, rather than over their intersection. */
type EachWithout<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Write one change, at the write. Never throws into the write that made it. */
export async function recordSessionChange(
	db: Db,
	change: EachWithout<SessionEventPayload, "at"> & {
		at?: number
		/** The run performing the write, when one is. */
		runId?: string | null
	}
): Promise<void> {
	const { runId, ...rest } = change
	const at = rest.at ?? Date.now()
	const payload = { ...rest, at } as SessionEventPayload
	try {
		await db.insert(schema.sessionChanges).values({
			sessionId: change.sessionId,
			event: change.event,
			messageId:
				"messageId" in change && typeof change.messageId === "number"
					? change.messageId
					: null,
			payload: payload as unknown as Record<string, unknown>,
			runId: runId ?? null,
			at: new Date(at)
		})
	} catch (err) {
		// The write this change describes has already landed; a change that
		// could not be written is logged, never a reason to fail the write.
		console.warn(
			"[sessionChanges] could not record a change — the write itself was unaffected:",
			err
		)
	}
}

async function unconsumed(db: Db, sessionId: number) {
	return await db
		.select({
			id: schema.sessionChanges.id,
			payload: schema.sessionChanges.payload
		})
		.from(schema.sessionChanges)
		.where(
			and(
				eq(schema.sessionChanges.sessionId, sessionId),
				isNull(schema.sessionChanges.consumedByRunId)
			)
		)
		.orderBy(desc(schema.sessionChanges.id))
}

/**
 * Newest-first rows to the list a run is handed: the newest fifty, oldest
 * first, and a truncation marker last when older ones were dropped.
 */
const newestFirstToList = (
	rows: Array<{ id: number; payload: unknown }>,
	sessionId: number
): SessionChange[] => {
	const list = rows
		.slice(0, SESSION_CHANGES_CAP)
		.reverse()
		.map((r) => r.payload as SessionChange)
	const dropped = rows.length - Math.min(rows.length, SESSION_CHANGES_CAP)
	if (dropped > 0)
		list.push({
			event: SESSION_CHANGES_TRUNCATED_EVENT,
			sessionId,
			at: Date.now(),
			dropped
		})
	return list
}

/** The unconsumed changes, oldest first, newest fifty — nothing marked. */
export async function peekSessionChanges(
	db: Db,
	sessionId: number
): Promise<SessionChange[]> {
	return newestFirstToList(await unconsumed(db, sessionId), sessionId)
}

/**
 * The unconsumed changes, oldest first, newest fifty, with the ids of every
 * row the read returned — the overflow included — for the mark that follows
 * the run. Nothing is marked here.
 */
export async function pendingSessionChanges(
	db: Db,
	sessionId: number
): Promise<{ changes: SessionChange[]; ids: number[] }> {
	const rows = await unconsumed(db, sessionId)
	return {
		changes: newestFirstToList(rows, sessionId),
		ids: rows.map((r) => r.id)
	}
}

/**
 * Mark these rows as read by `runId`, and let go of the content they carried.
 * Returns how many of `ids` this call actually marked.
 *
 * By id rather than by "still unconsumed", so a change written between the
 * read and the mark is left for the next run rather than marked as delivered
 * to this one. The where clause ALSO requires still-unconsumed
 * (`consumedByRunId IS NULL`), so two runs racing on the same read cannot
 * both win the same row: whichever mark lands first claims it, and the
 * other's returned count comes back short of `ids.length` — the caller's
 * signal that some of what it read was already claimed by another run. The
 * content is nulled in the same statement: `jsonb_set` with
 * `create_missing = false` leaves a payload without `lost` or `previous`
 * exactly as it was, and only nulls the `content` key where one exists.
 */
export async function markSessionChangesConsumed(
	db: Db,
	ids: number[],
	runId: string
): Promise<number> {
	if (!ids.length) return 0
	const payload = schema.sessionChanges.payload
	const marked = await db
		.update(schema.sessionChanges)
		.set({
			consumedByRunId: runId,
			payload: sql`jsonb_set(jsonb_set(${payload}, '{lost,content}', 'null'::jsonb, false), '{previous,content}', 'null'::jsonb, false)`
		})
		.where(
			and(
				inArray(schema.sessionChanges.id, ids),
				isNull(schema.sessionChanges.consumedByRunId)
			)
		)
		.returning({ id: schema.sessionChanges.id })
	return marked.length
}

/**
 * Read and mark in one call — for a caller with no run between the two.
 * The reply road reads before its run and marks after it; see
 * `pendingSessionChanges` / `markSessionChangesConsumed`.
 */
export async function consumeSessionChanges(
	db: Db,
	sessionId: number,
	runId: string
): Promise<SessionChange[]> {
	const { changes, ids } = await pendingSessionChanges(db, sessionId)
	await markSessionChangesConsumed(db, ids, runId)
	return changes
}

/**
 * Who voiced a row, as a participant reference — what a deleted message's
 * `lost.speaker` carries. A persona line is the character the person voiced;
 * narration is nobody in particular.
 */
export function speakerRefOf(row: {
	characterId?: number | null
	personaId?: number | null
	isNarratorResponse?: boolean | null
}): string | null {
	if (row.personaId != null) return `character:${row.personaId}`
	if (row.characterId != null) return `character:${row.characterId}`
	return null
}
