/**
 * ⏳ The `dc-crawl-clock` boot pass (`sessions/dcCrawlClock.ts`, plan
 * `PLAN-history-one-per-date-2026-11-10` item 6).
 *
 * Claims: the latest session-scoped `crawl-time` value is written verbatim
 * into the session clock; a session that has a clock is skipped; a session
 * with no value, or an unreadable one, is left; another genre is never read;
 * a second run changes nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { dcCrawlClock } from "./dcCrawlClock"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-dcCrawlClock-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function session(
	genreId = "core:genre/dungeon-crawler",
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `dc-clock-${++n}`)
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${n}`, genreId, ...extra })
		.returning()
	return row!
}

const crawlTime = async (sessionId: number, ...values: string[]) => {
	for (const v of values)
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session",
			ownerId: sessionId,
			slotId: "core:slot/crawl-time@1",
			value: { v },
			sessionId,
			updatedBy: "test"
		})
}

const clockOf = async (id: number) =>
	(
		await testDb
			.select({
				y: schema.sessions.storyClockYear,
				mo: schema.sessions.storyClockMonth,
				d: schema.sessions.storyClockDay,
				h: schema.sessions.storyClockHour,
				mi: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

describe("dc-crawl-clock", () => {
	test("the latest value goes in verbatim; skips, the unreadable and other genres are left; a second run changes nothing", async () => {
		const latest = await session()
		await crawlTime(latest.id, "1-01-01 08:30", "1-02-31 23:05")
		const has = await session(undefined, {
			storyClockYear: 7,
			storyClockMonth: 3,
			storyClockDay: 4
		})
		await crawlTime(has.id, "1-01-01 08:30")
		const none = await session()
		const junk = await session()
		await crawlTime(junk.id, "nightfall")
		const story = await session("core:genre/story")
		await crawlTime(story.id, "1-01-01 08:30")

		const r = await dcCrawlClock(db())
		expect(r).toMatchObject({ clocksSet: 1, noValue: 1, unreadable: 1, failed: 0 })
		expect(r.sessions).toBeGreaterThanOrEqual(3)

		expect(await clockOf(latest.id)).toEqual({ y: 1, mo: 2, d: 31, h: 23, mi: 5 })
		expect(await clockOf(has.id)).toEqual({ y: 7, mo: 3, d: 4, h: null, mi: null })
		expect(await clockOf(none.id)).toEqual({ y: null, mo: null, d: null, h: null, mi: null })
		expect((await clockOf(junk.id)).y).toBeNull()
		expect((await clockOf(story.id)).y).toBeNull()

		const all = () =>
			testDb.select().from(schema.sessions).orderBy(asc(schema.sessions.id))
		const before = await all()
		const again = await dcCrawlClock(db())
		expect(again.clocksSet).toBe(0)
		expect(await all()).toEqual(before)
	})
})
