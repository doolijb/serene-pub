import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { isSharedWith } from "$lib/server/utils/shares"
import { sessionsDrawingCard } from "$lib/server/cast/seatedCast"

export type SessionAccess = { isOwner: boolean; isGuest: boolean; hasAccess: boolean }

// `handle` is the db (or a transaction's `tx`) to ask; it defaults to the module db.
// Shared by any socket handler file that gates access to a session-scoped
// resource — duplicating this check per-file is how session guests previously
// ended up locked out of features (eg. scenes) that used a local, owner-only
// "eq(sessions.userId, userId)" check instead of this.
export async function checkSessionAccess(
	sessionId: number,
	userId: number,
	handle: Db = db as unknown as Db
): Promise<SessionAccess> {
	// The relational reads keep their shape (`columns: { userId }`): the
	// sockets' interest-gate test tells the access read from a cascade's
	// re-read by exactly that, and a transaction handle answers them too.
	const session = await handle.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) {
		return { isOwner: false, isGuest: false, hasAccess: false }
	}

	const isOwner = session.userId === userId

	const guestRecord = await handle.query.sessionGuests.findFirst({
		where: and(
			eq(schema.sessionGuests.sessionId, sessionId),
			eq(schema.sessionGuests.userId, userId)
		),
		columns: { userId: true }
	})

	const isGuest = !!guestRecord
	const hasAccess = isOwner || isGuest

	return { isOwner, isGuest, hasAccess }
}

/**
 * A user may view (not edit) a character they don't own if it is in a session
 * they have access to as owner or guest — mirrors the "view details for
 * characters in sessions they participate in" requirement that already governs
 * adding a character to a session.
 *
 * BOTH member tables. One character row can be in a session as cast
 * (`session_characters`) or as the voice one of its users speaks with
 * (`session_personas`), and either is a reason to be allowed to look at it.
 * Checking only the first makes a guest's own persona invisible to the
 * session's owner.
 *
 * A seat holds a card **directly** or **through its cast member**: a seat
 * whose member is linked to this card (`lorebook_bindings.character_id`) is a
 * reason too, whichever card the seat itself holds.
 *
 * A seat's member **drawn with this card** on the session's reading — the
 * dated card a cast amendment gives them by the session's clock — is a third
 * (owner ruling 2026-11-05: "Everything in session is cast -> active card",
 * ★acc-1 kept: the linked card still counts too). A card dated away from a
 * member is not a reason until the reading reaches the date.
 *
 * A **share** (`character_shares`, PLAN-private-messages §4) is the other
 * reason: the owner granted this person read and copy. It is asked first —
 * one indexed probe, cheaper than walking sessions.
 */
export async function canViewCharacter(
	characterId: number,
	userId: number,
	handle: Db = db as unknown as Db
): Promise<boolean> {
	if (await isSharedWith(handle, "character", characterId, userId))
		return true
	const [asCast, asVoice, memberCast, memberVoice, drawing] = await Promise.all([
		handle.query.sessionCharacters.findMany({
			where: eq(schema.sessionCharacters.characterId, characterId),
			columns: { sessionId: true }
		}),
		handle.query.sessionPersonas.findMany({
			where: eq(schema.sessionPersonas.personaId, characterId),
			columns: { sessionId: true }
		}),
		handle
			.select({ sessionId: schema.sessionCharacters.sessionId })
			.from(schema.sessionCharacters)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.sessionCharacters.castMemberId
				)
			)
			.where(eq(schema.lorebookBindings.characterId, characterId)),
		handle
			.select({ sessionId: schema.sessionPersonas.sessionId })
			.from(schema.sessionPersonas)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.sessionPersonas.castMemberId
				)
			)
			.where(eq(schema.lorebookBindings.characterId, characterId)),
		sessionsDrawingCard(handle, characterId)
	])
	const sessionIds = new Set<number>()
	for (const row of asCast) sessionIds.add(row.sessionId)
	for (const row of asVoice) sessionIds.add(row.sessionId)
	for (const row of memberCast) sessionIds.add(row.sessionId)
	for (const row of memberVoice) sessionIds.add(row.sessionId)
	for (const id of drawing) sessionIds.add(id)
	for (const sessionId of sessionIds) {
		const access = await checkSessionAccess(sessionId, userId, handle)
		if (access.hasAccess) return true
	}
	return false
}
