/**
 * A copy of a lorebook, made row for row inside one transaction.
 *
 * ⚠ **Duplicate is an exact copy** (owner ruling 2026-09-28, superseding the
 * earlier "one copier, and it is the exporter" design). A copy that went out
 * through the file format and back in carried only what the file carried —
 * main-line entries only in spirit, no branches, no amendments, no presences,
 * no tags, places and items flattened to World lore, and unowned cards
 * unlinked. So this reads every row the book owns and writes it again under
 * new ids, remapping every reference between them:
 *
 * - branches (with the parent chain — a fork of a fork keeps its grandparent —
 *   and fork dates), entries (every line, archived rows, provenance, positions,
 *   declared fields such as an item's supply), bindings (the real
 *   `characterId`, even for a card another user owns; tokens; sprite set; the
 *   book's `nextBindingNumber`), entry and cast amendments (ids inside an
 *   amendment's `fields` are remapped too), cast presences, links of both
 *   endpoint kinds, scenes and their cast, tags, the story calendar and clock,
 *   the attribute rows the book and its members own at the template layer,
 *   dismissed duplicate pairs, binding suggestions, entry vectors, entry
 *   annotations (an `entry:<id>` entity key names the copy's entry) and the
 *   stat sheets the book and its members hold.
 *
 * Which rows those are, and how each table is copied, is the lorebook table
 * registry's (`lorebooks/tableRegistry.ts`, plan B1): this copies the book
 * row and runs every registered table's copy, so a table added there travels
 * here with no code of its own.
 *
 * What deliberately does NOT travel:
 * - a scene's **session capture** (`sessionId`, `selectedMessageIds`) — those
 *   name messages in a session that reads the ORIGINAL book; a copy that kept
 *   them would show every captured scene twice in that session.
 * - session-layer attribute rows (they belong to the session, not the book).
 * - `binding_merge_logs` — an undo record of an operation done to the
 *   original's rows; undoing it on the copy would restore into the wrong book.
 * - the uuid (the copy is a new book; a re-import of the original's file must
 *   still find the original).
 *
 * ⚠ Every statement runs on `tx`. The outer `db` inside this transaction
 * deadlocks PGlite silently.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { copyLorebookTables, type IdMap } from "$lib/server/lorebooks/tableRegistry"

export interface DuplicatedLorebook {
	id: number
	/** Source id → copy id, per table — returned for tests and callers. */
	maps: {
		branches: IdMap
		bindings: IdMap
		entries: IdMap
		scenes: IdMap
	}
}

/**
 * Copies `sourceId` (which the caller has already confirmed `userId` owns)
 * into a new book named `name`, owned by `userId`. Must be called with a
 * transaction handle.
 */
export async function duplicateLorebookRows(
	tx: Db,
	sourceId: number,
	userId: number,
	name: string
): Promise<DuplicatedLorebook> {
	const [source] = await tx
		.select()
		.from(schema.lorebooks)
		.where(
			and(
				eq(schema.lorebooks.id, sourceId),
				eq(schema.lorebooks.userId, userId)
			)
		)
	if (!source) throw new Error("Lorebook not found.")

	const {
		id: _id,
		uuid: _uuid,
		createdAt: _createdAt,
		updatedAt: _updatedAt,
		...bookColumns
	} = source
	const [book] = await tx
		.insert(schema.lorebooks)
		.values({ ...bookColumns, name, userId })
		.returning({ id: schema.lorebooks.id })
	const newId = book.id

	const { branches, bindings, entries, scenes } = await copyLorebookTables(
		tx,
		sourceId,
		newId
	)

	// Keep the counter past every token the copy holds, whatever the source's
	// column said (a hand-edited or legacy book may be behind its own tokens).
	const tokens = await tx
		.select({ binding: schema.lorebookBindings.binding })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, newId))
	let maxToken = 0
	for (const row of tokens) {
		const n = Number(/:(\d+)\}\}?$/.exec(row.binding)?.[1])
		if (Number.isInteger(n) && n > maxToken) maxToken = n
	}
	if (maxToken > 0)
		await tx
			.update(schema.lorebooks)
			.set({
				nextBindingNumber: sql`GREATEST(${schema.lorebooks.nextBindingNumber}, ${maxToken + 1})`
			})
			.where(eq(schema.lorebooks.id, newId))

	return { id: newId, maps: { branches, bindings, entries, scenes } }
}
