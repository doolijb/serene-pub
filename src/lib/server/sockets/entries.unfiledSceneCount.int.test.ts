/**
 * 🚧 `unfiledSceneCount` on the history list's rows: how many not-yet-compiled
 * scenes a compile of the entry would take in — the date rule
 * (`historyEntryOfDate`) decides which entry a scene's day is filed under.
 * Projected on the wire only; a row without scenes carries no key.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import {
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-entries-unfiled-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `unfiled-count-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Unfiled Book ${seq}`, userId: user.id })
		.returning()
	const [day1, day2] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book.id, year: 3, month: 1, day: 1 } as any,
				{ lorebookId: book.id, year: 3, month: 1, day: 2 } as any
			])
		)
		.returning()
	return { book, day1, day2 }
}

const scene = async (
	bookId: number,
	day: number | null,
	extra: Partial<typeof schema.scenes.$inferInsert> = {}
) =>
	(
		await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: bookId,
				historyEntryId: null,
				name: "A scene",
				...(day == null
					? {}
					: {
							openedStoryClockYear: 3,
							openedStoryClockMonth: 1,
							openedStoryClockDay: day
						}),
				...extra
			} as any)
			.returning()
	)[0]

const listHistory = async (bookId: number) => {
	const { listEntryRows } = await import("./entries")
	return await listEntryRows(bookId, HISTORY_TYPE_ID)
}

describe("history rows carry unfiledSceneCount", () => {
	test("two unfiled scenes of an entry's day count 2; another day counts for its own entry; a filed scene is not counted; no scenes means no key", async () => {
		const w = await makeBook()
		await scene(w.book.id, 1)
		await scene(w.book.id, 1)
		await scene(w.book.id, 2, { historyEntryId: w.day2.id })
		const rows = await listHistory(w.book.id)
		const one = rows.find((r) => r.id === w.day1.id)!
		const two = rows.find((r) => r.id === w.day2.id)!
		expect(one.unfiledSceneCount).toBe(2)
		expect("unfiledSceneCount" in two).toBe(false)

		await scene(w.book.id, 2)
		const again = await listHistory(w.book.id)
		expect(again.find((r) => r.id === w.day1.id)!.unfiledSceneCount).toBe(2)
		expect(again.find((r) => r.id === w.day2.id)!.unfiledSceneCount).toBe(1)
	})

	test("a scene with no clock counts for the newest dated entry", async () => {
		const w = await makeBook()
		await scene(w.book.id, null)
		const rows = await listHistory(w.book.id)
		expect(rows.find((r) => r.id === w.day2.id)!.unfiledSceneCount).toBe(1)
		expect(
			"unfiledSceneCount" in rows.find((r) => r.id === w.day1.id)!
		).toBe(false)
	})

	test("a lore list carries none, and the wire list is the same rows", async () => {
		const w = await makeBook()
		await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId: w.book.id,
						title: "Gate",
						content: "x"
					} as any
				])
			)
		await scene(w.book.id, 1)
		const { listEntryRows } = await import("./entries")
		const lore = await listEntryRows(w.book.id, WORLD_LORE_TYPE_ID)
		expect(lore.length).toBeGreaterThan(0)
		for (const r of lore) expect("unfiledSceneCount" in r).toBe(false)
	})

	test("Apply on a compile review files the scene, and the row drops its count", async () => {
		const w = await makeBook()
		const filed = await scene(w.book.id, 1)
		const rowOf = async () =>
			(await listHistory(w.book.id)).find((r) => r.id === w.day1.id)!
		expect((await rowOf()).unfiledSceneCount).toBe(1)

		await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const id = activityStore.startCompile({
			userId: w.book.userId,
			historyEntryId: w.day1.id,
			historyEntryDate: "Year 3",
			lorebookId: w.book.id,
			lorebookLabel: w.book.name,
			branchId: null,
			moment: null,
			sceneIds: [filed.id]
		})
		activityStore.updateCompile(id, {
			status: "review",
			pendingResult: { content: "x" }
		})
		activityStore.remove(id, "acted")

		await vi.waitFor(async () => {
			expect("unfiledSceneCount" in (await rowOf())).toBe(false)
		}, { timeout: 10_000 })
		const [after] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, filed.id))
		expect(after.historyEntryId).toBe(w.day1.id)
	})

	test("a dateless fork's unfiled scene reads main's entry on the fork's line, so main's entry gets no count", async () => {
		const w = await makeBook()
		// A dateless fork owns no dated history (rule C): it reads main's
		// day1 for Year 3, but the count is taken on main's line, which does
		// not read the fork's scene.
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: "dateless" })
			.returning()
		await scene(w.book.id, 1, { branchId: fork.id })
		const rows = await listHistory(w.book.id)
		expect("unfiledSceneCount" in rows.find((r) => r.id === w.day1.id)!).toBe(false)
	}, 60_000)

	test("a history entry on a fork dated that day counts the fork's scene; main's entry gets none", async () => {
		const w = await makeBook()
		// Forked at Year 2: under rule C (owner, 2026-11-10) a fork owns a
		// history day only after its fork date, so its own Year 3 entry is
		// the day's entry on the fork, never a twin of main's.
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: "fork", forkYear: 2 })
			.returning()
		await scene(w.book.id, 1, { branchId: fork.id })
		const [onFork] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: w.book.id, year: 3, month: 1, day: 1, branchId: fork.id } as any
				])
			)
			.returning()
		const rows = await listHistory(w.book.id)
		expect(rows.find((r) => r.id === onFork.id)!.unfiledSceneCount).toBe(1)
		expect("unfiledSceneCount" in rows.find((r) => r.id === w.day1.id)!).toBe(false)
	}, 60_000)
})
