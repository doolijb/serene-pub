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
 * `db` is passed in: a caller inside a transaction must hand its `tx` (the
 * outer handle deadlocks PGlite), and a test hands its own. The read check
 * (`canViewLorebook`) defaults to the app handle only so its two-argument
 * form serves callers with no transaction.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { db as appDb } from "$lib/server/db"
import { isSharedWith } from "$lib/server/utils/shares"

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

/**
 * How `userId` may READ a book (PLAN-private-messages §4 "Shares"):
 * `owner`, `shared` (a `lorebook_shares` row: read and copy, never write), or
 * `admin` — the existing administrator exception the entry reads make
 * (`entries.ts`: `book.userId !== userId && !socket.user?.isAdmin`). Null
 * when none applies, or the book is missing.
 *
 * Reads only. Every WRITE keeps `assertOwnedBook`, whatever this says.
 * `isAdmin` is the caller's when it has a socket in hand; absent, the
 * account row is read.
 */
export type LorebookAccess = "owner" | "shared" | "admin"

export async function lorebookAccessFor(
	lorebookId: unknown,
	userId: number | null | undefined,
	opts: { db?: Db; isAdmin?: boolean } = {}
): Promise<LorebookAccess | null> {
	if (userId == null || !Number.isSafeInteger(lorebookId)) return null
	const db = opts.db ?? (appDb as unknown as Db)
	const [book] = await db
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId as number))
		.limit(1)
	if (!book) return null
	if (book.userId === userId) return "owner"
	if (await isSharedWith(db, "lorebook", lorebookId as number, userId))
		return "shared"
	let isAdmin = opts.isAdmin
	if (isAdmin === undefined) {
		const [user] = await db
			.select({ isAdmin: schema.users.isAdmin })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.limit(1)
		isAdmin = !!user?.isAdmin
	}
	return isAdmin ? "admin" : null
}

/** Whether `userId` may read book `lorebookId`: owner · shared · admin. */
export async function canViewLorebook(
	lorebookId: number,
	userId: number,
	opts: { db?: Db; isAdmin?: boolean } = {}
): Promise<boolean> {
	return (await lorebookAccessFor(lorebookId, userId, opts)) !== null
}

/**
 * The read-side twin of `assertOwnedBook`: the access, if `userId` may READ
 * book `lorebookId` (owner · shared · admin); otherwise throws the SAME
 * `LOREBOOK_NOT_FOUND`, so a refusal never confirms the book exists.
 * Same argument order as `assertOwnedBook`; pass `tx` inside a transaction.
 * Reads only — a write that reaches for this instead of `assertOwnedBook`
 * hands a share recipient the pen.
 */
export async function assertReadableBook(
	db: Db,
	userId: number | null | undefined,
	lorebookId: unknown,
	opts: { isAdmin?: boolean } = {}
): Promise<OwnedBook & { access: LorebookAccess }> {
	const access = await lorebookAccessFor(lorebookId, userId, {
		db,
		isAdmin: opts.isAdmin
	})
	if (!access) throw new Error(LOREBOOK_NOT_FOUND)
	const [book] = await db
		.select({
			id: schema.lorebooks.id,
			name: schema.lorebooks.name,
			userId: schema.lorebooks.userId
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId as number))
		.limit(1)
	if (!book) throw new Error(LOREBOOK_NOT_FOUND)
	return { ...book, access }
}
