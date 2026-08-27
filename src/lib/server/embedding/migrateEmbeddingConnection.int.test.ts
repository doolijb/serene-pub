import { describe, it, expect, beforeEach } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { migrateEmbeddingConnection } from "./migrateEmbeddingConnection"
import {
	encryptToken,
	decryptApiKeyField,
	VECTORIZATION_API_KEY_INFO
} from "$lib/server/utils/tokenCrypto"

/**
 * 20 §14: the vectorization endpoint config projects into a connections row
 * with `modality: 'embeddings'`, the site-wide pointer is set, the API key
 * survives the key-class change, and the whole thing is pointer-guarded
 * idempotent.
 */

let db: TestDb

async function ensureSettings(patch: Record<string, unknown> = {}) {
	const [existing] = await db
		.select()
		.from(schema.systemSettings)
		.where(eq(schema.systemSettings.id, 1))
	if (existing)
		await db
			.update(schema.systemSettings)
			.set({ activeEmbeddingConnectionId: null, ...patch })
			.where(eq(schema.systemSettings.id, 1))
	else
		await db
			.insert(schema.systemSettings)
			.values({ id: 1, ...patch } as any)
}

async function setVectorization(patch: Record<string, unknown>) {
	await db.delete(schema.vectorizationConfigs)
	await db
		.insert(schema.vectorizationConfigs)
		.values({ id: 1, ...patch } as any)
}

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

describe("migrateEmbeddingConnection", () => {
	it("projects an API config, re-encrypting the key across classes", async () => {
		const enc = encryptToken("sk-embed-123", VECTORIZATION_API_KEY_INFO)
		await ensureSettings()
		await setVectorization({
			mode: "api",
			apiBaseUrl: "http://localhost:1234/v1",
			apiModel: "text-embedding-3-small",
			apiDimensions: 1536,
			apiKey: enc.ciphertext,
			apiKeyIv: enc.iv,
			apiKeyAuthTag: enc.authTag
		})

		const r = await migrateEmbeddingConnection(db)
		expect(r.migrated).toBe(true)

		const [conn] = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, r.connectionId!))
		expect(conn).toMatchObject({
			modality: "embeddings",
			type: "openai-embeddings",
			baseUrl: "http://localhost:1234/v1",
			model: "text-embedding-3-small"
		})
		expect((conn.extraJson as any).dimensions).toBe(1536)
		// The key round-trips through the *connection* key class.
		expect(decryptApiKeyField((conn.extraJson as any).apiKey)).toBe(
			"sk-embed-123"
		)
		// And never rests as plaintext.
		expect(JSON.stringify(conn.extraJson)).not.toContain("sk-embed-123")

		const [settings] = await db
			.select()
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.id, 1))
		expect(settings.activeEmbeddingConnectionId).toBe(r.connectionId)

		// Pointer-guarded: the second run does nothing.
		expect((await migrateEmbeddingConnection(db)).migrated).toBe(false)
	}, 60_000)

	it("projects a local config from the chosen model name", async () => {
		await ensureSettings({ embeddingModelName: "all-MiniLM-L6-v2" })
		await setVectorization({ mode: "local" })
		const r = await migrateEmbeddingConnection(db)
		expect(r.migrated).toBe(true)
		const [conn] = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, r.connectionId!))
		expect(conn).toMatchObject({
			modality: "embeddings",
			type: "local-onnx",
			model: "all-MiniLM-L6-v2"
		})
	}, 60_000)

	it("a fresh install migrates nothing — the pointer stays null", async () => {
		await ensureSettings({ embeddingModelName: null })
		await setVectorization({ mode: "local" })
		expect((await migrateEmbeddingConnection(db)).migrated).toBe(false)
		const [settings] = await db
			.select()
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.id, 1))
		expect(settings.activeEmbeddingConnectionId).toBeNull()
	}, 60_000)
})
