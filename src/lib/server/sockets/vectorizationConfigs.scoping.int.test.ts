/**
 * Round-5 audit fix: vectorizationConfig:get had no isAdmin check — the
 * one vectorization-config-reading handler in the app without one — and
 * only denylisted apiKey, still returning mode/apiBaseUrl/apiModel/
 * apiDimensions to any authenticated user. Now admin-gated, and the query
 * is an explicit allowlist of just embeddingModelTtlMinutes, matching the
 * declared response type and the one real client caller
 * (EmbeddingConnectionPanel.svelte, itself only reachable by admins).
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
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vectorizationconfig-scoping-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(isAdmin: boolean) {
	return { user: { id: 1, isAdmin } } as any
}

const noopEmit = () => {}

async function seedSensitiveConfig() {
	await testDb.delete(schema.vectorizationConfigs)
	await testDb.insert(schema.vectorizationConfigs).values({
		id: 1,
		embeddingModelTtlMinutes: 42,
		mode: "api",
		apiBaseUrl: "http://internal-embeddings.local:8080",
		apiKey: "super-secret-key",
		apiModel: "text-embedding-3-small"
	})
}

describe("vectorizationConfig:get — admin gate + column allowlist (PGlite integration)", () => {
	test("rejects a non-admin caller", async () => {
		const { vectorizationConfigGetHandler } = await import(
			"./vectorizationConfigs"
		)
		await seedSensitiveConfig()

		await expect(
			vectorizationConfigGetHandler.handler(
				fakeSocket(false),
				{},
				noopEmit
			)
		).rejects.toThrow(/unauthorized/i)
	})

	test("returns only embeddingModelTtlMinutes to an admin caller", async () => {
		const { vectorizationConfigGetHandler } = await import(
			"./vectorizationConfigs"
		)
		await seedSensitiveConfig()

		const res = await vectorizationConfigGetHandler.handler(
			fakeSocket(true),
			{},
			noopEmit
		)

		expect(res.config.embeddingModelTtlMinutes).toBe(42)
		expect((res.config as any).apiKey).toBeUndefined()
		expect((res.config as any).apiBaseUrl).toBeUndefined()
		expect((res.config as any).apiModel).toBeUndefined()
		expect((res.config as any).mode).toBeUndefined()
	})
})

describe("vectorizationConfig:update — admin round-trip (PGlite integration)", () => {
	test("updates the TTL and its internal refetch still succeeds for an admin", async () => {
		const { vectorizationConfigUpdateHandler } = await import(
			"./vectorizationConfigs"
		)
		await seedSensitiveConfig()

		const res = await vectorizationConfigUpdateHandler.handler(
			fakeSocket(true),
			{ embeddingModelTtlMinutes: 15 },
			noopEmit
		)

		expect(res.success).toBe(true)
	})
})
