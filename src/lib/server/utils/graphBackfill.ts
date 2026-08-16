import { sql } from "drizzle-orm"
import { db as defaultDb } from "$lib/server/db"

type DbLike = typeof defaultDb

/**
 * Give scene-derived relationships the history entry they were always
 * associated with.
 *
 * graphBuilder used to set `historyEntryId` only for relationships extracted
 * from a *direct* history entry; anything derived from a scene got `sceneId`
 * and a null date, even though the scene knew its entry the whole time. That is
 * fixed at the source, but every relationship already in a user's graph still
 * carries the null — and a null date means the row cannot be placed on a
 * timeline, so the graph could not be read chronologically at all.
 *
 * The association is recoverable exactly, with no guessing: the scene the
 * relationship came from is recorded, and that scene points at its entry. This
 * only ever fills a NULL, so it cannot overwrite a date that is already set,
 * and it is naturally idempotent — a second run matches nothing.
 *
 * Safe to call on every boot, like backfillMissingBindingNames.
 */
export async function backfillRelationshipHistoryEntries(
	dbInstance?: DbLike
): Promise<number> {
	const db = dbInstance ?? defaultDb
	const result = await db.execute(sql`
		UPDATE narrative_relationships AS nr
		SET history_entry_id = s.history_entry_id
		FROM scenes AS s
		WHERE nr.scene_id = s.id
		  AND nr.history_entry_id IS NULL
		  AND s.history_entry_id IS NOT NULL
	`)
	const filled = (result as { affectedRows?: number })?.affectedRows ?? 0
	if (filled > 0) {
		console.log(
			`Backfilled history entries onto ${filled} narrative relationship(s).`
		)
	}
	return filled
}
