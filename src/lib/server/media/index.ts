/**
 * Media (28, resplit by 0182) — one module for every blob the instance stores.
 *
 * Replaces five hand-built upload paths, two near-identical gallery tables and
 * a serving route that parsed ownership out of a URL. See PLANS/28 for the
 * design; the rules worth knowing at a call site are:
 *
 *  - **A payload is ONE row.** `files` carries the metadata, `variants` carries
 *    the bytes, and building a client payload reads the file row and nothing
 *    else — see `toClientMedia`. The URL says which representation is wanted
 *    and the HTTP handler resolves it, deriving on first request. Putting a
 *    variant lookup back on the render path is the one thing this split exists
 *    to prevent.
 *  - **Provenance, not role.** A file says what it belongs to. What it is *for*
 *    is a pointer from the owner (`characters.avatarMediaId`, …). A variant has
 *    no provenance at all, which is what makes it structurally unreachable by a
 *    provenance query — the replacement for the old trick of leaving a
 *    thumbnail's four columns NULL.
 *  - **No FKs, no cascade.** A stale id keeps an orphan groupable.
 *  - **`path` never leaves the server.** It only exists on a variant row, and
 *    no payload builder loads one, so that is structural rather than a rule
 *    somebody has to remember.
 */
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { and, eq, isNull, asc, type SQL } from "drizzle-orm"
import { db as defaultDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	MediaFidelity,
	MediaKind,
	MediaVariant,
	MediaVisibility,
	type MediaVariantName,
	type MediaVisibilityType
} from "$lib/shared/constants/MediaVisibility"
import { mediaRelPath, resolveMediaPath, type MediaProvenance } from "./paths"
import { sniffMedia, MAX_MEDIA_UPLOAD_BYTES } from "./sniff"
import { WEB_SAFE_IMAGE_MIMES } from "./thumbnail"
import { readDimensions, readMotion } from "./convert/codecs"
import {
	ensureVariant,
	getVariant,
	removeVariant,
	variantsFor,
	type ResolvedVariant
} from "./variants"

export { mediaRelPath, variantRelPath, resolveMediaPath } from "./paths"
export { sniffMedia, MAX_MEDIA_UPLOAD_BYTES } from "./sniff"
export { canViewMedia } from "./access"
export {
	makeThumbnail,
	THUMB_MAX_EDGE,
	WEB_SAFE_IMAGE_MIMES
} from "./thumbnail"
export { readMotion, type MotionInfo } from "./convert/codecs"
/**
 * The kind-for-kind conversion router — image → image, document → document, as
 * opposed to the cross-kind generation a pipeline does. `makeDisplayWebp` used
 * to stand here as a named operation of its own; it was one call into this
 * router with one target, and `deriveDisplay` now makes that call itself.
 */
export {
	convertMedia,
	convertMediaTo,
	convertMediaBatch,
	converterExists,
	reachableTargets,
	refusalToError,
	MediaDowngradeError,
	type ConvertInput,
	type ConvertedMedia,
	type ConversionRefused,
	type ConversionRefusalCode,
	type ConversionResult
} from "./convert"
export {
	bumpFileRev,
	displayDerivable,
	ensureVariant,
	getVariant,
	getVariantById,
	removeVariant,
	setDisplayPointer,
	variantsFor,
	listVariants,
	type ResolvedVariant
} from "./variants"
export {
	cullVariant,
	cullableDerived,
	cullableOriginals,
	storedBytesByFile,
	type CullOutcome,
	type DerivedCullable,
	type OriginalCullable
} from "./cull"

/** The logical file and its metadata. The only row a payload is built from. */
export type FileRow = typeof schema.files.$inferSelect
/** One stored representation. Carries the path; never leaves the server. */
export type VariantRow = typeof schema.variants.$inferSelect
/** @deprecated 0182 split `media` into `files` + `variants`. This is the FILE
 *  row — mime, bytes and path moved to a variant. */
export type MediaRow = FileRow

