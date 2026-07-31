/**
 * Replace-mode never-delete regression (merge plan, "Design decision —
 * replace-mode graph rebuild", later tightened to drop ghost-row deletion
 * entirely): post-merge a binding IS the character's identity/privacy
 * anchor, so a wholesale delete-and-rebuild of every graph row (the old
 * narrativeNodes behavior) would destroy real character data. A rebuild
 * now NEVER deletes a lorebookBindings row, full stop — every row
 * (bound, lore-referenced, token-referenced, or a true "ghost") survives
 * with its graph-enrichment fields reset to defaults. Deleting ghost rows
 * used to silently break narrativeGraphUndoMergeHandler (dangling
 * relationship-endpoint references, or a nulled-out survivorId disabling
 * undo entirely) since bindingMergeLogs references node ids as plain JSON
 * integers, not real foreign keys.
 *
 * This file also covers the companion fix: a replace-mode rebuild clears
 * the relationship-scoped fields (relationshipRewrites/deletedRelationships)
 * on every merge log for the lorebook, since the relationship layer they'd
 * reference is being wholesale replaced anyway — making undo afterward a
 * well-defined identity-only restore instead of best-effort/crash-prone.
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
		path.join(os.tmpdir(), "serene-pub-replacemode-int-test-")
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

describe("narrativeGraphApplyProposalHandler — replace mode (PGlite integration)", () => {
	test("bound, lore-referenced, token-referenced, and true ghost rows all survive with reset fields — no row count changes", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("replace-mode-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Replace Mode Book", userId: user.id })
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Bound Char", description: "" })
			.returning()

		// 1. Bound row — must survive.
		const [boundRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Bound Char",
				summary: "stale summary",
				nodeState: "deceased"
			})
			.returning()

		// 2. Referenced by a character-lore entry — must survive.
		const [loreReferencedRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:2}}",
				name: "Lore Referenced NPC",
				summary: "stale summary",
				nodeState: "missing"
			})
			.returning()
		await testDb.insert(schema.characterLoreEntries).values({
			lorebookId: lorebook.id,
			lorebookBindingId: loreReferencedRow.id,
			name: "Lore entry",
			content: "Some private lore.",
			keys: ""
		})

		// 3. Token still appears in stored content — must survive.
		const [tokenReferencedRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:3}}",
				name: "Token Referenced NPC",
				summary: "stale summary",
				nodeState: "departed"
			})
			.returning()
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "World entry",
			content: `Mentions ${tokenReferencedRow.binding} in passing.`,
			keys: ""
		})

		// 4. True ghost row — none of the above — must still survive (with
		// its graph-enrichment fields reset), not be deleted.
		const [ghostRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:4}}",
				name: "Ghost NPC",
				summary: "will be deleted"
			})
			.returning()

		const beforeCount = (
			await testDb.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
			})
		).length

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: { nodes: [], relationships: [] } as any,
				mode: "replace"
			},
			noopEmit
		)

		const remaining = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})
		const remainingIds = remaining.map((r) => r.id)

		// The invariant the comment now claims: a rebuild never deletes a
		// row, full stop — catches any future path that reintroduces a
		// delete under a new classification, not just this specific ghost.
		expect(remaining.length).toBe(beforeCount)

		expect(remainingIds).toContain(boundRow.id)
		expect(remainingIds).toContain(loreReferencedRow.id)
		expect(remainingIds).toContain(tokenReferencedRow.id)
		expect(remainingIds).toContain(ghostRow.id)

		const afterBound = remaining.find((r) => r.id === boundRow.id)!
		expect(afterBound.summary).toBeNull()
		expect(afterBound.nodeState).toBe("active")
		// The bound row's identity (characterId, binding token) is untouched —
		// only graph-enrichment fields reset.
		expect(afterBound.characterId).toBe(character.id)
		expect(afterBound.binding).toBe("{{char:1}}")

		const afterLoreReferenced = remaining.find(
			(r) => r.id === loreReferencedRow.id
		)!
		expect(afterLoreReferenced.summary).toBeNull()
		expect(afterLoreReferenced.nodeState).toBe("active")

		const afterTokenReferenced = remaining.find(
			(r) => r.id === tokenReferencedRow.id
		)!
		expect(afterTokenReferenced.summary).toBeNull()
		expect(afterTokenReferenced.nodeState).toBe("active")

		const afterGhost = remaining.find((r) => r.id === ghostRow.id)!
		expect(afterGhost.summary).toBeNull()
		expect(afterGhost.nodeState).toBe("active")
	})

	test("clears the relationship-scoped fields on prior merge logs for the lorebook, making undo add zero relationship rows", async () => {
		const {
			narrativeGraphApplyProposalHandler,
			narrativeGraphUndoMergeHandler
		} = await import("./narrativeGraph")
		const user = await makeUser("replace-mode-mergelog-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Replace Mode Merge Log Book", userId: user.id })
			.returning()
		const [survivor] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:1}}",
				name: "Survivor"
			})
			.returning()

		const [log] = await testDb
			.insert(schema.bindingMergeLogs)
			.values({
				lorebookId: lorebook.id,
				userId: user.id,
				survivorId: survivor.id,
				absorbedSnapshot: {
					id: 999999,
					lorebookId: lorebook.id,
					binding: "{{char:2}}",
					name: "Absorbed",
					characterId: null,
					personaId: null,
					aliases: [],
					absorbedAliases: [],
					summary: null,
					nodeState: "active",
					nodeVisibility: "normal",
					parentNodeId: null,
					sceneId: null,
					historyEntryId: null,
					embedding: null,
					embeddingModel: null,
					vectorizedAt: null,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				},
				relationshipRewrites: [
					{ id: 12345, oldFromNodeId: 999999, oldToNodeId: survivor.id }
				],
				deletedRelationships: [
					{
						id: 67890,
						lorebookId: lorebook.id,
						fromNodeId: 999999,
						toNodeId: survivor.id,
						relationshipType: "ally",
						description: "",
						visibility: "acknowledged",
						status: "active",
						reason: null,
						historyEntryId: null,
						sceneId: null,
						embedding: null,
						embeddingModel: null,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					}
				],
				reassignedCharacterLoreEntryIds: [],
				reassignedChildNodeIds: []
			})
			.returning()

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: { nodes: [], relationships: [] } as any,
				mode: "replace"
			},
			noopEmit
		)

		const afterRebuild = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.id, log.id)
		})
		expect(afterRebuild?.relationshipRewrites).toEqual([])
		expect(afterRebuild?.deletedRelationships).toEqual([])

		const relCountBefore = (
			await testDb.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
			})
		).length

		const res = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log.id },
			noopEmit
		)
		expect(res.restoredNode.name).toBe("Absorbed")

		const relCountAfter = (
			await testDb.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
			})
		).length
		expect(relCountAfter).toBe(relCountBefore)
	})
})
