/**
 * 2b: narrativeGraphDeleteNodeHandler used to delete a lorebookBindings row
 * with no cleanup of scenes.participantCharacters/mentionedCharacters (plain
 * JSON int arrays, no FK — dangling ids otherwise), and gave the user no
 * warning when the node being deleted was referenced by a past merge log
 * (as survivorId, or as an endpoint in relationshipRewrites/
 * deletedRelationships) — deleting it there either silently orphans a
 * relationship-rewrite endpoint or permanently disables that merge's undo
 * via survivorId's onDelete: "set null". Now: scene arrays are cleaned up
 * in the same transaction as the delete, and a new read-only handler,
 * narrativeGraph:checkNodeMergeReferences, lets the client warn before the
 * user confirms.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { readSceneCast, writeSceneCast } from "$lib/server/utils/sceneCast"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-narrativegraph-deletenode-int-test-")
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

async function makeBinding(lorebookId: number, binding: string, name = "Node") {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding, name })
		.returning()
	return row
}

describe("narrativeGraph:deleteNode — scene array cleanup (PGlite integration)", () => {
	test("removes the deleted node's id from every referencing scene's participant/mentioned arrays", async () => {
		const { narrativeGraphDeleteNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("delnode-scene-user")
		const lorebook = await makeLorebook(user.id)
		const node = await makeBinding(lorebook.id, "{{char:1}}", "Doomed")
		const other = await makeBinding(lorebook.id, "{{char:2}}", "Survivor")
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
		await writeSceneCast(scene.id, {
			participantCharacters: [node.id, other.id],
			mentionedCharacters: [node.id]
		})

		await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(user.id),
			{ id: node.id },
			noopEmit
		)

		// The handler no longer rewrites scene cast by hand — scene_characters
		// .binding_id is a real FK with ON DELETE cascade, so the deleted
		// node's rows go with it while the other participant is untouched.
		const updatedScene = await readSceneCast(scene.id)
		expect(updatedScene.participantCharacters).toEqual([other.id])
		expect(updatedScene.mentionedCharacters).toEqual([])

		const deletedNode = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, node.id)
		})
		expect(deletedNode).toBeUndefined()
	})
})

describe("narrativeGraph:checkNodeMergeReferences (PGlite integration)", () => {
	test("detects a node referenced as a merge log's survivorId", async () => {
		const { narrativeGraphCheckNodeMergeReferencesHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("checkref-survivor-user")
		const lorebook = await makeLorebook(user.id)
		const survivor = await makeBinding(lorebook.id, "{{char:10}}")
		await testDb.insert(schema.bindingMergeLogs).values({
			lorebookId: lorebook.id,
			userId: user.id,
			survivorId: survivor.id,
			absorbedSnapshot: { id: 999, binding: "{{char:11}}" }
		})

		const res = await narrativeGraphCheckNodeMergeReferencesHandler.handler(
			fakeSocket(user.id),
			{ nodeId: survivor.id },
			noopEmit
		)

		expect(res.referencedByMergeLog).toBe(true)
	})

	test("detects a node referenced in deletedRelationships", async () => {
		const { narrativeGraphCheckNodeMergeReferencesHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("checkref-relationship-user")
		const lorebook = await makeLorebook(user.id)
		const survivor = await makeBinding(lorebook.id, "{{char:20}}")
		const endpoint = await makeBinding(lorebook.id, "{{char:21}}")
		await testDb.insert(schema.bindingMergeLogs).values({
			lorebookId: lorebook.id,
			userId: user.id,
			survivorId: survivor.id,
			absorbedSnapshot: { id: 998, binding: "{{char:22}}" },
			deletedRelationships: [
				{ id: 1, fromNodeId: endpoint.id, toNodeId: survivor.id }
			]
		})

		const res = await narrativeGraphCheckNodeMergeReferencesHandler.handler(
			fakeSocket(user.id),
			{ nodeId: endpoint.id },
			noopEmit
		)

		expect(res.referencedByMergeLog).toBe(true)
	})

	test("returns false for a node with no merge log references", async () => {
		const { narrativeGraphCheckNodeMergeReferencesHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("checkref-clean-user")
		const lorebook = await makeLorebook(user.id)
		const node = await makeBinding(lorebook.id, "{{char:30}}")

		const res = await narrativeGraphCheckNodeMergeReferencesHandler.handler(
			fakeSocket(user.id),
			{ nodeId: node.id },
			noopEmit
		)

		expect(res.referencedByMergeLog).toBe(false)
	})
})
