/**
 * Indexing progress is Activity's (playtest 2, §0-C): an indexed lorebook
 * entry raises or moves one `lorebook_indexing` activity for its book, seen by
 * the book's owner and by administrators; the last entry indexed, or the lane
 * going idle, ends it. `lorebookIndexCounts` is the one counter
 * `vectorization:checkRagStatus` also reads.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { activityStore } from "$lib/server/utils/activityStore"
import {
	seedEntryVectors,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import { lorebookIndexCounts, tellIndexingActivity } from "./indexingActivity"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
beforeAll(async () => {
	db = await createTestDb()
}, 120_000)

afterEach(() => {
	activityStore.endAllLorebookIndexing()
})

const MODEL = "test-model"

async function book(
	userId: number,
	name: string,
	entries: number,
	indexed: number
) {
	const [lb] = await db
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	const rows = entries
		? await db
				.insert(schema.lorebookEntries)
				.values(
					worldLoreValues(
						Array.from({ length: entries }, (_, i) => ({
							lorebookId: lb!.id,
							name: `E${i}`,
							content: `Entry ${i}.`
						}))
					)
				)
				.returning()
		: []
	await seedEntryVectors(
		db,
		rows.slice(0, indexed).map((e: any) => e.id),
		[1, 0, 0],
		MODEL
	)
	return { lb: lb!, entryIds: rows.map((e: any) => e.id) as number[] }
}

const item = (lorebookId: number, type = "worldLore") => ({
	type,
	id: 1,
	lorebookId,
	embeddingModel: MODEL,
	vectorizedAt: new Date().toISOString()
})
const tell = (lorebookId: number, type?: string) =>
	tellIndexingActivity(
		db,
		"vectorization:itemUpdated",
		item(lorebookId, type)
	)
const indexing = (userId: number, isAdmin = false) =>
	activityStore
		.getFor(userId, isAdmin)
		.filter((a) => a.kind === "lorebook_indexing") as any[]

describe("lorebookIndexCounts", () => {
	test("splits entries into not indexed, needs re-indexing and indexed", async () => {
		const u = await createTestUser(db, "idx-counts")
		const { lb, entryIds } = await book(u.id, "Counts", 5, 3)
		expect(await lorebookIndexCounts(db, lb.id, MODEL)).toEqual({
			total: 5,
			nullCount: 2,
			staleCount: 0,
			readyCount: 3
		})
		expect(await lorebookIndexCounts(db, lb.id, "other-model")).toEqual({
			total: 5,
			nullCount: 2,
			staleCount: 3,
			readyCount: 0
		})
		expect(entryIds).toHaveLength(5)
	})
})

describe("indexing activity", () => {
	test("an indexed entry raises one activity for the book's owner, seen by the owner and administrators only", async () => {
		const a = await createTestUser(db, "idx-owner-a")
		const b = await createTestUser(db, "idx-other-b")
		const { lb } = await book(a.id, "Harbor", 27, 26)
		await tell(lb.id)
		const mine = indexing(a.id)
		expect(mine).toHaveLength(1)
		expect(mine[0]).toMatchObject({
			userId: a.id,
			lorebookId: lb.id,
			lorebookLabel: "Harbor",
			status: "running",
			indexedCount: 26,
			total: 27
		})
		expect(indexing(b.id)).toHaveLength(0)
		expect(indexing(b.id, true)).toHaveLength(1)
	})

	test("a burst of events leaves one activity per book, on the latest counts", async () => {
		const u = await createTestUser(db, "idx-burst")
		const x = await book(u.id, "Burst X", 6, 2)
		const y = await book(u.id, "Burst Y", 4, 1)
		await Promise.all([
			tell(x.lb.id),
			tell(x.lb.id),
			tell(y.lb.id),
			tell(x.lb.id),
			tell(y.lb.id)
		])
		const all = indexing(u.id)
		expect(all).toHaveLength(2)
		expect(all.find((a) => a.lorebookId === x.lb.id)).toMatchObject({
			indexedCount: 2,
			total: 6
		})
		expect(all.find((a) => a.lorebookId === y.lb.id)).toMatchObject({
			indexedCount: 1,
			total: 4
		})
		// More arrive; the same activity moves.
		const id = all[0].id
		await seedEntryVectors(db, [x.entryIds[2]!], [1, 0, 0], MODEL)
		await tell(x.lb.id)
		const moved = indexing(u.id).find((a) => a.lorebookId === x.lb.id)
		expect(moved.indexedCount).toBe(3)
		expect(indexing(u.id)).toHaveLength(2)
		expect([id, moved.id]).toContain(moved.id)
	})

	test("the last entry indexed ends it", async () => {
		const u = await createTestUser(db, "idx-done")
		const { lb, entryIds } = await book(u.id, "Done", 3, 2)
		await tell(lb.id)
		expect(indexing(u.id)).toHaveLength(1)
		await seedEntryVectors(db, [entryIds[2]!], [1, 0, 0], MODEL)
		await tell(lb.id)
		expect(indexing(u.id)).toHaveLength(0)
	})

	test("the lane going idle ends every open one", async () => {
		const u = await createTestUser(db, "idx-idle")
		const { lb } = await book(u.id, "Idle", 3, 1)
		await tell(lb.id)
		expect(indexing(u.id)).toHaveLength(1)
		await tellIndexingActivity(db, "vectorization:progress", {
			status: "running"
		})
		expect(indexing(u.id)).toHaveLength(1)
		await tellIndexingActivity(db, "vectorization:progress", {
			status: "idle"
		})
		expect(indexing(u.id)).toHaveLength(0)
	})

	test("a recount still counting when the lane goes idle raises no card afterwards", async () => {
		const u = await createTestUser(db, "idx-late")
		const { lb } = await book(u.id, "Late", 3, 1)
		// The recount starts (not awaited), the lane goes idle meanwhile, then the recount lands.
		const pending = tell(lb.id)
		await tellIndexingActivity(db, "vectorization:progress", { status: "idle" })
		await pending
		expect(indexing(u.id)).toHaveLength(0)
	})

	test("other items and other events change nothing", async () => {
		const u = await createTestUser(db, "idx-ignored")
		const { lb } = await book(u.id, "Ignored", 3, 1)
		await tell(lb.id, "narrativeNode")
		await tell(lb.id, "message")
		await tellIndexingActivity(db, "vectorization:itemUpdated", {
			...item(lb.id),
			lorebookId: undefined
		})
		await tellIndexingActivity(db, "something:else", item(lb.id))
		expect(indexing(u.id)).toHaveLength(0)
	})

	test("Stop from Activity does nothing for indexing", async () => {
		const u = await createTestUser(db, "idx-cancel")
		const { lb } = await book(u.id, "Cancel", 3, 1)
		await tell(lb.id)
		activityStore.cancel(indexing(u.id)[0].id)
		expect(indexing(u.id)).toHaveLength(1)
	})
})
