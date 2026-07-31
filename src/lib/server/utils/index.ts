import os from "os"
import path from "path"
import envPaths from "env-paths"
import { db } from "$lib/server/db"
import { and, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { writeFile, mkdir, unlink } from "fs/promises"
import { v4 as uuid } from "uuid"
import { fileTypeFromBuffer } from "file-type"

const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"])

// Round-12 audit fix (MEDIUM): none of the five upload functions in this
// file (avatar x2, gallery x2, background) checked the incoming buffer's
// byte length — the only ceiling anywhere was Socket.IO's global
// maxHttpBufferSize (100MB, loadSockets.server.ts), applied per-EVENT, not
// per-field. 10MB is generous for a high-res avatar/gallery image while
// staying far under that global ceiling. Enforced inside
// sniffImageExtension since every upload path already calls it — a single
// choke point instead of five separate checks.
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Sniffs the real file type from the uploaded bytes and returns a safe
 * extension to write to disk — never trusts the client-supplied MIME
 * type/extension, which previously went straight into the on-disk filename
 * with no verification that it matched the actual file content.
 */
async function sniffImageExtension(
	buffer: Buffer | Uint8Array
): Promise<string> {
	if (buffer.length > MAX_IMAGE_UPLOAD_BYTES) {
		throw new Error(
			`Uploaded image is too large (max ${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)}MB).`
		)
	}
	const detected = await fileTypeFromBuffer(buffer)
	const ext = detected?.ext?.toLowerCase()
	if (!ext || !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
		throw new Error(
			"Uploaded file is not a recognized image type (png/jpg/webp/gif)"
		)
	}
	return ext === "jpeg" ? "jpg" : ext
}

/**
 * Deletes a previously-stored avatar file, given its stored `avatar` URL
 * (or null/undefined — a no-op) and the entity's own data directory —
 * reuses the same URL-to-filesystem-path pattern already established at
 * the PNG card-export call sites (getCharacterDataDir/getPersonaDataDir +
 * path.basename(avatar) + path.join). Errors (already gone, permission
 * issue) are swallowed, same safety shape as deleteUserBackground — a
 * failed cleanup shouldn't fail the upload that already succeeded.
 */
async function deleteOldAvatarIfPresent(
	previousAvatar: string | null | undefined,
	avatarDir: string
): Promise<void> {
	if (!previousAvatar) return
	const filename = path.basename(previousAvatar)
	const fullPath = path.join(avatarDir, filename)
	if (!fullPath.startsWith(avatarDir)) return
	try {
		await unlink(fullPath)
	} catch {
		// File already gone, or never existed on disk (eg. an imported
		// card's avatar) — ignore.
	}
}

/**
 * Gets the application data directory with optional override from environment
 * Checks SERENE_PUB_DATA_DIR environment variable first, falls back to envPaths
 */
export function getAppDataDir() {
	const envDataDir = process.env.SERENE_PUB_DATA_DIR
	if (envDataDir) {
		return envDataDir
	}

	const paths = envPaths("SerenePub", { suffix: "" })
	return paths.data
}

/**
 * True when running inside the bundled Android app wrapper (NodeService.kt sets
 * this env var before spawning the server). Used to hide features that don't
 * make sense in that sandbox — managed local model runners need a binary we
 * don't/can't bundle for Android, and on-device embedding models are an
 * unverified native-dependency risk there.
 */
export function isAndroidWrapper() {
	return process.env.SERENE_PUB_PLATFORM === "android"
}

/**
 * Gates whether NSFW browsing is available at all — both the "include
 * NSFW" toggle's visibility and whether outbound card-source search
 * requests are ever allowed to ask for NSFW-inclusive results. Off by
 * default; must be explicitly opted into via env var, not just disabled by
 * default UI state, so NSFW content is invisible rather than merely hidden
 * behind a togglable client-side flag.
 */
export function isUnsafeCharacterBrowsingEnabled() {
	return process.env.ENABLE_UNSAFE_CHARACTER_BROWSING === "true"
}

/**
 * Gets the database data directory (app data dir + /data)
 * Includes CI environment check for compatibility with existing logic
 */
export function getDbDataDir() {
	const isCI = process.env.CI === "true"
	if (isCI) {
		return path.join(os.homedir(), "SerenePubData")
	}

	const appDataDir = getAppDataDir()
	return path.join(appDataDir, "data")
}

export function getCharacterDataDir({
	characterId,
	userId
}: {
	characterId: number
	userId: number
}) {
	const appData = getAppDataDir()
	return path.join(
		appData,
		"data",
		"users",
		String(userId),
		"characters",
		String(characterId)
	)
}

export function getPersonaDataDir({
	personaId,
	userId
}: {
	personaId: number
	userId: number
}) {
	const appData = getAppDataDir()
	return path.join(
		appData,
		"data",
		"users",
		String(userId),
		"personas",
		String(personaId)
	)
}

export async function handleCharacterAvatarUpload({
	character,
	avatarFile
}: {
	character: any
	avatarFile: Buffer
}) {
	const ext = await sniffImageExtension(avatarFile)
	const filename = `avatar-${uuid().substring(0, 4)}.${ext}`
	const avatarDir = getCharacterDataDir({
		characterId: character.id,
		userId: character.userId
	})
	// Ensure the directory exists
	await mkdir(avatarDir, { recursive: true })
	// Save the new avatar file
	const filePath = path.join(avatarDir, filename)
	await writeFile(filePath, avatarFile, { flag: "w" }) // Write the file to disk
	const avatar = `/images/data/users/${character.userId}/characters/${character.id}/${filename}` // Construct URL for the avatar
	await db
		.update(schema.characters)
		.set({ avatar })
		.where(eq(schema.characters.id, character.id))
	// Round-12 audit fix (MEDIUM): the previous avatar file was never
	// deleted on re-upload — unbounded orphan growth on disk on every
	// re-upload. `character.avatar` here is the pre-update value (the
	// caller fetched this row before calling this function).
	await deleteOldAvatarIfPresent(character.avatar, avatarDir)
}

export function getUserBackgroundsDir({ userId }: { userId: number }) {
	const appData = getAppDataDir()
	return path.join(appData, "data", "users", String(userId), "backgrounds")
}

export async function handleUserBackgroundUpload({
	userId,
	backgroundFile,
	mimeType
}: {
	userId: number
	backgroundFile: Buffer | Uint8Array
	mimeType: string
}) {
	const ext = await sniffImageExtension(backgroundFile)
	const filename = `bg-${uuid().substring(0, 8)}.${ext}`
	const bgDir = getUserBackgroundsDir({ userId })
	await mkdir(bgDir, { recursive: true })
	const filePath = path.join(bgDir, filename)
	await writeFile(filePath, backgroundFile, { flag: "w" })
	return `/images/data/users/${userId}/backgrounds/${filename}`
}

export async function listUserBackgrounds({ userId }: { userId: number }) {
	const bgDir = getUserBackgroundsDir({ userId })
	try {
		const { readdir } = await import("fs/promises")
		const files = await readdir(bgDir)
		return files
			.filter((f) => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f))
			.map((f) => `/images/data/users/${userId}/backgrounds/${f}`)
	} catch {
		return []
	}
}

