/**
 * Stored representations, and how a missing one comes to exist (0182).
 *
 * **Nothing here is on the render path.** Building a payload reads the `files`
 * row and stops; a URL says which representation is wanted and this module is
 * what the HTTP handler calls to resolve it. That separation is the whole point
 * of the split, so resist the temptation to "helpfully" call `ensureVariant`
 * from a payload builder — it would put an encode behind a list query.
 *
 * **Derivation is lazy.** Before 0182 an upload encoded a thumbnail inline, so
 * a codec problem could stall or fail an upload, and a boot-time backfill had
 * to exist to catch the ones that failed. Now the first request pays, where the
 * cost can fall back to the display form if it goes wrong. A fresh upload with
 * exactly one variant row is the healthy state, not a missing derivative.
 *
 * **`rev` lives here** even though the column is on `files`, because every
 * legitimate bump is caused by something in this file: an existing variant's
 * bytes being replaced, or the display pointer moving. Keeping the two
 * together is what stops a caller inventing a third reason.
 */
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db as defaultDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	MediaFidelity,
	MediaKind,
	MediaVariant,
	type MediaVariantName
} from "$lib/shared/constants/MediaVisibility"
import { resolveMediaPath, variantRelPath } from "./paths"
import type { FileRow, VariantRow } from "./index"
import { makeThumbnail, WEB_SAFE_IMAGE_MIMES } from "./thumbnail"
import { convertMedia, MediaDowngradeError, refusalToError } from "./convert"

type Db = typeof defaultDb

/**
 * Where a derivation reads from, in order, and it is a named constant rather
 * than an incidental `??` chain because a later reader cannot otherwise tell
 * which was intended.
 *
 * The ORIGINAL first: it is the truest source, the bytes the user actually
 * gave us. The DISPLAY form second, for when the original has been culled —
 * both are lossless, so nothing degrades by falling through, but the priority
 * has to be explicit or someone will "simplify" it into whichever row the
 * pointer happens to name.
 */
const SOURCE_PRIORITY: readonly MediaVariantName[] = [
	MediaVariant.ORIGINAL,
	MediaVariant.DISPLAY
]

/**
 * One resolved representation: the row when it is stored, and the bytes either
 * way.
 *
 * `row` is null when the derived-form cache is switched off — the bytes were
 * made for this one request and nothing was written. The handler does not care
 * which it got, which is the point.
 */
export interface ResolvedVariant {
	row: VariantRow | null
	/** Which representation this actually IS. Not always what was asked for: a
	 *  thumbnail request for an image too small to shrink resolves to the
	 *  source, and a failed derivation falls back. */
	variant: MediaVariantName
	mime: string
	/** ⚠ The BYTES THEMSELVES, not a count — `variants.bytes` is the count, and
	 *  so is every other `bytes` in this module's payloads. Named for the
	 *  `CreateMediaInput.bytes` precedent; `row.bytes` or `data.byteLength` is
	 *  the number. */
	bytes: Buffer
	/** sha256 of the bytes — the ETag the route serves. */
	hash: string
	width: number | null
	height: number | null
}

/**
 * Bump the file's cache token.
 *
 * Call this ONLY when an existing variant's bytes changed, or when
 * `display_variant_id` moved. Deriving a variant that did not exist does not
 * bump (nothing already served changed), and culling one does not bump (the
 * other representations' bytes are untouched).
 */
export async function bumpFileRev(db: Db, fileId: number): Promise<void> {
	await db
		.update(schema.files)
		.set({ rev: sql`${schema.files.rev} + 1` })
		.where(eq(schema.files.id, fileId))
}

export async function variantsFor(
	db: Db,
	fileId: number
): Promise<VariantRow[]> {
	return db
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.fileId, fileId))
		.orderBy(asc(schema.variants.id))
}

/** Every variant of several files, keyed by file id — for the management
 *  panel, which is the only thing that wants them in bulk. */
export async function listVariants(
	db: Db,
	fileIds: number[]
): Promise<Map<number, VariantRow[]>> {
	const out = new Map<number, VariantRow[]>()
	if (!fileIds.length) return out
	const rows = await db
		.select()
		.from(schema.variants)
		.where(inArray(schema.variants.fileId, fileIds))
		.orderBy(asc(schema.variants.id))
	for (const row of rows) {
		const list = out.get(row.fileId)
		if (list) list.push(row)
		else out.set(row.fileId, [row])
	}
	return out
}

export async function getVariant(
	db: Db,
	fileId: number,
	variant: MediaVariantName
): Promise<VariantRow | null> {
	const [row] = await db
		.select()
		.from(schema.variants)
		.where(
			and(
				eq(schema.variants.fileId, fileId),
				eq(schema.variants.variant, variant)
			)
		)
		.limit(1)
	return row ?? null
}

