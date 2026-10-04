import { sql } from "drizzle-orm"
import { db as defaultDb } from "$lib/server/db"

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
 * ⚠ An entry↔entry row whose twin already stands at the scene's date is left
 * undated: dating it would put the same link twice on
 * `narrative_relationships_entry_pair_uq`, and one violation fails this single
 * statement — every other row, cast rows included, went un-dated on every
 * boot. Only an entry↔entry row can collide (the index is partial), and two
 * rows filled here cannot collide with each other: both undated, they already
 * differ on the index key.
 *
 * Safe to call on every boot, like backfillMissingBindingNames.
 */
export async function backfillRelationshipHistoryEntries(
	dbInstance?: Db
): Promise<number> {
	const db = dbInstance ?? defaultDb
	const result = await db.execute(sql`
		UPDATE narrative_relationships AS nr
		SET history_entry_id = s.history_entry_id
		FROM scenes AS s
		WHERE nr.scene_id = s.id
		  AND nr.history_entry_id IS NULL
		  AND s.history_entry_id IS NOT NULL
		  AND NOT (
			nr.from_entry_id IS NOT NULL AND nr.to_entry_id IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM narrative_relationships AS twin
				WHERE twin.lorebook_id = nr.lorebook_id
				  AND twin.from_entry_id = nr.from_entry_id
				  AND twin.to_entry_id = nr.to_entry_id
				  AND lower(twin.relationship_type) = lower(nr.relationship_type)
				  AND lower(twin.title) = lower(nr.title)
				  AND coalesce(twin.branch_id, 0) = coalesce(nr.branch_id, 0)
				  AND twin.history_entry_id = s.history_entry_id
			)
		  )
	`)
	const filled = (result as { affectedRows?: number })?.affectedRows ?? 0
	if (filled > 0) {
		console.log(
			`Backfilled history entries onto ${filled} narrative relationship(s).`
		)
	}
	return filled
}
