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

// A user may view (not edit) a character/persona they don't own if it's
// bound into a chat they have access to as owner or guest — mirrors the
// "view details for characters in chats they participate in" requirement
// that already governs adding characters/personas to a chat.
export async function canViewCharacter(
	characterId: number,
	userId: number
): Promise<boolean> {
	const bindings = await db.query.chatCharacters.findMany({
		where: eq(schema.chatCharacters.characterId, characterId),
		columns: { chatId: true }
	})
	for (const binding of bindings) {
		const access = await checkChatAccess(binding.chatId, userId)
		if (access.hasAccess) return true
	}
	return false
}

export async function canViewPersona(
	personaId: number,
	userId: number
): Promise<boolean> {
	const bindings = await db.query.chatPersonas.findMany({
		where: eq(schema.chatPersonas.personaId, personaId),
		columns: { chatId: true }
	})
	for (const binding of bindings) {
		const access = await checkChatAccess(binding.chatId, userId)
		if (access.hasAccess) return true
	}
	return false
}
