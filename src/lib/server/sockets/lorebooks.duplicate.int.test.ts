/**
 * `lorebooks:duplicate` — a copy of a book, made by the export/import pair.
 *
 * The copy holds what a file holds: entries with their anchors, bindings,
 * edges of both endpoint kinds, scenes and their cast. Annotations and
 * embeddings are derived, so they are absent until the things that derive them
 * run. Owner only, the same rule as delete.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import { loadBookEntries } from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lb-duplicate-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/** A book with one of everything a copy has to carry. */
async function seedBook(userId: number, name: string) {
	const { lorebooksCreateHandler } = await import("./lorebooks")
	const { lorebook } = await lorebooksCreateHandler.handler(
		fakeSocket(userId),
		{ name },
		noopEmit
	)

	const [city] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{ lorebookId: lorebook.id, name: "City", content: "A city." }
			])
		)
		.returning()
	const [district] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "District",
					content: "A district.",
					anchorEntryId: city.id
				}
			])
		)
		.returning()
	const [chapter] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: lorebook.id,
					content: "The founding.",
					year: 1200
				}
			])
		)
		.returning()

	const [keeper] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{char:1}}",
			name: "Keeper"
		})
		.returning()

	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			historyEntryId: chapter.id,
			name: "The meeting",
			summary: "They meet.",
			selectedMessageIds: []
		})
		.returning()
	await testDb.insert(schema.sceneCharacters).values({
		sceneId: scene.id,
		bindingId: keeper.id,
		role: "participant",
		ordinal: 0
	})

	await testDb.insert(schema.narrativeRelationships).values([
		{
			lorebookId: lorebook.id,
			fromNodeId: keeper.id,
			toEntryId: district.id,
			relationshipType: "keeper of",
			description: "cast to entry"
		},
		{
			lorebookId: lorebook.id,
			fromEntryId: district.id,
			toEntryId: city.id,
			relationshipType: "connects to",
			description: "entry to entry"
		}
	])

	return { lorebook, city, district, chapter, keeper, scene }
}

describe("lorebooks:duplicate (PGlite integration)", () => {
	test("copies entries, bindings, scenes and both endpoint kinds, under new ids", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const user = await makeUser("lb-dup-owner")
		const source = await seedBook(user.id, "Source Book")

		const emitted: string[] = []
		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: source.lorebook.id },
			(event: string) => emitted.push(event)
		)

		expect(copy.id).not.toBe(source.lorebook.id)
		expect(copy.name).toBe("Source Book (copy)")
		expect(copy.uuid).not.toBe(source.lorebook.uuid)
		expect(emitted).toContain("lorebooks:list")
		expect(emitted).toContain("lorebooks:duplicate")

		const sourceEntries = await loadBookEntries(testDb, source.lorebook.id)
		const copyEntries = await loadBookEntries(testDb, copy.id)
		expect(copyEntries).toHaveLength(sourceEntries.length)
		const copyEntryIds = new Set(copyEntries.map((e) => e.id))
		for (const entry of copyEntries)
			expect(sourceEntries.some((e) => e.id === entry.id)).toBe(false)

		const byName = new Map(copyEntries.map((e) => [e.name, e]))
		expect(byName.get("District")!.anchorEntryId).toBe(
			byName.get("City")!.id
		)

		const copyBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, copy.id)
		})
		expect(copyBindings.map((b) => b.name)).toEqual(["Keeper"])
		const copyBindingIds = new Set(copyBindings.map((b) => b.id))
		expect(copyBindingIds.has(source.keeper.id)).toBe(false)

		const copyScenes = await testDb.query.scenes.findMany({
			where: (s, { eq }) => eq(s.lorebookId, copy.id),
			with: { characters: true }
		})
		expect(copyScenes).toHaveLength(1)
		expect(copyScenes[0].name).toBe("The meeting")
		expect(copyScenes[0].characters.map((c: any) => c.bindingId)).toEqual([
			copyBindings[0].id
		])

		const copyEdges = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, copy.id)
		})
		expect(copyEdges.map((r) => r.relationshipType).sort()).toEqual([
			"connects to",
			"keeper of"
		])
		for (const edge of copyEdges) {
			for (const entryId of [edge.fromEntryId, edge.toEntryId])
				if (entryId !== null)
					expect(copyEntryIds.has(entryId)).toBe(true)
			for (const nodeId of [edge.fromNodeId, edge.toNodeId])
				if (nodeId !== null)
					expect(copyBindingIds.has(nodeId)).toBe(true)
		}

		// The source is untouched by its own copy.
		const sourceEdges = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, source.lorebook.id)
		})
		expect(sourceEdges).toHaveLength(2)
	}, 60_000)

	test("takes the name it is given", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const user = await makeUser("lb-dup-named")
		const source = await seedBook(user.id, "Named Source")

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: source.lorebook.id, name: "Second Draft" },
			noopEmit
		)
		expect(copy.name).toBe("Second Draft")
	}, 60_000)

	test("refuses a book the caller does not own", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("lb-dup-other-owner")
		const stranger = await makeUser("lb-dup-stranger")
		const source = await seedBook(owner.id, "Private Book")

		await expect(
			lorebooksDuplicateHandler.handler(
				fakeSocket(stranger.id),
				{ lorebookId: source.lorebook.id },
				noopEmit
			)
		).rejects.toThrow(/not found/i)

		const strangerBooks = await testDb.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, stranger.id)
		})
		expect(strangerBooks).toHaveLength(0)
	}, 60_000)
})
