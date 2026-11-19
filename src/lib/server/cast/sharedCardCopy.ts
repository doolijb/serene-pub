/**
 * 🚧 A copy of a card someone shared with the asker, made into a new member
 * of a session's notes.
 *
 * Why it exists: owner rulings Q3 (2026-10-12: a shared character is "read
 * and copy, never use-as-cast"; "a shared character is copied before it can
 * join a session"), G3 (2026-11-16: "shared cards are copied into the lorebook
 * unlinked") and C1 (2026-11-17: the copy lands in the session's notes, the
 * session's own book).
 *
 * It owns making the copy: a new card-less cast member carrying the card's
 * words, sheets, sprites, gallery and faces, with no link back to the card
 * (no `character_id`, no version parented on the card's versions). It does
 * not own seating the asker on it (`sessions/seats.ts`) nor the share itself
 * (`utils/shares.ts`).
 *
 * It takes its handle first and never statically imports `$lib/server/db`.
 * Runs on the caller's `tx`.
 */
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	ensureCardVersion,
	insertCastMemberCopy,
	insertCharacterVersions,
	writeBackShownName
} from "$lib/server/characters/versions"
import { makeMemberCardless } from "$lib/server/cast/cardless"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { isSharedWith } from "$lib/server/utils/shares"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import {
	CHARACTER_PROFILE_FIELDS,
	emptyCharacterProfile
} from "$lib/shared/characters/profile"

export const SHARED_CARD_REFUSALS = {
	notShared:
		"Only a character someone shared with you can be copied into a session."
}

/** Null when `userId` may copy the card: it exists, is not deleted, is not theirs, and is shared with them. */
export async function sharedCardRefusal(
	db: Db,
	cardId: number,
	userId: number
): Promise<string | null> {
	const [card] = await db
		.select({
			userId: schema.characters.userId,
			isDeleted: schema.characters.isDeleted
		})
		.from(schema.characters)
		.where(eq(schema.characters.id, cardId))
	if (!card || card.isDeleted || card.userId === userId)
		return SHARED_CARD_REFUSALS.notShared
	if (!(await isSharedWith(db, "character", cardId, userId)))
		return SHARED_CARD_REFUSALS.notShared
	return null
}

/** Makes the copy in the session's notes; a refusal is thrown as its sentence. */
export async function copySharedCard(
	tx: Db,
	input: { sessionId: number; cardId: number; userId: number }
): Promise<{ castMemberId: number; name: string; lorebookId: number }> {
	const { sessionId, cardId, userId } = input
	const refusal = await sharedCardRefusal(tx, cardId, userId)
	if (refusal) throw new Error(refusal)
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const { id: lorebookId } = await ownBookFor(tx, sessionId)
	await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
	const token = await deriveNextBindingToken(lorebookId, tx)

	const [card] = await tx
		.select({ name: schema.characters.name })
		.from(schema.characters)
		.where(eq(schema.characters.id, cardId))
	const parent = await ensureCardVersion(tx, cardId)
	if (!parent) throw new Error(SHARED_CARD_REFUSALS.notShared)
	const member = await insertCastMemberCopy(tx, {
		lorebookId,
		binding: token,
		characterId: null,
		name: card.name,
		createdBy: userId
	})
	await insertCharacterVersions(tx, [
		{
			castMemberId: member.id,
			lorebookId,
			parentVersionId: parent.id,
			personalPosition: null,
			nodeState: member.nodeState,
			nodeVisibility: member.nodeVisibility,
			writtenBy: null,
			...emptyCharacterProfile(),
			follows: [...CHARACTER_PROFILE_FIELDS]
		}
	])
	await makeMemberCardless(tx, member.id, { cause: "shared", card: cardId })
	await writeBackShownName(tx, member.id)
	const shown = (await membersAsRead(tx, [member.id], { sessionId })).get(
		member.id
	)?.shownName
	return {
		castMemberId: member.id,
		name: shown || card.name,
		lorebookId
	}
}
