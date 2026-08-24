/**
 * Round-11 audit fix (MEDIUM): the CREATE handler for each lore-entry type
 * spread the entire client payload straight into the insert
 * (`{ ...params.xEntry }`), unlike the sibling UPDATE handlers which
 * already denylist id/createdAt/updatedAt/vectorizedAt/embedding/
 * embeddingModel/position. A crafted create payload could plant a forged
 * vectorizedAt/embedding, which vectorizationQueue.ts's needsEmbedding
 * check then reads as "already current," permanently skipping real
 * embedding for that entry. Fixed by applying the same denylist CREATE
 * already didn't have to UPDATE.
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
		path.join(os.tmpdir(), "serene-pub-lore-create-massassign-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

const FORGED_DATE = new Date("2000-01-01")

describe("worldLoreEntries:create — mass-assignment denylist", () => {
	test("ignores a forged id/vectorizedAt/embedding/embeddingModel/createdAt/updatedAt", async () => {
		const { createWorldLoreEntryHandler } = await import(
			"./worldLoreEntries"
		)
		const user = await makeUser("world-lore-create-massassign-user")
		const lorebook = await makeLorebook(user.id, "World Lore Book")

		const res = await createWorldLoreEntryHandler.handler(
			fakeSocket(user.id),
			{
				worldLoreEntry: {
					lorebookId: lorebook.id,
					name: "Entry",
					content: "x",
					id: 999999,
					vectorizedAt: FORGED_DATE,
					embedding: [0.1, 0.2, 0.3],
					embeddingModel: "forged-model",
					createdAt: FORGED_DATE,
					updatedAt: FORGED_DATE
				} as any
			},
			noopEmit
		)

		expect(res.worldLoreEntry.id).not.toBe(999999)
		expect(res.worldLoreEntry.vectorizedAt).toBeNull()
		expect(res.worldLoreEntry.embedding).toBeNull()
		expect(res.worldLoreEntry.embeddingModel).toBeNull()
		expect(res.worldLoreEntry.createdAt).not.toBe(FORGED_DATE.toISOString())
	})
})

describe("characterLoreEntries:create — mass-assignment denylist", () => {
	test("ignores a forged id/vectorizedAt/embedding/embeddingModel/createdAt/updatedAt", async () => {
		const { createCharacterLoreEntryHandler } = await import(
			"./characterLoreEntries"
		)
		const user = await makeUser("character-lore-create-massassign-user")
		const lorebook = await makeLorebook(user.id, "Character Lore Book")

		const res = await createCharacterLoreEntryHandler.handler(
			fakeSocket(user.id),
			{
				characterLoreEntry: {
					lorebookId: lorebook.id,
					name: "Entry",
					content: "x",
					id: 999999,
					vectorizedAt: FORGED_DATE,
					embedding: [0.1, 0.2, 0.3],
					embeddingModel: "forged-model",
					createdAt: FORGED_DATE,
					updatedAt: FORGED_DATE
				} as any
			},
			noopEmit
		)

		expect(res.characterLoreEntry.id).not.toBe(999999)
		expect(res.characterLoreEntry.vectorizedAt).toBeNull()
		expect(res.characterLoreEntry.embedding).toBeNull()
		expect(res.characterLoreEntry.embeddingModel).toBeNull()
		expect(res.characterLoreEntry.createdAt).not.toBe(
			FORGED_DATE.toISOString()
		)
	})
})