type Db = typeof defaultDb

/** What a non-admin client is allowed to know about a file. */
export interface ClientMedia {
	id: number
	/** The public address. Every URL below is built from this, never from
	 *  `id` — see the note on `files.uuid`. */
	uuid: string
	/** Cache token, carried by every URL below. It changes when the bytes
	 *  behind that URL do, which is what lets the response be immutable. */
	rev: number
	kind: string
	/** The DISPLAY variant's mime, denormalised onto the file row so this
	 *  payload is one query. */
	mime: string
	/** The DISPLAY variant's byte length — what showing this file costs, not
	 *  what storing it costs. */
	bytes: number
	width: number | null
	height: number | null
	durationMs: number | null
	filename: string | null
	visibility: string
	position: number
	/** `/media/{uuid}?r={rev}` — the display form. ALREADY HAS A QUERY STRING:
	 *  anything appending to it must use `&`. */
	url: string
	/** `/media/{uuid}?v=thumb&r={rev}`. Derived on first request. */
	thumbUrl: string
	/** `/media/{uuid}?v=original&r={rev}`. The bytes as uploaded — for a
	 *  download or a card export, never for routine rendering. */
	originalUrl: string
	characterId: number | null
	personaId: number | null
	sessionId: number | null
	messageId: number | null
}

/**
 * The ONLY way a file row becomes a client payload, and it issues NO QUERY.
 *
 * `path` is not in `ClientMedia` and is not on the row this takes, so a leak is
 * two type errors deep rather than a review catch. This matters more than it
 * looks: before 28 `characters.avatar` *was* the path, and it shipped
 * `/images/data/users/1/characters/5/avatar-ab12.png` to every browser —
 * disclosing the data-dir layout, the owner's user id and the character id to
 * anyone who could read a socket payload.
 *
 * It used to take an optional thumbnail row so it could build `thumbUrl` from
 * the thumbnail's own uuid, which cost every list a second query. One uuid per
 * file plus `?v=` retired that: the thumbnail's address is derivable from the
 * row in hand, whether or not the thumbnail exists yet.
 */
export function toClientMedia(row: FileRow): ClientMedia {
	return {
		id: row.id,
		uuid: row.uuid,
		rev: row.rev,
		kind: row.kind,
		// Null only for a file whose display form has not been derived yet —
		// a format needing conversion, which `sniff.ts` cannot currently even
		// accept. The payload will not promise a type it has not produced.
		mime: row.displayMime ?? "application/octet-stream",
		bytes: row.displayBytes ?? 0,
		width: row.width,
		height: row.height,
		durationMs: row.durationMs,
		filename: row.filename,
		visibility: row.visibility,
		position: row.position,
		url: mediaUrl(row.uuid, row.rev),
		thumbUrl: mediaUrl(row.uuid, row.rev, MediaVariant.THUMB),
		originalUrl: mediaUrl(row.uuid, row.rev, MediaVariant.ORIGINAL),
		characterId: row.characterId,
		personaId: row.personaId,
		sessionId: row.sessionId,
		messageId: row.messageId
	}
}

/**
 * The uuid form — the real address.
 *
 * `r` is a cache-buster, not a token: the handler reads it and ignores its
 * value. Its only job is to make the URL *string* change when the bytes behind
 * it do, so an immutable cached entry is not consulted. Validating it would
 * turn a client holding a stale URL into a broken image instead of a stale one,
 * which is strictly worse.
 */
export function mediaUrl(
	uuid: string,
	rev: number,
	variant?: MediaVariantName
): string {
	const query = variant ? `v=${variant}&r=${rev}` : `r=${rev}`
	return `/media/${uuid}?${query}`
}

/**
 * The by-id form, for the one caller that cannot have a uuid: a character or
 * persona row carries `avatarMediaId` and nothing else, and joining for a uuid
 * at all ~46 read sites would be a large blast radius.
 *
 * `/media/{id}` is a **redirect** to the uuid form (see the route), which is
 * also where `rev` is injected — that is what lets the client-side builders in
 * `$lib/client/utils/media.ts` stay rev-unaware.
 */
