/**
 * Media (28) — one module for every blob the instance stores.
 *
 * Replaces five hand-built upload paths, two near-identical gallery tables and
 * a serving route that parsed ownership out of a URL. See PLANS/28 for the
 * design; the rules worth knowing at a call site are:
 *
 *  - **Provenance, not role.** A row says what it belongs to. What it is *for*
 *    is a pointer from the owner (`characters.avatarMediaId`, …).
 *  - **No FKs, no cascade.** A stale id keeps an orphan groupable.
 *  - **`path` never leaves the server** except to an admin — see
 *    `toClientMedia`, which is the only thing that should ever build a payload.
 */
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { and, eq, isNull, asc, sql, type SQL } from "drizzle-orm"
import { db as defaultDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	MediaKind,
	MediaVariant,
	MediaVisibility,
	type MediaVisibilityType
} from "$lib/shared/constants/MediaVisibility"
import {
	mediaRelPath,
	derivativeRelPath,
	resolveMediaPath,
	type MediaProvenance
} from "./paths"
import { sniffMedia, MAX_MEDIA_UPLOAD_BYTES } from "./sniff"
import { makeThumbnail, readDimensions } from "./thumbnail"

export { mediaRelPath, derivativeRelPath, resolveMediaPath } from "./paths"
export { sniffMedia, MAX_MEDIA_UPLOAD_BYTES } from "./sniff"
export { canViewMedia } from "./access"
export { makeThumbnail, THUMB_MAX_EDGE } from "./thumbnail"

export type MediaRow = typeof schema.media.$inferSelect
type Db = typeof defaultDb

/** What a non-admin client is allowed to know about a blob. */
export interface ClientMedia {
	id: number
	/** The public address. Every URL below is built from this, never from
	 *  `id` — see the note on `media.uuid`. */
	uuid: string
	kind: string
	mime: string
	bytes: number
	width: number | null
	height: number | null
	filename: string | null
	visibility: string
	position: number
	/** Always `/media/{id}` — a proxy, never a location. */
	url: string
	/** The thumbnail's proxy URL, or the original's when there is none. */
	thumbUrl: string
	thumbMediaId: number | null
	characterId: number | null
	personaId: number | null
	sessionId: number | null
	messageId: number | null
}

/**
 * The ONLY way a media row becomes a client payload.
 *
 * `path` is not in `ClientMedia`, so a leak is a type error rather than a
 * review catch. This matters more than it looks: today `characters.avatar`
 * *is* the path, and it ships `/images/data/users/1/characters/5/avatar-ab12.png`
 * to every browser — disclosing the data-dir layout, the owner's user id and
 * the character id to anyone who can read a socket payload. Never spread a raw
 * row into a response.
 */
export function toClientMedia(
	row: MediaRow,
	opts?: { thumb?: MediaRow | null }
): ClientMedia {
	const thumb = opts?.thumb ?? null
	return {
		id: row.id,
		uuid: row.uuid,
		kind: row.kind,
		mime: row.mime,
		bytes: row.bytes,
		width: row.width,
		height: row.height,
		filename: row.filename,
		visibility: row.visibility,
		position: row.position,
		url: mediaUrl(row.uuid),
		// The thumbnail's OWN uuid when there is one, so the client never needs
		// the `?v=thumb` resolution and the response can be immutable. When
		// there is none, the original IS the thumbnail.
		thumbUrl: mediaUrl(thumb?.uuid ?? row.uuid),
		thumbMediaId: thumb?.id ?? null,
		characterId: row.characterId,
		personaId: row.personaId,
		sessionId: row.sessionId,
		messageId: row.messageId
	}
}

export function mediaUrl(uuid: string): string {
	return `/media/${uuid}`
}

/**
 * The by-id form, for the one caller that cannot have a uuid: a character or
 * persona row carries `avatarMediaId` and nothing else, and joining for a uuid
 * at all ~46 read sites would be a large blast radius.
 *
 * `/media/{id}` is a **redirect** to the row's uuid URL (see the route), so the
 * cached bytes still live at an immutable address; only the tiny, uncached
 * redirect is re-fetched. `?v=thumb` redirects to the thumbnail's uuid.
 */
export function mediaIdUrl(id: number, variant?: "thumb"): string {
	return `/media/${id}${variant ? `?v=${variant}` : ""}`
}

/** @deprecated use mediaIdUrl(id, "thumb"). */
export function mediaThumbUrl(id: number): string {
	return mediaIdUrl(id, "thumb")
}

export interface CreateMediaInput extends MediaProvenance {
	bytes: Buffer | Uint8Array
	/** Display metadata only — never resolved, never part of a path. */
	filename?: string | null
	visibility?: MediaVisibilityType
	position?: number
	/** Permit documents as well as images. Off by default so an avatar field
	 *  cannot be handed a PDF. */
	allowDocuments?: boolean
	/** User-level bucket when there is no entity parent (eg. "backgrounds"). */
	bucket?: string
	/** Generate a thumbnail inline. Off during migrations and bulk imports,
	 *  where the backfill pass handles it instead. */
	thumbnail?: boolean
}

