/**
 * Session assets (20 §1): the bytes behind `core:image`/`core:file` parts and
 * the block vocabulary's image block.
 *
 * Since 28 these are ordinary media rows stamped with a `sessionId` — one place
 * for every blob in the instance, which since 0182 means a `files` row and the
 * `variants` under it. This module survives as the vocabulary message code
 * already speaks, so nothing above it had to move; the storage, dedupe, access
 * check and serving route are the shared ones.
 *
 * The old `session_assets` table and its `<dataDir>/session_assets/` tree are
 * gone (migration 0167); the 0166 data upgrade copied both into place.
 */
import {
	createMedia,
	readMedia,
	type CreatedMedia,
	type ReadMediaResult
} from "$lib/server/media"

/*
 * The handle is the global `Db` (`db/types.d.ts`) — a **parameter, never an
 * import**, and no longer the driver's own type.
 *
 * It used to be `typeof import("$lib/server/db").db`, a PGlite handle rather
 * than any `PgDatabase`, because `server/media` next door named the driver and
 * a driver-agnostic parameter was rejected at the `createMedia` call
 * (*"`PgQueryResultHKT` is not assignable to `PgliteQueryResultHKT`"*). That
 * note said widening media's type was a decision for that module; the decision
 * has since been made there — media touches nothing driver-specific — so this
 * seam is agnostic on both sides now and the callers above it no longer have to
 * cast to cross it.
 */

export interface CreateAssetInput {
	sessionId: number
	bytes: Buffer | Uint8Array
	mime: string
	createdBy?: number | null
	/** Stamped when the asset belongs to one message rather than the session at
	 *  large — finer provenance, same file location (28 §8 rule 1). */
	messageId?: number | null
	filename?: string | null
}

/**
 * `mime` is accepted for the caller's convenience but not trusted: `createMedia`
 * sniffs the bytes, exactly as every other upload path does.
 *
 * The return is `createMedia`'s own `CreatedMedia` — the file row plus the
 * variant holding the bytes just written. A session asset is a media row and
 * nothing more, which is the entire point of this module.
 */
export async function createSessionAsset(
	db: Db,
	input: CreateAssetInput
): Promise<CreatedMedia> {
	return createMedia(db, {
		// A session asset with no known uploader is owned by the session's
		// owner for storage purposes; access is still the session's (28 §6).
		userId: input.createdBy ?? (await sessionOwner(db, input.sessionId)),
		sessionId: input.sessionId,
		messageId: input.messageId ?? null,
		bytes: input.bytes,
		filename: input.filename ?? null,
		allowDocuments: true
	})
}

async function sessionOwner(db: Db, sessionId: number): Promise<number> {
	const row = await db.query.sessions.findFirst({
		where: (s, { eq }) => eq(s.id, sessionId),
		columns: { userId: true }
	})
	if (!row) throw new Error(`Session ${sessionId} not found`)
	return row.userId
}

/**
 * An asset's bytes: the ORIGINAL, falling back to the display form when the
 * original has been culled — `readMedia`'s default, and the right one here.
 *
 * An asset is handed on as it arrived. Asking for the display form instead
 * would be worse in both directions: on a file that has none stored it would
 * pay for a full lossless encode per read, and when that encode failed it would
 * return nothing rather than the bytes sitting on disk.
 */
export async function readSessionAsset(
	db: Db,
	id: number
): Promise<ReadMediaResult | null> {
	return readMedia(db, id)
}
