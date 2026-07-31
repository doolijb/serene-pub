/**
 * 2a: scenes:update used to `.set(params.scene)` wholesale, with ownership
 * checked only against the scene's *existing* lorebookId — a client could
 * redirect their own scene into another user's lorebook/chat/history entry
 * by including a foreign id in the payload, with no re-validation
 * (sceneCreateHandler validates its target ids on insert; this handler was
 * the one outlier that didn't). Now an explicit allowlist.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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
		path.join(os.tmpdir(), "serene-pub-scenes-scoping-int-test-")
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

describe("scenes:update — scoping (PGlite integration)", () => {
	test("ignores a foreign lorebookId/chatId/historyEntryId in the payload while applying allowed fields", async () => {
		const { sceneUpdateHandler } = await import("./scenes")
		const owner = await makeUser("scene-scope-owner")
		const attacker = await makeUser("scene-scope-attacker")

		const [ownLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book", userId: owner.id })
			.returning()
		const [foreignLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Attacker's Book", userId: attacker.id })
			.returning()
		const [ownHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: ownLorebook.id })
			.returning()
		const [foreignHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: foreignLorebook.id })
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: ownLorebook.id,
				historyEntryId: ownHistoryEntry.id,
				name: "Original"
			})
			.returning()

		const res = await sceneUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					id: scene.id,
					lorebookId: foreignLorebook.id,
					historyEntryId: foreignHistoryEntry.id,
					name: "Renamed",
					summary: "A new summary"
				} as any
			},
			noopEmit
		)

		// Allowed fields applied...
		expect(res.scene.name).toBe("Renamed")
		expect(res.scene.summary).toBe("A new summary")
		// ...but identity fields stay exactly as they were.
		expect(res.scene.lorebookId).toBe(ownLorebook.id)
		expect(res.scene.historyEntryId).toBe(ownHistoryEntry.id)
	})
})