export async function deleteUserBackground({
	userId,
	path: bgPath
}: {
	userId: number
	path: string
}) {
	// Safety: only allow deleting files within this user's backgrounds dir
	const bgDir = getUserBackgroundsDir({ userId })
	const filename = path.basename(bgPath)
	const fullPath = path.join(bgDir, filename)
	// Ensure the resolved path is inside the expected directory
	if (!fullPath.startsWith(bgDir)) return
	try {
		const { unlink } = await import("fs/promises")
		await unlink(fullPath)
	} catch {
		// File already gone — ignore
	}
}

export async function handlePersonaAvatarUpload({
	persona,
	avatarFile
}: {
	persona: any
	avatarFile: Buffer
}) {
	const ext = await sniffImageExtension(avatarFile)
	const filename = `avatar-${uuid().substring(0, 4)}.${ext}` // Use UUID to ensure unique filename
	const avatarDir = getPersonaDataDir({
		personaId: persona.id,
		userId: persona.userId
	})
	// Ensure the directory exists
	await mkdir(avatarDir, { recursive: true })
	// Save the new avatar file
	const filePath = path.join(avatarDir, filename)
	await writeFile(filePath, avatarFile, { flag: "w" }) // Write the file to disk
	const avatar = `/images/data/users/${persona.userId}/personas/${persona.id}/${filename}` // Construct URL for the avatar
	await db
		.update(schema.personas)
		.set({ avatar })
		.where(eq(schema.personas.id, persona.id))
	// Round-12 audit fix (MEDIUM): see handleCharacterAvatarUpload — same
	// orphan-cleanup fix, same reasoning.
	await deleteOldAvatarIfPresent(persona.avatar, avatarDir)
}

/**
 * Gallery uploads add to the gallery only — they deliberately do NOT touch
 * `characters.avatar` (a prior version of this function did, which meant
 * every gallery upload silently changed the character's avatar). Setting
 * the avatar is a separate, explicit action (see charactersSetAvatar).
 */
