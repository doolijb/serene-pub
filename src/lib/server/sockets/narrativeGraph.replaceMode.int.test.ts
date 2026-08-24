/**
 * Replace-mode never-delete, never-reset regression (merge plan, "Design
 * decision — replace-mode graph rebuild", later tightened to drop ghost-row
 * deletion entirely, then tightened again to drop the field-reset/merge-log
 * clearing that replaced it): post-merge a binding IS the character's
 * identity/privacy anchor, so a wholesale delete-and-rebuild of every graph
 * row (the old narrativeNodes behavior) would destroy real character data.
 * A rebuild now NEVER deletes a lorebookBindings row, full stop, and never
 * touches its existing fields either — nothing downstream of a fresh build
 * ever writes fresh values back onto an existing binding (see
 * graphBuilder.ts's header and narrativeGraph.ts's applyProposal), so a
 * previous "reset to defaults" behavior was pure data loss with no refill:
 * a real merge hierarchy in parentNodeId, a past merge's restorable
 * relationship content in bindingMergeLogs. Both are left untouched now.
 *
 * The relationship layer itself is still safe to wipe wholesale on replace
 * (proposal.relationships is genuinely freshly derived) — that part is
 * unchanged and still covered below.
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
	test("bound, lore-referenced, token-referenced, and true ghost rows all survive with their existing fields untouched — no row count changes, no field resets", async () => {
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

		// A real merge hierarchy — must survive a rebuild (Bug B: this used to
		// get silently reset to null, un-merging previously-merged identities
		// with no refill and no visible error).
		const [parentRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:0}}",
				name: "Parent NPC"
			})
			.returning()

		// 1. Bound row — must survive, fields untouched.
		const [boundRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Bound Char",
				summary: "existing summary",
				nodeState: "deceased",
				parentNodeId: parentRow.id
			})
			.returning()

		// 2. Referenced by a character-lore entry — must survive.
		const [loreReferencedRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:2}}",
				name: "Lore Referenced NPC",
				summary: "existing summary",
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
				summary: "existing summary",
				nodeState: "departed"
			})
			.returning()
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "World entry",
			content: `Mentions ${tokenReferencedRow.binding} in passing.`,
			keys: ""
		})

		// 4. True ghost row — none of the above — must still survive, fields
		// untouched, not be deleted.
		const [ghostRow] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:4}}",
				name: "Ghost NPC",
				summary: "existing summary"
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

		// The invariant: a rebuild never deletes a row, full stop — catches
		// any future path that reintroduces a delete under a new
		// classification, not just this specific ghost.
		expect(remaining.length).toBe(beforeCount)

		expect(remainingIds).toContain(boundRow.id)
		expect(remainingIds).toContain(loreReferencedRow.id)
		expect(remainingIds).toContain(tokenReferencedRow.id)
		expect(remainingIds).toContain(ghostRow.id)

		// Nothing downstream of a build ever refills these fields for an
		// existing binding — resetting them was pure data loss, so a rebuild
		// must leave them exactly as they were.
		const afterBound = remaining.find((r) => r.id === boundRow.id)!
		expect(afterBound.summary).toBe("existing summary")
		expect(afterBound.nodeState).toBe("deceased")
		expect(afterBound.parentNodeId).toBe(parentRow.id)
		expect(afterBound.characterId).toBe(character.id)
		expect(afterBound.binding).toBe("{{char:1}}")

		const afterLoreReferenced = remaining.find(
			(r) => r.id === loreReferencedRow.id
		)!
		expect(afterLoreReferenced.summary).toBe("existing summary")
		expect(afterLoreReferenced.nodeState).toBe("missing")

		const afterTokenReferenced = remaining.find(
			(r) => r.id === tokenReferencedRow.id
		)!
		expect(afterTokenReferenced.summary).toBe("existing summary")
		expect(afterTokenReferenced.nodeState).toBe("departed")

		const afterGhost = remaining.find((r) => r.id === ghostRow.id)!
		expect(afterGhost.summary).toBe("existing summary")
	})

	test("leaves prior merge logs' relationship-scoped fields untouched, so undo can still restore a relationship a merge deleted", async () => {
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
				// References a relationship row that no longer exists — this
				// restore loop is a plain UPDATE by id, so it's a harmless
				// no-op regardless of whether the wholesale wipe below ran.
				relationshipRewrites: [
					{
						id: 12345,
						oldFromNodeId: 999999,
						oldToNodeId: survivor.id
					}
				],
				// The one that actually matters: this restore loop is a fresh
				// INSERT built from the merge's own recorded content, with only
				// its endpoints remapped onto current (still-live) binding ids
				// — it never references the deleted row's id, so it's fully
				// restorable regardless of the wholesale relationship wipe
				// below, as long as this field itself survives the rebuild.
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

		// The fix: replace mode no longer clears these fields to `[]`.
		const afterRebuild = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.id, log.id)
		})
		expect(afterRebuild?.relationshipRewrites).toEqual([
			{ id: 12345, oldFromNodeId: 999999, oldToNodeId: survivor.id }
		])
		expect(afterRebuild?.deletedRelationships).toHaveLength(1)

		const relCountBefore = (
			await testDb.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
			})
		).length
		expect(relCountBefore).toBe(0)

		const res = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log.id },
			noopEmit
		)
		expect(res.restoredNode.name).toBe("Absorbed")

		// Under the old (bug) behavior, deletedRelationships would have been
		// cleared by the rebuild and undo would restore zero relationships
		// here. With the fix, the merge-deleted relationship comes back.
		const restoredRels = await testDb.query.narrativeRelationships.findMany(
			{
				where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
			}
		)
		expect(restoredRels).toHaveLength(1)
		expect(restoredRels[0].relationshipType).toBe("ally")
		expect(restoredRels[0].fromNodeId).toBe(res.restoredNode.id)
		expect(restoredRels[0].toNodeId).toBe(survivor.id)
	})
})