export function mediaIdUrl(id: number, variant?: MediaVariantName): string {
	return `/media/${id}${variant ? `?v=${variant}` : ""}`
}

/** @deprecated use mediaIdUrl(id, MediaVariant.THUMB). */
export function mediaThumbUrl(id: number): string {
	return mediaIdUrl(id, MediaVariant.THUMB)
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
	/**
	 * How this was made — prompt, seed, model, backend (0173). Stored verbatim,
	 * never interpreted, and never consulted for access.
	 *
	 * Note the dedupe below: identical bytes return the EXISTING row, meta and
	 * all. That is right — identical bytes are the same image, and the first
	 * generation's provenance is the one that produced it.
	 */
	meta?: Record<string, unknown> | null
}

export interface CreatedMedia {
	file: FileRow
	/** The variant holding the bytes just handed in. Also the display form when
	 *  the upload was already web-safe, which is every format the instance can
	 *  currently accept. */
	original: VariantRow
}

function sha256(bytes: Buffer): string {
	return crypto.createHash("sha256").update(bytes).digest("hex")
}

/**
 * Whether the bytes as given can be served to a browser unchanged, so the
 * original IS the display form and no second copy is written.
 *
 * True for a web-safe image, and true for every non-image kind — a PDF or a
 * video has no derivation available in this codec stack, so the bytes as given
 * are the only representation there will ever be, and leaving the pointer null
 * would only mean a payload that cannot say what its own mime is.
 */
function isServableAsGiven(kind: string, mime: string): boolean {
	if (kind !== MediaKind.IMAGE) return true
	return WEB_SAFE_IMAGE_MIMES.has(mime)
}

/**
 * Write bytes and insert the rows, deduping on (userId, hash).
 *
 * Idempotent by construction: the filename is the hash, so a re-upload of
 * identical bytes rewrites the same file and returns the existing rows.
 *
 * **No derivation happens here.** Before 0182 this encoded a thumbnail inline,
 * which meant a codec problem could fail or stall an upload; the first request
 * pays for it now, where the cost can fall back to the display form.
 */
export async function createMedia(
	db: Db,
	input: CreateMediaInput
): Promise<CreatedMedia> {
	const buf = Buffer.isBuffer(input.bytes)
		? input.bytes
		: Buffer.from(input.bytes)
	const sniffed = await sniffMedia(buf, {
		filename: input.filename ?? undefined,
		allowDocuments: input.allowDocuments
	})
	const hash = sha256(buf)

	const existing = await db.query.files.findFirst({
		where: and(
			eq(schema.files.userId, input.userId),
			eq(schema.files.hash, hash)
		)
	})
	if (existing) {
		return {
			file: existing,
			original: await restoreOriginal(db, existing, buf, sniffed.mime)
		}
	}

	const relPath = mediaRelPath(input, hash, sniffed.ext, {
		bucket: input.bucket
	})
	const abs = resolveMediaPath(relPath)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, buf)

	const isImage = sniffed.kind === MediaKind.IMAGE
	const dims = isImage ? await readDimensions(buf, sniffed.mime) : null
	// `motion.animated` is the signal a time dimension exists — not the
	// duration, which a WebP container can leave unstated while still being an
	// animation. See readMotion; both animating formats are probed.
	const motion = isImage ? await readMotion(buf, sniffed.mime) : null

	const [file] = await db
		.insert(schema.files)
		.values({
			userId: input.userId,
			characterId: input.characterId ?? null,
			personaId: input.personaId ?? null,
			sessionId: input.sessionId ?? null,
			messageId: input.messageId ?? null,
			visibility: input.visibility ?? MediaVisibility.SCOPED,
			kind: sniffed.kind,
			hash,
			filename: input.filename ?? null,
			width: dims?.width ?? null,
			height: dims?.height ?? null,
			// Null for a still, and null for an animation whose container
			// states no delays — `duration_ms` has never promised to be the
			// animated/still flag, and `displayDerivable` says why it cannot be
			// read as one.
			durationMs: motion?.animated ? motion.durationMs : null,
			position: input.position ?? 0,
			meta: input.meta ?? null
		})
		.returning()

	const [original] = await db
		.insert(schema.variants)
		.values({
			fileId: file.id,
			variant: MediaVariant.ORIGINAL,
			mime: sniffed.mime,
			bytes: buf.byteLength,
			path: relPath,
			hash,
			width: dims?.width ?? null,
			height: dims?.height ?? null,
			isOriginal: true,
			// NOT a cache entry: irreplaceable, and only the explicit
			// destructive admin action may ever remove it.
			cache: false,
			fidelity: MediaFidelity.FULL
		})
		.returning()

	if (!isServableAsGiven(sniffed.kind, sniffed.mime))
		return { file, original }

	// The original IS the display form. One statement, so the pointer and the
	// mime/bytes denormalised from it can never disagree; no `rev` bump,
	// because nothing has been served from this brand-new row yet.
	const [pointed] = await db
		.update(schema.files)
		.set({
			displayVariantId: original.id,
			displayMime: original.mime,
			displayBytes: original.bytes
		})
		.where(eq(schema.files.id, file.id))
		.returning()
	return { file: pointed ?? file, original }
}