export async function uploadCharacterGalleryImage({
	characterId,
	userId,
	imageFile,
	mimeType
}: {
	characterId: number
	userId: number
	imageFile: Buffer
	mimeType: string
}) {
	const ext = await sniffImageExtension(imageFile)
	const filename = `img-${uuid().substring(0, 8)}.${ext}`
	const dir = getCharacterDataDir({ characterId, userId })
	await mkdir(dir, { recursive: true })
	const filePath = path.join(dir, filename)
	await writeFile(filePath, imageFile, { flag: "w" })
	const imgPath = `/images/data/users/${userId}/characters/${characterId}/${filename}`

	const [{ maxPosition }] = await db
		.select({
			maxPosition: sql<number>`coalesce(max(${schema.characterGalleryImages.position}), -1)`
		})
		.from(schema.characterGalleryImages)
		.where(eq(schema.characterGalleryImages.characterId, characterId))
	await db.insert(schema.characterGalleryImages).values({
		characterId,
		path: imgPath,
		position: maxPosition + 1
	})

	return imgPath
}

/**
 * Lists a character's gallery images in persisted order, reconciling the
 * `characterGalleryImages` table against what's actually on disk: rows
 * whose file is gone (eg. removed out-of-band) are dropped, and on-disk
 * files with no row yet (eg. the first call after this table was
 * introduced, or a file that landed on disk some other way) are lazily
 * backfilled at the end, in directory-listing order — a one-time self-heal
 * rather than a startup migration script.
 */
