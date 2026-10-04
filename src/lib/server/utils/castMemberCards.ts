/**
 * Which cast member a card is, in one book (plan A25).
 *
 * A session seats a CARD (`session_characters.character_id`); the book holds
 * MEMBERS. A card is a member's when the member is linked to it
 * (`lorebook_bindings.character_id`), or when a cast amendment draws the member
 * with it from a date — a **dated card** — on any line and at any date. That is
 * who she is, not how one reading draws her: the young card and the keeper's
 * card are one person however far the story has got, so a seat holding either
 * finds her, and seating either never mints a second member.
 *
 * ⚠ **One card, one member.** A linked card wins over a dated one; between two
 * members whose dated changes name one card (only possible before
 * `amendments:create` refused it), the lowest member id. `cardTakenBy` is the
 * refusal's half.
 *
 * ⚠ This module must not statically import `$lib/server/db` — it is reached
 * from `characterBindingSync.ts`, which sits on the boot path (see its header).
 * Every function takes its handle, and a caller inside a transaction passes
 * its `tx`.
 */
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** Both directions of a book's card ↔ member map. */
export interface CastMemberCards {
	/** A card → the member it is. */
	memberOf: Map<number, number>
	/** A member → every card that is theirs: the linked card first, then each dated card. */
	cardsOf: Map<number, number[]>
}

/** The card a cast amendment's `fields` name, as SQL text (NULL when none). */
const datedCardSql = sql<string | null>`(${schema.castAmendments.fields}->>'characterId')`

/** A stored card id, or null for anything that is not a whole number. */
function cardIdOf(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value)
	return Number.isInteger(n) && n > 0 ? n : null
}

/** Every card of every member of one book — one read of each table. */
export async function castMemberCards(
	db: Db,
	lorebookId: number
): Promise<CastMemberCards> {
	const [linked, dated] = await Promise.all([
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
			.select({
				memberId: schema.castAmendments.lorebookBindingId,
				card: datedCardSql
			})
			.from(schema.castAmendments)
			.where(
				and(
					eq(schema.castAmendments.lorebookId, lorebookId),
					sql`${datedCardSql} IS NOT NULL`
				)
			)
			.orderBy(
				asc(schema.castAmendments.lorebookBindingId),
				asc(schema.castAmendments.id)
			)
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
	for (const row of dated) take(cardIdOf(row.card), row.memberId)
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
		.limit(1)
	if (linked) return linked.id
	const [dated] = await db
		.select({ memberId: schema.castAmendments.lorebookBindingId })
		.from(schema.castAmendments)
		.where(
			and(
				eq(schema.castAmendments.lorebookId, lorebookId),
				sql`${datedCardSql} = ${String(characterId)}`
			)
		)
		.orderBy(asc(schema.castAmendments.lorebookBindingId))
		.limit(1)
	return dated?.memberId ?? null
}

/**
 * The member OTHER than `memberId` who already has this card in the book — by
 * link or by a dated change — named for the refusal, or null when the card is
 * free for them.
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
	const [dated] = await db
		.select({ memberId: schema.castAmendments.lorebookBindingId })
		.from(schema.castAmendments)
		.where(
			and(
				eq(schema.castAmendments.lorebookId, lorebookId),
				sql`${datedCardSql} = ${String(characterId)}`,
				ne(schema.castAmendments.lorebookBindingId, memberId)
			)
		)
		.orderBy(asc(schema.castAmendments.lorebookBindingId))
		.limit(1)
	return dated ? namedMember(db, dated.memberId) : null
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
