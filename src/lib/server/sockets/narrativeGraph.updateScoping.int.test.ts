/**
 * 2a: narrativeGraph:updateNode / updateRelationship used to build their
 * UPDATE payload from a denylist (`...fields` after excluding a few known
 * columns), which silently let through any field not on the denylist —
 * including lorebookId itself, letting a client move a node/relationship
 * into a lorebook it doesn't own. The fix is an explicit allowlist, but
 * that alone isn't enough: the allowed id-typed fields (parentNodeId,
 * sceneId, historyEntryId) still need the *referenced* row to belong to
 * the same lorebook, or a client could point them at another tenant's row.
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
		path.join(os.tmpdir(), "serene-pub-update-scoping-int-test-")
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

async function makeBinding(
	lorebookId: number,
	overrides: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "", ...overrides })
		.returning()
	return binding
}

describe("narrativeGraph:updateNode — scoping (PGlite integration)", () => {
	test("ignores a foreign lorebookId in the payload instead of moving the node", async () => {
		const { narrativeGraphUpdateNodeHandler } = await import(
			"./narrativeGraph"
		)
		const owner = await makeUser("update-node-owner")
		const attacker = await makeUser("update-node-attacker")
		const ownLorebook = await makeLorebook(owner.id, "Owner's Book")
		const foreignLorebook = await makeLorebook(
			attacker.id,
			"Attacker's Book"
		)
		const node = await makeBinding(ownLorebook.id, { name: "Node" })

		const res = await narrativeGraphUpdateNodeHandler.handler(
			fakeSocket(owner.id),
			{
				node: {
					id: node.id,
					lorebookId: foreignLorebook.id,
					nodeState: "active"
				} as any
			},
			noopEmit
		)

		expect(res.node.lorebookId).toBe(ownLorebook.id)
		const afterUpdate = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, node.id)
		})
		expect(afterUpdate?.lorebookId).toBe(ownLorebook.id)
	})

	test("rejects a parentNodeId pointing at a row in a different lorebook", async () => {
		const { narrativeGraphUpdateNodeHandler } = await import(
			"./narrativeGraph"
		)
		const owner = await makeUser("update-node-parent-owner")
		const ownLorebook = await makeLorebook(owner.id, "Owner's Book 2")
		const otherLorebook = await makeLorebook(owner.id, "Other Book")
		const node = await makeBinding(ownLorebook.id, { name: "Node" })
		const foreignNode = await makeBinding(otherLorebook.id, {
			name: "Foreign Node"
		})

		await expect(
			narrativeGraphUpdateNodeHandler.handler(
				fakeSocket(owner.id),
				{
					node: {
						id: node.id,
						parentNodeId: foreignNode.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/parent node not found/i)
	})

	test("allows setting nodeState/nodeVisibility, the intended graph-shaped fields", async () => {
		const { narrativeGraphUpdateNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("update-node-allowed-user")
		const lorebook = await makeLorebook(user.id)
		const node = await makeBinding(lorebook.id, { name: "Node" })

		const res = await narrativeGraphUpdateNodeHandler.handler(
			fakeSocket(user.id),
			{
				node: {
					id: node.id,
					nodeState: "deceased",
					nodeVisibility: "hidden"
				} as any
			},
			noopEmit
		)

		expect(res.node.nodeState).toBe("deceased")
		expect(res.node.nodeVisibility).toBe("hidden")
	})
})

describe("narrativeGraph:updateRelationship — scoping (PGlite integration)", () => {
	test("ignores foreign fromNodeId/toNodeId/lorebookId in the payload", async () => {
		const { narrativeGraphUpdateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const owner = await makeUser("update-rel-owner")
		const attacker = await makeUser("update-rel-attacker")
		const lorebook = await makeLorebook(owner.id, "Rel Book")
		const foreignLorebook = await makeLorebook(
			attacker.id,
			"Attacker Rel Book"
		)
		const nodeA = await makeBinding(lorebook.id, { name: "A" })
		const nodeB = await makeBinding(lorebook.id, { name: "B" })
		const foreignNode = await makeBinding(foreignLorebook.id, {
			name: "Foreign"
		})
		const [rel] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: lorebook.id,
				fromNodeId: nodeA.id,
				toNodeId: nodeB.id,
				relationshipType: "ally"
			})
			.returning()

		const res = await narrativeGraphUpdateRelationshipHandler.handler(
			fakeSocket(owner.id),
			{
				relationship: {
					id: rel.id,
					lorebookId: foreignLorebook.id,
					fromNodeId: foreignNode.id,
					toNodeId: foreignNode.id,
					description: "updated"
				} as any
			},
			noopEmit
		)

		expect(res.relationship.lorebookId).toBe(lorebook.id)
		expect(res.relationship.fromNodeId).toBe(nodeA.id)
		expect(res.relationship.toNodeId).toBe(nodeB.id)
		expect(res.relationship.description).toBe("updated")
	})

	test("rejects a historyEntryId pointing at a different lorebook", async () => {
		const { narrativeGraphUpdateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("update-rel-history-user")
		const lorebook = await makeLorebook(user.id, "History Rel Book")
		const otherLorebook = await makeLorebook(user.id, "Other History Book")
		const nodeA = await makeBinding(lorebook.id, { name: "A" })
		const nodeB = await makeBinding(lorebook.id, { name: "B" })
		const [rel] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: lorebook.id,
				fromNodeId: nodeA.id,
				toNodeId: nodeB.id,
				relationshipType: "ally"
			})
			.returning()
		const [foreignHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: otherLorebook.id })
			.returning()

		await expect(
			narrativeGraphUpdateRelationshipHandler.handler(
				fakeSocket(user.id),
				{
					relationship: {
						id: rel.id,
						historyEntryId: foreignHistoryEntry.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/history entry not found/i)
	})
})
