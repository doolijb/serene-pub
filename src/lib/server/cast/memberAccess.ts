/**
 * 🚧 Who may read and who may edit a cast member's own art (its sprite sets
 * and its gallery). One module, so the socket families and the copy rule
 * answer the same question the same way.
 *
 * READ is the member-art rule `media/access.ts` states for its files: whoever
 * may read the member's book, or anyone in a session that seats the member.
 * EDIT is narrower: whoever may edit the member's book (`findOwnedBook`: its
 * owner; a session's own notes are its owner's), or the owner of the character
 * card the member is linked to while that member is seated in a session they
 * are in (a guest manages the card they brought). A share recipient, a session
 * guest and an administrator read; none of them write otherwise.
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

/** The sessions that seat the member (a character seat or a player seat, not removed). */
async function seatedSessionIds(db: Db, castMemberId: number): Promise<Set<number>> {
	const seated = [
		...(await db
			.select({ sessionId: schema.sessionCharacters.sessionId })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.castMemberId, castMemberId),
					isNull(schema.sessionCharacters.removedAt)
				)
			)),
		...(await db
			.select({ sessionId: schema.sessionPersonas.sessionId })
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.castMemberId, castMemberId),
					isNull(schema.sessionPersonas.removedAt)
				)
			))
	]
	return new Set(seated.map((s) => s.sessionId))
}

/**
 * 🚧 The member, if `userId` may read its art: anyone who can read its book
 * (owner, shared, a live provided book, a session's own notes for its owner;
 * an administrator unless `opts.isAdmin` is false), or anyone in a
 * session that seats it (which is how a guest reads the notes' members). Null
 * otherwise, and when the member is missing — a refusal never confirms the
 * member exists.
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
	for (const sessionId of await seatedSessionIds(db, member.id))
		if ((await checkSessionAccess(sessionId, userId, db)).hasAccess)
			return member
	return null
}

/**
 * 🚧 The member, if `userId` may edit its book (`findOwnedBook`: the book's
 * owner; a session's own notes are its owner's), or owns the character card
 * the member is linked to and the member is seated in a session `userId` is
 * in. Nothing else of the notes opens by this. Null otherwise.
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
	if (book) return { ...member, bookOwnerId: book.userId }
	return (await ownCardSeatedIn(db, member, userId)) ?? null
}

/** The member, when its linked card is `userId`'s and it is seated in a session they are in. */
async function ownCardSeatedIn(
	db: Db,
	member: CastMemberRef,
	userId: number
): Promise<EditableCastMember | null> {
	const [row] = await db
		.select({
			cardOwnerId: schema.characters.userId,
			bookOwnerId: schema.lorebooks.userId
		})
		.from(schema.lorebookBindings)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.lorebookBindings.characterId)
		)
		.innerJoin(
			schema.lorebooks,
			eq(schema.lorebooks.id, schema.lorebookBindings.lorebookId)
		)
		.where(eq(schema.lorebookBindings.id, member.id))
		.limit(1)
	if (!row || row.cardOwnerId !== userId) return null
	for (const sessionId of await seatedSessionIds(db, member.id))
		if ((await checkSessionAccess(sessionId, userId, db)).hasAccess)
			return { ...member, bookOwnerId: row.bookOwnerId }
	return null
}
