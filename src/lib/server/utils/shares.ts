/**
 * **Shares** — the explicit, revocable read grant one person gives another on
 * a character or a lorebook (PLAN-private-messages §2, §4 "Shares", §6.7).
 * Tables `character_shares` / `lorebook_shares`. A share grants read and copy;
 * every write path keeps its owner check. ⚠ Not a session guest (sessions are
 * never shared this way) and not the retired layout *share*.
 *
 * Every function takes `db` explicitly: a caller inside a transaction hands
 * its `tx` (the outer handle deadlocks PGlite), and a test hands its own.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { ConversationPerson } from "$lib/shared/sockets/conversations"

export type ShareKind = "character" | "lorebook"

/** The refusal for a recipient list naming someone who cannot receive. */
export const SHARE_RECIPIENT_REFUSED =
	"One of those people can't be shared with."

function sharesTable(kind: ShareKind) {
	return kind === "character"
		? {
				table: schema.characterShares,
				subject: schema.characterShares.characterId,
				user: schema.characterShares.userId
			}
		: {
				table: schema.lorebookShares,
				subject: schema.lorebookShares.lorebookId,
				user: schema.lorebookShares.userId
			}
}

/** Whether `subjectId` of `kind` is shared with `userId`. */
export async function isSharedWith(
	db: Db,
	kind: ShareKind,
	subjectId: number,
	userId: number
): Promise<boolean> {
	if (!Number.isSafeInteger(subjectId) || !Number.isSafeInteger(userId))
		return false
	const t = sharesTable(kind)
	const [row] = await db
		.select({ userId: t.user })
		.from(t.table)
		.where(and(eq(t.subject, subjectId), eq(t.user, userId)))
		.limit(1)
	return !!row
}

/**
 * The people `subjectId` is shared with, oldest share first. Soft-deleted
 * accounts are left out — the roster hides them (§3).
 */
export async function listSharedWith(
	db: Db,
	kind: ShareKind,
	subjectId: number
): Promise<ConversationPerson[]> {
	const t = sharesTable(kind)
	const rows = await db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			avatarMediaId: schema.users.avatarMediaId
		})
		.from(t.table)
		.innerJoin(schema.users, eq(schema.users.id, t.user))
		.where(and(eq(t.subject, subjectId), eq(schema.users.isDeleted, false)))
		.orderBy(asc(t.table.sharedAt), asc(schema.users.id))
	return rows
}

async function sharedIdsFor(
	db: Db,
	kind: ShareKind,
	userId: number
): Promise<number[]> {
	const t = sharesTable(kind)
	const rows = await db
		.select({ id: t.subject })
		.from(t.table)
		.where(eq(t.user, userId))
	return rows.map((r) => r.id)
}

/** Ids of every character shared with `userId` (list queries). */
export function sharedCharacterIdsFor(db: Db, userId: number) {
	return sharedIdsFor(db, "character", userId)
}

/** Ids of every lorebook shared with `userId` (list queries). */
export function sharedLorebookIdsFor(db: Db, userId: number) {
	return sharedIdsFor(db, "lorebook", userId)
}

/**
 * Replace the recipient set of `subjectId` with `userIds` (a **replace-set**:
 * unlisted recipients are revoked). Every id must be a live account other
 * than the owner; otherwise throws `SHARE_RECIPIENT_REFUSED` and writes
 * nothing. Owner checking is the CALLER's. Run it inside a transaction and
 * hand the `tx`.
 *
 * Resolves with who was added and who was removed, so the caller can tell
 * exactly the affected people.
 */
export async function replaceShares(
	tx: Db,
	kind: ShareKind,
	subjectId: number,
	ownerId: number,
	userIds: unknown
): Promise<{ added: number[]; removed: number[] }> {
	if (!Array.isArray(userIds)) throw new Error(SHARE_RECIPIENT_REFUSED)
	const wanted = [...new Set(userIds)]
	if (
		wanted.some((id) => !Number.isSafeInteger(id) || id === ownerId) ||
		wanted.length > 500
	)
		throw new Error(SHARE_RECIPIENT_REFUSED)
	const ids = wanted as number[]
	if (ids.length) {
		const live = await tx
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(and(inArray(schema.users.id, ids), eq(schema.users.isDeleted, false)))
		if (live.length !== ids.length) throw new Error(SHARE_RECIPIENT_REFUSED)
	}

	const t = sharesTable(kind)
	const current = (
		await tx.select({ id: t.user }).from(t.table).where(eq(t.subject, subjectId))
	).map((r) => r.id)
	const added = ids.filter((id) => !current.includes(id))
	const removed = current.filter((id) => !ids.includes(id))
	if (removed.length)
		await tx
			.delete(t.table)
			.where(and(eq(t.subject, subjectId), inArray(t.user, removed)))
	if (added.length) {
		if (kind === "character")
			await tx
				.insert(schema.characterShares)
				.values(added.map((userId) => ({ characterId: subjectId, userId })))
				.onConflictDoNothing()
		else
			await tx
				.insert(schema.lorebookShares)
				.values(added.map((userId) => ({ lorebookId: subjectId, userId })))
				.onConflictDoNothing()
	}
	return { added, removed }
}