export async function getVariantById(
	db: Db,
	id: number
): Promise<VariantRow | null> {
	if (!Number.isInteger(id)) return null
	const [row] = await db
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.id, id))
		.limit(1)
	return row ?? null
}

/**
 * Unlink the bytes and drop the row, with NO invariant checking.
 *
 * Deliberately blunt, and deliberately not exported to anything that talks to a
 * user: the two callers that may leave a file with fewer representations are
 * `deleteFile` (the whole file is going away, so nothing can be orphaned) and
 * `cullVariant` (which checks the invariants first). Anything else wanting to
 * remove a variant wants `cullVariant`.
 */
export async function removeVariant(db: Db, row: VariantRow): Promise<void> {
	try {
		await fs.unlink(resolveMediaPath(row.path))
	} catch {
		// Already gone, or never written. Removing the row is the point.
	}
	await db.delete(schema.variants).where(eq(schema.variants.id, row.id))
}

/**
 * Point a bare `/media/{uuid}` at a different variant.
 *
 * `display_mime` and `display_bytes` are written in the SAME statement, never
 * apart — they exist only so a payload is one row, and a pointer that
 * disagrees with them is a payload that lies about what it is serving.
 *
 * Bumps `rev` when the pointer actually moves. That is the one deliberate
 * exception to "deriving does not bump", and it is consistent with the rule
 * rather than a hole in it: the bump rule is about whether the bytes behind an
 * existing URL changed, and here they did.
 */
export async function setDisplayPointer(
	db: Db,
	file: FileRow,
	target: VariantRow
): Promise<void> {
	if (file.displayVariantId === target.id) return
	await db
		.update(schema.files)
		.set({
			displayVariantId: target.id,
			displayMime: target.mime,
			displayBytes: target.bytes
		})
		.where(eq(schema.files.id, file.id))
	await bumpFileRev(db, file.id)
}

/** Read a stored variant's bytes. Null when the file is gone from disk — a
 *  dangling reference is expected (28 §2), not exceptional. */
async function readVariant(row: VariantRow): Promise<ResolvedVariant | null> {
	try {
		const bytes = await fs.readFile(resolveMediaPath(row.path))
		return {
			row,
			variant: row.variant as MediaVariantName,
			mime: row.mime,
			bytes,
			hash: row.hash,
			width: row.width,
			height: row.height
		}
	} catch {
		return null
	}
}

async function loadSource(
	db: Db,
	file: FileRow
): Promise<ResolvedVariant | null> {
	for (const name of SOURCE_PRIORITY) {
		const row = await getVariant(db, file.id, name)
		if (!row) continue
		const resolved = await readVariant(row)
		if (resolved) return resolved
	}
	return null
}

/** Whether the derived-form cache may write to disk for this file's owner.
 *  Missing settings row = on, which is what a fresh install has. */
async function cacheEnabled(db: Db, file: FileRow): Promise<boolean> {
	const [row] = await db
		.select({ enabled: schema.userSettings.derivedMediaCacheEnabled })
		.from(schema.userSettings)
		.where(eq(schema.userSettings.userId, file.userId))
		.limit(1)
	return row?.enabled ?? true
}

async function writeVariantFile(
	file: FileRow,
	variant: MediaVariantName,
	ext: string,
	bytes: Buffer
): Promise<string> {
	const relPath = variantRelPath(file, variant, ext)
	const abs = resolveMediaPath(relPath)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, bytes)
	return relPath
}

function sha256(bytes: Buffer): string {
	return crypto.createHash("sha256").update(bytes).digest("hex")
}

/**
 * Cheap answer to "could a display form be derived for this file at all",
 * without touching the bytes.
 *
 * Exists for the cull-originals preview, which has to explain per file why it
 * is skipping one. `ensureVariant` returns null for every kind of failure
 * because a serving route has nothing useful to do with a reason; an admin
 * screen does.
 *
 * ⚠ **A null `duration_ms` is not proof of a still image**, and this function
 * is the only place that reads the column. It is as good as the probe that
 * wrote it: an animated WebP whose container states no per-frame delays stores
 * null, and so does any row written before that format was probed at all. So
 * `{ ok: true }` means "nothing on the row forbids it", never "these bytes are
 * still" — `deriveDisplay` asks the router, which reads the BYTES, and that is
 * the check that may not be skipped. The whole visible cost of the gap is a
 * cull-originals preview calling such a file "no display form yet" instead of
 * "animated"; the original itself is never taken, because the sweep has no
 * display form to fall back to either.
 */
