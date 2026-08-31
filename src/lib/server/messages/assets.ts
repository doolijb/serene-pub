/**
 * Session assets (20 §1): the bytes behind `core:image`/`core:file` parts and
 * the block vocabulary's image block.
 *
 * Since 28 these are ordinary `media` rows stamped with a `sessionId` — one
 * table for every blob in the instance. This module survives as the vocabulary
 * message code already speaks, so nothing above it had to move; the storage,
 * dedupe, access check and serving route are the shared ones.
 *
 * The old `session_assets` table and its `<dataDir>/session_assets/` tree are
 * gone (migration 0167); the 0166 data upgrade copied both into place.
 */
import * as schema from "$lib/server/db/schema"
import { createMedia, readMedia, type MediaRow } from "$lib/server/media"

type Db = any

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
 */
export async function createSessionAsset(
	db: Db,
	input: CreateAssetInput
): Promise<MediaRow> {
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
		where: (s: any, { eq }: any) => eq(s.id, sessionId),
		columns: { userId: true }
	})
	if (!row) throw new Error(`Session ${sessionId} not found`)
	return row.userId
}

export async function readSessionAsset(
	db: Db,
	id: number
): Promise<{ row: MediaRow; bytes: Buffer } | null> {
	return readMedia(db, id)
}