/**
 * Re-write an original that a dedupe hit found missing.
 *
 * `files_user_hash_unique` is on the ORIGINAL's sha256 and `files.hash`
 * survives culling, so this sequence is reachable: upload photo.jpg, admin
 * culls originals, user re-uploads photo.jpg. The file row matches, and there
 * is no honest original to return with it.
 *
 * The hash matched, so these bytes are provably the same file — writing them
 * back costs nothing we are not already holding, and it is the conservative
 * answer: the alternative is a return type that lies or a caller that has to
 * handle a case it cannot fix. The display pointer is deliberately left where
 * it is: it already names a live full-fidelity row (`cullVariant` guarantees
 * that), and moving it would bump `rev` for no change in what the file is.
 */
async function restoreOriginal(
	db: Db,
	file: FileRow,
	buf: Buffer,
	mime: string
): Promise<VariantRow> {
	const present = await getVariant(db, file.id, MediaVariant.ORIGINAL)
	if (present) return present

	const dims =
		file.kind === MediaKind.IMAGE ? await readDimensions(buf, mime) : null
	const ext = mime.split("/")[1] ?? "bin"
	const relPath = mediaRelPath(file, file.hash, ext)
	const abs = resolveMediaPath(relPath)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, buf)

	const [row] = await db
		.insert(schema.variants)
		.values({
			fileId: file.id,
			variant: MediaVariant.ORIGINAL,
			mime,
			bytes: buf.byteLength,
			path: relPath,
			hash: file.hash,
			width: dims?.width ?? null,
			height: dims?.height ?? null,
			isOriginal: true,
			cache: false,
			fidelity: MediaFidelity.FULL
		})
		.onConflictDoNothing()
		.returning()
	return row ?? (await getVariant(db, file.id, MediaVariant.ORIGINAL))!
}

export type MediaParent =
	| { characterId: number }
	| { personaId: number }
	| { sessionId: number }
	| { messageId: number }
	| { userId: number; bucket?: never }

function parentWhere(parent: MediaParent): SQL {
	if ("characterId" in parent)
		return eq(schema.files.characterId, parent.characterId)
	if ("personaId" in parent)
		return eq(schema.files.personaId, parent.personaId)
	if ("messageId" in parent)
		return eq(schema.files.messageId, parent.messageId)
	if ("sessionId" in parent)
		return eq(schema.files.sessionId, parent.sessionId)
	return and(
		eq(schema.files.userId, parent.userId),
		isNull(schema.files.characterId),
		isNull(schema.files.personaId),
		isNull(schema.files.sessionId)
	)!
}

