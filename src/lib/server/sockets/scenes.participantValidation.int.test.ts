/**
 * Round-9 audit fix (LOW): sceneCreateHandler/sceneUpdateHandler accepted
 * participantCharacters/mentionedCharacters with no validation that the
 * submitted character ids actually belong to the scene's own lorebook.
 * Every downstream consumer (graphBuilder.ts, lorebookExportMapper.ts,
 * narrativeGraph.ts) already re-scopes these ids and silently drops
 * anything foreign, so this wasn't independently exploitable — but the
 * write path itself didn't validate, so a future consumer that trusted
 * these arrays directly would reopen a cross-lorebook leak. Both handlers
 * now filter to only ids present in lorebookBindings for the scene's own
 * lorebookId, silently dropping anything else (matching the same
 * "drop, don't error" tolerance the downstream consumers already use).
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
		path.join(os.tmpdir(), "serene-pub-scenes-participant-validation-int-test-")
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

async function makeCharacter(userId: number, name: string) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return character
}

describe("scenes:create/update — participantCharacters/mentionedCharacters scoping (PGlite integration)", () => {
	test("create: drops a character id not bound into the scene's own lorebook", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const owner = await makeUser("scene-participant-create-owner")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Scene Lorebook", userId: owner.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()

		const boundChar = await makeCharacter(owner.id, "Bound Character")
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: boundChar.id,
			binding: "{{char:1}}"
		})
		// A character that exists, but has no binding in THIS lorebook.
		const unboundChar = await makeCharacter(owner.id, "Unbound Character")

		const res = await sceneCreateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Summary",
					participantCharacters: [boundChar.id, unboundChar.id],
					mentionedCharacters: [unboundChar.id]
				} as any
			},
			noopEmit
		)

		expect(res.scene.participantCharacters).toEqual([boundChar.id])
		expect(res.scene.mentionedCharacters).toEqual([])
	})

	test("update: drops a character id not bound into the scene's own lorebook", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const owner = await makeUser("scene-participant-update-owner")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Scene Lorebook 2", userId: owner.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const boundChar = await makeCharacter(owner.id, "Bound Character 2")
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: boundChar.id,
			binding: "{{char:1}}"
		})
		const foreignChar = await makeCharacter(owner.id, "Foreign Character")

		const created = await sceneCreateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Summary"
				} as any
			},
			noopEmit
		)

		const res = await sceneUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					id: created.scene.id,
					participantCharacters: [boundChar.id, foreignChar.id],
					mentionedCharacters: [foreignChar.id]
				} as any
			},
			noopEmit
		)

		expect(res.scene.participantCharacters).toEqual([boundChar.id])
		expect(res.scene.mentionedCharacters).toEqual([])
	})
})
