/**
 * Sprites — the server half (DESIGN-sprites §3, ~/.claude/plans).
 *
 * A card's art: named **sprite sets**, each holding labelled **sprites**,
 * each pointing at one `files` row. Everything that reads or writes those two
 * tables goes through here, so the three rules below live in one place:
 *
 *  1. **Exactly one default set per character**, created the first time a
 *     card gains a sprite (`ensureDefaultSpriteSet`). A cast member's
 *     `spriteSet` resolves to it whenever the name it asks for is missing.
 *  2. **A sprite image is an ordinary character file** — `files.character_id`
 *     is its provenance, so it inherits the character's visibility
 *     (`canViewMedia`) — and the sprite row is its ROLE. The gallery reads
 *     roles to leave sprites out (`spriteFileIds`).
 *  3. **Deleting a sprite deletes its file only when nothing else wears it.**
 *     `createMedia` dedupes on (user, hash), so one file can be a sprite, the
 *     avatar and a gallery image at once; removing one role must not break the
 *     others.
 *
 * Every function takes the database handle it should use, so a caller inside
 * `db.transaction(async (tx) => …)` passes `tx` (the outer handle deadlocks
 * PGlite — see `db/transactionGuard.ts`).
 */

import { and, asc, eq, inArray, isNotNull, max, ne, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createMedia, deleteFile } from "$lib/server/media"
import { isServerFailure } from "$lib/server/imports/importFailure"
import {
	DEFAULT_SPRITE_SET_NAME,
	normalizeSpriteName,
	type SpriteOrigin,
	type SpriteSetView
} from "$lib/shared/sprites"

export type { SpriteSetView, SpriteView } from "$lib/shared/sprites"

export type SpriteSetRow = typeof schema.spriteSets.$inferSelect
export type SpriteRow = typeof schema.sprites.$inferSelect

/** Ceilings on what one import may add. A card is untrusted input. */
export const SPRITE_IMPORT_LIMITS = {
	/** Sprites per import, across every set. */
	count: 512,
	/** Bytes per sprite image. */
	bytes: 16 * 1024 * 1024,
	/** Bytes per import, summed. */
	totalBytes: 256 * 1024 * 1024
}