/**
 * Every file grouped under a parent, in `position` order.
 *
 * There is no derivative filter here and there is nothing to filter: a variant
 * has no provenance columns at all, so `characterId = X` cannot match one. That
 * claim was made before 0182 too, but it was false — `mediaFor` carried an
 * `isNull(variant)` filter because a thumbnail lived in the same table. Now it
 * is true structurally.
 */
export async function mediaFor(
	db: Db,
	parent: MediaParent
): Promise<FileRow[]> {
	return db
		.select()
		.from(schema.files)
		.where(parentWhere(parent))
		.orderBy(asc(schema.files.position), asc(schema.files.id))
}

/** A parent's files, ready for a payload — ONE query, no variant lookup. */
export async function clientMediaFor(
	db: Db,
	parent: MediaParent
): Promise<ClientMedia[]> {
	return (await mediaFor(db, parent)).map(toClientMedia)
}

/** Look a file up by its public address. */
export async function getMediaByUuid(
	db: Db,
	uuid: string
): Promise<FileRow | null> {
	// Cheap shape guard so a junk path parameter never reaches the database as
	// a uuid comparison (which errors rather than returning empty).
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			uuid
		)
	)
		return null
	const row = await db.query.files.findFirst({
		where: eq(schema.files.uuid, uuid)
	})
	return row ?? null
}

export async function getMedia(db: Db, id: number): Promise<FileRow | null> {
	if (!Number.isInteger(id)) return null
	const row = await db.query.files.findFirst({
		where: eq(schema.files.id, id)
	})
	return row ?? null
}

export type ReadMediaResult = ResolvedVariant & {
	file: FileRow
	/** Non-null here: `readMedia` only ever resolves `original` or `display`,
	 *  and neither is a cache row, so both are always persisted. */
	row: VariantRow
}

/**
 * Read a file's bytes off disk. Null when the row or the file is gone — a
 * dangling reference is expected here (28 §2), not exceptional.
 *
 * Defaults to the ORIGINAL, because the callers are exports: a character card
 * embeds its avatar's actual PNG, and a session asset is handed on as it
 * arrived. When the original has been culled this falls back to the display
 * form rather than returning nothing, which is the same rule the serving route
 * follows for `?v=original`.
 */
export async function readMedia(
	db: Db,
	id: number,
	variant: MediaVariantName = MediaVariant.ORIGINAL
): Promise<ReadMediaResult | null> {
	const file = await getMedia(db, id)
	if (!file) return null
	const resolved =
		(await ensureVariant(db, file, variant)) ??
		(variant === MediaVariant.ORIGINAL
			? await ensureVariant(db, file, MediaVariant.DISPLAY)
			: null)
	if (!resolved?.row) return null
	return { ...resolved, row: resolved.row, file }
}

/**
 * Delete a file, every representation of it, and its bytes.
 *
 * The one operation allowed to leave nothing behind — because the file itself
 * is going away, so there is nothing left to orphan. Reclaiming space WITHOUT
 * deleting the file is `cullVariant`, which refuses to take the last copy.
 *
 * Deliberately narrow in the other direction: it clears nothing that *points*
 * at the file. A dangling `avatarMediaId` renders as a missing image and is
 * collected by the cleanup tool — the trade 28 §2 makes on purpose.
 */
export async function deleteFile(db: Db, fileId: number): Promise<void> {
	const file = await getMedia(db, fileId)
	if (!file) return
	for (const variant of await variantsFor(db, fileId)) {
		await removeVariant(db, variant)
	}
	await db.delete(schema.files).where(eq(schema.files.id, fileId))
}

/** @deprecated 0182 renamed this to `deleteFile`, which is what it always
 *  did — the id is a file id, and every variant goes with it. */
export async function deleteMedia(db: Db, id: number): Promise<void> {
	return deleteFile(db, id)
}

/** Set `position` across a parent's files, in the order given. */
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
			.update(schema.files)
			.set({ position: position++ })
			.where(eq(schema.files.id, id))
	}
}
