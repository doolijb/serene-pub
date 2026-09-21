/**
 * `sessions:rowChanged` — the push that keeps a session's LIST row current.
 *
 * The sidebar row, the session detail panel and the home page's "continue"
 * card each quote a session they are not showing: how many messages it holds
 * and its last visible line. Nothing on a message path re-lists, so without
 * this a card goes stale the moment a message lands, is edited, hidden,
 * deleted, swiped, regenerated or streamed. One small push says what changed,
 * where a re-list would have re-read every session that user owns.
 *
 * Shaped exactly like `sessions:runStatus` (R-19): SCOPED on `sessionId`,
 * GATED, broadcast to the session's users through `broadcastToSessionUsers`,
 * and built from a LAZY payload so the two reads below are skipped outright
 * when no open view holds the key.
 *
 * ## Coalesced per session
 *
 * A streamed reply persists a chunk every few hundred milliseconds and each
 * one announces its row, so a naive push would run two queries per chunk for a
 * line the reader watches fill anyway. Every call is therefore a trailing
 * debounce keyed on the session: a burst yields ONE push, `ROW_PUSH_DELAY_MS`
 * after the last call in it, carrying the state as it is then rather than as
 * it was at any call. Two sessions streaming at once hold two timers and never
 * wait on each other.
 *
 * ## It can never take a run down
 *
 * A push is a display. The timer body is guarded end to end and the broadcast
 * carries its own `.catch()`, so neither a failed read nor a socket that has
 * gone can throw into the run, handler or transaction that called it — and
 * `broadcastSessionRow` itself returns nothing to await. The timers are
 * `unref`'d where the runtime allows it, so a pending push never holds the
 * process open, and `process.once("exit")` drops what is left.
 */

import { count, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import { lastVisibleMessages } from "$lib/server/sessions/rowProjection"
import type { AuthenticatedSocket } from "$lib/server/sockets/auth"

/** Where a session's rows are announced. Absent, nothing is broadcast. */
type SessionIo = AuthenticatedSocket["io"] | undefined

/**
 * How long a burst is allowed to run before the row is re-read.
 *
 * A neighbour of `QUEUE_STATUS_DELAY_MS` (`runtime/runStatus.ts`) and chosen
 * the same way: long enough that a streaming reply's chunks collapse into a
 * handful of pushes, short enough that a person watching the sidebar sees
 * their own sent message appear on the card at once.
 */
export const ROW_PUSH_DELAY_MS = 250

/** One pending push per session. Empty between bursts. */
const pending = new Map<number, ReturnType<typeof setTimeout>>()

/**
 * The row as `sessions:list` would project it, for one session.
 *
 * Two reads, the same two the list pays for all of its sessions at once: the
 * message count beside the session's own `updated_at`, and the last visible
 * line. `null` back means there is no such session any more — it was deleted
 * while the debounce waited — and a null payload is `broadcastToSessionUsers`'
 * signal to send nothing.
 */
export async function sessionRowFrame(
	handle: Db,
	sessionId: number
): Promise<Sockets.Sessions.RowChanged.Response | null> {
	// COUNT over the left join rather than a second round trip: a session with
	// no messages counts zero, which is what the list's grouped count reports
	// for it by way of its own `?? 0`.
	const [head] = await handle
		.select({
			updatedAt: schema.sessions.updatedAt,
			messageCount: count(schema.sessionMessages.id)
		})
		.from(schema.sessions)
		.leftJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.sessionId, schema.sessions.id)
		)
		.where(eq(schema.sessions.id, sessionId))
		.groupBy(schema.sessions.id)
	if (!head) return null

	const lastMessages = await lastVisibleMessages(handle, [sessionId])
	return {
		sessionId,
		messageCount: head.messageCount,
		// Null rather than absent: the push has to be able to say the quote is
		// gone, which is what a delete of the last visible line leaves behind.
		lastMessage: lastMessages.get(sessionId) ?? null,
		updatedAt: String(head.updatedAt)
	}
}

/**
 * Tell this session's users that its list row moved.
 *
 * Call it after any write that changes what a card shows — a message inserted,
 * edited, hidden, deleted, swiped, regenerated, stopped, or persisted
 * mid-stream. Calling it twice for one write is free: the debounce makes a
 * burst one push.
 *
 * Returns immediately and never throws, so a call site may `void` it in the
 * middle of a handler without changing that handler's behaviour on any path.
 */
export function broadcastSessionRow(io: SessionIo, sessionId: number): void {
	if (!io || !Number.isFinite(sessionId)) return
	// Guarded from the first statement: the callers are a streaming run's
	// announce chain, a socket handler's `finally` and a built-in's, and a
	// card update has no business reaching any of them as an exception.
	try {
		const existing = pending.get(sessionId)
		if (existing) clearTimeout(existing)
		const timer = setTimeout(() => {
			pending.delete(sessionId)
			try {
				void broadcastToSessionUsers(
					io,
					sessionId,
					"sessions:rowChanged",
					// LAZY: the two reads are the cost, and they are not worth
					// paying when no open view holds this session's key.
					() => sessionRowFrame(db, sessionId)
				).catch(() => {})
			} catch {
				// A stale `io`, a handle that has gone: a card one push behind
				// is the whole of the damage.
			}
		}, ROW_PUSH_DELAY_MS)
		// A pending card update is not a reason for the process to stay up.
		;(timer as { unref?: () => void }).unref?.()
		pending.set(sessionId, timer)
	} catch {
		// As above, one push earlier.
	}
}

/** Drop every pending push. Shutdown, and the reset a test needs. */
export function __resetRowPushForTests(): void {
	for (const timer of pending.values()) clearTimeout(timer)
	pending.clear()
}

// Nothing left armed when the process goes: a timer firing into a torn-down
// database handle would have nothing to read and nobody to tell.
process.once("exit", () => {
	for (const timer of pending.values()) clearTimeout(timer)
	pending.clear()
})
