/**
 * Existing graphs predate the historyEntryId fix, so every scene-derived
 * relationship in them carries a null date and cannot be placed on a timeline.
 * The association is recoverable exactly — the relationship records its scene,
 * and the scene records its entry.
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-gbf-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("backfillRelationshipHistoryEntries", () => {
	test("fills nulls from the scene, leaves existing dates alone, and is idempotent", async () => {
		const { backfillRelationshipHistoryEntries } = await import(
			"./graphBackfill"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "graph-backfill-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "LB" })
			.returning()
		const [entryA] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id, year: 200, content: "A" })
			.returning()
		const [entryB] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id, year: 300, content: "B" })
			.returning()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({ lorebookId: lorebook.id, historyEntryId: entryA.id })
			.returning()
		const [n1, n2] = await testDb
			.insert(schema.lorebookBindings)
			.values([
				{ lorebookId: lorebook.id, name: "N1", binding: "{{char:1}}" },
				{ lorebookId: lorebook.id, name: "N2", binding: "{{char:2}}" }
			])
			.returning()

		const rel = (
			historyEntryId: number | null,
			sceneId: number | null
		) => ({
			lorebookId: lorebook.id,
			fromNodeId: n1.id,
			toNodeId: n2.id,
			relationshipType: "ally",
			sceneId,
			historyEntryId
		})
		const [needsFill, alreadySet, noScene] = await testDb
			.insert(schema.narrativeRelationships)
			.values([
				rel(null, scene.id), // the common case
				rel(entryB.id, scene.id), // must NOT be overwritten
				rel(null, null) // nothing to derive from
			])
			.returning()

		const filled = await backfillRelationshipHistoryEntries(testDb as any)
		expect(filled).toBeGreaterThanOrEqual(1)

		const reread = async (id: number) =>
			testDb.query.narrativeRelationships.findFirst({
				where: eq(schema.narrativeRelationships.id, id)
			})
		expect((await reread(needsFill.id))!.historyEntryId).toBe(entryA.id)
		// An explicitly-set date is never clobbered by an inferred one.
		expect((await reread(alreadySet.id))!.historyEntryId).toBe(entryB.id)
		expect((await reread(noScene.id))!.historyEntryId).toBeNull()

		// Idempotent: a second boot matches nothing.
		expect(await backfillRelationshipHistoryEntries(testDb as any)).toBe(0)
	})
})
