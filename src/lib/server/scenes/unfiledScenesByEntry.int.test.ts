/**
 * 🚧 `unfiledScenesByEntry`: the one reading of "an unfiled scene belongs to the
 * history entry of its day" — grouped per (line, day), line-aware, a Day-count
 * scene dated by its year, a scene on another book's line skipped.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
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
		path.join(os.tmpdir(), "serene-pub-unfiled-by-entry-int-test-")
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
	const user = await createTestUser(testDb, `by-entry-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `By Entry ${seq}`, userId: user.id })
		.returning()
	const [day1] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book.id, year: 3, month: 1, day: 1 } as any
			])
		)
		.returning()
	return { book, day1 }
}

const scene = async (
	bookId: number,
	clock: { year: number; month?: number; day?: number } | null,
	extra: Partial<typeof schema.scenes.$inferInsert> = {}
) =>
	(
		await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: bookId,
				historyEntryId: null,
				name: "A scene",
				...(clock
					? {
							openedStoryClockYear: clock.year,
							openedStoryClockMonth: clock.month ?? null,
							openedStoryClockDay: clock.day ?? null
						}
					: {}),
				...extra
			} as any)
			.returning()
	)[0]

const branch = async (bookId: number, name: string) =>
	(
		await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: bookId, name })
			.returning()
	)[0]

const idsOf = (m: Map<number, { id: number }[]>, entryId: number) =>
	(m.get(entryId) ?? []).map((s) => s.id)

describe("unfiledScenesByEntry", () => {
	test("two scenes of a day map to its entry in id order; a day with no entry is absent", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const w = await makeBook()
		const a = await scene(w.book.id, { year: 3, month: 1, day: 1 })
		const b = await scene(w.book.id, { year: 3, month: 1, day: 1 })
		const other = await scene(w.book.id, { year: 3, month: 1, day: 9 })
		const map = await unfiledScenesByEntry(testDb as any, {
			lorebookId: w.book.id,
			line: MAIN_LINE
		})
		expect(idsOf(map, w.day1.id)).toEqual([a.id, b.id])
		expect([...map.values()].flat().map((s) => s.id)).not.toContain(
			other.id
		)
	})

	test("a Day-count scene (a year, no month; the database allows a day only beside a month) maps to the entry dated by its year", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const w = await makeBook()
		const [yearEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: w.book.id, year: 7 } as any]))
			.returning()
		const s = await scene(w.book.id, { year: 7 })
		const map = await unfiledScenesByEntry(testDb as any, {
			lorebookId: w.book.id,
			line: MAIN_LINE
		})
		expect(idsOf(map, yearEntry.id)).toEqual([s.id])
	})

	test("with a line, a fork's scene is absent on main and present on the fork, beside main's shared one", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const { lineOfBook } = await import("$lib/server/state/reading")
		const w = await makeBook()
		const fork = await branch(w.book.id, "fork")
		const clock = { year: 3, month: 1, day: 1 }
		const shared = await scene(w.book.id, clock)
		const forked = await scene(w.book.id, clock, { branchId: fork.id })
		const db = testDb as any
		const onMain = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, null)
		})
		expect(idsOf(onMain, w.day1.id)).toEqual([shared.id])
		const onFork = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, fork.id)
		})
		expect(idsOf(onFork, w.day1.id)).toEqual([shared.id, forked.id])
	})

	test("a scene on another book's line is not read on main, and nothing throws", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const w = await makeBook()
		const other = await makeBook()
		const foreign = await branch(other.book.id, "elsewhere")
		const clock = { year: 3, month: 1, day: 1 }
		const ok = await scene(w.book.id, clock)
		await scene(w.book.id, clock, { branchId: foreign.id })
		const map = await unfiledScenesByEntry(testDb as any, {
			lorebookId: w.book.id,
			line: MAIN_LINE
		})
		expect(idsOf(map, w.day1.id)).toEqual([ok.id])
	})

	test("equivalence: every (line, day) group files where one historyEntryOfDate call per group would, on main and on a fork, and nothing is created", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const { historyEntryOfDate, dayOnly } = await import(
			"./historyEntryOfDate"
		)
		const { lineOfBook, BranchRefusal } = await import(
			"$lib/server/state/reading"
		)
		const db = testDb as any
		const w = await makeBook()
		const fork = await branch(w.book.id, "fork")
		const historyCount = async () =>
			(
				await testDb
					.select({ id: schema.lorebookEntries.id })
					.from(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.lorebookId, w.book.id),
							eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
						)
					)
			).length
		// 3/1/1 gets a second entry (higher position); 3/1/2 one more; a
		// year-only entry; and one that only the fork reads.
		await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: w.book.id, year: 3, month: 1, day: 1 } as any
				])
			)
			.returning()
		await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: w.book.id, year: 3, month: 1, day: 2 } as any
				])
			)
			.returning()
		await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: w.book.id, year: 7 } as any]))
		await testDb.insert(schema.lorebookEntries).values(
			historyValues([
				{
					lorebookId: w.book.id,
					year: 3,
					month: 1,
					day: 5,
					branchId: fork.id
				} as any
			])
		)
		const clock = (year: number, month?: number, day?: number) => ({
			year,
			month,
			day
		})
		const input = [
			{ s: await scene(w.book.id, clock(3, 1, 1)), branchId: null },
			{ s: await scene(w.book.id, clock(3, 1, 1)), branchId: null },
			{ s: await scene(w.book.id, clock(3, 1, 2)), branchId: null },
			{ s: await scene(w.book.id, clock(3, 1, 9)), branchId: null },
			{ s: await scene(w.book.id, clock(7)), branchId: null },
			// Undated: rowsReadingOnLine keeps a scene with no clock on its line.
			{ s: await scene(w.book.id, null), branchId: null },
			{
				s: await scene(w.book.id, clock(3, 1, 1), {
					branchId: fork.id
				}),
				branchId: fork.id
			},
			{
				s: await scene(w.book.id, clock(3, 1, 5), {
					branchId: fork.id
				}),
				branchId: fork.id
			},
			{
				s: await scene(w.book.id, null, { branchId: fork.id }),
				branchId: fork.id
			}
		]

		const expected = async (branchIds: Array<number | null>) => {
			const groups = new Map<
				string,
				{ branchId: number | null; date: StoryDate | null; ids: number[] }
			>()
			for (const { s, branchId } of input) {
				if (!branchIds.includes(branchId)) continue
				const date =
					s.openedStoryClockYear == null
						? null
						: dayOnly({
								year: s.openedStoryClockYear,
								month: s.openedStoryClockMonth ?? null,
								day: s.openedStoryClockDay ?? null
							})
				const key = `${branchId}|${JSON.stringify(date)}`
				const g = groups.get(key) ?? { branchId, date, ids: [] as number[] }
				g.ids.push(s.id)
				groups.set(key, g)
			}
			const out = new Map<number, number[]>()
			for (const g of groups.values()) {
				let answer
				try {
					answer = await historyEntryOfDate(
						db,
						{
							lorebookId: w.book.id,
							branchId: g.branchId,
							date: g.date
						},
						{ create: false }
					)
				} catch (e) {
					if (e instanceof BranchRefusal) continue
					throw e
				}
				if (!answer) continue
				out.set(
					answer.historyEntryId,
					[...(out.get(answer.historyEntryId) ?? []), ...g.ids].sort(
						(a, b) => a - b
					)
				)
			}
			return [...out.entries()].sort((a, b) => a[0] - b[0])
		}
		const actual = (m: Map<number, { id: number }[]>) =>
			[...m.entries()]
				.map(([k, v]) => [k, v.map((x) => x.id)] as [number, number[]])
				.sort((a, b) => a[0] - b[0])

		const before = await historyCount()
		const onMain = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, null)
		})
		const onFork = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, fork.id)
		})
		const wantMain = await expected([null])
		const wantFork = await expected([null, fork.id])
		expect(wantMain.length).toBeGreaterThan(2)
		expect(wantFork.length).toBeGreaterThan(wantMain.length)
		expect(actual(onMain)).toEqual(wantMain)
		expect(actual(onFork)).toEqual(wantFork)
		expect(await historyCount()).toBe(before)
	})

	test("a doubled date on a fork: both scenes file under the lowest-id entry (main's)", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const { lineOfBook } = await import("$lib/server/state/reading")
		const db = testDb as any
		const w = await makeBook()
		const fork = await branch(w.book.id, "fork")
		const [forkEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{
						lorebookId: w.book.id,
						year: 3,
						month: 1,
						day: 1,
						branchId: fork.id
					} as any
				])
			)
			.returning()
		expect(forkEntry.position).toBeGreaterThan(w.day1.position)
		const clock = { year: 3, month: 1, day: 1 }
		const shared = await scene(w.book.id, clock)
		const forked = await scene(w.book.id, clock, { branchId: fork.id })
		const onFork = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, fork.id)
		})
		// One date, two entries the fork reads: the lowest id is the date's
		// entry (`historyEntryOver`), so both scenes file under main's.
		expect(idsOf(onFork, w.day1.id)).toEqual([shared.id, forked.id])
		expect(idsOf(onFork, forkEntry.id)).toEqual([])
	})

	test("main and a fork resolve the same scene day differently, each on its own line", async () => {
		const { unfiledScenesByEntry } = await import("./unfiledScenesByEntry")
		const { lineOfBook } = await import("$lib/server/state/reading")
		const db = testDb as any
		const w = await makeBook()
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: "fork", forkYear: 2 })
			.returning()
		const [forkEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{
						lorebookId: w.book.id,
						year: 3,
						month: 1,
						day: 1,
						branchId: fork.id
					} as any
				])
			)
			.returning()
		const clock = { year: 3, month: 1, day: 1 }
		const mainScene = await scene(w.book.id, clock)
		const forkScene = await scene(w.book.id, clock, { branchId: fork.id })
		const onMain = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, null)
		})
		const onFork = await unfiledScenesByEntry(db, {
			lorebookId: w.book.id,
			line: await lineOfBook(db, w.book.id, fork.id)
		})
		expect(idsOf(onMain, w.day1.id)).toEqual([mainScene.id])
		expect(idsOf(onMain, forkEntry.id)).toEqual([])
		// The fork (dated Year 2) owns Year 3: main's scene resolves to the
		// fork's own row on the fork's line, and so does the fork's scene.
		expect(idsOf(onFork, forkEntry.id)).toEqual([forkScene.id])
		// Main's Year-3 scene is past the fork cut, so the fork does not read it.
		expect(idsOf(onFork, w.day1.id)).toEqual([])
	}, 60_000)
})
