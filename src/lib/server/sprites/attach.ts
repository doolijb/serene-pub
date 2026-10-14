/**
 * 🚧 `core:outlet/attach-sprite@1`'s write (DESIGN-image-generation §6.3,
 * §4.11; I5): file each keyed picture a run drew as a sprite of the card.
 *
 * The host's commit calls this; nothing else should. The rules are the
 * contract's: a keyed picture lands under the sprite label its key was drawn
 * for (an empty sprite first, else a variant — never a replacement); an
 * unkeyed picture is ignored; a key that brought no picture is `missing`.
 *
 * Refused unless the person the run acts as owns the card or is an admin.
 * A picture must be the run person's own file or already the card's — a
 * media reference is an address anyone could type, and a sprite would
 * re-publish whatever it names under the card's visibility.
 */

import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { getMediaByUuid } from "$lib/server/media"
import {
	ensureDefaultSpriteSet,
	findSpriteSetByName,
	placeSpriteFile
} from "$lib/server/sprites"
import { normalizeSpriteName } from "$lib/shared/sprites"

export class AttachSpriteRefusal extends Error {}

export interface AttachSpritesInput {
	characterId: number
	/** The set to fill, by name; blank or gone = the default set. */
	setName?: string | null
	/** The pictures — `MediaRef`s, each with the series `key` it was drawn for. */
	media: unknown
	/** The series asked for: `{ key, vars: { label } }` per item. */
	series?: unknown
	/** Who the run acts as. */
	userId: number
}

export interface AttachSpritesResult {
	setId: number
	setName: string
	attached: Array<{ label: string; spriteId: number; fileId: number }>
	/** Labels the series asked for that came back with no picture. */
	missing: string[]
}

/** May this person fill this card's sprites: its owner, or an admin. */
export async function mayFillSprites(
	db: Db,
	userId: number,
	characterId: number
): Promise<boolean> {
	const character = await db.query.characters.findFirst({
		where: eq(schema.characters.id, characterId),
		columns: { id: true, userId: true }
	})
	if (!character) return false
	if (character.userId === userId) return true
	const user = await db.query.users.findFirst({
		where: eq(schema.users.id, userId),
		columns: { isAdmin: true }
	})
	return !!user?.isAdmin
}

/** The key → sprite label map a series carries; a key with no label is its own label. */
export function labelsByKey(series: unknown): Map<string, string> {
	const out = new Map<string, string>()
	if (!Array.isArray(series)) return out
	for (const item of series) {
		if (!item || typeof item !== "object") continue
		const key = (item as { key?: unknown }).key
		if (key === undefined || key === null) continue
		const vars = (item as { vars?: Record<string, unknown> }).vars
		const label = normalizeSpriteName(vars?.label) || normalizeSpriteName(String(key))
		if (label) out.set(String(key), label)
	}
	return out
}

export async function attachGeneratedSprites(
	db: Db,
	input: AttachSpritesInput
): Promise<AttachSpritesResult> {
	if (!(await mayFillSprites(db, input.userId, input.characterId)))
		throw new AttachSpriteRefusal(
			"only the card's owner or an admin can add sprites to it."
		)

	const set =
		(input.setName
			? await findSpriteSetByName(db, input.characterId, input.setName)
			: null) ?? (await ensureDefaultSpriteSet(db, input.characterId))

	const byKey = labelsByKey(input.series)
	const items = Array.isArray(input.media)
		? input.media
		: input.media
			? [input.media]
			: []

	const attached: AttachSpritesResult["attached"] = []
	const got = new Set<string>()
	for (const item of items) {
		if (!item || typeof item !== "object") continue
		const ref = item as { uuid?: unknown; key?: unknown; kind?: unknown }
		// Surplus the host kept with no key context: not a sprite.
		if (ref.key === undefined || ref.key === null || ref.key === "") continue
		if (ref.kind !== undefined && ref.kind !== "image") continue
		const key = String(ref.key)
		const label = byKey.get(key) ?? normalizeSpriteName(key)
		if (!label || typeof ref.uuid !== "string") continue
		const file = await getMediaByUuid(db, ref.uuid)
		if (!file) continue
		if (file.userId !== input.userId && file.characterId !== input.characterId)
			throw new AttachSpriteRefusal(
				"a picture handed to it is neither yours nor this card's."
			)
		// Provenance: the picture becomes the card's file (its visibility,
		// its gallery rule). Only a file nobody else claims is stamped.
		if (file.characterId == null)
			await db
				.update(schema.files)
				.set({ characterId: input.characterId })
				.where(
					and(eq(schema.files.id, file.id), isNull(schema.files.characterId))
				)
		const row = await placeSpriteFile(db, set.id, label, file.id, "generated")
		attached.push({ label, spriteId: row.id, fileId: file.id })
		got.add(key)
	}

	const missing = [...byKey.entries()]
		.filter(([key]) => !got.has(key))
		.map(([, label]) => label)

	return { setId: set.id, setName: set.name, attached, missing }
}
