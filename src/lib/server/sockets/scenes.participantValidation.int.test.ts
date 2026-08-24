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
 *
 * Updated: these arrays hold **lorebookBindings ids**, not character ids.
 * The filter used to scope by `b.characterId` and these cases were written
 * to match, passing character ids — which happened to pass only when a
 * binding id and a character id coincided numerically. Under the real
 * semantics that silently erased every unbound background/NPC binding
 * (characterId NULL can never match), wiping scene casts on each re-process.
 * The cases below now use binding ids, which is what scenes:process,
 * sessions:summarize and the graph build all actually emit; the guarantee under
 * test — "an id not belonging to this lorebook is dropped" — is unchanged.
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
		path.join(
			os.tmpdir(),
			"serene-pub-scenes-participant-validation-int-test-"
		)
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
		const [localBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: boundChar.id,
				binding: "{{char:1}}"
			})
			.returning()
		// A binding that exists, but in a DIFFERENT lorebook.
		const [otherLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Other Lorebook", userId: owner.id })
			.returning()
		const [foreignBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: otherLorebook.id,
				binding: "{{char:1}}",
				name: "Foreign"
			})
			.returning()

		const res = await sceneCreateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Summary",
					participantCharacters: [localBinding.id, foreignBinding.id],
					mentionedCharacters: [foreignBinding.id]
				} as any
			},
			noopEmit
		)

		expect(res.scene.participantCharacters).toEqual([localBinding.id])
		expect(res.scene.mentionedCharacters).toEqual([])
	})

	test("create: keeps an UNBOUND background/NPC binding id", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const owner = await makeUser("scene-participant-npc-owner")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "NPC Lorebook", userId: owner.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		// characterId NULL — a discovered character, the shape the old
		// characterId-based filter could never match and always erased.
		const [npc] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:7}}",
				name: "Cassia"
			})
			.returning()

		const res = await sceneCreateHandler.handler(
			fakeSocket(owner.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Cassia appeared.",
					participantCharacters: [npc.id]
				} as any
			},
			noopEmit
		)

		expect(res.scene.participantCharacters).toEqual([npc.id])
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
		const [localBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: boundChar.id,
				binding: "{{char:1}}"
			})
			.returning()
		const [otherLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Other Lorebook 2", userId: owner.id })
			.returning()
		const [foreignBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: otherLorebook.id,
				binding: "{{char:1}}",
				name: "Foreign 2"
			})
			.returning()

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
					participantCharacters: [localBinding.id, foreignBinding.id],
					mentionedCharacters: [foreignBinding.id]
				} as any
			},
			noopEmit
		)

		expect(res.scene.participantCharacters).toEqual([localBinding.id])
		expect(res.scene.mentionedCharacters).toEqual([])
	})
})
