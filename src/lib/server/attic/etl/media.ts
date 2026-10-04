/**
 * 0.5.3's image paths as 0.6 media: avatars, galleries, uploaded backgrounds.
 *
 * 0.5.3 stored a URL, `/images/data/users/<uid>/…`, served from the app data
 * root. Each file is read and handed to `createMedia` — the one path every
 * upload takes — which hashes it, writes it under its hash and dedupes per
 * user. The 0.5.3 file is left where it is: the upgrade copies, never moves,
 * so the pre-upgrade backup and the folder agree.
 *
 * Galleries go first, in their 0.5.3 order, so an avatar that was also a
 * gallery image (0.5.3 listed the avatar in its own gallery) finds its row
 * rather than adding a second one. A file that is missing or unreadable is
 * skipped with a note; it never fails the upgrade.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, gt } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createMedia } from "$lib/server/media"
import * as attic from "../tables"
import { asDate, mapped, movedTo, readById, type RestoreContext } from "../context"

const LEGACY_PREFIX = "/images/"

/** The file a 0.5.3 image URL names, if it names one inside the data root. */
export function legacyImagePath(
	ref: string | null | undefined,
	appDataDir: string
): string | null {
	if (!ref || !ref.startsWith(LEGACY_PREFIX)) return null
	const rel = decodeURIComponent(ref.slice(LEGACY_PREFIX.length))
	const root = path.resolve(appDataDir, "data", "users")
	const abs = path.resolve(appDataDir, rel)
	return abs.startsWith(root + path.sep) ? abs : null
}

async function importImage(
	ctx: RestoreContext,
	input: {
		ref: string
		userId: number
		characterId?: number
		position?: number
		bucket?: string
		owner: string
	}
): Promise<number | null> {
	const abs = legacyImagePath(input.ref, ctx.appDataDir)
	let bytes: Buffer | null = null
	if (abs)
		try {
			bytes = await fs.readFile(abs)
		} catch {
			bytes = null
		}
	if (!bytes) {
		ctx.notes.add({
			topic: "image-missing",
			objectLabel: input.owner,
			summary: `The image ${input.ref} for ${input.owner} was not found in the data folder, so it was not carried over.`
		})
		return null
	}
	try {
		const { file } = await createMedia(ctx.tx, {
			userId: input.userId,
			characterId: input.characterId,
			bytes,
			filename: path.basename(abs!),
			position: input.position,
			bucket: input.bucket
		})
		return file.id
	} catch (err) {
		ctx.notes.add({
			topic: "image-missing",
			objectLabel: input.owner,
			summary: `The image ${input.ref} for ${input.owner} could not be read as an image (${(err as Error).message}), so it was not carried over.`
		})
		return null
	}
}

/**
 * A gallery image's 0.5.3 date onto its file. Only ever moved earlier: a file
 * two gallery rows shared keeps the older date.
 */
async function keepDate(
	ctx: RestoreContext,
	fileId: number | null,
	createdAt: string | Date | null | undefined
): Promise<void> {
	const at = asDate(createdAt)
	if (fileId == null || !at) return
	await ctx.tx
		.update(schema.files)
		.set({ createdAt: at })
		.where(and(eq(schema.files.id, fileId), gt(schema.files.createdAt, at)))
}

export async function restoreImages(
	ctx: RestoreContext,
	backgrounds: Array<{ userId: number; backgroundImagePath: string | null }>
): Promise<void> {
	const { tx } = ctx
	const chars = await readById(tx, attic.characters)
	const charById = new Map(chars.map((c) => [c.id, c]))
	const personas = await readById(tx, attic.personas)
	const personaById = new Map(personas.map((p) => [p.id, p]))
	const galleryCount = new Map<number, number>()

	const gallery = await tx
		.select()
		.from(attic.characterGalleryImages)
		.orderBy(
			asc(attic.characterGalleryImages.characterId),
			asc(attic.characterGalleryImages.position),
			asc(attic.characterGalleryImages.id)
		)
	for (const g of gallery) {
		const c = charById.get(g.characterId)
		if (!c) continue
		const position = galleryCount.get(c.id) ?? 0
		const id = await importImage(ctx, {
			ref: g.path,
			userId: mapped(ctx, "users", c.userId)!,
			characterId: c.id,
			position,
			owner: `character "${c.name}"`
		})
		if (id != null) galleryCount.set(c.id, position + 1)
		await keepDate(ctx, id, g.createdAt)
	}

	const personaGallery = await tx
		.select()
		.from(attic.personaGalleryImages)
		.orderBy(
			asc(attic.personaGalleryImages.personaId),
			asc(attic.personaGalleryImages.position),
			asc(attic.personaGalleryImages.id)
		)
	for (const g of personaGallery) {
		const p = personaById.get(g.personaId)
		const characterId = movedTo(ctx, "personas", g.personaId)
		if (!p || characterId == null) continue
		const position = galleryCount.get(characterId) ?? 0
		const id = await importImage(ctx, {
			ref: g.path,
			userId: mapped(ctx, "users", p.userId)!,
			characterId,
			position,
			owner: `persona "${p.name}"`
		})
		if (id != null) galleryCount.set(characterId, position + 1)
		await keepDate(ctx, id, g.createdAt)
	}

	const avatars: Array<{
		ref: string
		userId: number
		characterId: number
		owner: string
	}> = [
		...chars
			.filter((c) => c.avatar)
			.map((c) => ({
				ref: c.avatar!,
				userId: mapped(ctx, "users", c.userId)!,
				characterId: c.id,
				owner: `character "${c.name}"`
			})),
		...personas
			.filter((p) => p.avatar)
			.map((p) => ({
				ref: p.avatar!,
				userId: mapped(ctx, "users", p.userId)!,
				characterId: movedTo(ctx, "personas", p.id)!,
				owner: `persona "${p.name}"`
			}))
	]
	for (const a of avatars) {
		const position = galleryCount.get(a.characterId) ?? 0
		const fileId = await importImage(ctx, { ...a, position })
		if (fileId == null) continue
		await tx
			.update(schema.characters)
			.set({ avatarMediaId: fileId })
			.where(eq(schema.characters.id, a.characterId))
	}

	// A shipped background (`/backgrounds/defaults/…`) is a static path and
	// stays one; an uploaded one becomes the user's media.
	for (const b of backgrounds) {
		if (!b.backgroundImagePath?.startsWith(LEGACY_PREFIX)) continue
		const fileId = await importImage(ctx, {
			ref: b.backgroundImagePath,
			userId: b.userId,
			bucket: "backgrounds",
			owner: "the background image"
		})
		await tx
			.update(schema.userSettings)
			.set({ backgroundMediaId: fileId, backgroundImagePath: null })
			.where(eq(schema.userSettings.userId, b.userId))
	}
}
