/**
 * Thumbnail backfill (28 §5, §10).
 *
 * Two callers need this and neither can do the work inline:
 *
 *  - The 0166 data upgrade, which must not encode thousands of images inside a
 *    migration transaction — that is how an upgrade appears to hang.
 *  - Any upload whose inline encode failed. `ensureThumbnail` swallows those on
 *    purpose so a codec problem never fails an upload; this is what retries.
 *
 * Originals serve until a thumbnail exists, so running late is a cost in bytes
 * over the wire, never a broken image.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { MediaKind, MediaVariant } from "$lib/shared/constants/MediaVisibility"
import { deleteMedia, ensureThumbnail, rotateMediaUuid } from "./index"
import { THUMB_MAX_EDGE } from "./thumbnail"

/** Small enough that a big instance does not stall boot behind image encoding,
 *  and the next pass picks up where this one stopped. */
const BATCH = 50

let running = false

/** Originals of `kind = image` that have no thumbnail row pointing at them. */
async function pending(limit: number) {
	return db
		.select()
		.from(schema.media)
		.where(
			and(
				isNull(schema.media.variant),
				eq(schema.media.kind, MediaKind.IMAGE),
				sql`NOT EXISTS (
					SELECT 1 FROM ${schema.media} AS t
					WHERE t.parent_media_id = ${schema.media.id}
					  AND t.variant = ${MediaVariant.THUMB}
				)`
			)
		)
		.limit(limit)
}

/**
 * Thumbnails smaller than the current target whose original still has pixels to
 * give — i.e. generated under an older, smaller `THUMB_MAX_EDGE`.
 *
 * Without this, raising the target only affects images uploaded afterwards, and
 * every existing character keeps a soft card image forever. Rows with unknown
 * dimensions are skipped rather than guessed at: a NULL width means the decode
 * failed, and re-running it every six hours would be a pointless loop.
 */
async function stale(limit: number) {
	const parent = alias(schema.media, "parent")
	const rows = await db
		.select({ thumb: schema.media, parent })
		.from(schema.media)
		.innerJoin(parent, eq(schema.media.parentMediaId, parent.id))
		.where(
			and(
				eq(schema.media.variant, MediaVariant.THUMB),
				isNotNull(schema.media.width),
				isNotNull(schema.media.height),
				isNotNull(parent.width),
				isNotNull(parent.height),
				sql`GREATEST(${schema.media.width}, ${schema.media.height}) < ${THUMB_MAX_EDGE}`,
				// Only when the original is actually bigger than the thumb —
				// a small source is already at its own maximum.
				sql`GREATEST(${parent.width}, ${parent.height})
					> GREATEST(${schema.media.width}, ${schema.media.height})`
			)
		)
		.limit(limit)
	return rows
}

/**
 * Generate up to `BATCH` missing thumbnails. Never throws: a bad row must not
 * take the pass — or, when called from boot, the process — down with it.
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
		for (const row of rows) {
			attempted++
			const thumb = await ensureThumbnail(db, row)
			if (thumb) generated++
		}

		// Then re-cut any that were made under a smaller target. Deleting
		// first is what lets ensureThumbnail run at all — it no-ops when a
		// thumbnail already exists.
		if (rows.length < limit) {
			for (const { thumb, parent } of await stale(limit - rows.length)) {
				attempted++
				await deleteMedia(db, thumb.id)
				// The parent's address has to change with it — a client
				// holding the old one would keep the previous thumbnail for a
				// year, since media responses are immutable.
				await rotateMediaUuid(db, parent.id)
				if (await ensureThumbnail(db, parent)) generated++
			}
		}
	} catch (err) {
		console.warn(
			"[media] thumbnail backfill failed:",
			err instanceof Error ? err.message : err
		)
	} finally {
		running = false
	}
	return { generated, attempted }
}

/**
 * Boot hook. Drains in batches rather than one pass, but stops as soon as a
 * batch produces nothing new — otherwise an image that genuinely cannot be
 * encoded would be retried forever inside a single boot.
 */
export async function backfillOnBoot(): Promise<void> {
	let total = 0
	for (;;) {
		const { generated, attempted } = await backfillThumbnails()
		total += generated
		if (attempted === 0 || generated === 0) break
	}
	if (total) console.log(`[media] generated ${total} missing thumbnail(s).`)
}
