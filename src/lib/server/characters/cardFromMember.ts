/**
 * 🚧 Copy to my characters, from a cast member (owner 2026-11-05: "If a user
 * wants a cast member as a card, they can export the cast member as a card to
 * their account"; plan §34.2). The other half of `characters:duplicate`.
 *
 * The copy is a new card owned by the asker with **no link back** to the
 * member (no `lorebookId`, no binding). It holds what the member shows at its
 * book's present: the words (`membersAsRead`, `follows` resolved) as v1 with
 * no label, the face and likeness image, the sprite sets, the gallery, the
 * stats (current values become the card's defaults, ruled 2026-11-08; never a
 * session's) and, when the asker may read the member's card, its tags.
 *
 * Each module's own writer does its part (P2): the card and its v1 by
 * `insertCard`/`updateCardVersion`, files by `createMedia`, sprite rows by
 * `copySpriteSets`, card stats by `applyCardChanges` and `setOwnerSheets`.
 * Every file is a NEW file of the asker's, so a revoked share or a deleted
 * member cannot take the copy's art; identical bytes the asker already holds
 * come back as the asker's existing row (`createMedia` dedupes on user and
 * hash). A picture whose bytes cannot be read is left out; the copy stands.
 *
 * `cardFromMember` runs on the caller's `tx`; `mayCopyMember` answers on a
 * plain handle, before the transaction opens.
 */
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { canReadCastMember } from "$lib/server/cast/memberAccess"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { cardColumnsOfProfile } from "$lib/server/characters/cardIO"
import { insertCard, updateCardVersion } from "$lib/server/characters/versions"
import {
	createMedia,
	mediaFor,
	readMedia,
	type FileRow
} from "$lib/server/media"
import { MediaKind, MediaVariant } from "$lib/shared/constants/MediaVisibility"
import {
	copySpriteSets,
	listSpriteSets,
	spriteFileIds,
	type SpriteOwner
} from "$lib/server/sprites"
import { readingOf, rowsOnReading } from "$lib/server/state/reading"
import { inForce } from "$lib/server/state/resolve"
import { applyCardChanges } from "$lib/server/state/cardState"
import { setOwnerSheets } from "$lib/server/state/declarations"
import { StateRefusal } from "$lib/server/state/write"
import { canViewCharacter } from "$lib/server/utils/sessionAccess"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import { profileOf } from "$lib/shared/characters/profile"
import type { CharacterLikenessInput } from "$lib/shared/characters/likeness"

/** The sentence a refused copy gets; it never confirms the member exists. */
export const CAST_MEMBER_NOT_FOUND = "Cast member not found."

/** What a copy carried over, for the report and the tests. */
export interface CardFromMemberOutcome {
	card: typeof schema.characters.$inferSelect
	spriteSets: number
	sprites: number
	galleryFiles: number
	sheets: number
	configs: number
	values: number
	/** Stat rows the card layer refused (a slot a card may not carry): left out. */
	skippedStats: number
	tags: string[]
}

/**
 * 🚧 Whether `userId` may copy member `castMemberId`: anyone who can read its
 * book (owner, shared, a live provided book, a session's own notes for its
 * members; no administrator exception), or anyone in a session that seats it.
 */
export async function mayCopyMember(
	db: Db,
	castMemberId: number,
	userId: number
): Promise<boolean> {
	return !!(await canReadCastMember(db, castMemberId, userId, {
		isAdmin: false
	}))
}

/** One file's bytes as a new file of `userId`'s on card `characterId`; null when unreadable. */
async function copyFile(
	tx: Db,
	fileId: number,
	userId: number,
	characterId: number,
	position = 0
): Promise<number | null> {
	try {
		const read = await readMedia(tx, fileId, MediaVariant.ORIGINAL)
		if (!read) return null
		const { file } = await createMedia(tx, {
			userId,
			characterId,
			bytes: Buffer.from(read.bytes),
			filename: read.file.filename,
			position
		})
		return file.id
	} catch (error) {
		console.error("Copying a cast member's picture failed:", error)
		return null
	}
}

const isImage = (file: FileRow) => file.kind === MediaKind.IMAGE

