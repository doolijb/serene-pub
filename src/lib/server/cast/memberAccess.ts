/**
 * 🚧 Who may read and who may edit a cast member's own art (its sprite sets
 * and its gallery). One module, so the socket families and the copy rule
 * answer the same question the same way.
 *
 * READ is the member-art rule `media/access.ts` states for its files: whoever
 * may read the member's book, or anyone in a session that seats the member.
 * EDIT is narrower: whoever may edit the member's book (`findOwnedBook`: its
 * owner, or a session's own notes for its members). A share recipient, a
 * session guest and an administrator read; none of them write.
 */
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { findOwnedBook, lorebookAccessFor } from "$lib/server/utils/ownedBook"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"

/** The member and the book it lives in. */
export interface CastMemberRef {
	id: number
	lorebookId: number
}

/** The member, its book, and the book's owner (whose files the member's art is). */
export interface EditableCastMember extends CastMemberRef {
	bookOwnerId: number
}

async function memberRow(
	db: Db,
	castMemberId: unknown
): Promise<CastMemberRef | null> {
	if (!Number.isSafeInteger(castMemberId)) return null
	const [member] = await db
		.select({
			id: schema.lorebookBindings.id,
			lorebookId: schema.lorebookBindings.lorebookId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, castMemberId as number))
		.limit(1)
	return member ?? null
}

/**
 * 🚧 The member, if `userId` may read its art: anyone who can read its book
 * (owner, shared, a live provided book, a session's own notes for its
 * members; an administrator unless `opts.isAdmin` is false), or anyone in a
 * session that seats it. Null otherwise, and when the member is missing —
 * a refusal never confirms the member exists.
 */
export async function canReadCastMember(
	db: Db,
	castMemberId: number,
	userId: number,
	opts: { isAdmin?: boolean } = {}
): Promise<CastMemberRef | null> {
	const member = await memberRow(db, castMemberId)
	if (!member) return null
	if (
		await lorebookAccessFor(member.lorebookId, userId, {
			db,
			isAdmin: opts.isAdmin
		})
	)
		return member
	const seated = [
		...(await db
			.select({ sessionId: schema.sessionCharacters.sessionId })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.castMemberId, member.id),
					isNull(schema.sessionCharacters.removedAt)
				)
			)),
		...(await db
			.select({ sessionId: schema.sessionPersonas.sessionId })
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.castMemberId, member.id),
					isNull(schema.sessionPersonas.removedAt)
				)
			))
	]
	for (const sessionId of new Set(seated.map((s) => s.sessionId)))
		if ((await checkSessionAccess(sessionId, userId, db)).hasAccess)
			return member
	return null
}

/**
 * 🚧 The member, if `userId` may edit its book (`findOwnedBook`): the book's
 * owner, or a member of the session whose own notes it is. Null otherwise.
 * `bookOwnerId` is the owner of the book, whose files the member's art is.
 */
export async function canEditCastMember(
	db: Db,
	castMemberId: number,
	userId: number
): Promise<EditableCastMember | null> {
	const member = await memberRow(db, castMemberId)
	if (!member) return null
	const book = await findOwnedBook(db, userId, member.lorebookId)
	if (!book) return null
	return { ...member, bookOwnerId: book.userId }
}
