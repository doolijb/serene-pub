/**
 * Which cast member a card is, in one book (plan A25).
 *
 * A session seats a CARD (`session_characters.character_id`); the book holds
 * MEMBERS. A card is a member's when the member is linked to it
 * (`lorebook_bindings.character_id`), when one of the member's cast versions
 * has a parent card version of that card (plan §31 §8: a cast version's parent
 * is how a member is drawn with a card — a **dated card**), on any line and at
 * any date. That is who she is, not how one reading draws her: the young card
 * and the keeper's card are one person however far the story has got, so a seat
 * holding either finds her, and seating either never mints a second member.
 *
 * ⚠ **One card, one member.** A linked card wins over a version's parent;
 * between two members that both name one card through a version, the lowest
 * member id. `cardTakenBy` is the refusal's half.
 *
 * ⚠ This module must not statically import `$lib/server/db` — it is reached
 * from `characterBindingSync.ts`, which sits on the boot path (see its header).
 * Every function takes its handle, and a caller inside a transaction passes
 * its `tx`.
 */
import { and, asc, eq, isNotNull, ne } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"

/** Both directions of a book's card ↔ member map. */
export interface CastMemberCards {
	/** A card → the member it is. */
	memberOf: Map<number, number>
	/** A member → every card that is theirs: the linked card first, then each cast version's parent card. */
	cardsOf: Map<number, number[]>
}

/**
 * A cast version and its parent card version (aliased): the parent's card is
 * a card the version's member is drawn with. A cast version carries its
 * book (`lorebook_id`).
 */
function versionAndParent() {
	return {
		cv: schema.characterVersions,
		parent: alias(schema.characterVersions, "parent_version")
	}
}

/** Every card of every member of one book — one read of each table. */
export async function castMemberCards(
	db: Db,
	lorebookId: number
): Promise<CastMemberCards> {
	const { cv, parent } = versionAndParent()
	const [linked, versioned] = await Promise.all([
		db
			.select({
				id: schema.lorebookBindings.id,
				characterId: schema.lorebookBindings.characterId
			})
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, lorebookId),
					isNotNull(schema.lorebookBindings.characterId)
				)
			)
			.orderBy(asc(schema.lorebookBindings.id)),
		db
			.select({ memberId: cv.castMemberId, card: parent.cardId })
			.from(cv)
			.innerJoin(parent, eq(parent.id, cv.parentVersionId))
			.where(
				and(
					eq(cv.lorebookId, lorebookId),
					isNotNull(cv.castMemberId),
					isNotNull(parent.cardId)
				)
			)
			.orderBy(asc(cv.castMemberId), asc(cv.id))
	])
	const memberOf = new Map<number, number>()
	const cardsOf = new Map<number, number[]>()
	const take = (card: number | null, memberId: number) => {
		if (card == null) return
		if (!memberOf.has(card)) memberOf.set(card, memberId)
		const cards = cardsOf.get(memberId) ?? []
		if (!cards.includes(card)) cards.push(card)
		cardsOf.set(memberId, cards)
	}
	for (const row of linked) take(row.characterId, row.id)
	for (const row of versioned)
		if (row.memberId != null) take(row.card, row.memberId)
	return { memberOf, cardsOf }
}

/** The member one card is in one book, or null. */
export async function memberOfCard(
	db: Db,
	lorebookId: number,
	characterId: number
): Promise<number | null> {
	const [linked] = await db
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(schema.lorebookBindings.characterId, characterId)
			)
		)
		.orderBy(asc(schema.lorebookBindings.id))
		.limit(1)
	if (linked) return linked.id
	const { cv, parent } = versionAndParent()
	const [versioned] = await db
		.select({ memberId: cv.castMemberId })
		.from(cv)
		.innerJoin(parent, eq(parent.id, cv.parentVersionId))
		.where(
			and(
				eq(cv.lorebookId, lorebookId),
				isNotNull(cv.castMemberId),
				eq(parent.cardId, characterId)
			)
		)
		.orderBy(asc(cv.castMemberId))
		.limit(1)
	return versioned?.memberId ?? null
}

/**
 * The member OTHER than `memberId` who already has this card in the book — by
 * link or by a cast version's parent — named for the
 * refusal, or null when the card is free for them.
 */
export async function cardTakenBy(
	db: Db,
	lorebookId: number,
	characterId: number,
	memberId: number
): Promise<{ id: number; name: string } | null> {
	const [linked] = await db
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(schema.lorebookBindings.characterId, characterId),
				ne(schema.lorebookBindings.id, memberId)
			)
		)
		.limit(1)
	if (linked) return namedMember(db, linked.id)
	const { cv, parent } = versionAndParent()
	const [versioned] = await db
		.select({ memberId: cv.castMemberId })
		.from(cv)
		.innerJoin(parent, eq(parent.id, cv.parentVersionId))
		.where(
			and(
				eq(cv.lorebookId, lorebookId),
				isNotNull(cv.castMemberId),
				ne(cv.castMemberId, memberId),
				eq(parent.cardId, characterId)
			)
		)
		.orderBy(asc(cv.castMemberId))
		.limit(1)
	return versioned?.memberId != null
		? namedMember(db, versioned.memberId)
		: null
}

async function namedMember(
	db: Db,
	id: number
): Promise<{ id: number; name: string }> {
	const [row] = await db
		.select({ name: schema.lorebookBindings.name })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, id))
		.limit(1)
	return { id, name: row?.name?.trim() || "Another cast member" }
}
