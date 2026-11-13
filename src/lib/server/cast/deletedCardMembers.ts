/**
 * ⏳ The `deleted-card-members` boot pass (owner 2026-11-10, ★RF-1: "Yes, if
 * the card is removed/deleted, populate the cast member with the deleted
 * content"; asked about members still linked to a card deleted before the
 * card-less conversion: "yes, build it"). Every cast member still linked to a
 * soft-deleted card is made card-less with the card's content by the steps a
 * card delete runs today (`sockets/characters.ts` `charactersDelete`):
 * `resolveFollows(tx, { cardId })`, then `makeMemberCardless(tx, member,
 * { cause: "card-delete" })` for each member linked to the card. No second
 * converter.
 *
 * Such members come from deletes before the ★3 card-less conversion
 * (2026-11-08) and from the attic ETL, which copies `character_id` without
 * asking whether the card was deleted. Serves only that old data: delete at
 * the RC1 squash, with the attic.
 *
 * - **Order.** After `seat-members` (a seat still empty is filled with the
 *   linked member first, as a delete fills seats before it converts; once
 *   card-less, nothing finds that member by its card, so running earlier would
 *   mint a second member for the same card) and after `character-versions`
 *   (`resolveFollows` changes only existing versions; before the lift there
 *   are none, and the card's words would be lost). Before `seat-keys`.
 * - **One transaction per card**, as the delete handler converts all of a
 *   card's members in its one transaction, and `resolveFollows` is keyed on
 *   the card. Only `tx` inside it. A card that throws is rolled back alone,
 *   counted in `failed`, logged by card and member ids, and the pass goes on;
 *   after the loop a non-zero `failed` throws one error naming the count, so
 *   the startup task (`failsHealth`) reports it.
 * - **Idempotent.** The candidate query names only members linked to a
 *   soft-deleted card, and the pass clears every such link, so a second boot
 *   reads that one query, selects nothing and writes nothing.
 * - No events (nothing is connected at boot), no `SeatChange`, no migration.
 *   Seats keep their member.
 */
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { resolveFollows } from "$lib/server/characters/versions"
import { makeMemberCardless } from "$lib/server/cast/cardless"

export interface DeletedCardMembersReport {
	/** Soft-deleted cards whose members were made card-less. */
	cards: number
	/** Cast members made card-less. */
	members: number
	/** Cards left as they were because their transaction threw. */
	failed: number
}

export async function deletedCardMembers(
	db: Db
): Promise<DeletedCardMembersReport> {
	const report: DeletedCardMembersReport = { cards: 0, members: 0, failed: 0 }
	const B = schema.lorebookBindings
	const C = schema.characters
	const linked = await db
		.select({ cardId: C.id, memberId: B.id })
		.from(B)
		.innerJoin(C, eq(C.id, B.characterId))
		.where(eq(C.isDeleted, true))
		.orderBy(asc(C.id), asc(B.id))
	const byCard = new Map<number, number[]>()
	for (const { cardId, memberId } of linked) {
		const members = byCard.get(cardId) ?? []
		members.push(memberId)
		byCard.set(cardId, members)
	}

	for (const [cardId, seen] of byCard) {
		try {
			const made = await db.transaction(async (tx) => {
				const t = tx as unknown as Db
				await resolveFollows(t, { cardId })
				const members = await t
					.select({ id: B.id })
					.from(B)
					.where(eq(B.characterId, cardId))
					.orderBy(asc(B.id))
				for (const m of members)
					await makeMemberCardless(t, m.id, { cause: "card-delete" })
				return members.length
			})
			report.cards++
			report.members += made
		} catch (err) {
			report.failed++
			console.error(
				`[deleted-card-members] deleted card ${cardId} and its cast member(s) ${seen.join(", ")} were left as they were:`,
				err
			)
		}
	}

	if (report.failed > 0)
		throw new Error(
			`${report.failed} deleted card(s) could not have their cast members made card-less; see the log`
		)
	return report
}