/**
 * Write bytes and insert the row, deduping on (userId, hash, variant).
 *
 * Idempotent by construction: the filename is the hash, so a re-upload of
 * identical bytes rewrites the same file and returns the existing row.
 */
export async function createMedia(
	db: Db,
	input: CreateMediaInput
): Promise<MediaRow> {
	const buf = Buffer.isBuffer(input.bytes)
		? input.bytes
		: Buffer.from(input.bytes)
	const sniffed = await sniffMedia(buf, {
		filename: input.filename ?? undefined,
		allowDocuments: input.allowDocuments
	})
	const hash = crypto.createHash("sha256").update(buf).digest("hex")

	const existing = await db.query.media.findFirst({
		where: and(
			eq(schema.media.userId, input.userId),
			eq(schema.media.hash, hash),
			isNull(schema.media.variant)
		)
	})
	if (existing) return existing

	const relPath = mediaRelPath(input, hash, sniffed.ext, {
		bucket: input.bucket
	})
	const abs = resolveMediaPath(relPath)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, buf)

	const dims =
		sniffed.kind === MediaKind.IMAGE
			? await readDimensions(buf, sniffed.mime)
			: null

	const [row] = await db
		.insert(schema.media)
		.values({
			userId: input.userId,
			characterId: input.characterId ?? null,
			personaId: input.personaId ?? null,
			sessionId: input.sessionId ?? null,
			messageId: input.messageId ?? null,
			visibility: input.visibility ?? MediaVisibility.SCOPED,
			hash,
			mime: sniffed.mime,
			bytes: buf.byteLength,
			kind: sniffed.kind,
			path: relPath,
			filename: input.filename ?? null,
			width: dims?.width ?? null,
			height: dims?.height ?? null,
			position: input.position ?? 0
		})
		.returning()

	if (input.thumbnail !== false && sniffed.kind === MediaKind.IMAGE) {
		await ensureThumbnail(db, row, buf)
	}
	return row
}

/**
 * Generate and store the thumbnail for an original, if it does not have one.
 *
 * **Never throws.** A failed encode must not fail the upload — the original
 * still lands and serves, and the backfill pass retries. An image matters more
 * than its optimisation.
 */
/**
 * Note on uuids: this deliberately does NOT rotate the parent's address.
 *
 * On first generation there is nothing cached to invalidate, and rotating here
 * would hand `createMedia` back a row whose uuid was already stale — a dead URL
 * for its own caller. Rotation belongs to the callers that *replace* an
 * existing thumbnail (the regenerate handler and the backfill re-cut), because
 * only they know a browser may be holding the old one.
 */
export async function ensureThumbnail(
	db: Db,
	original: MediaRow,
	sourceBytes?: Buffer
): Promise<MediaRow | null> {
	if (original.variant) return null
	if (original.kind !== MediaKind.IMAGE) return null
	try {
		const existing = await db.query.media.findFirst({
			where: and(
				eq(schema.media.parentMediaId, original.id),
				eq(schema.media.variant, MediaVariant.THUMB)
			)
		})
		if (existing) return existing

		const buf =
			sourceBytes ?? (await fs.readFile(resolveMediaPath(original.path)))
		const thumb = await makeThumbnail(buf, original.mime)
		if (!thumb) return null

		const relPath = derivativeRelPath(
			original.path,
			MediaVariant.THUMB,
			thumb.ext
		)
		const abs = resolveMediaPath(relPath)
		await fs.mkdir(path.dirname(abs), { recursive: true })
		await fs.writeFile(abs, thumb.bytes)

		const hash = crypto
			.createHash("sha256")
			.update(thumb.bytes)
			.digest("hex")

		// A thumbnail carries NO entity provenance — its only parent is the
		// image it represents (28 §5). That is what keeps mediaFor() returning
		// originals only, with no `variant IS NULL` filter at any call site,
		// and what makes "never export a thumbnail" true with no code.
		const [row] = await db
			.insert(schema.media)
			.values({
				userId: original.userId,
				visibility: original.visibility,
				hash,
				mime: thumb.mime,
				bytes: thumb.bytes.byteLength,
				kind: MediaKind.IMAGE,
				path: relPath,
				width: thumb.width,
				height: thumb.height,
				parentMediaId: original.id,
				variant: MediaVariant.THUMB
			})
			.onConflictDoNothing()
			.returning()
		return row ?? null
	} catch (err) {
		console.warn(
			`[media] thumbnail generation failed for media ${original.id}:`,
			err instanceof Error ? err.message : err
		)
		return null
	}
}

export type MediaParent =
	| { characterId: number }
	| { personaId: number }
	| { sessionId: number }
	| { messageId: number }
	| { userId: number; bucket?: never }