/** Every set of a character with its sprites, default first, then by position. */
export async function listSpriteSets(
	db: Db,
	characterId: number
): Promise<SpriteSetView[]> {
	const sets = await db.query.spriteSets.findMany({
		where: eq(schema.spriteSets.characterId, characterId),
		orderBy: [asc(schema.spriteSets.position), asc(schema.spriteSets.id)],
		with: {
			sprites: {
				orderBy: [asc(schema.sprites.label), asc(schema.sprites.position)],
				with: {
					file: {
						columns: { id: true, uuid: true, rev: true, frame: true }
					}
				}
			}
		}
	})
	return sets
		.map((s) => ({
			id: s.id,
			name: s.name,
			isDefault: s.isDefault,
			position: s.position,
			sprites: s.sprites.map((p) => ({
				id: p.id,
				label: p.label,
				position: p.position,
				source: p.source as SpriteOrigin,
				media: p.file
					? {
							id: p.file.id,
							uuid: p.file.uuid,
							rev: p.file.rev,
							frame: p.file.frame ?? null
						}
					: null
			}))
		}))
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/**
 * The character's default set, created on first need.
 *
 * Race-safe on the partial unique index: a concurrent creator loses the
 * insert, and the re-read finds the winner.
 */
export async function ensureDefaultSpriteSet(
	db: Db,
	characterId: number
): Promise<SpriteSetRow> {
	const found = await db.query.spriteSets.findFirst({
		where: and(
			eq(schema.spriteSets.characterId, characterId),
			eq(schema.spriteSets.isDefault, true)
		)
	})
	if (found) return found
	// A set with the default NAME but no flag (a set renamed back, say) is
	// promoted rather than duplicated — the name is unique per character.
	const named = await db.query.spriteSets.findFirst({
		where: and(
			eq(schema.spriteSets.characterId, characterId),
			eq(schema.spriteSets.name, DEFAULT_SPRITE_SET_NAME.toLowerCase())
		)
	})
	if (named) {
		const [row] = await db
			.update(schema.spriteSets)
			.set({ isDefault: true })
			.where(eq(schema.spriteSets.id, named.id))
			.returning()
		return row
	}
	const inserted = await db
		.insert(schema.spriteSets)
		.values({
			characterId,
			name: DEFAULT_SPRITE_SET_NAME.toLowerCase(),
			isDefault: true,
			position: 0
		})
		.onConflictDoNothing()
		.returning()
	if (inserted[0]) return inserted[0]
	const winner = await db.query.spriteSets.findFirst({
		where: and(
			eq(schema.spriteSets.characterId, characterId),
			eq(schema.spriteSets.isDefault, true)
		)
	})
	if (!winner) throw new Error("Could not create the default sprite set.")
	return winner
}

/** A set of this character by name, or null. Names are normalised first. */
export async function findSpriteSetByName(
	db: Db,
	characterId: number,
	name: string
): Promise<SpriteSetRow | null> {
	const key = normalizeSpriteName(name)
	if (!key) return null
	return (
		(await db.query.spriteSets.findFirst({
			where: and(
				eq(schema.spriteSets.characterId, characterId),
				eq(schema.spriteSets.name, key)
			)
		})) ?? null
	)
}

/** Load a set and check it belongs to the character. Throws otherwise. */
export async function requireSpriteSet(
	db: Db,
	characterId: number,
	setId: number
): Promise<SpriteSetRow> {
	const set = await db.query.spriteSets.findFirst({
		where: and(
			eq(schema.spriteSets.id, setId),
			eq(schema.spriteSets.characterId, characterId)
		)
	})
	if (!set) throw new Error("Sprite set not found.")
	return set
}

/** Create a named set. The first set a character gets becomes the default. */
export async function createSpriteSet(
	db: Db,
	characterId: number,
	name: string
): Promise<SpriteSetRow> {
	const key = normalizeSpriteName(name)
	if (!key) throw new Error("A sprite set needs a name.")
	if (await findSpriteSetByName(db, characterId, key)) {
		throw new Error(`There is already a sprite set named "${key}".`)
	}
	const hasDefault = await db.query.spriteSets.findFirst({
		where: and(
			eq(schema.spriteSets.characterId, characterId),
			eq(schema.spriteSets.isDefault, true)
		),
		columns: { id: true }
	})
	const [{ top }] = await db
		.select({ top: max(schema.spriteSets.position) })
		.from(schema.spriteSets)
		.where(eq(schema.spriteSets.characterId, characterId))
	const [row] = await db
		.insert(schema.spriteSets)
		.values({
			characterId,
			name: key,
			isDefault: !hasDefault,
			position: (top ?? -1) + 1
		})
		.returning()
	return row
}

/**
 * Rename a set.
 *
 * ⚠ A cast amendment names a set by NAME (DESIGN-sprites §2.2), so a rename
 * strands any amendment that named the old one; those fall back to the default
 * set and say so on the receipt. The editor warns before renaming for that
 * reason — this function does not rewrite amendments, because it cannot know
 * which books use this card.
 */
export async function renameSpriteSet(
	db: Db,
	characterId: number,
	setId: number,
	name: string
): Promise<SpriteSetRow> {
	const set = await requireSpriteSet(db, characterId, setId)
	const key = normalizeSpriteName(name)
	if (!key) throw new Error("A sprite set needs a name.")
	if (key === set.name) return set
	const clash = await findSpriteSetByName(db, characterId, key)
	if (clash) throw new Error(`There is already a sprite set named "${key}".`)
	const [row] = await db
		.update(schema.spriteSets)
		.set({ name: key })
		.where(eq(schema.spriteSets.id, setId))
		.returning()
	return row
}

/** Make a set the default. The previous default stays, as an ordinary set. */
export async function setDefaultSpriteSet(
	db: Db,
	characterId: number,
	setId: number
): Promise<void> {
	await requireSpriteSet(db, characterId, setId)
	await db.transaction(async (tx) => {
		await tx
			.update(schema.spriteSets)
			.set({ isDefault: false })
			.where(
				and(
					eq(schema.spriteSets.characterId, characterId),
					eq(schema.spriteSets.isDefault, true)
				)
			)
		await tx
			.update(schema.spriteSets)
			.set({ isDefault: true })
			.where(eq(schema.spriteSets.id, setId))
	})
}

/**
 * Delete a set and its sprites.
 *
 * The default set can be deleted only when it is the character's last set —
 * otherwise a cast member's fallback would silently change to "no sprites".
 * Make another set the default first.
 */
export async function deleteSpriteSet(
	db: Db,
	characterId: number,
	setId: number
): Promise<void> {
	const set = await requireSpriteSet(db, characterId, setId)
	if (set.isDefault) {
		const others = await db.query.spriteSets.findFirst({
			where: and(
				eq(schema.spriteSets.characterId, characterId),
				ne(schema.spriteSets.id, setId)
			),
			columns: { id: true }
		})
		if (others) {
			throw new Error(
				"Make another sprite set the default before deleting this one."
			)
		}
	}
	const fileIds = (
		await db
			.select({ fileId: schema.sprites.fileId })
			.from(schema.sprites)
			.where(
				and(
					eq(schema.sprites.spriteSetId, setId),
					isNotNull(schema.sprites.fileId)
				)
			)
	).map((r) => r.fileId as number)
	await db.delete(schema.spriteSets).where(eq(schema.spriteSets.id, setId))
	for (const fileId of new Set(fileIds)) await releaseSpriteFile(db, fileId)
}

/** The next free position under (set, label). */
async function nextPosition(
	db: Db,
	setId: number,
	label: string
): Promise<number> {
	const [{ top }] = await db
		.select({ top: max(schema.sprites.position) })
		.from(schema.sprites)
		.where(
			and(eq(schema.sprites.spriteSetId, setId), eq(schema.sprites.label, label))
		)
	return (top ?? -1) + 1
}

export interface AddSpriteInput {
	userId: number
	characterId: number
	/** The target set; omitted = the default set. */
	setId?: number
	label: string
	bytes: Buffer | Uint8Array
	filename?: string | null
	source: SpriteOrigin
}

/**
 * Store an image and add it as a sprite.
 *
 * An **empty sprite** already waiting under that label is filled rather than
 * a variant added beside it — "add the standard set" makes slots, and the
 * first upload into a slot is meant to land in it.
 *
 * `createMedia` sniffs the bytes, so a card's lying `ext` never matters, and
 * refuses a non-image.
 */
export async function addSprite(
	db: Db,
	input: AddSpriteInput
): Promise<SpriteRow> {
	const label = normalizeSpriteName(input.label)
	if (!label) throw new Error("A sprite needs a label.")
	const set = input.setId
		? await requireSpriteSet(db, input.characterId, input.setId)
		: await ensureDefaultSpriteSet(db, input.characterId)

	const { file } = await createMedia(db, {
		userId: input.userId,
		characterId: input.characterId,
		bytes: input.bytes,
		filename: input.filename ?? null
	})

	// The same image already under this label in this set: nothing to add.
	const same = await db.query.sprites.findFirst({
		where: and(
			eq(schema.sprites.spriteSetId, set.id),
			eq(schema.sprites.label, label),
			eq(schema.sprites.fileId, file.id)
		)
	})
	if (same) return same

	const empty = await db.query.sprites.findFirst({
		where: and(
			eq(schema.sprites.spriteSetId, set.id),
			eq(schema.sprites.label, label),
			sql`${schema.sprites.fileId} IS NULL`
		),
		orderBy: [asc(schema.sprites.position)]
	})
	if (empty) {
		const [row] = await db
			.update(schema.sprites)
			.set({ fileId: file.id, source: input.source })
			.where(eq(schema.sprites.id, empty.id))
			.returning()
		return row
	}

	const [row] = await db
		.insert(schema.sprites)
		.values({
			spriteSetId: set.id,
			label,
			position: await nextPosition(db, set.id, label),
			fileId: file.id,
			source: input.source
		})
		.returning()
	return row
}

/**
 * Add empty sprites for labels the set does not have yet — "Add the standard
 * set". Labels already present (with or without an image) are left alone.
 */
export async function addEmptySprites(
	db: Db,
	characterId: number,
	setId: number | undefined,
	labels: readonly string[]
): Promise<number> {
	const set = setId
		? await requireSpriteSet(db, characterId, setId)
		: await ensureDefaultSpriteSet(db, characterId)
	const present = new Set(
		(
			await db
				.select({ label: schema.sprites.label })
				.from(schema.sprites)
				.where(eq(schema.sprites.spriteSetId, set.id))
		).map((r) => r.label)
	)
	const wanted = [...new Set(labels.map(normalizeSpriteName))].filter(
		(l) => l && !present.has(l)
	)
	if (wanted.length === 0) return 0
	await db.insert(schema.sprites).values(
		wanted.map((label) => ({
			spriteSetId: set.id,
			label,
			position: 0,
			fileId: null,
			source: "upload"
		}))
	)
	return wanted.length
}

/** Load a sprite and check it belongs to the character. Throws otherwise. */
async function requireSprite(
	db: Db,
	characterId: number,
	spriteId: number
): Promise<SpriteRow & { characterId: number }> {
	const [row] = await db
		.select({ sprite: schema.sprites, characterId: schema.spriteSets.characterId })
		.from(schema.sprites)
		.innerJoin(
			schema.spriteSets,
			eq(schema.spriteSets.id, schema.sprites.spriteSetId)
		)
		.where(eq(schema.sprites.id, spriteId))
	if (!row || row.characterId !== characterId) {
		throw new Error("Sprite not found.")
	}
	return { ...row.sprite, characterId: row.characterId }
}

/** Move a sprite to another label (appended after that label's variants). */
export async function relabelSprite(
	db: Db,
	characterId: number,
	spriteId: number,
	label: string
): Promise<SpriteRow> {
	const sprite = await requireSprite(db, characterId, spriteId)
	const key = normalizeSpriteName(label)
	if (!key) throw new Error("A sprite needs a label.")
	if (key === sprite.label) return sprite
	const [row] = await db
		.update(schema.sprites)
		.set({
			label: key,
			position: await nextPosition(db, sprite.spriteSetId, key)
		})
		.where(eq(schema.sprites.id, spriteId))
		.returning()
	return row
}

/** Move a sprite to another set of the same character, keeping its label. */
export async function moveSprite(
	db: Db,
	characterId: number,
	spriteId: number,
	toSetId: number
): Promise<SpriteRow> {
	const sprite = await requireSprite(db, characterId, spriteId)
	await requireSpriteSet(db, characterId, toSetId)
	if (sprite.spriteSetId === toSetId) return sprite
	const [row] = await db
		.update(schema.sprites)
		.set({
			spriteSetId: toSetId,
			position: await nextPosition(db, toSetId, sprite.label)
		})
		.where(eq(schema.sprites.id, spriteId))
		.returning()
	return row
}

/**
 * Put one label's variants in the order given. Ids not under that (set,
 * label) are ignored.
 *
 * Two passes because `(set, label, position)` is unique and a reorder is a
 * permutation: every row first moves to a position no row holds, then to its
 * place.
 */
export async function reorderSpriteVariants(
	db: Db,
	characterId: number,
	setId: number,
	label: string,
	orderedIds: number[]
): Promise<void> {
	await requireSpriteSet(db, characterId, setId)
	const key = normalizeSpriteName(label)
	const rows = await db
		.select({ id: schema.sprites.id })
		.from(schema.sprites)
		.where(
			and(eq(schema.sprites.spriteSetId, setId), eq(schema.sprites.label, key))
		)
	const allowed = new Set(rows.map((r) => r.id))
	const ids = orderedIds.filter((id) => allowed.has(id))
	for (const id of rows.map((r) => r.id)) if (!ids.includes(id)) ids.push(id)
	await db.transaction(async (tx) => {
		for (const [i, id] of ids.entries()) {
			await tx
				.update(schema.sprites)
				.set({ position: 1_000_000 + i })
				.where(eq(schema.sprites.id, id))
		}
		for (const [i, id] of ids.entries()) {
			await tx
				.update(schema.sprites)
				.set({ position: i })
				.where(eq(schema.sprites.id, id))
		}
	})
}

/** Delete one sprite, and its file when nothing else wears it. */
export async function deleteSprite(
	db: Db,
	characterId: number,
	spriteId: number
): Promise<void> {
	const sprite = await requireSprite(db, characterId, spriteId)
	await db.delete(schema.sprites).where(eq(schema.sprites.id, spriteId))
	if (sprite.fileId) await releaseSpriteFile(db, sprite.fileId)
}

/**
 * Delete a file a sprite stopped pointing at — but only when it has no other
 * role and no other parent: no other sprite, no character's avatar, and no
 * session or message (a file there is part of a conversation).
 *
 * Deliberately conservative. A kept file is recoverable by the cleanup tool;
 * a deleted avatar is a broken face everywhere it was shown.
 */
async function releaseSpriteFile(db: Db, fileId: number): Promise<void> {
	const stillSprite = await db.query.sprites.findFirst({
		where: eq(schema.sprites.fileId, fileId),
		columns: { id: true }
	})
	if (stillSprite) return
	const avatar = await db.query.characters.findFirst({
		where: eq(schema.characters.avatarMediaId, fileId),
		columns: { id: true }
	})
	if (avatar) return
	const file = await db.query.files.findFirst({
		where: eq(schema.files.id, fileId),
		columns: { sessionId: true, messageId: true }
	})
	if (!file || file.sessionId || file.messageId) return
	await deleteFile(db, fileId)
}

/**
 * The files of a character that are sprites and NOT its avatar — what the
 * gallery leaves out. The avatar stays in the gallery even when the same bytes
 * are also a sprite (a RisuAI card's `neutral` is often the icon).
 */
export async function spriteFileIds(
	db: Db,
	characterId: number
): Promise<Set<number>> {
	const character = await db.query.characters.findFirst({
		where: eq(schema.characters.id, characterId),
		columns: { avatarMediaId: true }
	})
	const rows = await db
		.select({ fileId: schema.sprites.fileId })
		.from(schema.sprites)
		.innerJoin(
			schema.spriteSets,
			eq(schema.spriteSets.id, schema.sprites.spriteSetId)
		)
		.where(
			and(
				eq(schema.spriteSets.characterId, characterId),
				isNotNull(schema.sprites.fileId)
			)
		)
	const ids = new Set(rows.map((r) => r.fileId as number))
	if (character?.avatarMediaId) ids.delete(character.avatarMediaId)
	return ids
}

/** One image to import as a sprite. */
export interface SpriteImportItem {
	/** Target set name; omitted = the default set. Created when missing. */
	set?: string
	label: string
	bytes: Buffer | Uint8Array
	filename?: string | null
}

export interface SpriteImportResult {
	added: number
	/** Items refused, with the reason, for the import's warning list. */
	skipped: { label: string; reason: string }[]
}

/**
 * Import sprites for a character — a card, a SillyTavern folder.
 *
 * Enforces `SPRITE_IMPORT_LIMITS` before storing anything past a ceiling, and
 * never throws for one bad image: an image `createMedia` refuses (not an
 * image, a corrupt file) is skipped and reported, and the rest still land.
 */
export async function importSprites(
	db: Db,
	userId: number,
	characterId: number,
	items: readonly SpriteImportItem[],
	source: SpriteOrigin
): Promise<SpriteImportResult> {
	const result: SpriteImportResult = { added: 0, skipped: [] }
	let total = 0
	const setIds = new Map<string, number>()
	for (const [index, item] of items.entries()) {
		const label = normalizeSpriteName(item.label) || `sprite ${index + 1}`
		if (result.added >= SPRITE_IMPORT_LIMITS.count) {
			result.skipped.push({ label, reason: "too many sprites in one import" })
			continue
		}
		if (item.bytes.length > SPRITE_IMPORT_LIMITS.bytes) {
			result.skipped.push({ label, reason: "image too large" })
			continue
		}
		if (total + item.bytes.length > SPRITE_IMPORT_LIMITS.totalBytes) {
			result.skipped.push({ label, reason: "import too large" })
			continue
		}
		try {
			const setKey = normalizeSpriteName(item.set ?? "")
			let setId: number | undefined
			if (setKey) {
				setId = setIds.get(setKey)
				if (setId === undefined) {
					// The default set first, so a card whose sets are all named
					// still gets a default that is not one of them by accident.
					await ensureDefaultSpriteSet(db, characterId)
					const set =
						(await findSpriteSetByName(db, characterId, setKey)) ??
						(await createSpriteSet(db, characterId, setKey))
					setId = set.id
					setIds.set(setKey, setId)
				}
			}
			await addSprite(db, {
				userId,
				characterId,
				setId,
				label,
				bytes: item.bytes,
				filename: item.filename ?? null,
				source
			})
			total += item.bytes.length
			result.added++
		} catch (e) {
			result.skipped.push({ label, reason: spriteSkipReason(e, characterId, label) })
		}
	}
	return result
}

/**
 * Why one sprite was left behind, as the import's warning says it: the
 * refusal's own words (not an image, a corrupt file), or — for the server's
 * own failure (`isServerFailure`: a query, the disk, a bug) — a plain phrase,
 * with the whole error in the server log. A card's label reaches the query,
 * so a card can make the database fail on purpose; its text never reaches
 * the person.
 */
function spriteSkipReason(e: unknown, characterId: number, label: string): string {
	if (isServerFailure(e) || !(e instanceof Error) || !e.message) {
		console.error(`[sprites] Character ${characterId}'s sprite "${label}" was not saved:`, e)
		return "the server could not save it; the server log has the details"
	}
	return e.message
}

/**
 * Every character's sprite labels with an image, by set name — the shape a
 * picker and a renderer read. One query for many characters.
 */
export async function spriteLabelsFor(
	db: Db,
	characterIds: readonly number[]
): Promise<
	Map<number, { defaultSet: string | null; sets: Map<string, string[]> }>
> {
	const out = new Map<
		number,
		{ defaultSet: string | null; sets: Map<string, string[]> }
	>()
	if (characterIds.length === 0) return out
	const rows = await db
		.select({
			characterId: schema.spriteSets.characterId,
			set: schema.spriteSets.name,
			isDefault: schema.spriteSets.isDefault,
			label: schema.sprites.label
		})
		.from(schema.sprites)
		.innerJoin(
			schema.spriteSets,
			eq(schema.spriteSets.id, schema.sprites.spriteSetId)
		)
		.where(
			and(
				inArray(schema.spriteSets.characterId, [...characterIds]),
				isNotNull(schema.sprites.fileId)
			)
		)
	for (const r of rows) {
		let entry = out.get(r.characterId)
		if (!entry) {
			entry = { defaultSet: null, sets: new Map() }
			out.set(r.characterId, entry)
		}
		if (r.isDefault) entry.defaultSet = r.set
		const labels = entry.sets.get(r.set) ?? []
		if (!labels.includes(r.label)) labels.push(r.label)
		entry.sets.set(r.set, labels)
	}
	return out
}
