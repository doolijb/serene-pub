/**
 * 🚧 Whose **lore write mode** governs a write, and what it is (plan A22,
 * ruled 2026-09-30). The modes and the one resolution rule are
 * `$lib/shared/lorebooks/loreWriteMode.ts`; this reads the two rows.
 *
 * ## The book owner's, always — tightened by the book
 *
 * A session's book is its owner's (`sessions:create` / `:update` check it),
 * and a run writes as the session's owner (`write.ts writerOf`). So the mode
 * that decides a session's book write is the BOOK OWNER's — a guest's turn
 * never picks the guest's mode, and a guest's Accept is refused by
 * authority before the mode is ever asked. The book's own mode
 * (`lorebooks.lore_write_mode`, 2026-10-21) can only make it stricter:
 * Personal > Lorebook > Session.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	effectiveLoreWriteMode,
	isLoreWriteMode,
	stricterLoreWriteMode,
	type LoreWriteMode
} from "$lib/shared/lorebooks/loreWriteMode"

/** A person's mode: their own choice, else the pub's (`effectiveLoreWriteMode`). */
export async function loreWriteModeFor(db: Db, userId: number | null | undefined): Promise<LoreWriteMode> {
	const [own] =
		userId == null
			? []
			: await db
					.select({ mode: schema.userSettings.loreWriteMode })
					.from(schema.userSettings)
					.where(eq(schema.userSettings.userId, userId))
					.limit(1)
	const [pub] = await db
		.select({ mode: schema.systemSettings.loreWriteModeDefault })
		.from(schema.systemSettings)
		.where(eq(schema.systemSettings.id, 1))
		.limit(1)
	return effectiveLoreWriteMode(own?.mode, pub?.mode)
}

/** The mode a book's writes follow: its owner's, tightened by the book's own. */
export async function bookLoreWriteMode(db: Db, lorebookId: number): Promise<LoreWriteMode> {
	const [book] = await db
		.select({ userId: schema.lorebooks.userId, mode: schema.lorebooks.loreWriteMode })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	const personal = await loreWriteModeFor(db, book?.userId ?? null)
	return isLoreWriteMode(book?.mode) ? stricterLoreWriteMode(personal, book.mode) : personal
}

/**
 * The mode a session's book writes follow: its book's (owner's, tightened by
 * the book) — the session's own user's when it reads no book (it then
 * writes none).
 */
export async function sessionLoreWriteMode(db: Db, sessionId: number): Promise<LoreWriteMode> {
	const [session] = await db
		.select({ userId: schema.sessions.userId, lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (session?.lorebookId != null) return bookLoreWriteMode(db, session.lorebookId)
	return loreWriteModeFor(db, session?.userId ?? null)
}