function parentWhere(parent: MediaParent): SQL {
	if ("characterId" in parent)
		return eq(schema.media.characterId, parent.characterId)
	if ("personaId" in parent)
		return eq(schema.media.personaId, parent.personaId)
	if ("messageId" in parent)
		return eq(schema.media.messageId, parent.messageId)
	if ("sessionId" in parent)
		return eq(schema.media.sessionId, parent.sessionId)
	return and(
		eq(schema.media.userId, parent.userId),
		isNull(schema.media.characterId),
		isNull(schema.media.personaId),
		isNull(schema.media.sessionId)
	)!
}

/**
 * Every original grouped under a parent, in `position` order.
 *
 * Returns originals only — and not because of a filter here. A thumbnail
 * carries no entity provenance, so `characterId = X` simply never matches one.
 */
export async function mediaFor(
	db: Db,
	parent: MediaParent
): Promise<MediaRow[]> {
	return db
		.select()
		.from(schema.media)
		.where(and(parentWhere(parent), isNull(schema.media.variant)))
		.orderBy(asc(schema.media.position), asc(schema.media.id))
}

/** Originals for a parent, each paired with its thumbnail, ready for a payload. */
export async function clientMediaFor(
	db: Db,
	parent: MediaParent
): Promise<ClientMedia[]> {
	const rows = await mediaFor(db, parent)
	if (!rows.length) return []
	const thumbs = await thumbsByParent(
		db,
		rows.map((r) => r.id)
	)
	return rows.map((r) => toClientMedia(r, { thumb: thumbs.get(r.id) ?? null }))
}

/** Thumbnail rows keyed by the id of the original they represent. */
export async function thumbsByParent(
	db: Db,
	originalIds: number[]
): Promise<Map<number, MediaRow>> {
	const out = new Map<number, MediaRow>()
	if (!originalIds.length) return out
	const rows = await db
		.select()
		.from(schema.media)
		.where(
			and(
				eq(schema.media.variant, MediaVariant.THUMB),
				sql`${schema.media.parentMediaId} IN ${originalIds}`
			)
		)
	for (const r of rows) if (r.parentMediaId) out.set(r.parentMediaId, r)
	return out
}

/** Look a row up by its public address. */
export async function getMediaByUuid(
	db: Db,
	uuid: string
): Promise<MediaRow | null> {
	// Cheap shape guard so a junk path parameter never reaches the database as
	// a uuid comparison (which errors rather than returning empty).
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))
		return null
	const row = await db.query.media.findFirst({
		where: eq(schema.media.uuid, uuid)
	})
	return row ?? null
}

/**
 * Give a row a new public address.
 *
 * Called when what the row serves could differ from what a browser already
 * cached. Bytes at a given uuid never change, so this is the only thing that
 * has to happen for a cache to be correct — and it is why every media response
 * can be `immutable` rather than revalidating.
 */
export async function rotateMediaUuid(db: Db, id: number): Promise<void> {
	await db
		.update(schema.media)
		.set({ uuid: sql`gen_random_uuid()` })
		.where(eq(schema.media.id, id))
}

export async function getMedia(db: Db, id: number): Promise<MediaRow | null> {
	if (!Number.isInteger(id)) return null
	const row = await db.query.media.findFirst({
		where: eq(schema.media.id, id)
	})
	return row ?? null
}

/** Read a row's bytes off disk. Null when the row or the file is gone — a
 *  dangling reference is expected here (28 §2), not exceptional. */
export async function readMedia(
	db: Db,
	id: number
): Promise<{ row: MediaRow; bytes: Buffer } | null> {
	const row = await getMedia(db, id)
	if (!row) return null
	try {
		return { row, bytes: await fs.readFile(resolveMediaPath(row.path)) }
	} catch {
		return null
	}
}

/**
 * Delete a row, its file, and any derivative of it.
 *
 * Deliberately narrow: it clears nothing that *points* at the row. A dangling
 * `avatarMediaId` renders as a missing image and is collected by the cleanup
 * tool — that is the trade 28 §2 makes on purpose.
 */
export async function deleteMedia(db: Db, id: number): Promise<void> {
	const row = await getMedia(db, id)
	if (!row) return
	const derivatives = await db
		.select()
		.from(schema.media)
		.where(eq(schema.media.parentMediaId, id))
	for (const r of [...derivatives, row]) {
		try {
			await fs.unlink(resolveMediaPath(r.path))
		} catch {
			// Already gone, or never written. Removing the row is the point.
		}
		await db.delete(schema.media).where(eq(schema.media.id, r.id))
	}
}

/** Set `position` across a parent's originals, in the order given. */
export async function reorderMedia(
	db: Db,
	parent: MediaParent,
	orderedIds: number[]
): Promise<void> {
	const rows = await mediaFor(db, parent)
	const allowed = new Set(rows.map((r) => r.id))
	let position = 0
	for (const id of orderedIds) {
		if (!allowed.has(id)) continue
		await db
			.update(schema.media)
			.set({ position: position++ })
			.where(eq(schema.media.id, id))
	}
}
