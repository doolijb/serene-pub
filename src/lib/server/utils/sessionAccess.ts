import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

// Shared by any socket handler file that gates access to a session-scoped
// resource — duplicating this check per-file is how session guests previously
// ended up locked out of features (eg. scenes) that used a local, owner-only
// "eq(sessions.userId, userId)" check instead of this.
export async function checkSessionAccess(
	sessionId: number,
	userId: number
): Promise<{ isOwner: boolean; isGuest: boolean; hasAccess: boolean }> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) {
		return { isOwner: false, isGuest: false, hasAccess: false }
	}

	const isOwner = session.userId === userId

	const guestRecord = await db.query.sessionGuests.findFirst({
		where: (cg, { and, eq }) =>
			and(eq(cg.sessionId, sessionId), eq(cg.userId, userId))
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
 */
export async function canViewCharacter(
	characterId: number,
	userId: number
): Promise<boolean> {
	const [asCast, asVoice] = await Promise.all([
		db.query.sessionCharacters.findMany({
			where: eq(schema.sessionCharacters.characterId, characterId),
			columns: { sessionId: true }
		}),
		db.query.sessionPersonas.findMany({
			where: eq(schema.sessionPersonas.personaId, characterId),
			columns: { sessionId: true }
		})
	])
	const sessionIds = new Set<number>()
	for (const row of asCast) sessionIds.add(row.sessionId)
	for (const row of asVoice) sessionIds.add(row.sessionId)
	for (const sessionId of sessionIds) {
		const access = await checkSessionAccess(sessionId, userId)
		if (access.hasAccess) return true
	}
	return false
}
