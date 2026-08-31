/**
 * Media permissions (28 §6): two layers, in order.
 *
 * This is today's policy stated once, instead of re-derived from a URL string
 * in the serving route. It also means media inherits sharing automatically — a
 * character shared into a session brings its gallery with it, with no second
 * grant to keep in sync.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import {
	checkSessionAccess,
	canViewCharacter,
	canViewPersona
} from "$lib/server/utils/sessionAccess"
import { MediaVisibility } from "$lib/shared/constants/MediaVisibility"

type MediaRow = typeof schema.media.$inferSelect

/**
 * A derivative has no entity provenance of its own (28 §5), so it resolves its
 * parent's permissions — never its own. Returns the row that actually carries
 * the provenance to check.
 */
async function permissionSubject(row: MediaRow): Promise<MediaRow> {
	if (!row.parentMediaId) return row
	const parent = await db.query.media.findFirst({
		where: eq(schema.media.id, row.parentMediaId)
	})
	// A thumbnail whose original is gone is an orphan; deny rather than fall
	// back to the thumbnail's own (empty) provenance, which would read as
	// "owner only" and quietly leak nothing — but deny is the honest answer.
	return parent ?? row
}

export async function canViewMedia(
	row: MediaRow,
	userId: number
): Promise<boolean> {
	const subject = await permissionSubject(row)

	// A thumbnail pointing at a missing original: nothing to inherit from.
	if (row.parentMediaId && subject.id === row.id) return subject.userId === userId

	// Layer 2 first when it is restrictive — `private` can only ever narrow
	// what layer 1 would allow, so there is no point resolving the parent.
	if (subject.visibility === MediaVisibility.PRIVATE) {
		return subject.userId === userId
	}

	// The owner always sees their own.
	if (subject.userId === userId) return true

	// Layer 1 — derived from the parent, most specific first.
	if (subject.sessionId) {
		const access = await checkSessionAccess(subject.sessionId, userId)
		if (access.hasAccess) return true
	}
	if (subject.characterId) {
		if (await canViewCharacter(subject.characterId, userId)) return true
	}
	if (subject.personaId) {
		if (await canViewPersona(subject.personaId, userId)) return true
	}

	// No entity parent means a personal blob (a background, a staged upload):
	// owner only, which the check above already settled.
	return false
}
