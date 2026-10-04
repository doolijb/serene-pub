/**
 * The Part of check: where an entry may be filed (`anchor_entry_id`), and the
 * cast member it may be told about (`lorebookBindingId`).
 *
 * One function for every writer of the parent — `entries:create`,
 * `entries:update`, and a dated re-parent carried in an amendment's `fields`
 * (`amendments:create` / `amendments:update`) — so a parent the editor refuses
 * cannot arrive as of a date instead. The binding check is shared the same
 * way.
 */

import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { declaresParent } from "$lib/server/entries/declarations"
import { ENTRY_TYPE_LABEL, HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { MAX_ANCHOR_DEPTH } from "$lib/shared/lorebooks/limits"
import { isOnLine, type Line } from "$lib/shared/lorebooks/lineReading"

/**
 * A client-supplied anchor must name a binding in the *same* lorebook.
 *
 * Without this an entry could be linked to a binding row from another lorebook
 * (including another user's), permanently pinning that foreign binding as "in
 * use" for `syncLorebookBindings`' auto-create tracking — or, carried in a
 * dated overlay, read as another book's member at one moment.
 */
export async function assertAnchorInBook(
	bindingId: number | null | undefined,
	lorebookId: number,
	dbOrTx: Db = db
): Promise<void> {
	if (bindingId == null) return
	const binding = await dbOrTx.query.lorebookBindings.findFirst({
		where: eq(schema.lorebookBindings.id, bindingId),
		columns: { lorebookId: true }
	})
	if (!binding || binding.lorebookId !== lorebookId)
		throw new Error("That cast member is not in this lorebook.")
}

/**
 * A client-supplied parent entry, checked before it is written.
 *
 * Six refusals, and each names a different broken tree: a child whose type
 * declares no `parent` field role (a place — places plan B2, 2026-09-29: asked
 * of the role map, never of a type id), a parent in another lorebook (an entry
 * filed under something its book does not contain), a parent that does not
 * exist, the entry itself, a parent that exists only on another line than the
 * child, and a parent whose own chain of parents leads back to the entry being
 * moved. The last is the one that cannot be checked locally — hence the walk.
 * A null parent (the top level) is never refused, whatever the type.
 *
 * `entryId` is absent on a create: a row that does not exist yet cannot be its
 * own ancestor, so only the lorebook, existence and line refusals can fire.
 *
 * **The line rule has two readings.** A stored parent (`anchor_entry_id`)
 * cascades, so the parent must be shared or on the child's own line —
 * exactly. A dated overlay (`overlayLine`) cascades nothing; it is read on
 * the amendment's line, so its parent need only be on that line — shared, the
 * line's own, or an ancestor fork's.
 *
 * ⚠ The walk reads the STORED parents, never other amendments' overlays, and
 * that is wrong in both directions for a dated re-parent: a cycle made only of
 * overlays passes, and a swap that an earlier overlay made sound is refused
 * (the stored tree still holds the old order). Judging the tree AS OF the
 * amendment's moment — and at every later overlay's — is still open (not in
 * places plan B2).
 */
/**
 * What a refusal calls the entries of a type that is never filed: the type's
 * label, which is already plural for Places, and "History entries" for
 * history (owner, 2026-10-02: history is always top level), whose label is a
 * mass noun.
 */
function neverFiledNoun(typeId: string): string {
	if (typeId === HISTORY_TYPE_ID) return "History entries"
	return (
		ENTRY_TYPE_LABEL[typeId as keyof typeof ENTRY_TYPE_LABEL] ??
		"Entries of this kind"
	)
}

export async function assertAnchorEntry(
	anchorEntryId: number | null | undefined,
	lorebookId: number,
	entryId: number | undefined,
	/** The line the CHILD is on (null = shared). */
	childBranchId: number | null,
	/** The CHILD's entry type — bare id — whose declaration says if it is filed. */
	childTypeId: string,
	dbOrTx: Db = db,
	/**
	 * A dated overlay's reading line, in place of the stored-parent rule: the
	 * parent need only be on it. Absent for a stored `anchor_entry_id`.
	 */
	overlayLine?: Line
): Promise<void> {
	if (anchorEntryId == null) return
	if (!declaresParent(childTypeId))
		throw new Error(
			`${neverFiledNoun(childTypeId)} are never filed inside anything. Link them instead.`
		)
	if (entryId != null && anchorEntryId === entryId)
		throw new Error("An entry cannot be filed under itself.")

	let cursor: number | null = anchorEntryId
	for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth++) {
		if (cursor == null) return
		const row:
			| {
					lorebookId: number
					anchorEntryId: number | null
					branchId: number | null
			  }
			| undefined = await dbOrTx.query.lorebookEntries.findFirst({
			where: eq(schema.lorebookEntries.id, cursor),
			columns: { lorebookId: true, anchorEntryId: true, branchId: true }
		})
		if (!row) throw new Error("Parent entry not found.")
		if (row.lorebookId !== lorebookId)
			throw new Error("Parent entry not found.")
		// ⚠ The direct parent only: a parent that passes is itself under the
		// same rule. `anchor_entry_id` cascades, so a shared (or other-line)
		// entry filed under a line's own entry would be deleted with that
		// line — the child must be on the parent's line, or the parent shared.
		// An overlay cascades nothing: its parent must be readable on its line.
		const offLine = overlayLine
			? !isOnLine(row, overlayLine)
			: row.branchId != null && row.branchId !== childBranchId
		if (depth === 0 && offLine)
			throw new Error(
				childBranchId == null
					? "An entry on main cannot be filed under one that exists only on a branch."
					: "An entry cannot be filed under one that exists only on another line."
			)
		if (entryId != null && row.anchorEntryId === entryId)
			throw new Error(
				"That would file the entry under one of its own children."
			)
		cursor = row.anchorEntryId
	}
	throw new Error(`Entries may be nested ${MAX_ANCHOR_DEPTH} deep at most.`)
}