/** A member's stat rows for the card layer: its own at its book's present, else its card's. */
async function statsToCopy(
	tx: Db,
	member: { id: number; lorebookId: number },
	cardId: number | null
) {
	const reading = await readingOf(tx, member.lorebookId)
	const sheetsOf = async (kind: "card" | "cast_member", id: number) =>
		(
			await tx
				.select({ sheetId: schema.ownerSheets.sheetId })
				.from(schema.ownerSheets)
				.where(
					and(
						eq(schema.ownerSheets.ownerKind, kind),
						eq(schema.ownerSheets.ownerId, id),
						isNull(schema.ownerSheets.sessionId)
					)
				)
				.orderBy(
					asc(schema.ownerSheets.position),
					asc(schema.ownerSheets.id)
				)
		).map((r) => r.sheetId)
	const sheets = [
		...new Set([
			...(await sheetsOf("cast_member", member.id)),
			...(cardId != null ? await sheetsOf("card", cardId) : [])
		])
	]

	const values = new Map<string, unknown>()
	const configs = new Map<string, Record<string, unknown>>()
	// The member's own rows decide at its book's present (a later date wins,
	// a row on another line is not in force); the card layer has no line.
	const layer = async <
		T extends typeof schema.attributeValues | typeof schema.attributeConfigs
	>(
		source: T,
		kind: "cast_member" | "card",
		id: number
	) => {
		const rows = await tx
			.select()
			.from(source as typeof schema.attributeValues)
			.where(
				and(
					eq(source.ownerKind, kind),
					eq(source.ownerId, id),
					isNull(source.sessionId)
				)
			)
			.orderBy(asc(source.id))
		const read =
			kind === "card"
				? rows.filter((r) => r.branchId == null)
				: await rowsOnReading(tx, rows, reading)
		const bySlot = new Map<string, typeof rows>()
		for (const r of read)
			bySlot.set(r.slotId, [...(bySlot.get(r.slotId) ?? []), r])
		return [...bySlot].map(
			([slotId, slotRows]) =>
				[
					slotId,
					inForce(
						slotRows,
						kind === "card" ? undefined : reading.dates
					)!
				] as const
		)
	}
	for (const kind of cardId != null
		? (["cast_member", "card"] as const)
		: (["cast_member"] as const)) {
		const id = kind === "card" ? cardId! : member.id
		for (const [slotId, row] of await layer(
			schema.attributeValues,
			kind,
			id
		)) {
			const v = (row.value as { v?: unknown } | null)?.v
			if (v !== null && v !== undefined && !values.has(slotId))
				values.set(slotId, v)
		}
		for (const [slotId, row] of await layer(
			schema.attributeConfigs,
			kind,
			id
		)) {
			const c = (
				row as unknown as { config: Record<string, unknown> | null }
			).config
			if (c && Object.keys(c).length && !configs.has(slotId))
				configs.set(slotId, c)
		}
	}
	return { sheets, values, configs }
}

/**
 * 🚧 Makes the asker's new card from cast member `castMemberId` as its book
 * reads it now (see the header). The caller has already asked `mayCopyMember`;
 * every read and write here is on `tx`.
 */
