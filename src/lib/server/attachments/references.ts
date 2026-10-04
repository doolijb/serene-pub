/**
 * **Part references** — which sessions show a file through an attachment
 * (PLAN-composer-attachments §6.3).
 *
 * A file's provenance names ONE session (or none): dedupe is per
 * (user, hash), so a person re-attaching their own avatar gets the avatar's
 * row back, carrying its `characterId` and no `sessionId`. Without a second
 * road, a guest of the session sees a broken image and a reply that sends it
 * is refused. The second road is this: a file a `core:image` / `core:file`
 * part of a message in session S refers to is a file of S, for viewing and for
 * sending to S's models.
 *
 * Read through `message_parts_asset_idx` (the expression + partial index on
 * `data->>'assetId'`, declared in `schema.ts`), so it is an index probe rather than a
 * scan of every part. `private` visibility still narrows first — that is the
 * caller's (`canViewMedia`).
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The part types that refer to a file by `data.assetId`. */
export const ATTACHMENT_PART_TYPES = ["core:image", "core:file"] as const

const assetIdIs = (fileId: number) =>
	sql`(${schema.messageParts.data}->>'assetId') = ${String(fileId)}`

/**
 * Every session one of whose messages carries a part referring to `fileId`,
 * at most `limit` of them (a file shown in hundreds of sessions needs only
 * one the viewer can open).
 */
export async function sessionsReferencingFile(
	db: Db,
	fileId: number,
	limit = 50
): Promise<number[]> {
	const rows = await db
		.selectDistinct({ sessionId: schema.messages.sessionId })
		.from(schema.messageParts)
		.innerJoin(
			schema.messages,
			eq(schema.messages.id, schema.messageParts.messageId)
		)
		.where(
			and(
				assetIdIs(fileId),
				inArray(schema.messageParts.type, [...ATTACHMENT_PART_TYPES])
			)
		)
		.limit(limit)
	return rows.map((r) => r.sessionId).filter((id): id is number => id != null)
}

/** Whether a message of `sessionId` carries a part referring to `fileId`. */
export async function isFileReferencedInSession(
	db: Db,
	fileId: number,
	sessionId: number
): Promise<boolean> {
	const [row] = await db
		.select({ id: schema.messageParts.id })
		.from(schema.messageParts)
		.innerJoin(
			schema.messages,
			eq(schema.messages.id, schema.messageParts.messageId)
		)
		.where(
			and(
				assetIdIs(fileId),
				inArray(schema.messageParts.type, [...ATTACHMENT_PART_TYPES]),
				eq(schema.messages.sessionId, sessionId)
			)
		)
		.limit(1)
	return !!row
}
