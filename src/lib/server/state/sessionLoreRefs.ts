/**
 * What sessions hold of one book's entries, outside the stats the book owns
 * (plan A13): an item in a character's pack, the place a character — or the
 * party — is in. These are lore references (`{ entryId }`) inside values on a
 * session's own layer over a character (`session_cast`) or over its world
 * (`session`); `purgeLorebook` never reaches them, since their owner is
 * the character or the session, not the book.
 *
 * An overwrite import replaces every entry of the book under new ids, so each
 * of these would name nothing afterwards. It drops them
 * (`dropSessionLoreRefs`), and its conflict prompt counts them first
 * (`countSessionLoreRefs`, `overwriteLosses`). Both read one list
 * (`sessionLoreRefHolders`), so the count and the drop cannot drift apart.
 *
 * ⚠ A reference is its listed entry, never a namesake (NOMENCLATURE §9,
 * _undescribed_): the file's entry of the same title is a new row, and is not
 * guessed to be the same thing.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { isSlotLoreRef } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

/** The owner kinds whose session values can hold another owner's entries. */
const HOLDER_KINDS = ["session", "session_cast"] as const

/** One stored value that holds at least one of the book's entries. */
interface SessionLoreRefHolder {
	id: number
	sessionId: number
	ownerKind: string
	ownerId: number
	slotId: string
	value: { v?: unknown } & Record<string, unknown>
	/** The book's entries this value names. */
	entryIds: number[]
}

/**
 * Every session value (`session`, `session_cast`) that names one of the
 * book's entries, on any line. Call it before the entries are deleted.
 */
export async function sessionLoreRefHolders(
	tx: Db,
	lorebookId: number
): Promise<SessionLoreRefHolder[]> {
	const book = new Set(
		(
			await tx
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		).map((r) => r.id)
	)
	if (!book.size) return []
	const v = schema.attributeValues
	const rows = await tx
		.select({
			id: v.id,
			sessionId: v.sessionId,
			ownerKind: v.ownerKind,
			ownerId: v.ownerId,
			slotId: v.slotId,
			value: v.value
		})
		.from(v)
		.where(
			and(
				isNotNull(v.sessionId),
				inArray(v.ownerKind, [...HOLDER_KINDS]),
				// Only a value that holds a reference at all is read whole.
				sql`${v.value}::text LIKE '%"entryId"%'`
			)
		)
	const holders: SessionLoreRefHolder[] = []
	for (const row of rows) {
		const value = row.value as SessionLoreRefHolder["value"]
		const held = Array.isArray(value?.v) ? value.v : [value?.v]
		const entryIds = held
			.filter(isSlotLoreRef)
			.map((ref) => ref.entryId)
			.filter((id) => book.has(id))
		if (entryIds.length)
			holders.push({ ...row, sessionId: row.sessionId!, value, entryIds })
	}
	return holders
}

/**
 * How many things sessions hold of the book's entries: one per entry held in
 * one slot of one owner in one session, however many dated values repeat it.
 */
export async function countSessionLoreRefs(tx: Db, lorebookId: number): Promise<number> {
	const held = new Set<string>()
	for (const h of await sessionLoreRefHolders(tx, lorebookId))
		for (const entryId of h.entryIds)
			held.add(`${h.sessionId}:${h.ownerKind}:${h.ownerId}:${h.slotId}:${entryId}`)
	return held.size
}

/**
 * Drop every reference a session holds to the book's entries, ahead of the
 * entries' delete, inside its transaction (`tx` only): a list keeps its
 * other items (an empty list stays, so the pack reads empty rather than the
 * book's starting pack); a value that is one reference — a place — is
 * deleted, so the session reads the layer beneath it.
 */
export async function dropSessionLoreRefs(tx: Db, lorebookId: number): Promise<void> {
	const v = schema.attributeValues
	for (const h of await sessionLoreRefHolders(tx, lorebookId)) {
		if (!Array.isArray(h.value.v)) {
			await tx.delete(v).where(eq(v.id, h.id))
			continue
		}
		const gone = new Set(h.entryIds)
		await tx
			.update(v)
			.set({
				value: {
					...h.value,
					v: h.value.v.filter((item) => !(isSlotLoreRef(item) && gone.has(item.entryId)))
				}
			})
			.where(eq(v.id, h.id))
	}
}