export async function cardFromMember(
	tx: Db,
	input: { castMemberId: number; userId: number }
): Promise<CardFromMemberOutcome> {
	const { castMemberId, userId } = input
	const read = (await membersAsRead(tx, [castMemberId])).get(castMemberId)
	if (!read) throw new Error(CAST_MEMBER_NOT_FOUND)

	// The asker may read the member's active card when they own it or reach it
	// (a share, a session seating it): only then is anything of the card's
	// own, beyond what the member shows, copied.
	let cardReadable = false
	if (read.activeCardId != null) {
		const [card] = await tx
			.select({ userId: schema.characters.userId })
			.from(schema.characters)
			.where(
				and(
					eq(schema.characters.id, read.activeCardId),
					eq(schema.characters.isDeleted, false)
				)
			)
			.limit(1)
		cardReadable =
			!!card &&
			(card.userId === userId ||
				(await canViewCharacter(read.activeCardId, userId, tx)))
	}

	// The words, with no pointer at the member's files: those are copied below.
	const profile = profileOf(read)
	const { imageMediaId: likenessImage, ...likenessRest } =
		(profile.likeness ?? {}) as CharacterLikenessInput
	const { card, version } = await insertCard(tx, {
		...cardColumnsOfProfile({
			...profile,
			faceMediaId: null,
			likeness: Object.keys(likenessRest).length ? likenessRest : null
		}),
		userId,
		isPersona: false,
		lorebookId: null,
		characterVersion: null
	})

	const out: CardFromMemberOutcome = {
		card,
		spriteSets: 0,
		sprites: 0,
		galleryFiles: 0,
		sheets: 0,
		configs: 0,
		values: 0,
		skippedStats: 0,
		tags: []
	}

	// Face and likeness image: new files of the asker's.
	const face =
		profile.faceMediaId != null
			? await copyFile(tx, profile.faceMediaId, userId, card.id)
			: null
	const likenessCopy =
		likenessImage != null
			? await copyFile(tx, likenessImage, userId, card.id)
			: null
	// Insert made v1 with the label "1.0" and the notes without their language:
	// the copy's v1 has no label and the member's notes as they were.
	await updateCardVersion(
		tx,
		version.id,
		{
			creatorNotes: profile.creatorNotes,
			faceMediaId: face,
			likeness:
				likenessCopy != null
					? { ...likenessRest, imageMediaId: likenessCopy }
					: Object.keys(likenessRest).length
						? likenessRest
						: null
		},
		{ label: null }
	)
	const [fresh] = await tx
		.select()
		.from(schema.characters)
		.where(eq(schema.characters.id, card.id))
	out.card = fresh

	// Sprite sets: the member's own, else those it shows from its card.
	const ownSets = await listSpriteSets(tx, { castMemberId })
	const from: SpriteOwner | null = ownSets.some((s) =>
		s.sprites.some((p) => p.media)
	)
		? { castMemberId }
		: read.activeCardId != null
			? { characterId: read.activeCardId }
			: null
	if (from) {
		const fileFor = async (fileId: number) => {
			const copied = await copyFile(tx, fileId, userId, card.id)
			if (copied == null)
				throw new Error("A sprite's picture could not be read.")
			return copied
		}
		try {
			// A savepoint: one unreadable sprite leaves the copy without sprites, not without a card.
			const copied = await tx.transaction((sp) =>
				copySpriteSets(
					sp as unknown as Db,
					from,
					{ characterId: card.id },
					fileFor
				)
			)
			out.spriteSets = copied.sets
			out.sprites = copied.sprites
		} catch (error) {
			console.error("Copying a cast member's sprites failed:", error)
		}
	}

	// Gallery: the member's own pictures, else its card's when the asker may read it.
	let gallery = (await mediaFor(tx, { castMemberId })).filter(isImage)
	const memberSprites = await spriteFileIds(tx, { castMemberId })
	gallery = gallery.filter((f) => !memberSprites.has(f.id))
	if (!gallery.length && read.activeCardId != null && cardReadable) {
		const cardSprites = await spriteFileIds(tx, {
			characterId: read.activeCardId
		})
		gallery = (
			await mediaFor(tx, { characterId: read.activeCardId })
		).filter((f) => isImage(f) && !cardSprites.has(f.id))
	}
	for (const [index, file] of gallery.entries())
		if ((await copyFile(tx, file.id, userId, card.id, index)) != null)
			out.galleryFiles++

	// Stats: current values as the card's defaults. The member's own at its
	// book's present; its card's layer fills the slots the member has none for
	// (only when the asker may read that card).
	const stats = await statsToCopy(
		tx,
		{ id: castMemberId, lorebookId: read.lorebookId },
		cardReadable ? read.activeCardId : null
	)
	if (stats.sheets.length)
		try {
			await setOwnerSheets(
				tx,
				{ kind: "card", id: card.id },
				stats.sheets,
				{
					userId
				}
			)
			out.sheets = stats.sheets.length
		} catch (error) {
			if (!(error instanceof StateRefusal)) throw error
			out.skippedStats += stats.sheets.length
		}
	// One change at a time: a stat the card layer refuses is skipped, never fatal.
	// Limits land before the values judged against them.
	const apply = async (
		change: { slotId: string; config: any } | { slotId: string; value: any }
	) => {
		try {
			await applyCardChanges(tx, {
				characterId: card.id,
				userId,
				changes: [change]
			})
			return true
		} catch (error) {
			if (!(error instanceof StateRefusal)) throw error
			out.skippedStats++
			return false
		}
	}
	for (const [slotId, config] of stats.configs)
		if (await apply({ slotId, config })) out.configs++
	for (const [slotId, value] of stats.values)
		if (await apply({ slotId, value })) out.values++

	// Tags: the member's active card's, re-made as the asker's own.
	if (cardReadable) {
		for (const name of read.tags) {
			const tagId = await findOrCreateTagId(userId, name, tx)
			if (tagId == null) continue
			await tx
				.insert(schema.characterTags)
				.values({ characterId: card.id, tagId })
				.onConflictDoNothing()
			out.tags.push(name)
		}
	}
	return out
}
