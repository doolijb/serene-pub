/**
 * Consolidating-absorb regression (replaces the old parentNodeId-tagging
 * merge — see the "Replace node merging with prevention + a real
 * consolidating absorb" plan). The guard/auto-swap rules carry over from
 * the old merge-node semantics; everything else here is new: absorb must
 * actually rewrite every reference onto the survivor, not just tag one row
 * as a cosmetic alias of another, and the whole operation must be
 * reversible via the audit log it writes.
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
		path.join(os.tmpdir(), "serene-pub-absorb-int-test-")
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

async function makeRelationship(
	lorebookId: number,
	fromNodeId: number,
	toNodeId: number,
	overrides: Partial<typeof schema.narrativeRelationships.$inferInsert> = {}
) {
	const [rel] = await testDb
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromNodeId,
			toNodeId,
			relationshipType: "ally",
			...overrides
		})
		.returning()
	return rel
}

async function makeLorebookWithBoundAndUnbound(username: string) {
	const user = await makeUser(username)
	const lorebook = await makeLorebook(user.id, "Absorb Test Book")
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Real Character", description: "" })
		.returning()
	const bound = await makeBinding(lorebook.id, {
		characterId: character.id,
		binding: "{{char:1}}",
		name: "Real Character"
	})
	const unbound = await makeBinding(lorebook.id, {
		binding: "{{char:2}}",
		name: "Ghost NPC"
	})
	return { user, lorebook, character, bound, unbound }
}

describe("narrativeGraphMergeNodeHandler — absorb (PGlite integration)", () => {
	test("refuses to absorb two rows that are both bound to a real character/persona", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("absorb-both-bound-user")
		const lorebook = await makeLorebook(user.id, "Both Bound Book")
		const [charA] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Char A", description: "" })
			.returning()
		const [charB] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Char B", description: "" })
			.returning()
		const bindingA = await makeBinding(lorebook.id, {
			characterId: charA.id,
			binding: "{{char:1}}",
			name: "Char A"
		})
		const bindingB = await makeBinding(lorebook.id, {
			characterId: charB.id,
			binding: "{{char:2}}",
			name: "Char B"
		})

		await expect(
			narrativeGraphMergeNodeHandler.handler(
				fakeSocket(user.id),
				{ nodeId: bindingA.id, parentNodeId: bindingB.id },
				noopEmit
			)
		).rejects.toThrow(/both linked to character bindings/)
	})

	test("refuses to merge a node with itself", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("absorb-self-merge-user")
		const lorebook = await makeLorebook(user.id, "Self Merge Book")
		const node = await makeBinding(lorebook.id, { name: "Solo" })

		await expect(
			narrativeGraphMergeNodeHandler.handler(
				fakeSocket(user.id),
				{ nodeId: node.id, parentNodeId: node.id },
				noopEmit
			)
		).rejects.toThrow(/cannot merge a node with itself/i)

		// The node must still exist, untouched.
		const stillThere = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, node.id)
		})
		expect(stillThere).toBeDefined()
	})

	test("reparents alias-children of the absorbed row onto the survivor, instead of orphaning them", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("absorb-reparent-user")
		const lorebook = await makeLorebook(user.id, "Reparent Book")
		const survivor = await makeBinding(lorebook.id, { name: "Survivor" })
		const absorbed = await makeBinding(lorebook.id, { name: "Absorbed" })
		const child = await makeBinding(lorebook.id, {
			name: "Alias Child",
			parentNodeId: absorbed.id
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)

		const afterChild = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, child.id)
		})
		// Without the fix, the FK's onDelete:"set null" would silently
		// orphan this row instead of reparenting it.
		expect(afterChild?.parentNodeId).toBe(survivor.id)

		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.survivorId, survivor.id)
		})
		expect(log?.reassignedChildNodeIds).toEqual([child.id])
	})

	test("auto-swaps so the bound row survives, even when passed as the child argument — the absorbed row is deleted, not tagged", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-swap-user")

		const res = await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: bound.id, parentNodeId: unbound.id },
			noopEmit
		)

		expect(res.survivorNode.id).toBe(bound.id)

		const afterUnbound = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, unbound.id)
		})
		expect(afterUnbound).toBeUndefined() // deleted, not tagged

		const afterBound = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bound.id)
		})
		expect(afterBound?.characterId).not.toBeNull() // untouched identity
	})

	test("does not swap when the bound row is already passed as the survivor argument", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-noswap-user")

		const res = await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		expect(res.survivorNode.id).toBe(bound.id)
	})

	test("rewrites a relationship from the absorbed row onto the survivor", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-rewrite-user")
		const thirdParty = await makeBinding(lorebook.id, {
			binding: "{{char:3}}",
			name: "Third Party"
		})
		const rel = await makeRelationship(
			lorebook.id,
			unbound.id,
			thirdParty.id,
			{ description: "trusts them" }
		)

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const afterRel = await testDb.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, rel.id)
		})
		expect(afterRel?.fromNodeId).toBe(bound.id)
		expect(afterRel?.toNodeId).toBe(thirdParty.id)
	})

	test("deletes a relationship that becomes a self-loop after the rewrite", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-selfloop-user")
		const rel = await makeRelationship(lorebook.id, unbound.id, bound.id, {
			description: "the ghost trusts the real one"
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const afterRel = await testDb.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, rel.id)
		})
		expect(afterRel).toBeUndefined()

		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.survivorId, bound.id),
			orderBy: (l, { desc }) => desc(l.id)
		})
		expect(
			(log?.deletedRelationships as any[]).some((r) => r.id === rel.id)
		).toBe(true)
	})

	test("dedupes against a pre-existing survivor relationship of the same type+direction, keeping the more complete one", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-dedup-user")
		const thirdParty = await makeBinding(lorebook.id, {
			binding: "{{char:3}}",
			name: "Third Party"
		})
		// Survivor already has a relationship to thirdParty; absorbed row has
		// its own (shorter description) relationship to the same thirdParty,
		// same type — these become duplicates of each other after rewrite.
		const survivorRel = await makeRelationship(
			lorebook.id,
			bound.id,
			thirdParty.id,
			{ description: "a long and detailed description of the bond" }
		)
		const absorbedRel = await makeRelationship(
			lorebook.id,
			unbound.id,
			thirdParty.id,
			{ description: "short" }
		)

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const remaining = await testDb.query.narrativeRelationships.findMany({
			where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
		})
		expect(remaining).toHaveLength(1)
		expect(remaining[0].id).toBe(survivorRel.id)
		expect(remaining[0].description).toBe(
			"a long and detailed description of the bond"
		)
	})

	test("reassigns character-lore entries from the absorbed row to the survivor", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-lore-user")
		const [lore] = await testDb
			.insert(schema.characterLoreEntries)
			.values({
				lorebookId: lorebook.id,
				lorebookBindingId: unbound.id,
				name: "Secret",
				content: "A secret about the ghost.",
				keys: ""
			})
			.returning()

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const afterLore = await testDb.query.characterLoreEntries.findFirst({
			where: eq(schema.characterLoreEntries.id, lore.id)
		})
		expect(afterLore?.lorebookBindingId).toBe(bound.id)
	})

	test("rewrites scene participant/mentioned arrays that reference the absorbed id", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-scene-user")
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: lorebook.id,
				historyEntryId: historyEntry.id,
				participantCharacters: [unbound.id, bound.id],
				mentionedCharacters: [unbound.id]
			})
			.returning()

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const afterScene = await testDb.query.scenes.findFirst({
			where: eq(schema.scenes.id, scene.id)
		})
		// Deduped — bound.id was already present alongside the rewritten
		// unbound.id -> bound.id, must not appear twice.
		expect(afterScene?.participantCharacters).toEqual([bound.id])
		expect(afterScene?.mentionedCharacters).toEqual([bound.id])
	})

	test("appends the absorbed identity to absorbedAliases (not aliases) — survives a subsequent character sync", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { charactersUpdate } = await import("./characters")
		const { user, lorebook, character, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-alias-sync-user")

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const afterMerge = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bound.id)
		})
		expect(afterMerge?.absorbedAliases).toContain("Ghost NPC")
		expect(afterMerge?.aliases ?? []).not.toContain("Ghost NPC")

		// A later, unrelated edit to the bound character runs
		// syncLorebookBindingsForCharacter, which fully replaces `aliases`.
		// If "Ghost NPC" had been written into `aliases` directly, it would
		// vanish here — the entire reason absorbedAliases exists.
		await charactersUpdate.handler(
			fakeSocket(user.id),
			{ character: { id: character.id, name: "Real Character" } as any },
			noopEmit
		)

		const afterSync = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bound.id)
		})
		expect(afterSync?.absorbedAliases).toContain("Ghost NPC")
	})

	test("nulls the survivor's vectorizedAt/embedding after absorb", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, bound, unbound } = await makeLorebookWithBoundAndUnbound(
			"absorb-vector-user"
		)
		await testDb
			.update(schema.lorebookBindings)
			.set({
				embedding: [0.1, 0.2],
				embeddingModel: "test-model",
				vectorizedAt: new Date()
			})
			.where(eq(schema.lorebookBindings.id, bound.id))

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const after = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bound.id)
		})
		expect(after?.embedding).toBeNull()
		expect(after?.embeddingModel).toBeNull()
		expect(after?.vectorizedAt).toBeNull()
	})

	test("writes an audit log entry capturing the absorbed snapshot", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("absorb-auditlog-user")

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)

		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebook.id)
		})
		expect(log).toBeDefined()
		expect(log?.survivorId).toBe(bound.id)
		expect((log?.absorbedSnapshot as any).id).toBe(unbound.id)
		expect((log?.absorbedSnapshot as any).binding).toBe("{{char:2}}")
	})
})

describe("narrativeGraphUndoMergeHandler (PGlite integration)", () => {
	test("restores the absorbed row verbatim, including its exact original binding token", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("undo-token-user")

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)
		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebook.id)
		})

		const res = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log!.id },
			noopEmit
		)

		expect(res.restoredNode.binding).toBe("{{char:2}}")
		expect(res.restoredNode.name).toBe("Ghost NPC")
		expect(res.restoredNode.id).not.toBe(unbound.id) // new primary key

		const logAfterUndo = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.id, log!.id)
		})
		expect(logAfterUndo).toBeUndefined() // consumed
	})

	test("restores relationships, scenes, character lore, and absorbedAliases on undo", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("undo-full-user")
		const thirdParty = await makeBinding(lorebook.id, {
			binding: "{{char:3}}",
			name: "Third Party"
		})
		const rel = await makeRelationship(
			lorebook.id,
			unbound.id,
			thirdParty.id,
			{ description: "trusts them" }
		)
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: lorebook.id,
				historyEntryId: historyEntry.id,
				participantCharacters: [unbound.id],
				mentionedCharacters: []
			})
			.returning()
		const [lore] = await testDb
			.insert(schema.characterLoreEntries)
			.values({
				lorebookId: lorebook.id,
				lorebookBindingId: unbound.id,
				name: "Secret",
				content: "A secret.",
				keys: ""
			})
			.returning()

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)
		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebook.id)
		})

		const res = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log!.id },
			noopEmit
		)
		const restoredId = res.restoredNode.id

		const afterRel = await testDb.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, rel.id)
		})
		expect(afterRel?.fromNodeId).toBe(restoredId)
		expect(afterRel?.toNodeId).toBe(thirdParty.id)

		const afterScene = await testDb.query.scenes.findFirst({
			where: eq(schema.scenes.id, scene.id)
		})
		expect(afterScene?.participantCharacters).toEqual([restoredId])

		const afterLore = await testDb.query.characterLoreEntries.findFirst({
			where: eq(schema.characterLoreEntries.id, lore.id)
		})
		expect(afterLore?.lorebookBindingId).toBe(restoredId)

		const afterSurvivor = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bound.id)
		})
		expect(afterSurvivor?.absorbedAliases ?? []).not.toContain("Ghost NPC")
	})

	test("restores a reparented alias-child's parentNodeId back to the recreated row on undo", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const user = await makeUser("undo-reparent-user")
		const lorebook = await makeLorebook(user.id, "Undo Reparent Book")
		const survivor = await makeBinding(lorebook.id, { name: "Survivor" })
		const absorbed = await makeBinding(lorebook.id, { name: "Absorbed" })
		const child = await makeBinding(lorebook.id, {
			name: "Alias Child",
			parentNodeId: absorbed.id
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.survivorId, survivor.id)
		})

		const res = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log!.id },
			noopEmit
		)
		const restoredId = res.restoredNode.id

		const afterChild = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, child.id)
		})
		expect(afterChild?.parentNodeId).toBe(restoredId)
	})

	test("re-inserts a relationship that was deleted as a self-loop during absorb", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("undo-selfloop-user")
		await makeRelationship(lorebook.id, unbound.id, bound.id, {
			description: "the ghost trusts the real one"
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)
		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebook.id)
		})

		const res = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log!.id },
			noopEmit
		)

		const restored = await testDb.query.narrativeRelationships.findMany({
			where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
		})
		expect(restored).toHaveLength(1)
		expect(restored[0].fromNodeId).toBe(res.restoredNode.id)
		expect(restored[0].toNodeId).toBe(bound.id)
		expect(restored[0].description).toBe(
			"the ghost trusts the real one"
		)
	})

	test("refuses to undo once the survivor is gone", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const { user, lorebook, bound, unbound } =
			await makeLorebookWithBoundAndUnbound("undo-gone-survivor-user")

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: unbound.id, parentNodeId: bound.id },
			noopEmit
		)
		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebook.id)
		})

		// Survivor is deleted entirely (e.g. the character was removed).
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, bound.id))

		await expect(
			narrativeGraphUndoMergeHandler.handler(
				fakeSocket(user.id),
				{ mergeLogId: log!.id },
				noopEmit
			)
		).rejects.toThrow(/can no longer be undone/)
	})
})
