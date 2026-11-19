/**
 * The only writers of a session's `genre_fields` and `rigour` columns (P2: a
 * module owns its data and every write to it). Every update of either column
 * goes through one of the two functions below, inside the caller's own
 * transaction and after the caller's own permission checks; a source-scanning
 * test (`settingsWrite.guard.test.ts`) fails on any other update and names
 * the few writes that are not updates (a new row) or are data passes.
 *
 * Each re-reads the column inside the transaction it is handed, so a change
 * that landed after the caller read the row is never lost, and writes only
 * when the result differs from what is stored. `tx` only: called inside
 * `db.transaction`, it must be handed that transaction's handle.
 *
 * A leaf module: it imports the schema and drizzle and nothing else, so the
 * form door, the socket handlers, the author's note and voice resolution can
 * all import it without pulling in one another.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

type GenreFields = Record<string, unknown>

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * 🚧 Write a session's genre fields. `change` receives a shallow copy of what
 * is stored now (`{}` when nothing is), read inside `tx`; it returns the
 * fields to store, or `null` to store nothing. Nothing is written when the
 * session does not exist, `change` answers `null`, or the answer equals what
 * is stored. Returns whether it wrote and the genre fields as stored after.
 */
export async function writeGenreFields(
	tx: Db,
	sessionId: number,
	change: (current: GenreFields) => GenreFields | null
): Promise<{ written: boolean; genreFields: GenreFields }> {
	const [row] = await tx
		.select({ genreFields: schema.sessions.genreFields })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.for("update")
		.limit(1)
	if (!row) return { written: false, genreFields: {} }
	const stored = (row.genreFields ?? {}) as GenreFields
	const next = change({ ...stored })
	if (next === null || sameJson(next, stored))
		return { written: false, genreFields: stored }
	await tx
		.update(schema.sessions)
		.set({ genreFields: next })
		.where(eq(schema.sessions.id, sessionId))
	return { written: true, genreFields: next }
}

/**
 * 🚧 Write a session's How strict (`rigour`). Re-read inside `tx`; written
 * only when the session exists and the value differs from what is stored.
 * Which values are allowed is the caller's to check. Returns whether it wrote.
 */
export async function writeRigour(
	tx: Db,
	sessionId: number,
	value: string
): Promise<boolean> {
	const [row] = await tx
		.select({ rigour: schema.sessions.rigour })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.for("update")
		.limit(1)
	if (!row || row.rigour === value) return false
	await tx
		.update(schema.sessions)
		.set({ rigour: value })
		.where(eq(schema.sessions.id, sessionId))
	return true
}
