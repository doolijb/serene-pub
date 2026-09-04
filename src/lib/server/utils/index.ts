import os from "os"
import path from "path"
import envPaths from "env-paths"
import { db } from "$lib/server/db"
import { and, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createMedia,
	clientMediaFor,
	deleteFile,
	getMedia,
	mediaFor,
	reorderMedia
} from "$lib/server/media"

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

// ---------------------------------------------------------------------------
// Media-backed entity helpers (28).
//
// These keep the names the socket handlers already call, but every one of them
// is now a thin adapter over `$lib/server/media`. The five hand-built upload
// paths, the two near-identical gallery tables and the disk<->DB reconciliation
// that `listCharacterGallery` used to perform are all gone: the row is the
// truth, and the file is named after its own hash.
// ---------------------------------------------------------------------------

export async function handleCharacterAvatarUpload({
	character,
	avatarFile
}: {
	character: { id: number; userId: number; avatarMediaId?: number | null }
	avatarFile: Buffer
}) {
	// `createMedia` answers with the file and the original variant it just
	// wrote (0182). An avatar pointer names the FILE — never a stored
	// representation, which is what lets the original be culled later without
	// stranding the pointer.
	const created = await createMedia(db, {
		userId: character.userId,
		characterId: character.id,
		bytes: avatarFile
	})
	await db
		.update(schema.characters)
		.set({ avatarMediaId: created.file.id })
		.where(eq(schema.characters.id, character.id))
	return created
}

export async function handlePersonaAvatarUpload({
	persona,
	avatarFile
}: {
	persona: { id: number; userId: number; avatarMediaId?: number | null }
	avatarFile: Buffer
}) {
	const created = await createMedia(db, {
		userId: persona.userId,
		personaId: persona.id,
		bytes: avatarFile
	})
	await db
		.update(schema.personas)
		.set({ avatarMediaId: created.file.id })
		.where(eq(schema.personas.id, persona.id))
	return created
}

/**
 * The previous avatar file is deliberately NOT deleted here.
 *
 * The old code unlinked it on every re-upload to stop unbounded orphan growth.
 * That is no longer this function's job, and doing it here would now be wrong:
 * the same bytes may be deduped into a gallery entry or another character's
 * avatar, so "nothing points at my old avatar" is not a fact a single caller
 * can establish. Orphans are the cleanup tool's problem (28 §9) — and unlike
 * before, they are an exact query rather than a guess.
 */

export function getUserBackgroundsDir({ userId }: { userId: number }) {
	const appData = getAppDataDir()
	return path.join(appData, "data", "users", String(userId), "backgrounds")
}

export async function handleUserBackgroundUpload({
	userId,
	backgroundFile
}: {
	userId: number
	backgroundFile: Buffer | Uint8Array
	mimeType?: string
}) {
	// No entity parent — a background is personal, so it lands in the user-level
	// bucket and stays owner-only (28 §6: no entity parent means no sharing to
	// inherit).
	return createMedia(db, {
		userId,
		bytes: backgroundFile,
		bucket: "backgrounds"
	})
}

/** A user's uploaded backgrounds, newest last. Shipped defaults are static
 *  assets and are listed separately by `getDefaultBackgrounds`. */
export async function listUserBackgrounds({ userId }: { userId: number }) {
	return clientMediaFor(db, { userId })
}

export async function deleteUserBackground({
	userId,
	mediaId
}: {
	userId: number
	mediaId: number
}) {
	const row = await getMedia(db, mediaId)
	// Ownership is the whole check: a background has no entity parent, so
	// there is no sharing path that could make someone else's deletable.
	if (!row || row.userId !== userId) return
	await deleteFile(db, mediaId)
	await db
		.update(schema.userSettings)
		.set({ backgroundMediaId: null })
		.where(
			and(
				eq(schema.userSettings.userId, userId),
				eq(schema.userSettings.backgroundMediaId, mediaId)
			)
		)
}

/**
 * Gallery uploads add to the gallery only — they deliberately do NOT set the
 * avatar (a prior version did, which meant every gallery upload silently
 * changed it). Setting the avatar stays a separate, explicit action.
 */
export async function uploadCharacterGalleryImage({
	characterId,
	userId,
	imageFile
}: {
	characterId: number
	userId: number
	imageFile: Buffer
}) {
	const existing = await mediaFor(db, { characterId })
	return createMedia(db, {
		userId,
		characterId,
		bytes: imageFile,
		position: existing.length
	})
}

/** Mirrors uploadCharacterGalleryImage. */
export async function uploadPersonaGalleryImage({
	personaId,
	userId,
	imageFile
}: {
	personaId: number
	userId: number
	imageFile: Buffer
}) {
	const existing = await mediaFor(db, { personaId })
	return createMedia(db, {
		userId,
		personaId,
		bytes: imageFile,
		position: existing.length
	})
}

/**
 * A character's gallery.
 *
 * The old version reconciled the database against a directory listing on every
 * call — adopting stray files, deleting rows whose file had vanished — because
 * the row and the file were two independent facts that drifted. They are one
 * fact now, so this is a query.
 *
 * Returns files, and not by filtering: since 0182 a stored representation has
 * no provenance columns at all, so `characterId = X` cannot match one. That
 * absence replaced the old trick of writing a thumbnail with all four
 * provenance columns NULL to keep it out of exactly this query.
 */
export async function listCharacterGallery({
	characterId
}: {
	characterId: number
	userId?: number
}) {
	return clientMediaFor(db, { characterId })
}

export async function listPersonaGallery({
	personaId
}: {
	personaId: number
	userId?: number
}) {
	return clientMediaFor(db, { personaId })
}

export async function deleteCharacterGalleryImage({
	characterId,
	mediaId
}: {
	characterId: number
	userId?: number
	mediaId: number
}) {
	const row = await getMedia(db, mediaId)
	if (!row || row.characterId !== characterId) return
	await deleteFile(db, mediaId)
	// The deleted image may have been the avatar. Clearing the pointer is
	// cheap and keeps a broken image off every card and message; a dangling
	// pointer elsewhere is tolerated by design, but not one we can see.
	await db
		.update(schema.characters)
		.set({ avatarMediaId: null })
		.where(
			and(
				eq(schema.characters.id, characterId),
				eq(schema.characters.avatarMediaId, mediaId)
			)
		)
}

export async function deletePersonaGalleryImage({
	personaId,
	mediaId
}: {
	personaId: number
	userId?: number
	mediaId: number
}) {
	const row = await getMedia(db, mediaId)
	if (!row || row.personaId !== personaId) return
	await deleteFile(db, mediaId)
	await db
		.update(schema.personas)
		.set({ avatarMediaId: null })
		.where(
			and(
				eq(schema.personas.id, personaId),
				eq(schema.personas.avatarMediaId, mediaId)
			)
		)
}

/**
 * Persists a new display order. Only `position` changes — files are named
 * after their own hash and are never renamed — so no reorder can invalidate an
 * avatar pointer. Ids that do not belong to this parent are ignored.
 */
export async function reorderCharacterGalleryImages({
	characterId,
	mediaIds
}: {
	characterId: number
	mediaIds: number[]
}) {
	await reorderMedia(db, { characterId }, mediaIds)
}

export async function reorderPersonaGalleryImages({
	personaId,
	mediaIds
}: {
	personaId: number
	mediaIds: number[]
}) {
	await reorderMedia(db, { personaId }, mediaIds)
}
