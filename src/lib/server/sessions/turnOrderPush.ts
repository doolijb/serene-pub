/**
 * The `sessions:turnOrder` push (PLAN-turn-order §4.7): the order, to every
 * client watching the session, the moment it is written.
 *
 * Its own module rather than a line inside `emitSessionEvent`, for the
 * reason every other push has one: the socket layer is where a frame's
 * shape and its interest gate live, and the emitter should not have to know
 * either. `emitSessionEvent` calls this on `turn-order-changed`; the view
 * handler calls it alongside `sessions:view`, so a client that has just
 * joined renders the same state as one that was already there.
 *
 * ⚠ **Page load is not an event** (§3). Nothing here recomputes: the push
 * carries what is stored, and a session that has never had an event yet
 * pushes the empty order, which the UI renders as "nothing prepared". The
 * order arrives on that session's first event — no backfill (§4.1).
 */

import { readTurnOrder, type TurnOrderV1 } from "@serene-pub/sdk"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { db } from "$lib/server/db"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"

/**
 * Push a session's turn order. `turnOrder` is the document when the caller
 * has it (the event carries it); otherwise it is read off the row, which is
 * the same value by construction — `set-turn-order` is the one writer.
 *
 * A no-op with no socket server, exactly as the message announcements are:
 * a run started by a test or a CLI has nobody to tell.
 */
export async function pushTurnOrder(
	io: SessionIo,
	sessionId: number,
	turnOrder?: unknown,
	/**
	 * Whether auto-advance is about to fire the head (lair pass B9) — set
	 * only by the push that answers a write, never by the view's.
	 */
	opts?: { autoAdvancing?: boolean }
): Promise<void> {
	if (!io) return
	let document: TurnOrderV1
	if (turnOrder && typeof turnOrder === "object")
		document = readTurnOrder({ turnOrder })
	else {
		const [row] = await db
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row) return
		document = readTurnOrder(row.metadata)
	}
	await broadcastToSessionUsers(io, sessionId, "sessions:turnOrder", {
		sessionId,
		turnOrder: document,
		...(opts?.autoAdvancing !== undefined
			? { autoAdvancing: opts.autoAdvancing }
			: {})
	})
}
