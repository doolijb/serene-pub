/**
 * Round-10 audit fix (HIGH): lorebooks:createBinding/updateBinding accepted
 * `sceneId`/`historyEntryId`/`parentNodeId` from the client with no check
 * that the referenced row belongs to the same lorebook as the binding being
 * written — narrativeGraphUpdateNodeHandler (narrativeGraph.ts) already
 * guards this exact pattern for the same table/columns via a different
 * entry point; this handler pair didn't. Also allowed a client to directly
 * set embedding/embeddingModel/vectorizedAt/absorbedAliases/createdAt/
 * updatedAt on a binding.
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
		path.join(os.tmpdir(), "serene-pub-binding-crosstenant-int-test-")
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

async function makeLorebook(userId: number, name = "Test Book") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

describe("lorebooks:createBinding — cross-tenant FK validation (PGlite integration)", () => {
	test("rejects a sceneId belonging to a different lorebook", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("binding-create-scene-user")
		const ownLorebook = await makeLorebook(user.id, "Own Book")
		const otherLorebook = await makeLorebook(user.id, "Other Book")
		const [foreignHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: otherLorebook.id })
			.returning()
		const [foreignScene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: otherLorebook.id,
				historyEntryId: foreignHistoryEntry.id,
				name: "Foreign Scene"
			})
			.returning()

		await expect(
			createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{
					lorebookBinding: {
						lorebookId: ownLorebook.id,
						name: "Background NPC",
						sceneId: foreignScene.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/scene not found/i)
	})

	test("rejects a historyEntryId belonging to a different lorebook", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("binding-create-history-user")
		const ownLorebook = await makeLorebook(user.id, "Own Book 2")
		const otherLorebook = await makeLorebook(user.id, "Other Book 2")
		const [foreignEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: otherLorebook.id })
			.returning()

		await expect(
			createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{
					lorebookBinding: {
						lorebookId: ownLorebook.id,
						name: "Background NPC",
						historyEntryId: foreignEntry.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/history entry not found/i)
	})

	test("rejects a parentNodeId belonging to a different lorebook", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("binding-create-parent-user")
		const ownLorebook = await makeLorebook(user.id, "Own Book 3")
		const otherLorebook = await makeLorebook(user.id, "Other Book 3")
		const [foreignBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: otherLorebook.id,
				binding: "{{char:99}}",
				name: "Foreign Node"
			})
			.returning()

		await expect(
			createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{
					lorebookBinding: {
						lorebookId: ownLorebook.id,
						name: "Background NPC",
						parentNodeId: foreignBinding.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/parent node not found/i)
	})

	test("accepts a sceneId/historyEntryId/parentNodeId belonging to the same lorebook", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("binding-create-samebook-user")
		const lorebook = await makeLorebook(user.id, "Same Book")
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: lorebook.id,
				name: "Scene",
				historyEntryId: historyEntry.id
			})
			.returning()
		const [parentBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:1}}",
				name: "Parent Node"
			})
			.returning()

		const res = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					name: "Child Node",
					sceneId: scene.id,
					historyEntryId: historyEntry.id,
					parentNodeId: parentBinding.id
				} as any
			},
			noopEmit
		)
		expect(res.lorebookBinding.sceneId).toBe(scene.id)
		expect(res.lorebookBinding.historyEntryId).toBe(historyEntry.id)
		expect(res.lorebookBinding.parentNodeId).toBe(parentBinding.id)
	})

	test("ignores embedding/embeddingModel/vectorizedAt/absorbedAliases/createdAt/updatedAt in the payload", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("binding-create-denylist-user")
		const lorebook = await makeLorebook(user.id, "Denylist Book")
		const forgedDate = new Date("2000-01-01")

		const res = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					name: "Node",
					embedding: [0.1, 0.2, 0.3],
					embeddingModel: "forged-model",
					vectorizedAt: forgedDate,
					absorbedAliases: ["forged-alias"],
					createdAt: forgedDate,
					updatedAt: forgedDate
				} as any
			},
			noopEmit
		)
		expect(res.lorebookBinding.embedding).toBeNull()
		expect(res.lorebookBinding.embeddingModel).toBeNull()
		expect(res.lorebookBinding.vectorizedAt).toBeNull()
		expect(res.lorebookBinding.absorbedAliases).toEqual([])
		expect(res.lorebookBinding.createdAt.getTime()).not.toBe(
			forgedDate.getTime()
		)
	})
})

describe("lorebooks:updateBinding — cross-tenant FK validation (PGlite integration)", () => {
	test("rejects a sceneId belonging to a different lorebook", async () => {
		const { createLorebookBindingHandler, updateLorebookBindingHandler } =
			await import("./lorebooks")
		const user = await makeUser("binding-update-scene-user")
		const lorebook = await makeLorebook(user.id, "Update Own Book")
		const otherLorebook = await makeLorebook(user.id, "Update Other Book")
		const [foreignHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: otherLorebook.id })
			.returning()
		const [foreignScene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: otherLorebook.id,
				historyEntryId: foreignHistoryEntry.id,
				name: "Foreign Scene"
			})
			.returning()
		const created = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					name: "Node"
				} as any
			},
			noopEmit
		)

		await expect(
			updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{
					lorebookBinding: {
						id: created.lorebookBinding.id,
						sceneId: foreignScene.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/scene not found/i)
	})

	test("accepts a sceneId belonging to the same lorebook", async () => {
		const { createLorebookBindingHandler, updateLorebookBindingHandler } =
			await import("./lorebooks")
		const user = await makeUser("binding-update-samebook-user")
		const lorebook = await makeLorebook(user.id, "Update Same Book")
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: lorebook.id,
				historyEntryId: historyEntry.id,
				name: "Scene"
			})
			.returning()
		const created = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					name: "Node"
				} as any
			},
			noopEmit
		)

		const res = await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					id: created.lorebookBinding.id,
					sceneId: scene.id
				} as any
			},
			noopEmit
		)
		expect(res.lorebookBinding.sceneId).toBe(scene.id)
	})

	test("ignores embedding/embeddingModel/vectorizedAt/absorbedAliases/createdAt/updatedAt in the payload", async () => {
		const { createLorebookBindingHandler, updateLorebookBindingHandler } =
			await import("./lorebooks")
		const user = await makeUser("binding-update-denylist-user")
		const lorebook = await makeLorebook(user.id, "Update Denylist Book")
		const created = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					name: "Node"
				} as any
			},
			noopEmit
		)
		const originalUpdatedAt = created.lorebookBinding.updatedAt

		const forgedDate = new Date("2000-01-01")
		const res = await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					id: created.lorebookBinding.id,
					embedding: [0.1, 0.2, 0.3],
					embeddingModel: "forged-model",
					vectorizedAt: forgedDate,
					absorbedAliases: ["forged-alias"],
					createdAt: forgedDate,
					updatedAt: forgedDate
				} as any
			},
			noopEmit
		)
		expect(res.lorebookBinding.embedding).toBeNull()
		expect(res.lorebookBinding.embeddingModel).toBeNull()
		expect(res.lorebookBinding.vectorizedAt).toBeNull()
		expect(res.lorebookBinding.absorbedAliases).toEqual([])
		expect(res.lorebookBinding.updatedAt.getTime()).not.toBe(
			forgedDate.getTime()
		)
		expect(res.lorebookBinding.updatedAt.getTime()).not.toBe(
			new Date(originalUpdatedAt).getTime()
		)
	})
})
