// Shared find-or-create for per-user tags. Case-insensitive + trimmed so
// importing a card tagged "fantasy" when the user already has "Fantasy"
// adopts the existing tag instead of creating a case-variant duplicate —
// backed by the tags_user_id_name_unique expression index (userId,
// lower(name)) in schema.ts.
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"

type Executor =
	| PgliteDatabase<typeof schema>
	| PgliteTransaction<
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >

/**
 * Finds an existing tag for this user matching `rawName` (trimmed,
 * case-insensitive), or creates one. Accepts an optional transaction
 * handle so callers running inside a larger `db.transaction(...)` (eg. the
 * lorebook-import restore path) can pass it through and stay atomic —
 * every query here uses `dbOrTx`, never the module `db`, so a caller that
 * does pass a `tx` never silently escapes it.
 */
export async function findOrCreateTagId(
	userId: number,
	rawName: string,
	dbOrTx: Executor = db
): Promise<number | null> {
	const name = rawName.trim()
	if (!name) return null

	const existing = await dbOrTx.query.tags.findFirst({
		where: (t, { and, eq, sql }) =>
			and(eq(t.userId, userId), sql`lower(${t.name}) = lower(${name})`)
	})
	if (existing) return existing.id

	try {
		const [created] = await dbOrTx
			.insert(schema.tags)
			.values({ name, userId })
			.returning()
		return created.id
	} catch (e) {
		// Concurrent create of the same name — fall back to the row the
		// other request just committed instead of surfacing the conflict.
		const existing2 = await dbOrTx.query.tags.findFirst({
			where: (t, { and, eq, sql }) =>
				and(eq(t.userId, userId), sql`lower(${t.name}) = lower(${name})`)
		})
		if (existing2) return existing2.id
		throw e
	}
}
