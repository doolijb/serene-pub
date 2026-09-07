import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { AuthenticatedSocket } from "../auth"
import { withoutConnectionIdentity } from "$lib/server/connections/visibility"

/**
 * Emit to a set of user rooms, hiding connections from those who are not
 * administrators.
 *
 * These broadcasts do not go through `sockets/index.ts`'s `emitToUser` — they
 * fan out to OTHER people's rooms, so there is no `socket.user` to read — which
 * is exactly why the rule has to be repeated here rather than assumed.
 *
 * The admin roster is only read when the payload actually carries connection
 * identity, and `withoutConnectionIdentity` answers that question by returning
 * the very same object when it found nothing to remove. The streaming path
 * broadcasts a message row per chunk and none of them has ever named a
 * connection, so the common case costs one walk and no query at all.
 *
 * ⚠ The owner's emit now happens after the guest lookup rather than before it —
 * both callers gather every recipient first so one roster read can serve them
 * all. Same number of queries, one of them moved: the owner's copy of a
 * streamed chunk lands a query later than it used to, which is not cumulative
 * across chunks.
 */
async function emitRedacted(
	io: AuthenticatedSocket["io"],
	event: string,
	recipients: { userId: number; data: any }[]
): Promise<void> {
	const hidden = new Map<any, any>()
	for (const { data } of recipients) {
		if (hidden.has(data)) continue
		hidden.set(data, withoutConnectionIdentity(data))
	}

	// Same object back means the payload named no connection, so who is an
	// administrator cannot change what anyone receives — and the roster is not
	// worth a round trip.
	const carriesIdentity = [...hidden].some(([raw, safe]) => raw !== safe)
	const admins = carriesIdentity
		? new Set(
				(
					await db
						.select({ id: schema.users.id })
						.from(schema.users)
						.where(
							and(
								inArray(
									schema.users.id,
									recipients.map((r) => r.userId)
								),
								eq(schema.users.isAdmin, true)
							)
						)
				).map((row) => row.id)
			)
		: null

	for (const { userId, data } of recipients)
		io.to(`user_${userId}`).emit(
			event,
			admins && !admins.has(userId) ? hidden.get(data) : data
		)
}

/**
 * Emit to ONE user room that is not necessarily the caller's own.
 *
 * For the handful of pushes aimed at somebody else — a newly added guest's
 * session list, say — which by definition cannot go through the caller's
 * `emitToUser` and so would otherwise leave the redaction behind.
 */
export async function emitToUserRedacted(
	io: AuthenticatedSocket["io"],
	userId: number,
	event: string,
	data: any
): Promise<void> {
	await emitRedacted(io, event, [{ userId, data }])
}

/**
 * Broadcast an event to all users involved in a session (owner + guests)
 * @param io The socket.io instance
 * @param sessionId The session ID to broadcast to
 * @param event The event name
 * @param data The data to emit
 */
export async function broadcastToSessionUsers(
	io: AuthenticatedSocket["io"],
	sessionId: number,
	event: string,
	data: any
) {
	// Get session owner
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) return

	// Get all guests
	const guests = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.sessionId, sessionId),
		columns: { userId: true }
	})

	await emitRedacted(io, event, [
		{ userId: session.userId, data },
		...guests.map((guest) => ({ userId: guest.userId, data }))
	])
}

/*
 * ⚠ `broadcastToSessionUsersVaryingByRole` used to live here: same fan-out,
 * but a different payload for the owner than for the guests, so a raw service
 * error could reach "their own connection/credentials" and nobody else.
 *
 * It is gone rather than merely unused, because the axis it encoded is the one
 * 0.6 overturned. Connections are the administrator's; a non-admin OWNER has no
 * more relationship to the instance's compute than a guest does, so a helper
 * whose whole shape is owner-vs-guest is a trap for the next person who needs to
 * hide something. It was also solving the wrong half: its one caller,
 * `persistGenerationErrorRow`, STORES the error and `projectLegacy` re-serves it
 * on every reload, so a redaction made at the broadcast was undone by the next
 * page load. The fix is the shape of the stored row (identity in a field the
 * projection removes), which makes one payload right for every recipient and
 * leaves `emitRedacted` — one rule, per recipient — as the only thing that
 * varies by who is listening.
 */

/**
 * Get all user IDs involved in a session (owner + guests)
 * @param sessionId The session ID
 * @returns Array of user IDs
 */
export async function getSessionUserIds(sessionId: number): Promise<number[]> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) return []

	const userIds = [session.userId]

	// Get all guests
	const guests = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.sessionId, sessionId),
		columns: { userId: true }
	})

	// Add guest user IDs
	for (const guest of guests) {
		userIds.push(guest.userId)
	}

	return userIds
}

/**
 * Create a broadcaster function for a specific session
 * This allows handlers to emit to all session participants without needing the IO instance
 * @param io The socket.io instance
 * @param sessionId The session ID
 * @returns A function that broadcasts to all session users
 */
export function createSessionBroadcaster(
	io: AuthenticatedSocket["io"],
	sessionId: number
) {
	return async (event: string, data: any) => {
		await broadcastToSessionUsers(io, sessionId, event, data)
	}
}
