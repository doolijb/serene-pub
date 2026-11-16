import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import {
	DEFAULT_VECTOR_NAME,
	WORLD_LORE_TYPE_ID
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-entries-listwire-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("the entries list wire carries no vector (★P6)", () => {
	test("a vectorized entry lists with embedding null and its model and timestamp", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "list-wire-1")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Wire Book", userId: user.id })
			.returning()
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{ lorebookId: book.id, title: "Gate", content: "x" } as any
				])
			)
			.returning()
		const [plain] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{ lorebookId: book.id, title: "Wall", content: "y" } as any
				])
			)
			.returning()
		const stamp = new Date("2026-01-02T03:04:05Z")
		await testDb.insert(schema.lorebookEntryVectors).values({
			entryId: entry.id,
			vectorName: DEFAULT_VECTOR_NAME,
			chunkIndex: 0,
			model: "test-embed-model",
			dims: 3,
			vector: [0.1, 0.2, 0.3],
			vectorizedAt: stamp
		} as any)

		const { listEntryRows } = await import("./entries")
		const rows = await listEntryRows(book.id, WORLD_LORE_TYPE_ID)
		const row = rows.find((r) => r.id === entry.id)!
		expect(row.embedding).toBeNull()
		expect(row.embeddingModel).toBe("test-embed-model")
		expect(row.vectorizedAt).toEqual(stamp)
		const other = rows.find((r) => r.id === plain.id)!
		expect(other.embedding).toBeNull()
		expect(other.embeddingModel).toBeNull()
		expect(other.vectorizedAt).toBeNull()
	})
})
