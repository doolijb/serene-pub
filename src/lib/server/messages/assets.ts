/**
 * Session assets (20 §1): the bytes behind `core:image`/`core:file` parts and
 * the block vocabulary's image block — one reference vocabulary, not two.
 *
 * Bytes live under `<dataDir>/session_assets/<sessionId>/<hash>`, jailed the
 * same way plugin storage is; the row is the reference. Hash-addressed, so a
 * re-attached identical file dedupes to the same row and the serving route can
 * cache immutably.
 */

import crypto from "node:crypto"
import path from "node:path"
import fs from "node:fs/promises"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as dbConfig from "$lib/server/db/drizzle.config"

type Db = { select: any; insert: any }

export const ASSETS_DIR = "session_assets"

const assetsRoot = () => path.resolve(dbConfig.dataDir, ASSETS_DIR)

export interface CreateAssetInput {
	sessionId: number
	bytes: Buffer | Uint8Array
	mime: string
	createdBy?: number | null
}

export async function createSessionAsset(
	db: Db,
	input: CreateAssetInput
): Promise<typeof schema.sessionAssets.$inferSelect> {
	const buf = Buffer.isBuffer(input.bytes)
		? input.bytes
		: Buffer.from(input.bytes)
	const hash = crypto.createHash("sha256").update(buf).digest("hex")

	// Dedupe within the session: the same bytes attach once.
	const [existing] = await db
		.select()
		.from(schema.sessionAssets)
		.where(
			and(
				eq(schema.sessionAssets.sessionId, input.sessionId),
				eq(schema.sessionAssets.hash, hash)
			)
		)
		.limit(1)
	if (existing) return existing

	const dir = path.join(assetsRoot(), String(input.sessionId))
	const filePath = path.join(dir, hash)
	// Containment invariant, asserted rather than trusted — the id is ours and
	// the hash is hex, but the jail check is one line and forever.
	if (!filePath.startsWith(assetsRoot() + path.sep))
		throw new Error("session asset resolved to an unsafe path")
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(filePath, buf)

	const [row] = await db
		.insert(schema.sessionAssets)
		.values({
			sessionId: input.sessionId,
			hash,
			mime: input.mime,
			bytes: buf.byteLength,
			// Stored relative to the data dir, so the data dir can move.
			path: path.join(ASSETS_DIR, String(input.sessionId), hash),
			createdBy: input.createdBy ?? null
		})
		.returning()
	return row
}

export async function readSessionAsset(
	db: Db,
	id: number
): Promise<{
	row: typeof schema.sessionAssets.$inferSelect
	bytes: Buffer
} | null> {
	const [row] = await db
		.select()
		.from(schema.sessionAssets)
		.where(eq(schema.sessionAssets.id, id))
		.limit(1)
	if (!row) return null
	const filePath = path.resolve(dbConfig.dataDir, row.path)
	if (!filePath.startsWith(assetsRoot() + path.sep)) return null
	try {
		return { row, bytes: await fs.readFile(filePath) }
	} catch {
		return null
	}
}
