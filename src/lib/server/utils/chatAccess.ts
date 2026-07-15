import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

// Shared by any socket handler file that gates access to a chat-scoped
// resource — duplicating this check per-file is how chat guests previously
// ended up locked out of features (eg. scenes) that used a local, owner-only
// "eq(chats.userId, userId)" check instead of this.
export async function checkChatAccess(
	chatId: number,
	userId: number
): Promise<{ isOwner: boolean; isGuest: boolean; hasAccess: boolean }> {
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { userId: true }
	})

	if (!chat) {
		return { isOwner: false, isGuest: false, hasAccess: false }
	}

	const isOwner = chat.userId === userId

	const guestRecord = await db.query.chatGuests.findFirst({
		where: (cg, { and, eq }) =>
			and(eq(cg.chatId, chatId), eq(cg.userId, userId))
	})

	const isGuest = !!guestRecord
	const hasAccess = isOwner || isGuest

	return { isOwner, isGuest, hasAccess }
}