export function displayDerivable(
	file: FileRow
): { ok: true } | { ok: false; reason: string } {
	if (file.kind !== MediaKind.IMAGE) {
		return { ok: false, reason: "not an image — no codec to convert it" }
	}
	if (file.durationMs !== null) {
		return {
			ok: false,
			reason: "animated — converting it would keep one frame"
		}
	}
	return { ok: true }
}

/**
 * The one format a display variant is ever encoded to.
 *
 * Lossless WebP, which is the only lossless target this build can write. Named
 * here rather than inline because it is the pair the router is asked for, and
 * "which format is the display form" should be answerable without reading an
 * argument list.
 */
const DISPLAY_TARGET_MIME = "image/webp"

/**
 * The DISPLAY form: full size, lossless WebP.
 *
 * Two things make this smaller than it looks. Every format the instance can
 * currently accept (`sniff.ts` takes png/jpg/webp/gif and nothing else) is
 * already web-safe, so `createMedia` points `display_variant_id` at the
 * original and this is never reached by an upload — only by an explicit
 * `?v=display` and by the cull-originals path, which needs a display form to
 * exist before it may take the original away.
 *
 * And it may decline to keep what it just encoded. A lossless WebP of a
 * photograph is routinely LARGER than the JPEG it came from; writing it anyway
 * would grow the library and make "cull originals to reclaim space" free the
 * small file and keep the big one. So when the current display target is
 * already web-safe and the encode came out no smaller, the encode is thrown
 * away and the existing target stands. The bytes are never written to disk in
 * that case — the comparison happens in memory, before the write.
 *
 * **The encode goes through the CONVERSION ROUTER**, because deriving a display
 * form IS a kind-for-kind conversion: image in, image out, at the one lossless
 * target this build can write. Nothing here knows which codec that takes, and
 * a format the router cannot reach comes back as a refusal naming the pair
 * rather than as bytes in some other format.
 */
async function deriveDisplay(
	db: Db,
	file: FileRow,
	source: ResolvedVariant
): Promise<ResolvedVariant | null> {
	// Checked before the decode so the common "this is animated" case costs
	// nothing; the router checks the BYTES as well, for a row that is silent
	// about motion.
	const derivable = displayDerivable(file)
	if (!derivable.ok) {
		throw new MediaDowngradeError(
			derivable.reason,
			`No display form for file ${file.id}: ${derivable.reason}.`
		)
	}

	// `lossless` (and, inside the encoder, `exact`) because this is the
	// representation user-facing rendering uses and the original may be culled
	// afterwards — it has to be a faithful stand-in, not a good-looking one.
	//
	// The router REFUSES an animated source: every encoder in this build writes
	// a single frame, so flattening is the only thing it could do, and a still
	// image of an animation is a downgrade. `displayDerivable` above checked
	// `files.duration_ms` so the common case costs no decode; this is the
	// second check, for a row that is silent about motion — one written before
	// the column existed, or an animated WebP whose container states no
	// delays — where the bytes in hand are the reliable witness and the row is
	// not.
	const encoded = await convertMedia(
		{ bytes: source.bytes, mime: source.mime },
		DISPLAY_TARGET_MIME,
		{ lossless: true }
	)
	// A refusal is a value; `ensureVariant` logs a decision differently from a
	// fault, so `refusalToError` is what keeps that distinction on the way up.
	if (!encoded.ok) throw refusalToError(encoded)

	const current = file.displayVariantId
		? await getVariantById(db, file.displayVariantId)
		: null
	if (
		current &&
		WEB_SAFE_IMAGE_MIMES.has(current.mime) &&
		encoded.bytes.byteLength >= current.bytes
	) {
		return readVariant(current)
	}

	const relPath = await writeVariantFile(
		file,
		MediaVariant.DISPLAY,
		encoded.ext,
		encoded.bytes
	)
	const [row] = await db
		.insert(schema.variants)
		.values({
			fileId: file.id,
			variant: MediaVariant.DISPLAY,
			mime: encoded.mime,
			bytes: encoded.bytes.byteLength,
			path: relPath,
			hash: sha256(encoded.bytes),
			width: encoded.width,
			height: encoded.height,
			isOriginal: false,
			// NOT a cache entry. The display form is the default client-side
			// representation of the file, and the derived-form sweep must never
			// touch it — see the cull invariants in cull.ts.
			cache: false,
			fidelity: MediaFidelity.FULL
		})
		.onConflictDoNothing()
		.returning()

	// Lost the race to another process. Its row is as good as ours would have
	// been (same bytes, same hash, same path), so take it.
	const stored = row ?? (await getVariant(db, file.id, MediaVariant.DISPLAY))
	if (!stored) return null

	// Smallest-wins, as a STORED decision. Comparing at request time would let
	// a newly derived variant change what an already-cached immutable URL
	// serves without changing the URL.
	if (!current || stored.bytes < current.bytes) {
		await setDisplayPointer(db, file, stored)
	}
	return readVariant(stored)
}

