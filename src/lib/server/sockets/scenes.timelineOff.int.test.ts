/**
 * Compile and history filing on a lorebook whose timeline is off
 * (`lorebooks/timeline.ts`): a by-date compile, an entry compile and a scene
 * filed under a history day are refused with the history sentence, and nothing
 * is made; a scene with no day is saved as ever.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scenes-timeline-off-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const existing = await testDb.query.systemSettings.findFirst()
	if (!existing) await testDb.insert(schema.systemSettings).values({} as any)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

async function seed(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, username)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			name: "No timeline",
			userId: owner.id,
			timelineEnabled: false
		})
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: book!.id,
					year: 1,
					content: "The caravan set out."
				} as any
			])
		)
		.returning()
	return { owner, book: book!, entry: entry! }
}

const counts = async (bookId: number) => ({
	entries: (
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
	).length,
	scenes: (
		await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, bookId))
	).length
})

describe("compile and history filing with the timeline off", () => {
	test("a by-date compile is refused with the history sentence and makes nothing", async () => {
		const w = await seed("scenes-timeline-off-date")
		const { sceneCompileHandler } = await import("./scenes")
		const before = await counts(w.book.id)
		const emitted: Array<[string, any]> = []
		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{
					lorebookId: w.book.id,
					date: { year: 2, month: null, day: null },
					requestId: "r1"
				} as any,
				(event: string, data: any) => emitted.push([event, data])
			)
		).rejects.toThrow(TIMELINE_OFF_SENTENCES.history)
		expect(emitted).toContainEqual([
			"scenes:compile:error",
			{ requestId: "r1", error: TIMELINE_OFF_SENTENCES.history }
		])
		expect(await counts(w.book.id)).toEqual(before)
	})

	test("an entry compile is refused with the history sentence and starts nothing", async () => {
		const w = await seed("scenes-timeline-off-entry")
		const { sceneCompileHandler } = await import("./scenes")
		const emitted: Array<[string, any]> = []
		await expect(
			sceneCompileHandler.handler(
				fakeSocket(w.owner.id),
				{
					historyEntryId: w.entry.id,
					branchId: null,
					moment: null
				} as any,
				(event: string, data: any) => emitted.push([event, data])
			)
		).rejects.toThrow()
		expect(emitted).toContainEqual([
			"scenes:compile:error",
			{
				historyEntryId: w.entry.id,
				error: TIMELINE_OFF_SENTENCES.history
			}
		])
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		expect(
			activityStore
				.getFor(w.owner.id, false)
				.find((a) => (a as any).historyEntryId === w.entry.id)
		).toBeUndefined()
	})

	test("a scene filed under a history day is refused; one with no day is saved", async () => {
		const w = await seed("scenes-timeline-off-create")
		const { sceneCreateHandler } = await import("./scenes")
		const before = await counts(w.book.id)
		await expect(
			sceneCreateHandler.handler(
				fakeSocket(w.owner.id),
				{
					scene: {
						lorebookId: w.book.id,
						historyEntryId: w.entry.id,
						name: "Filed",
						summary: "Filed."
					}
				} as any,
				() => {}
			)
		).rejects.toThrow(TIMELINE_OFF_SENTENCES.history)
		expect(await counts(w.book.id)).toEqual(before)
		await sceneCreateHandler.handler(
			fakeSocket(w.owner.id),
			{
				scene: {
					lorebookId: w.book.id,
					name: "Unfiled",
					summary: "Unfiled."
				}
			} as any,
			() => {}
		)
		expect((await counts(w.book.id)).scenes).toBe(before.scenes + 1)
	})
})
