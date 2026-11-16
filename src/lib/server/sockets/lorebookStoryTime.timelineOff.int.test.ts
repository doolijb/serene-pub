/**
 * 🚧 The lorebook's own clock and calendar on a book with no timeline:
 * `lorebooks:setClock` and `lorebooks:setCalendar` refuse, for a set and for a
 * clear, and write nothing; with the timeline on they work as before.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { ...actual, db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-storyTimeOff-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
const quiet = (async () => {}) as any
const as = (id: number) => ({ user: { id }, io: {} }) as any
const CALENDAR = { months: [{ name: "Only", days: 30 }], yearLabel: "Year" }

async function owned(timelineEnabled: boolean, extra: Partial<typeof schema.lorebooks.$inferInsert> = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `story-time-off-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${seq}`, timelineEnabled, ...extra })
		.returning()
	return { owner, book: book! }
}

const stored = async (id: number) =>
	(await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, id)))[0]!

describe("lorebooks:setClock and lorebooks:setCalendar follow the Timeline switch", () => {
	test("off: a set and a clear of the clock are refused, nothing moves", async () => {
		const { lorebookSetClockHandler } = await import("./lorebookStoryTime")
		const w = await owned(false, { storyClockYear: 7 })
		for (const clock of [{ year: 3 }, null])
			await expect(
				lorebookSetClockHandler.handler(as(w.owner.id), { lorebookId: w.book.id, clock } as any, quiet)
			).rejects.toThrow(TIMELINE_OFF_SENTENCES.clock)
		expect((await stored(w.book.id)).storyClockYear).toBe(7)
	})

	test("off: a set and a clear of the calendar are refused, nothing moves", async () => {
		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		const w = await owned(false)
		for (const calendar of [CALENDAR, null])
			await expect(
				lorebookSetCalendarHandler.handler(as(w.owner.id), { lorebookId: w.book.id, calendar } as any, quiet)
			).rejects.toThrow(TIMELINE_OFF_SENTENCES.dated)
		expect((await stored(w.book.id)).storyCalendar).toBeNull()
	})

	test("on: the clock and the calendar are set as before", async () => {
		const { lorebookSetClockHandler, lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		const w = await owned(true)
		await lorebookSetCalendarHandler.handler(as(w.owner.id), { lorebookId: w.book.id, calendar: CALENDAR } as any, quiet)
		await lorebookSetClockHandler.handler(as(w.owner.id), { lorebookId: w.book.id, clock: { year: 3 } } as any, quiet)
		const row = await stored(w.book.id)
		expect(row.storyClockYear).toBe(3)
		expect(row.storyCalendar).toBeTruthy()
	})
})
