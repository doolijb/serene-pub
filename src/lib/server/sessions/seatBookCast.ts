/**
 * 🚧 (M3b) The members a lorebook's cast seats at `sessions:create`.
 *
 * Owner ruling 2026-11-05, ★M3-4 "the book seats its cast, genre-declared":
 * a genre that declares `SessionShape.castFromLorebook` has the attached book
 * seat its cast members as the session's characters, whoever owns the cards;
 * reading follows the book's pub-wide access. P1: only that declaration calls
 * this — no other genre, no other door (not update, not attach).
 *
 * S4 (plan §34.2): it names **members**, card-less ones included, each with
 * its linked card (null: card-less). Never a member whose active card is a
 * persona card. A provided book seats **all** its members (owner ★S4-1; its
 * plugin-stamped cards stay hidden, so the card is no filter). The ids are
 * computed here from the book, never taken from a request, so the caller skips
 * the ownership check for exactly these rows. A member any of whose cards the
 * request already seats (`exclude`), or that the request already names
 * (`excludeMembers`), is skipped: one cast member is one character seat.
 *
 * ⚠ This module must not statically import `$lib/server/db`: it takes its
 * handle (a caller inside a transaction passes its `tx`).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { castMemberCards } from "$lib/server/utils/castMemberCards"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import {
	markedBook,
	providedBooksReadableBy
} from "$lib/server/plugins/providedMarks"

export async function bookCastToSeat(
	db: Db,
	{
		lorebookId,
		userId,
		isAdmin,
		exclude,
		excludeMembers
	}: {
		lorebookId: number
		userId: number
		isAdmin: boolean
		/** Cards the request already seats (its characters and personas); a member with any of them is not seated again. */
		exclude: ReadonlySet<number>
		/** Members the request already names (`castMemberIds`); they are not seated again. */
		excludeMembers?: ReadonlySet<number>
	}
): Promise<{ castMemberId: number; cardId: number | null }[]> {
	const [book] = await db
		.select({
			uuid: schema.lorebooks.uuid,
			extraJson: schema.lorebooks.extraJson
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!book) return []
	const mark = markedBook(book.extraJson, book.uuid)
	if (mark) {
		// A disabled or ownerless provided book seats nothing — for the admin owner too.
		if (
			!(await providedBooksReadableBy(db, userId, [lorebookId])).has(
				lorebookId
			)
		)
			return []
	} else {
		const { lorebookAccessFor } = await import(
			"$lib/server/utils/ownedBook"
		)
		if (
			(await lorebookAccessFor(lorebookId, userId, { db, isAdmin })) ===
			null
		)
			return []
	}
	// The book's members in its order (by id), overlay rows left out.
	const members = await db
		.select({
			id: schema.lorebookBindings.id,
			characterId: schema.lorebookBindings.characterId
		})
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				isNull(schema.lorebookBindings.overlayOf)
			)
		)
		.orderBy(asc(schema.lorebookBindings.id))
	if (!members.length) return []
	const { cardsOf } = await castMemberCards(db, lorebookId)
	// A member whose active card is a persona card is a player's, not the cast's.
	const read = await membersAsRead(
		db,
		members.map((m) => m.id),
		{}
	)
	const activeCards = [...read.values()]
		.map((m) => m.activeCardId)
		.filter((id): id is number => id != null)
	const personaCards = new Set(
		activeCards.length
			? (
					await db
						.select({ id: schema.characters.id })
						.from(schema.characters)
						.where(
							and(
								inArray(schema.characters.id, activeCards),
								eq(schema.characters.isPersona, true)
							)
						)
				).map((r) => r.id)
			: []
	)
	const seated: { castMemberId: number; cardId: number | null }[] = []
	for (const m of members) {
		if (excludeMembers?.has(m.id)) continue
		const activeCardId = read.get(m.id)?.activeCardId ?? null
		if (activeCardId != null && personaCards.has(activeCardId)) continue
		if ((cardsOf.get(m.id) ?? []).some((id) => exclude.has(id))) continue
		seated.push({ castMemberId: m.id, cardId: m.characterId })
	}
	return seated
}
