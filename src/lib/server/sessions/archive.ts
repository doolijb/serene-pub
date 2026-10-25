/**
 * 🚧 **Archive** (pr-6, R-k, ruled 2026-10-24): a session's `archived_at` flag and the one read-only rule it
 * brings. Archived = read-only — the composer closed, Back / Forward / Regenerate greyed, routines stopped — until
 * the owner unarchives it (clears the flag). Written ONLY here; every door that plays the session asks
 * `sessionArchivedRefusal`. Sentences: `$lib/shared/sessions/archive`.
 *
 * ⚠ An archived SESSION is not an archived lorebook ENTRY (`lorebook_entries.archived`).
 */
import { and, eq, isNull } from "drizzle-orm"
import { COMPOSER_STATE_ANY, type ComposerStatesV1 } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { SESSION_ARCHIVED_SENTENCE, SESSION_ARCHIVE_REFUSALS } from "$lib/shared/sessions/archive"

/** Thrown with the sentence a person reads. */
export class SessionArchiveRefusal extends Error {}

/** The one read-only rule: SESSION_ARCHIVED_SENTENCE while `archived_at` is set, else null. */
export async function sessionArchivedRefusal(db: Db, sessionId: number): Promise<string | null> {
	const [row] = await db
		.select({ archivedAt: schema.sessions.archivedAt })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.archivedAt ? SESSION_ARCHIVED_SENTENCE : null
}

/**
 * The payload's composer states while archived — never stored: every channel, everyone, closed with the archived sentence.
 * `waits: false`: the archived session waits on nothing in play, so its placeholder and refusal read the sentence alone (`composerClosedPlaceholder`).
 */
export function withSessionArchiveClosure(
	states: ComposerStatesV1,
	archivedAt: Date | string | null | undefined
): ComposerStatesV1 {
	if (!archivedAt) return states
	return {
		...states,
		[COMPOSER_STATE_ANY]: {
			...((states as Record<string, Record<string, unknown>>)[COMPOSER_STATE_ANY] ?? {}),
			[COMPOSER_STATE_ANY]: { open: false, reason: SESSION_ARCHIVED_SENTENCE, waits: false }
		}
	} as ComposerStatesV1
}

async function ownedRow(db: Db, sessionId: number, userId: number) {
	const [row] = await db
		.select({ userId: schema.sessions.userId, archivedAt: schema.sessions.archivedAt })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) throw new SessionArchiveRefusal(SESSION_ARCHIVE_REFUSALS.missing)
	if (row.userId !== userId) throw new SessionArchiveRefusal(SESSION_ARCHIVE_REFUSALS.notOwner)
	return row
}

/** Owner only. Refusals: missing, notOwner, already. Sets archived_at = now() WHERE archived_at IS NULL; returns it. */
export async function archiveSession(
	db: Db,
	opts: { sessionId: number; userId: number }
): Promise<{ archivedAt: Date }> {
	const row = await ownedRow(db, opts.sessionId, opts.userId)
	if (row.archivedAt) throw new SessionArchiveRefusal(SESSION_ARCHIVE_REFUSALS.already)
	const [set] = await db
		.update(schema.sessions)
		.set({ archivedAt: new Date() })
		.where(and(eq(schema.sessions.id, opts.sessionId), isNull(schema.sessions.archivedAt)))
		.returning({ archivedAt: schema.sessions.archivedAt })
	if (!set?.archivedAt) throw new SessionArchiveRefusal(SESSION_ARCHIVE_REFUSALS.already)
	return { archivedAt: set.archivedAt }
}

/** Owner only. Refusals: missing, notOwner, notArchived. Clears archived_at. */
export async function unarchiveSession(
	db: Db,
	opts: { sessionId: number; userId: number }
): Promise<void> {
	const row = await ownedRow(db, opts.sessionId, opts.userId)
	if (!row.archivedAt) throw new SessionArchiveRefusal(SESSION_ARCHIVE_REFUSALS.notArchived)
	await db.update(schema.sessions).set({ archivedAt: null }).where(eq(schema.sessions.id, opts.sessionId))
}
