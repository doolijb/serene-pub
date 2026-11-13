/**
 * Media permissions (28 §6): two layers, in order.
 *
 * This is today's policy stated once, instead of re-derived from a URL string
 * in the serving route. It also means media inherits sharing automatically — a
 * character shared into a session brings its gallery with it, with no second
 * grant to keep in sync.
 *
 * **One row decides it.** The old rule took whatever `media` row
 * the route had resolved, notice a derivative had no provenance of its own, and
 * go and fetch its parent — with an orphan branch for a thumbnail whose
 * original was gone. Provenance now lives on the FILE and a variant is never
 * looked up independently of its file on any access-checked path, so the
 * subject is simply the row handed in. Both the extra query and the orphan case
 * stopped existing rather than being fixed.
 */
import * as schema from "$lib/server/db/schema"
import { db as appDb } from "$lib/server/db"
import { sessionsReferencingFile } from "$lib/server/attachments/references"
import { sessionAccessFor } from "$lib/server/messages/permissions"
import { isConversationMember } from "$lib/server/conversations/membership"
import {
	checkSessionAccess,
	canViewCharacter
} from "$lib/server/utils/sessionAccess"
import { MediaVisibility } from "$lib/shared/constants/MediaVisibility"
import { canViewLorebook } from "$lib/server/utils/ownedBook"
import { canReadCastMember } from "$lib/server/cast/memberAccess"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

type FileRow = typeof schema.files.$inferSelect

/**
 * ⏳ A cast member's face is its **versions'** (`character_versions.face_media_id`
 * on a row with a `cast_member_id`); the member's own column is frozen. The
 * face counts when it is the version's OWN — a followed face is the card's, and
 * the card branch above answers for it. Retired rows count: an older branch
 * may still read the face they wore, and a read permission over a file the
 * book's or session's people already drew gains nothing from forgetting it.
 */
const wornByVersion = (fileId: number) =>
	and(
		isNotNull(schema.characterVersions.castMemberId),
		eq(schema.characterVersions.faceMediaId, fileId),
		sql`NOT ('faceMediaId' = ANY(${schema.characterVersions.follows}))`
	)

