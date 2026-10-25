/**
 * 🚧 **Forget** — a note the Assistant kept, taken back (★K, lane 2,
 * 2026-10-19; the `forget` tool, `tools/writeTools.ts`).
 *
 * Only what a pipeline wrote can be taken back this way: a world-lore entry
 * whose provenance is `pipeline`, named exactly (any case), in the books
 * this session keeps its notes in — its own notes, and the lorebook it reads
 * when the session's owner owns it. A person's own entry is never touched,
 * and nothing is deleted: the entry is archived, which every reader skips
 * and the lorebook's own Archived view can restore.
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

const WORLD_LORE = "core:entry/world-lore"

/** Archive the notes named `name`; the ids archived (none when nothing matched). */
export async function forgetNote(db: Db, sessionId: number, name: string): Promise<number[]> {
	const wanted = name.trim().toLowerCase()
	if (!wanted) return []
	const [session] = await db
		.select({ userId: schema.sessions.userId, lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return []
	const books: number[] = []
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const notes = await ownBookOf(db, sessionId)
	if (notes) books.push(notes.id)
	if (session.lorebookId != null) {
		const [book] = await db
			.select({ userId: schema.lorebooks.userId })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, session.lorebookId))
			.limit(1)
		if (book?.userId === session.userId) books.push(session.lorebookId)
	}
	if (!books.length) return []
	const rows = await db
		.update(schema.lorebookEntries)
		.set({ archived: true })
		.where(
			and(
				inArray(schema.lorebookEntries.lorebookId, books),
				eq(schema.lorebookEntries.provenance, "pipeline"),
				sql`split_part(${schema.lorebookEntries.typeId}, '@', 1) = ${WORLD_LORE}`,
				eq(schema.lorebookEntries.archived, false),
				sql`lower(trim(${schema.lorebookEntries.title})) = ${wanted}`
			)
		)
		.returning({ id: schema.lorebookEntries.id })
	return rows.map((r: { id: number }) => r.id)
}
