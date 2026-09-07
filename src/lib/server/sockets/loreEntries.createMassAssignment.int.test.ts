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
 *
 * ⚠ The three embedding fields are a *vector row* now, not columns on the
 * entry, so the wire assertions below can no longer fail on their own — the
 * adapter has nowhere to put a forged value even if the denylist let one
 * through. `noVectorFor` is what still carries the claim: the forged payload
 * must not leave a `lorebook_entry_vectors` row behind, because that row is
 * what the queue's staleness check actually reads.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import {
	CHARACTER_LORE_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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

/** The claim the wire assertions used to carry on their own. */
async function noVectorFor(entryId: number) {
	const rows = await testDb
		.select()
		.from(schema.lorebookEntryVectors)
		.where(eq(schema.lorebookEntryVectors.entryId, entryId))
	return rows.length === 0
}

describe("entries:create — mass-assignment denylist, world lore", () => {
	test("ignores a forged id/vectorizedAt/embedding/embeddingModel/createdAt/updatedAt", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("world-lore-create-massassign-user")
		const lorebook = await makeLorebook(user.id, "World Lore Book")

		const res = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
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

		expect(res.entry.id).not.toBe(999999)
		expect(res.entry.vectorizedAt).toBeNull()
		expect(res.entry.embedding).toBeNull()
		expect(res.entry.embeddingModel).toBeNull()
		expect(res.entry.createdAt).not.toBe(FORGED_DATE.toISOString())
		expect(await noVectorFor(res.entry.id)).toBe(true)
	})
})

describe("entries:create — mass-assignment denylist, character lore", () => {
	test("ignores a forged id/vectorizedAt/embedding/embeddingModel/createdAt/updatedAt", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("character-lore-create-massassign-user")
		const lorebook = await makeLorebook(user.id, "Character Lore Book")

		const res = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: CHARACTER_LORE_TYPE_ID,
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

		expect(res.entry.id).not.toBe(999999)
		expect(res.entry.vectorizedAt).toBeNull()
		expect(res.entry.embedding).toBeNull()
		expect(res.entry.embeddingModel).toBeNull()
		expect(res.entry.createdAt).not.toBe(FORGED_DATE.toISOString())
		expect(await noVectorFor(res.entry.id)).toBe(true)
	})
})
