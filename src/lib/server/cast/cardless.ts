/**
 * 🚧 The one way a cast member becomes card-less (plan §34.2; owner
 * 2026-11-05: "If a cast's feature in a lorebook/session can't survive
 * without a card, then that feature needs to be copied to the cast member";
 * ★3 2026-11-08: a card delete makes its followers card-less).
 *
 * It orchestrates each module's own writer (P2) and writes one row itself,
 * `lorebook_bindings.character_id = null`:
 *
 * - the words: `resolveFollows(… { detach: true })` (characters/versions)
 * - sprite sets and their images: `copySpriteSetsToMember` (sprites)
 * - the card gallery's pictures: `addToMemberGallery` (media)
 * - the card-layer sheets, configs and values: `copyCardStatsToMember`
 *   (characters/dowry)
 * - the faces and likeness pictures on the member's versions:
 *   `repointCastVersionFiles` (characters/versions), to the book owner's own
 *   file rows
 *
 * Files go through `fileForOwner`: the book owner's own card shares its file
 * rows; another owner's card is copied to a file row of the book owner's.
 *
 * Idempotent: a member with no card has nothing to copy, and each writer
 * above is a no-op the second time. Runs on the caller's `tx` (the outer `db`
 * inside a transaction deadlocks PGlite silently; `db/transactionGuard.ts`
 * throws in dev and test). A starter copy (cause `starter`) runs it for every
 * member of the copy. The writer itself writes no annotations: elsewhere the
 * member's entity key becomes `cast_member:<id>` through the annotation
 * vocabulary hash, and the annotations module owns those rows (P2); the
 * starter path rewrites its own copy's keys (`makeCopyCardless`).
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	repointCastVersionFiles,
	resolveFollows
} from "$lib/server/characters/versions"
import { copyCardStatsToMember } from "$lib/server/characters/dowry"
import { copySpriteSetsToMember, spriteFileIds } from "$lib/server/sprites"
import { addToMemberGallery, fileForOwner, mediaFor } from "$lib/server/media"
import { MediaKind } from "$lib/shared/constants/MediaVisibility"

/** Why a member is losing its card. */
export type CardlessCause =
	| "unlink"
	| "card-delete"
	| "provided-uninstall"
	| "starter"

export interface CardlessOutcome {
	/** The book the member belongs to. */
	lorebookId: number
	/** The card let go; null when the member had none (nothing was copied). */
	cardId: number | null
	/** Versions of the member that stopped following the card. */
	detached: number
	/** Sprite sets copied onto the member. */
	spriteSets: number
	/** Sprites copied onto the member. */
	sprites: number
	/** Gallery pictures newly linked to the member. */
	galleryFiles: number
	/** Card-layer sheets copied onto the member. */
	sheets: number
	/** Card-layer attribute configs copied onto the member. */
	configs: number
	/** Card-layer attribute values copied onto the member. */
	values: number
	/** 🚧 Versions of the member whose face or likeness picture moved to a file row of the book owner's. */
	facesRepointed: number
}

export async function makeMemberCardless(
	tx: Db,
	memberId: number,
	opts: {
		cause: CardlessCause
		/** The card being let go; defaults to the member's linked card — pass it when the caller already nulled `character_id` in this transaction. */
		card?: number
	}
): Promise<CardlessOutcome> {
	const [member] = await tx
		.select({
			lorebookId: schema.lorebookBindings.lorebookId,
			characterId: schema.lorebookBindings.characterId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, memberId))
	if (!member) throw new Error("That cast member no longer exists.")
	const [book] = await tx
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, member.lorebookId))
	const bookOwner = book.userId
	const card = opts.card ?? member.characterId

	// 2026-11-06: an unlink "applies from the book's present — versions from
	// the present on become card-less keeping the card's words; earlier ones
	// stay on the card". The caller's `reparentFromBookPresent` already did
	// that, so an unlink must not detach every version.
	const detached =
		opts.cause === "unlink"
			? 0
			: await resolveFollows(
					tx,
					{ castMemberId: memberId },
					{ detach: true }
				)

	const out: CardlessOutcome = {
		lorebookId: member.lorebookId,
		cardId: card ?? null,
		detached,
		spriteSets: 0,
		sprites: 0,
		galleryFiles: 0,
		sheets: 0,
		configs: 0,
		values: 0,
		facesRepointed: 0
	}

	if (card != null) {
		const fileFor = (id: number) =>
			fileForOwner(tx, id, {
				userId: bookOwner,
				lorebookId: member.lorebookId
			})
		const copied = await copySpriteSetsToMember(tx, card, memberId, fileFor)
		out.spriteSets = copied.sets
		out.sprites = copied.sprites

		// The card gallery: its files minus the sprites, pictures only.
		const sprites = await spriteFileIds(tx, card)
		const ids: number[] = []
		for (const f of await mediaFor(tx, { characterId: card })) {
			if (sprites.has(f.id) || f.kind !== MediaKind.IMAGE) continue
			ids.push(await fileFor(f.id))
		}
		out.galleryFiles = await addToMemberGallery(tx, memberId, ids)

		const stats = await copyCardStatsToMember(tx, card, memberId, {
			userId: bookOwner
		})
		out.sheets = stats.sheets
		out.configs = stats.configs
		out.values = stats.values

		// Faces and likeness pictures (a detached version now holds the card's
		// face as its own): a file of another owner is copied to the book
		// owner's, so the card owner deleting it later leaves the member's.
		const V = schema.characterVersions
		const worn = new Set<number>()
		for (const v of await tx
			.select({ face: V.faceMediaId, likeness: V.likeness })
			.from(V)
			.where(eq(V.castMemberId, memberId))) {
			if (v.face != null) worn.add(v.face)
			if (v.likeness?.imageMediaId != null)
				worn.add(v.likeness.imageMediaId)
		}
		const files = new Map<number, number>()
		if (worn.size) {
			const owners = await tx
				.select({ id: schema.files.id, userId: schema.files.userId })
				.from(schema.files)
				.where(inArray(schema.files.id, [...worn]))
			for (const f of owners) {
				if (f.userId === bookOwner) continue
				const next = await fileFor(f.id)
				if (next !== f.id) files.set(f.id, next)
			}
		}
		out.facesRepointed = await repointCastVersionFiles(tx, memberId, files)
	}

	await tx
		.update(schema.lorebookBindings)
		.set({ characterId: null })
		.where(
			and(
				eq(schema.lorebookBindings.id, memberId),
				isNotNull(schema.lorebookBindings.characterId)
			)
		)
	return out
}
