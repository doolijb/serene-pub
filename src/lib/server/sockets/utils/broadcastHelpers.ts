import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { AuthenticatedSocket } from "../auth"

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

	// Emit to session owner
	io.to(`user_${session.userId}`).emit(event, data)

	// Get all guests
	const guests = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.sessionId, sessionId),
		columns: { userId: true }
	})

	// Emit to all guests
	for (const guest of guests) {
		io.to(`user_${guest.userId}`).emit(event, data)
	}
}

/**
 * Same owner+guest fan-out as broadcastToSessionUsers, but lets the caller
 * send a different payload to the owner than to guests — for data (like a
 * raw upstream provider error) that's legitimate for the session owner to see
 * (it's their own connection/credentials) but shouldn't be broadcast
 * verbatim to guests who have no relationship to that connection.
 * @param io The socket.io instance
 * @param sessionId The session ID to broadcast to
 * @param event The event name
 * @param ownerData The payload sent to the session owner
 * @param guestData The payload sent to every guest
 */
export async function broadcastToSessionUsersVaryingByRole(
	io: AuthenticatedSocket["io"],
	sessionId: number,
	event: string,
	ownerData: any,
	guestData: any
) {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) return

	io.to(`user_${session.userId}`).emit(event, ownerData)

	const guests = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.sessionId, sessionId),
		columns: { userId: true }
	})

	for (const guest of guests) {
		io.to(`user_${guest.userId}`).emit(event, guestData)
	}
}

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