export async function canViewMedia(
	file: FileRow,
	userId: number,
	db: Db = appDb as unknown as Db
): Promise<boolean> {
	// Layer 2 first when it is restrictive — `private` can only ever narrow
	// what layer 1 would allow, so there is no point resolving the parent.
	if (file.visibility === MediaVisibility.PRIVATE) {
		return file.userId === userId
	}

	// The owner always sees their own.
	if (file.userId === userId) return true

	// A file uploaded into a private conversation: every member reads it
	// (PLAN-private-messages §4). Membership is the only authority there —
	// no admin bypass.
	if (file.conversationId) {
		if (await isConversationMember(db, file.conversationId, userId))
			return true
	}

	// Layer 1 — derived from the parent, most specific first.
	if (file.sessionId) {
		const access = await checkSessionAccess(file.sessionId, userId)
		if (access.hasAccess) return true
	}
	// `canViewCharacter` checks BOTH member tables, so a file belonging to a
	// character somebody VOICES is reachable by that session's participants
	// too — one branch answers for the cast and the voices alike.
	if (file.characterId) {
		if (await canViewCharacter(file.characterId, userId)) return true
	}

	// A cast member's face (PLAN-cast-retold-fields): whoever may read a book
	// whose member WEARS this file, or is in a session reading that book —
	// that is where the face is drawn. Judged by the members that wear it, not
	// by `files.lorebook_id` alone: files are one row per (user, bytes), so the
	// same picture can be worn in a second book, or be a gallery image of a
	// card the session does not seat (review 2026-10-13). The stamp still
	// counts, for a book's own upload no member wears yet.
	// A book's **cover image** is judged the same way, by the books that wear
	// it as their cover.
	// A cast member's **own art** — a sprite in a set of its own, or a picture
	// in its gallery (`cast_member_files`) — is judged as a face is: by the
	// books of the members that hold it. A card's sprite sets are the card's,
	// and the card branch above answers for them; they are not the book's.
	const [wornIn, coverOf, spriteHolders, galleryHolders] = await Promise.all([
		db
			.selectDistinct({ lorebookId: schema.characterVersions.lorebookId })
			.from(schema.characterVersions)
			.where(wornByVersion(file.id)),
		db
			.select({ lorebookId: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.coverMediaId, file.id)),
		db
			.selectDistinct({
				memberId: schema.lorebookBindings.id,
				lorebookId: schema.lorebookBindings.lorebookId
			})
			.from(schema.sprites)
			.innerJoin(
				schema.spriteSets,
				eq(schema.spriteSets.id, schema.sprites.spriteSetId)
			)
			.innerJoin(
				schema.lorebookBindings,
				eq(schema.lorebookBindings.id, schema.spriteSets.castMemberId)
			)
			.where(eq(schema.sprites.fileId, file.id)),
		db
			.selectDistinct({
				memberId: schema.lorebookBindings.id,
				lorebookId: schema.lorebookBindings.lorebookId
			})
			.from(schema.castMemberFiles)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.castMemberFiles.castMemberId
				)
			)
			.where(eq(schema.castMemberFiles.fileId, file.id))
	])
	const artHolders = [...spriteHolders, ...galleryHolders]
	const books = new Set(
		[...wornIn, ...coverOf, ...artHolders]
			.map((r) => r.lorebookId)
			.filter((id): id is number => id != null)
	)
	if (file.lorebookId) books.add(file.lorebookId)
	if (books.size) {
		for (const bookId of books)
			if (await canViewLorebook(bookId, userId, { db })) return true
		const sessions = await db
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(inArray(schema.sessions.lorebookId, [...books]))
		for (const s of sessions)
			if ((await checkSessionAccess(s.id, userId)).hasAccess) return true
	}

	// A seated member's own face: a session's people see the face of a member
	// the session seats, as they see the avatar of the card it seats, wherever
	// that member lives (an attached book, or the session's own book). The
	// member's own sprites and gallery follow the same rule.
	const artMemberIds = [...new Set(artHolders.map((r) => r.memberId))]
	const [seatedCast, seatedVoice, seatedArtCast, seatedArtVoice] =
		await Promise.all([
			db
				.selectDistinct({
					sessionId: schema.sessionCharacters.sessionId
				})
				.from(schema.sessionCharacters)
				.innerJoin(
					schema.characterVersions,
					eq(
						schema.characterVersions.castMemberId,
						schema.sessionCharacters.castMemberId
					)
				)
				.where(wornByVersion(file.id)),
			db
				.selectDistinct({ sessionId: schema.sessionPersonas.sessionId })
				.from(schema.sessionPersonas)
				.innerJoin(
					schema.characterVersions,
					eq(
						schema.characterVersions.castMemberId,
						schema.sessionPersonas.castMemberId
					)
				)
				.where(wornByVersion(file.id)),
			artMemberIds.length
				? db
						.selectDistinct({
							sessionId: schema.sessionCharacters.sessionId
						})
						.from(schema.sessionCharacters)
						.where(
							inArray(
								schema.sessionCharacters.castMemberId,
								artMemberIds
							)
						)
				: [],
			artMemberIds.length
				? db
						.selectDistinct({
							sessionId: schema.sessionPersonas.sessionId
						})
						.from(schema.sessionPersonas)
						.where(
							inArray(
								schema.sessionPersonas.castMemberId,
								artMemberIds
							)
						)
				: []
		])
	const seatingSessions = new Set(
		[
			...seatedCast,
			...seatedVoice,
			...seatedArtCast,
			...seatedArtVoice
		].map((r) => r.sessionId)
	)
	for (const sessionId of seatingSessions)
		if ((await checkSessionAccess(sessionId, userId, db)).hasAccess)
			return true

	// A card's file a cast member DRAWS from its card (★s4-fb-4, owner
	// 2026-11-10: "Permissions cascade through the cast member if the lorebook
	// is shared, or user is a guest."): whoever may read a member —
	// `canReadCastMember`, its book readable or a seat's session — sees the
	// card's sprite files (while the member draws no sprites of its own), the
	// card face it follows and the likeness image it follows, since those are
	// what its panels draw. Retired versions count, as for `wornByVersion`.
	// Stays out: a card's gallery pictures, every other file of the card, and
	// a face or sprite the member owns (the branches above answer for those).
	// Skipped when no member draws the file.
	const parentVersion = alias(schema.characterVersions, "card_parent_version")
	const [spriteCards, followedFace, followedLikeness] = await Promise.all([
		db
			.selectDistinct({ cardId: schema.spriteSets.characterId })
			.from(schema.sprites)
			.innerJoin(
				schema.spriteSets,
				eq(schema.spriteSets.id, schema.sprites.spriteSetId)
			)
			.where(
				and(
					eq(schema.sprites.fileId, file.id),
					isNotNull(schema.spriteSets.characterId)
				)
			),
		db
			.selectDistinct({ memberId: schema.characterVersions.castMemberId })
			.from(schema.characterVersions)
			.innerJoin(
				parentVersion,
				eq(parentVersion.id, schema.characterVersions.parentVersionId)
			)
			.where(
				and(
					isNotNull(schema.characterVersions.castMemberId),
					sql`'faceMediaId' = ANY(${schema.characterVersions.follows})`,
					eq(parentVersion.faceMediaId, file.id)
				)
			),
		db
			.selectDistinct({ memberId: schema.characterVersions.castMemberId })
			.from(schema.characterVersions)
			.innerJoin(
				parentVersion,
				eq(parentVersion.id, schema.characterVersions.parentVersionId)
			)
			.where(
				and(
					isNotNull(schema.characterVersions.castMemberId),
					sql`'likeness' = ANY(${schema.characterVersions.follows})`,
					sql`(${parentVersion.likeness}->>'imageMediaId')::int = ${file.id}`
				)
			)
	])
	const drawers = new Set<number>()
	for (const r of [...followedFace, ...followedLikeness])
		if (r.memberId != null) drawers.add(r.memberId)
	const cardIds = spriteCards
		.map((r) => r.cardId)
		.filter((id): id is number => id != null)
	if (cardIds.length) {
		const [linked, versioned] = await Promise.all([
			db
				.selectDistinct({ memberId: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.characterId, cardIds)),
			db
				.selectDistinct({
					memberId: schema.characterVersions.castMemberId
				})
				.from(schema.characterVersions)
				.innerJoin(
					parentVersion,
					eq(
						parentVersion.id,
						schema.characterVersions.parentVersionId
					)
				)
				.where(
					and(
						isNotNull(schema.characterVersions.castMemberId),
						inArray(parentVersion.cardId, cardIds)
					)
				)
		])
		const spriteMembers = [
			...new Set(
				[...linked, ...versioned]
					.map((r) => r.memberId)
					.filter((id): id is number => id != null)
			)
		]
		if (spriteMembers.length) {
			const { spriteLabelsForMembers } = await import(
				"$lib/server/sprites"
			)
			const own = await spriteLabelsForMembers(db, spriteMembers)
			for (const id of spriteMembers)
				if (!((own.get(id)?.sets.size ?? 0) > 0)) drawers.add(id)
		}
	}
	// No administrator exception: the owner named two paths (a shared
	// book — a live provided book counts as shared — or a seat's session).
	for (const memberId of drawers)
		if (await canReadCastMember(db, memberId, userId, { isAdmin: false }))
			return true

	// An account's avatar is drawn wherever the account is — the roster,
	// sharing, conversations, the Users view — so, like the account's name,
	// any signed-in person may see it. The route has already refused anyone
	// signed out.
	const [avatarOf] = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(eq(schema.users.avatarMediaId, file.id))
		.limit(1)
	if (avatarOf) return true

	// Shown by an attachment (PLAN-composer-attachments §6.3): a file a
	// `core:image` / `core:file` part of a message in a session the viewer can
	// open refers to. Dedupe is per (user, hash), so a re-attached avatar's row
	// names its character, not this session — without this branch a guest
	// sees a broken image. AFTER the provenance branches: it costs a query.
	for (const sessionId of await sessionsReferencingFile(db, file.id)) {
		if (sessionId === file.sessionId) continue // asked above
		const access = await sessionAccessFor(db, sessionId, userId)
		if (access.hasAccess) return true
	}

	// No entity parent means a personal blob (a background, a staged upload):
	// owner only, which the check above already settled.
	return false
}
