/**
 * 🚧 Who may sit at a session (`GenreDecl.members`, ruled 2026-10-19): a
 * `'solo'` genre refuses guests; `'group'` is every other genre.
 *
 * Its own module so the guest door (`sessions:addGuest`) reads the policy
 * without reaching into the genre listing's module for it.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { listSessionGenres, STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"

export async function sessionMembersPolicy(db: Db, sessionId: number): Promise<"solo" | "group"> {
	try {
		const [row] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row) return "group"
		const genreId = row.genreId ?? STANDARD_GENRE_ID
		const genre = (await listSessionGenres(db)).find((g) => g.genreId === genreId)
		return genre?.members === "solo" ? "solo" : "group"
	} catch {
		return "group"
	}
}