/**
 * The THUMB form: long edge capped, reduced fidelity.
 *
 * `fidelity: 'reduced'` keeps it out of the display-pointer comparison
 * structurally — it is smaller than every full representation and would
 * otherwise win "serve the smallest" every time.
 *
 * A thumbnail MAY flatten an animation, and that is the deliberate opposite of
 * the display rule: a still preview of an animated image is the understood
 * contract for a list cell, and it is declared reduced. Do not read this as
 * permission to flatten anywhere else.
 */
async function deriveThumb(
	db: Db,
	file: FileRow,
	source: ResolvedVariant
): Promise<ResolvedVariant | null> {
	const thumb = await makeThumbnail(source.bytes, source.mime)
	// Already small enough to be its own thumbnail. Serving the source is the
	// long-standing behaviour and the reason `thumbUrl` can be unconditional.
	if (!thumb) return source

	if (!(await cacheEnabled(db, file))) {
		// The admin turned the derived-form cache off: encode per request and
		// keep nothing. The display form is untouched by this setting — it is
		// not a cache entry.
		return {
			row: null,
			variant: MediaVariant.THUMB,
			mime: thumb.mime,
			bytes: thumb.bytes,
			hash: sha256(thumb.bytes),
			width: thumb.width,
			height: thumb.height
		}
	}

	const relPath = await writeVariantFile(
		file,
		MediaVariant.THUMB,
		thumb.ext,
		thumb.bytes
	)
	const [row] = await db
		.insert(schema.variants)
		.values({
			fileId: file.id,
			variant: MediaVariant.THUMB,
			mime: thumb.mime,
			bytes: thumb.bytes.byteLength,
			path: relPath,
			hash: sha256(thumb.bytes),
			width: thumb.width,
			height: thumb.height,
			isOriginal: false,
			cache: true,
			fidelity: MediaFidelity.REDUCED
		})
		.onConflictDoNothing()
		.returning()
	const stored = row ?? (await getVariant(db, file.id, MediaVariant.THUMB))
	return stored ? readVariant(stored) : null
}

/**
 * In-flight derivations, keyed `${fileId}:${variant}`.
 *
 * `variants_file_variant_unique` plus `onConflictDoNothing` is the CROSS-
 * PROCESS backstop, and it is not a substitute for this: the index only
 * dedupes the ROW, after both requests have already paid for the encode. Two
 * page loads hitting the same missing thumbnail is the ordinary case, not a
 * rare race — that is exactly what a fresh gallery does — so the expensive
 * half has to be shared, not just the cheap half.
 */
const inFlight = new Map<string, Promise<ResolvedVariant | null>>()

/**
 * Resolve one representation of a file, deriving it if it does not exist yet.
 *
 * **Never throws.** Every failure — a codec that cannot read the source, a
 * refused downgrade, a file missing from disk — comes back as null so the
 * caller can fall back to the display form. An image matters more than its
 * optimisation, and a 500 on a thumbnail would take a whole gallery down.
 */
export async function ensureVariant(
	db: Db,
	file: FileRow,
	variant: MediaVariantName
): Promise<ResolvedVariant | null> {
	const key = `${file.id}:${variant}`
	const running = inFlight.get(key)
	if (running) return running

	const work = (async (): Promise<ResolvedVariant | null> => {
		try {
			const existing = await getVariant(db, file.id, variant)
			if (existing) return await readVariant(existing)

			// An original is the bytes somebody gave us. There is nothing to
			// derive it FROM, which is what makes culling one irreversible.
			if (variant === MediaVariant.ORIGINAL) return null

			const source = await loadSource(db, file)
			if (!source) return null

			return variant === MediaVariant.DISPLAY
				? await deriveDisplay(db, file, source)
				: await deriveThumb(db, file, source)
		} catch (err) {
			// A refused downgrade is a decision, not a fault: log it at the
			// same level but say which it was, so "why is my GIF not a WebP"
			// has an answer in the log.
			const why = err instanceof Error ? err.message : String(err)
			console.warn(
				err instanceof MediaDowngradeError
					? `[media] declined to derive ${variant} for file ${file.id}: ${why}`
					: `[media] deriving ${variant} for file ${file.id} failed: ${why}`
			)
			return null
		} finally {
			inFlight.delete(key)
		}
	})()

	inFlight.set(key, work)
	return work
}
