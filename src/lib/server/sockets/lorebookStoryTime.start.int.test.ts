/**
 * 🚧 The `lorebooks:storyTime` reply's `start`: where a new session on the book
 * would start — the line (`mostRecentBranchOf`), the date and why
 * (`storyStartOf`), `today` in the asking user's time zone.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
	return testDbModule(await createTestDb())
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-storyTimeStart-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterEach(() => {
	vi.useRealTimers()
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
const quiet = (() => {}) as any
const as = (id: number) => ({ user: { id }, io: {} }) as any
const TEN_MONTHS = { months: Array.from({ length: 10 }, (_, i) => ({ name: `M${i + 1}`, days: 30 })), yearLabel: "Year" }

async function owned(extra: Partial<typeof schema.lorebooks.$inferInsert> = {}, timeZone: string | null = "UTC") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `story-time-start-${++seq}`)
	await testDb.update(schema.users).set({ timeZone }).where(eq(schema.users.id, owner.id))
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${seq}`, timelineEnabled: true, ...extra })
		.returning()
	return { owner, book: book! }
}

async function read(w: Awaited<ReturnType<typeof owned>>): Promise<Sockets.Lorebooks.BookStoryTime> {
	const { lorebookStoryTimeHandler } = await import("./lorebookStoryTime")
	return (await lorebookStoryTimeHandler.handler(as(w.owner.id), { lorebookId: w.book.id } as any, quiet)) as any
}

describe("lorebooks:storyTime carries where a new session starts", () => {
	test("a present: that date, cause present, on main", async () => {
		const w = await owned({ storyClockYear: 12, storyClockMonth: 4 })
		const res = await read(w)
		expect(res.lorebookId).toBe(w.book.id)
		expect(res.start).toEqual({ branchId: null, date: { year: 12, month: 4, day: null, hour: null, minute: null }, cause: "present" })
	})

	test("no present: today in the asking user's zone", async () => {
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date("2026-11-15T23:30:00Z"))
		const w = await owned({}, "Pacific/Auckland")
		expect((await read(w)).start).toEqual({
			branchId: null,
			date: { year: 2026, month: 11, day: 16, hour: null, minute: null },
			cause: "today"
		})
	})

	test("today does not land: cause asks, no date", async () => {
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date("2026-11-15T08:05:00Z"))
		const w = await owned({ storyCalendar: TEN_MONTHS })
		expect((await read(w)).start).toEqual({ branchId: null, date: null, cause: "asks" })
	})

	test("timeline off: cause undated, no date", async () => {
		const w = await owned({ timelineEnabled: false })
		expect((await read(w)).start).toEqual({ branchId: null, date: null, cause: "undated" })
	})
})
