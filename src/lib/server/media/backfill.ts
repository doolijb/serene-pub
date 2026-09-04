/**
 * The thumbnail regeneration sweep (28 §5, §10 — repurposed by 0182).
 *
 * This used to be a boot hook, and it had to be: an upload encoded its
 * thumbnail inline, so anything that failed inline needed retrying, and the
 * 0166 data upgrade deliberately encoded nothing. Lazy derivation removed both
 * reasons — a missing thumbnail is now made by the first request that wants
 * one, and a fresh upload having none is the healthy state.
 *
 * What is left is the case laziness cannot cover: a thumbnail that ALREADY
 * EXISTS and is now wrong, because `THUMB_MAX_EDGE` was raised in a release.
 * Nothing will ask for it again — the URL is cached and the row is present — so
 * something has to go and re-cut it. This is that something, and it is the one
 * place in the media module where a `rev` bump is expected: an existing
 * variant's bytes are being replaced.
 *
 * Invoked DELIBERATELY (an upgrade step, an admin action), never on boot.
 * Eager boot-time encoding is exactly what the lazy ruling forbids.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { MediaKind, MediaVariant } from "$lib/shared/constants/MediaVisibility"
import { bumpFileRev, ensureVariant, removeVariant } from "./variants"
import { THUMB_MAX_EDGE } from "./thumbnail"

/** Small enough that a big instance does not stall behind image encoding, and
 *  the next pass picks up where this one stopped. */
const BATCH = 50

let running = false

/**
 * Images with no thumbnail row at all.
 *
 * Kept even though laziness covers the common case, because a sweep that only
 * re-cut stale rows would leave a library imported by a bulk tool with nothing
 * warm — and `NOT EXISTS` against `variants` is a cheaper question than the
 * self-join through `parent_media_id` it replaces.
 */
async function pending(limit: number) {
	return db
		.select()
		.from(schema.files)
		.where(
			and(
				eq(schema.files.kind, MediaKind.IMAGE),
				sql`NOT EXISTS (
					SELECT 1 FROM ${schema.variants} AS t
					WHERE t.file_id = ${schema.files.id}
					  AND t.variant = ${MediaVariant.THUMB}
				)`
			)
		)
		.limit(limit)
}

/**
 * Thumbnails smaller than the current target whose source still has pixels to
 * give — i.e. generated under an older, smaller `THUMB_MAX_EDGE`.
 *
 * Without this, raising the target only affects images uploaded afterwards, and
 * every existing character keeps a soft card image forever. Rows with unknown
 * dimensions are skipped rather than guessed at: a NULL width means the decode
 * failed, and re-running it every sweep would be a pointless loop.
 *
 * The source's dimensions are on the FILE row since 0182, so the parent alias
 * this used to self-join through is gone.
 */
async function stale(limit: number) {
	return db
		.select({ thumb: schema.variants, file: schema.files })
		.from(schema.variants)
		.innerJoin(schema.files, eq(schema.variants.fileId, schema.files.id))
		.where(
			and(
				eq(schema.variants.variant, MediaVariant.THUMB),
				isNotNull(schema.variants.width),
				isNotNull(schema.variants.height),
				isNotNull(schema.files.width),
				isNotNull(schema.files.height),
				sql`GREATEST(${schema.variants.width}, ${schema.variants.height}) < ${THUMB_MAX_EDGE}`,
				// Only when the source is actually bigger than the thumb — a
				// small image is already at its own maximum.
				sql`GREATEST(${schema.files.width}, ${schema.files.height})
					> GREATEST(${schema.variants.width}, ${schema.variants.height})`
			)
		)
		.limit(limit)
}

/**
 * Generate up to `BATCH` thumbnails. Never throws: a bad row must not take the
 * pass down with it.
 */
export async function backfillThumbnails(
	limit = BATCH
): Promise<{ generated: number; attempted: number }> {
	if (running) return { generated: 0, attempted: 0 }
	running = true
	let generated = 0
	let attempted = 0
	try {
		const rows = await pending(limit)
		for (const file of rows) {
			attempted++
			const made = await ensureVariant(db, file, MediaVariant.THUMB)
			// A resolved variant that is NOT a thumb means the image was
			// already small enough to be its own — nothing was generated, and
			// nothing will be next time either.
			if (made?.variant === MediaVariant.THUMB) generated++
		}

		// Then re-cut any made under a smaller target. Deleting first is what
		// lets ensureVariant run at all — it no-ops when a row exists.
		if (rows.length < limit) {
			for (const { thumb, file } of await stale(limit - rows.length)) {
				attempted++
				await removeVariant(db, thumb)
				const made = await ensureVariant(db, file, MediaVariant.THUMB)
				if (made?.variant === MediaVariant.THUMB) generated++
				// An EXISTING variant's bytes just changed, so the URL a
				// browser may be holding has to change with it — media
				// responses are immutable for a year.
				await bumpFileRev(db, file.id)
			}
		}
	} catch (err) {
		console.warn(
			"[media] thumbnail sweep failed:",
			err instanceof Error ? err.message : err
		)
	} finally {
		running = false
	}
	return { generated, attempted }
}

/**
 * Drain the sweep in batches, stopping as soon as a batch produces nothing new
 * — otherwise an image that genuinely cannot be encoded would be retried
 * forever inside a single run.
 */
export async function sweepThumbnails(): Promise<void> {
	let total = 0
	for (;;) {
		const { generated, attempted } = await backfillThumbnails()
		total += generated
		if (attempted === 0 || generated === 0) break
	}
	if (total) console.log(`[media] re-cut ${total} thumbnail(s).`)
}
