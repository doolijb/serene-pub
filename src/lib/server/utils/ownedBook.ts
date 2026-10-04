/**
 * One lorebook ownership check (plan B3).
 *
 * Every socket that acts on a book asks the same question — *is this book
 * this user's?* — and it was asked three dozen ways: `findOwnedBook` copied
 * verbatim into three files, an `assertOwnedBook` in a fourth, and inline
 * `lorebooks.findFirst` checks everywhere else, refusing in two wordings.
 *
 * ⚠ **One refusal: "Lorebook not found."** Another user's book reads exactly as
 * a missing one, so a refusal never confirms that an id exists. The longer
 * "…or access denied." told the asker the id was real.
 *
 * `db` is passed in, never imported here: a caller inside a transaction must
 * hand its `tx` (the outer handle deadlocks PGlite), and a test hands its own.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The refusal every lorebook verb gives a book that is missing or not the asker's. */
export const LOREBOOK_NOT_FOUND = "Lorebook not found."

/** What the check hands back: enough to name the book and its owner. */
export interface OwnedBook {
	id: number
	name: string
	userId: number
}

/** The book, if `userId` owns it; otherwise undefined. A non-integer id owns nothing. */
export async function findOwnedBook(
	db: Db,
	userId: number | null | undefined,
	lorebookId: unknown
): Promise<OwnedBook | undefined> {
	if (userId == null || !Number.isInteger(lorebookId)) return undefined
	const [book] = await db
		.select({
			id: schema.lorebooks.id,
			name: schema.lorebooks.name,
			userId: schema.lorebooks.userId
		})
		.from(schema.lorebooks)
		.where(
			and(
				eq(schema.lorebooks.id, lorebookId as number),
				eq(schema.lorebooks.userId, userId)
			)
		)
		.limit(1)
	return book
}

/** The book, if `userId` owns it; otherwise throws `LOREBOOK_NOT_FOUND`. */
export async function assertOwnedBook(
	db: Db,
	userId: number | null | undefined,
	lorebookId: unknown
): Promise<OwnedBook> {
	const book = await findOwnedBook(db, userId, lorebookId)
	if (!book) throw new Error(LOREBOOK_NOT_FOUND)
	return book
}
