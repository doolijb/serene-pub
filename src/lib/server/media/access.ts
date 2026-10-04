/**
 * Media permissions (28 §6): two layers, in order.
 *
 * This is today's policy stated once, instead of re-derived from a URL string
 * in the serving route. It also means media inherits sharing automatically — a
 * character shared into a session brings its gallery with it, with no second
 * grant to keep in sync.
 *
 * **One row decides it, since 0182.** This used to take whatever `media` row
 * the route had resolved, notice a derivative had no provenance of its own, and
 * go and fetch its parent — with an orphan branch for a thumbnail whose
 * original was gone. Provenance now lives on the FILE and a variant is never
 * looked up independently of its file on any access-checked path, so the
 * subject is simply the row handed in. Both the extra query and the orphan case
 * stopped existing rather than being fixed.
 */
import * as schema from "$lib/server/db/schema"
import { db as appDb } from "$lib/server/db"
import { sessionsReferencingFile } from "$lib/server/attachments/references"
import { sessionAccessFor } from "$lib/server/messages/permissions"
import {
	checkSessionAccess,
	canViewCharacter
} from "$lib/server/utils/sessionAccess"
import { MediaVisibility } from "$lib/shared/constants/MediaVisibility"

type FileRow = typeof schema.files.$inferSelect

export async function canViewMedia(
	file: FileRow,
	userId: number,
	db: Db = appDb as unknown as Db
): Promise<boolean> {
	// Layer 2 first when it is restrictive — `private` can only ever narrow
	// what layer 1 would allow, so there is no point resolving the parent.
	if (file.visibility === MediaVisibility.PRIVATE) {
		return file.userId === userId
	}

	// The owner always sees their own.
	if (file.userId === userId) return true

	// Layer 1 — derived from the parent, most specific first.
	if (file.sessionId) {
		const access = await checkSessionAccess(file.sessionId, userId)
		if (access.hasAccess) return true
	}
	// `canViewCharacter` checks BOTH member tables, so a file belonging to a
	// character somebody VOICES is reachable by that session's participants
	// too — one branch answers for the cast and the voices alike.
	if (file.characterId) {
		if (await canViewCharacter(file.characterId, userId)) return true
	}

	// Shown by an attachment (PLAN-composer-attachments §6.3): a file a
	// `core:image` / `core:file` part of a message in a session the viewer can
	// open refers to. Dedupe is per (user, hash), so a re-attached avatar's row
	// names its character, not this session — without this branch a guest
	// sees a broken image. AFTER the provenance branches: it costs a query.
	for (const sessionId of await sessionsReferencingFile(db, file.id)) {
		if (sessionId === file.sessionId) continue // asked above
		const access = await sessionAccessFor(db, sessionId, userId)
		if (access.hasAccess) return true
	}

	// No entity parent means a personal blob (a background, a staged upload):
	// owner only, which the check above already settled.
	return false
}
