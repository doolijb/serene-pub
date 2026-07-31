/**
 * Round-11 audit fix (MEDIUM): vectorizationConfigs.apiKey was stored
 * plaintext in the DB despite the app already owning an AES-256-GCM
 * encryption-at-rest utility. vectorizationSetApiConfig now encrypts the
 * key before writing (new apiKeyIv/apiKeyAuthTag columns);
 * vectorizationListModels decrypts it back before returning to the client
 * (EmbeddingConnectionPanel.svelte loads the real value into its edit
 * form, same as before this fix — what changed is DB storage, not what
 * the admin client sees).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

// activateApiEmbedding() would otherwise make a real test-embed HTTP call —
// stub it to resolve immediately. resolveVectorizationApiKey stays real
// (that's what's under test).
vi.mock("$lib/server/embedding/index", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/embedding/index")>()
	return {
		...actual,
		activateApiEmbedding: vi.fn(async () => ({ dimensions: 384 }))
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vectorization-apikey-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
	await testDb.insert(schema.vectorizationConfigs).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: true } } as any
}

const noopEmit = () => {}

describe("vectorization:setApiConfig/listModels — apiKey encryption at rest", () => {
	test("encrypts the key in the DB row and decrypts it back through vectorization:listModels", async () => {
		const { vectorizationSetApiConfig, vectorizationListModels } =
			await import("./vectorization")
		const admin = await makeAdmin("vectorization-apikey-user")

		await vectorizationSetApiConfig.handler(
			fakeSocket(admin.id),
			{
				baseUrl: "https://api.example.com/v1",
				apiKey: "sk-embeddings-super-secret",
				model: "text-embedding-3-small"
			} as any,
			noopEmit
		)

		const rawRow = await testDb.query.vectorizationConfigs.findFirst({
			where: (v, { eq }) => eq(v.id, 1)
		})
		expect(rawRow?.apiKey).not.toBe("sk-embeddings-super-secret")
		expect(rawRow?.apiKeyIv).toBeTruthy()
		expect(rawRow?.apiKeyAuthTag).toBeTruthy()

		const listed = await vectorizationListModels.handler(
			fakeSocket(admin.id),
			{},
			noopEmit
		)
		expect(listed.apiKey).toBe("sk-embeddings-super-secret")
	})

	test("omitting apiKey on a later setApiConfig call leaves the previously-saved encrypted key untouched", async () => {
		const { vectorizationSetApiConfig, vectorizationListModels } =
			await import("./vectorization")
		const admin = await makeAdmin("vectorization-apikey-preserve-user")

		await vectorizationSetApiConfig.handler(
			fakeSocket(admin.id),
			{
				baseUrl: "https://api.example.com/v1",
				apiKey: "sk-preserve-me",
				model: "text-embedding-3-small"
			} as any,
			noopEmit
		)

		// Re-save without an apiKey (eg. just changing the model) — the
		// existing key must survive, not get nulled out.
		await vectorizationSetApiConfig.handler(
			fakeSocket(admin.id),
			{
				baseUrl: "https://api.example.com/v1",
				model: "text-embedding-3-large"
			} as any,
			noopEmit
		)

		const listed = await vectorizationListModels.handler(
			fakeSocket(admin.id),
			{},
			noopEmit
		)
		expect(listed.apiKey).toBe("sk-preserve-me")
	})
})
