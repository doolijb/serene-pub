/**
 * Round-6 audit fix: sceneCreateHandler verified lorebookId and (if
 * present) sessionId ownership, but inserted the client-supplied
 * historyEntryId with no check it belonged to that same lorebook. An
 * attacker could create a scene with their own lorebookId/sessionId but a
 * guessed historyEntryId from a victim's private lorebook — the injected
 * scene's content would then feed directly into the victim's own
 * LLM-driven compile call the next time they compiled that history entry
 * (sceneCompileHandler used to query scenes by historyEntryId alone, now
 * also defense-in-depth scoped to lorebookId).
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
		path.join(os.tmpdir(), "serene-pub-scenes-create-scoping-int-test-")
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

describe("scenes:create — historyEntryId scoping (PGlite integration)", () => {
	test("rejects a historyEntryId belonging to a different lorebook", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const attacker = await makeUser("scene-create-attacker")
		const victim = await makeUser("scene-create-victim")

		const [attackerLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Attacker's Book", userId: attacker.id })
			.returning()
		const [victimLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Victim's Book", userId: victim.id })
			.returning()
		const [victimHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: victimLorebook.id })
			.returning()

		await expect(
			sceneCreateHandler.handler(
				fakeSocket(attacker.id),
				{
					scene: {
						lorebookId: attackerLorebook.id,
						historyEntryId: victimHistoryEntry.id,
						name: "Injected scene",
						summary: "Malicious content"
					} as any
				},
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a historyEntryId belonging to the same lorebook", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const owner = await makeUser("scene-create-owner")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book", userId: owner.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()

		const res = await sceneCreateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Legit scene",
					summary: "Fine"
				} as any
			},
			noopEmit
		)

		expect(res.scene.historyEntryId).toBe(historyEntry.id)
	})
})