export async function listCharacterGallery({
	characterId,
	userId
}: {
	characterId: number
	userId: number
}) {
	const dir = getCharacterDataDir({ characterId, userId })
	const urlPrefix = `/images/data/users/${userId}/characters/${characterId}/`

	let onDiskPaths = new Set<string>()
	try {
		const { readdir } = await import("fs/promises")
		const files = await readdir(dir)
		onDiskPaths = new Set(
			files
				.filter((f) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
				.map((f) => urlPrefix + f)
		)
	} catch {
		onDiskPaths = new Set()
	}

	const rows = await db.query.characterGalleryImages.findMany({
		where: eq(schema.characterGalleryImages.characterId, characterId),
		orderBy: (t, { asc }) => asc(t.position)
	})

	const staleIds = rows
		.filter((r) => !onDiskPaths.has(r.path))
		.map((r) => r.id)
	if (staleIds.length > 0) {
		await db
			.delete(schema.characterGalleryImages)
			.where(inArray(schema.characterGalleryImages.id, staleIds))
	}

	const knownPaths = new Set(rows.map((r) => r.path))
	const missingPaths = [...onDiskPaths].filter((p) => !knownPaths.has(p))
	if (missingPaths.length > 0) {
		let nextPosition =
			rows.length > 0 ? Math.max(...rows.map((r) => r.position)) + 1 : 0
		await db.insert(schema.characterGalleryImages).values(
			missingPaths.map((p) => ({
				characterId,
				path: p,
				position: nextPosition++
			}))
		)
	}

	if (staleIds.length === 0 && missingPaths.length === 0) {
		return rows.map((r) => r.path)
	}

	const finalRows = await db.query.characterGalleryImages.findMany({
		where: eq(schema.characterGalleryImages.characterId, characterId),
		orderBy: (t, { asc }) => asc(t.position)
	})
	return finalRows.map((r) => r.path)
}

export async function deleteCharacterGalleryImage({
	characterId,
	userId,
	path: imgPath
}: {
	characterId: number
	userId: number
	path: string
}) {
	const dir = getCharacterDataDir({ characterId, userId })
	const filename = path.basename(imgPath)
	const fullPath = path.join(dir, filename)
	if (!fullPath.startsWith(dir)) return
	try {
		const { unlink } = await import("fs/promises")
		await unlink(fullPath)
	} catch {
		// File already gone
	}
	await db
		.delete(schema.characterGalleryImages)
		.where(
			and(
				eq(schema.characterGalleryImages.characterId, characterId),
				eq(schema.characterGalleryImages.path, imgPath)
			)
		)
	// The deleted file may have been the character's avatar — leaving that
	// column pointing at a now-nonexistent path renders as a broken image
	// everywhere the avatar is shown (character cards, chat messages, etc.),
	// so clear it rather than leave a dangling reference.
	await db
		.update(schema.characters)
		.set({ avatar: null })
		.where(
			and(
				eq(schema.characters.id, characterId),
				eq(schema.characters.avatar, imgPath)
			)
		)
}

/**
 * Persists a new display order for a character's gallery. Only `position`
 * changes — filenames on disk are never renamed — so `characters.avatar`
 * (which stores a full image path) can never be invalidated by a reorder.
 * Paths that don't belong to this character are silently ignored.
 */
export async function reorderCharacterGalleryImages({
	characterId,
	paths
}: {
	characterId: number
	paths: string[]
}) {
	await Promise.all(
		paths.map((p, position) =>
			db
				.update(schema.characterGalleryImages)
				.set({ position })
				.where(
					and(
						eq(
							schema.characterGalleryImages.characterId,
							characterId
						),
						eq(schema.characterGalleryImages.path, p)
					)
				)
		)
	)
}

/** Mirrors uploadCharacterGalleryImage — see its comment. */
export async function uploadPersonaGalleryImage({
	personaId,
	userId,
	imageFile,
	mimeType
}: {
	personaId: number
	userId: number
	imageFile: Buffer
	mimeType: string
}) {
	const ext = await sniffImageExtension(imageFile)
	const filename = `img-${uuid().substring(0, 8)}.${ext}`
	const dir = getPersonaDataDir({ personaId, userId })
	await mkdir(dir, { recursive: true })
	const filePath = path.join(dir, filename)
	await writeFile(filePath, imageFile, { flag: "w" })
	const imgPath = `/images/data/users/${userId}/personas/${personaId}/${filename}`

	const [{ maxPosition }] = await db
		.select({
			maxPosition: sql<number>`coalesce(max(${schema.personaGalleryImages.position}), -1)`
		})
		.from(schema.personaGalleryImages)
		.where(eq(schema.personaGalleryImages.personaId, personaId))
	await db.insert(schema.personaGalleryImages).values({
		personaId,
		path: imgPath,
		position: maxPosition + 1
	})

	return imgPath
}

/** Mirrors listCharacterGallery — see its comment. */
export async function listPersonaGallery({
	personaId,
	userId
}: {
	personaId: number
	userId: number
}) {
	const dir = getPersonaDataDir({ personaId, userId })
	const urlPrefix = `/images/data/users/${userId}/personas/${personaId}/`

	let onDiskPaths = new Set<string>()
	try {
		const { readdir } = await import("fs/promises")
		const files = await readdir(dir)
		onDiskPaths = new Set(
			files
				.filter((f) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
				.map((f) => urlPrefix + f)
		)
	} catch {
		onDiskPaths = new Set()
	}

	const rows = await db.query.personaGalleryImages.findMany({
		where: eq(schema.personaGalleryImages.personaId, personaId),
		orderBy: (t, { asc }) => asc(t.position)
	})

	const staleIds = rows
		.filter((r) => !onDiskPaths.has(r.path))
		.map((r) => r.id)
	if (staleIds.length > 0) {
		await db
			.delete(schema.personaGalleryImages)
			.where(inArray(schema.personaGalleryImages.id, staleIds))
	}

	const knownPaths = new Set(rows.map((r) => r.path))
	const missingPaths = [...onDiskPaths].filter((p) => !knownPaths.has(p))
	if (missingPaths.length > 0) {
		let nextPosition =
			rows.length > 0 ? Math.max(...rows.map((r) => r.position)) + 1 : 0
		await db.insert(schema.personaGalleryImages).values(
			missingPaths.map((p) => ({
				personaId,
				path: p,
				position: nextPosition++
			}))
		)
	}

	if (staleIds.length === 0 && missingPaths.length === 0) {
		return rows.map((r) => r.path)
	}

	const finalRows = await db.query.personaGalleryImages.findMany({
		where: eq(schema.personaGalleryImages.personaId, personaId),
		orderBy: (t, { asc }) => asc(t.position)
	})
	return finalRows.map((r) => r.path)
}

export async function deletePersonaGalleryImage({
	personaId,
	userId,
	path: imgPath
}: {
	personaId: number
	userId: number
	path: string
}) {
	const dir = getPersonaDataDir({ personaId, userId })
	const filename = path.basename(imgPath)
	const fullPath = path.join(dir, filename)
	if (!fullPath.startsWith(dir)) return
	try {
		const { unlink } = await import("fs/promises")
		await unlink(fullPath)
	} catch {
		// File already gone
	}
	await db
		.delete(schema.personaGalleryImages)
		.where(
			and(
				eq(schema.personaGalleryImages.personaId, personaId),
				eq(schema.personaGalleryImages.path, imgPath)
			)
		)
	// See deleteCharacterGalleryImage — clear a dangling avatar reference
	// rather than leave it pointing at a deleted file.
	await db
		.update(schema.personas)
		.set({ avatar: null })
		.where(
			and(
				eq(schema.personas.id, personaId),
				eq(schema.personas.avatar, imgPath)
			)
		)
}

/** Mirrors reorderCharacterGalleryImages — see its comment. */
export async function reorderPersonaGalleryImages({
	personaId,
	paths
}: {
	personaId: number
	paths: string[]
}) {
	await Promise.all(
		paths.map((p, position) =>
			db
				.update(schema.personaGalleryImages)
				.set({ position })
				.where(
					and(
						eq(schema.personaGalleryImages.personaId, personaId),
						eq(schema.personaGalleryImages.path, p)
					)
				)
		)
	)
}
