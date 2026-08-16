import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { AuthenticatedSocket } from "../auth"

/**
 * Broadcast an event to all users involved in a chat (owner + guests)
 * @param io The socket.io instance
 * @param chatId The chat ID to broadcast to
 * @param event The event name
 * @param data The data to emit
 */
export async function broadcastToChatUsers(
	io: AuthenticatedSocket["io"],
	chatId: number,
	event: string,
	data: any
) {
	// Get chat owner
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { userId: true }
	})

	if (!chat) return

	// Emit to chat owner
	io.to(`user_${chat.userId}`).emit(event, data)

	// Get all guests
	const guests = await db.query.chatGuests.findMany({
		where: eq(schema.chatGuests.chatId, chatId),
		columns: { userId: true }
	})

	// Emit to all guests
	for (const guest of guests) {
		io.to(`user_${guest.userId}`).emit(event, data)
	}
}

/**
 * Same owner+guest fan-out as broadcastToChatUsers, but lets the caller
 * send a different payload to the owner than to guests — for data (like a
 * raw upstream provider error) that's legitimate for the chat owner to see
 * (it's their own connection/credentials) but shouldn't be broadcast
 * verbatim to guests who have no relationship to that connection.
 * @param io The socket.io instance
 * @param chatId The chat ID to broadcast to
 * @param event The event name
 * @param ownerData The payload sent to the chat owner
 * @param guestData The payload sent to every guest
 */
export async function broadcastToChatUsersVaryingByRole(
	io: AuthenticatedSocket["io"],
	chatId: number,
	event: string,
	ownerData: any,
	guestData: any
) {
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { userId: true }
	})

	if (!chat) return

	io.to(`user_${chat.userId}`).emit(event, ownerData)

	const guests = await db.query.chatGuests.findMany({
		where: eq(schema.chatGuests.chatId, chatId),
		columns: { userId: true }
	})

	for (const guest of guests) {
		io.to(`user_${guest.userId}`).emit(event, guestData)
	}
}

/**
 * Get all user IDs involved in a chat (owner + guests)
 * @param chatId The chat ID
 * @returns Array of user IDs
 */
export async function getChatUserIds(chatId: number): Promise<number[]> {
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { userId: true }
	})

	if (!chat) return []

	const userIds = [chat.userId]

	// Get all guests
	const guests = await db.query.chatGuests.findMany({
		where: eq(schema.chatGuests.chatId, chatId),
		columns: { userId: true }
	})

	// Add guest user IDs
	for (const guest of guests) {
		userIds.push(guest.userId)
	}

	return userIds
}

/**
 * Create a broadcaster function for a specific chat
 * This allows handlers to emit to all chat participants without needing the IO instance
 * @param io The socket.io instance
 * @param chatId The chat ID
 * @returns A function that broadcasts to all chat users
 */
export function createChatBroadcaster(
	io: AuthenticatedSocket["io"],
	chatId: number
) {
	return async (event: string, data: any) => {
		await broadcastToChatUsers(io, chatId, event, data)
	}
}
