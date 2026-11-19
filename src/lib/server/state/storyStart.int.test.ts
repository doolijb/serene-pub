/**
 * Where a new session's story starts (`storyStartOf`) and the one "today"
 * (`storyToday`): "today" is the real date in the owner's time zone.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-story-start-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function fixture(opts: { calendar?: unknown; clock?: { year: number; month?: number }; timelineEnabled?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `story-start-${suffix}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			storyCalendar: (opts.calendar ?? null) as any,
			storyClockYear: opts.clock?.year ?? null,
			storyClockMonth: opts.clock?.month ?? null,
			...(opts.timelineEnabled === undefined ? {} : { timelineEnabled: opts.timelineEnabled })
		})
		.returning()
	const entry = async (typeId: string, fields: Record<string, unknown>, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId,
					typeVersion: 1,
					position: ++n,
					title: null,
					content: "…",
					fields,
					branchId
				})
				.returning()
		)[0]
	const member = async () =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: lorebook.id, binding: `{{char:${++n}}}`, name: `Member ${n}` } as any)
				.returning()
		)[0]
	const branch = async () =>
		(await testDb.insert(schema.lorebookBranches).values({ lorebookId: lorebook.id, name: `Branch ${++n}` }).returning())[0]
	const start = async (args: Record<string, unknown> = {}) => {
		const { storyStartOf } = await import("$lib/server/state/storyTime")
		return storyStartOf(db(), { lorebookId: lorebook.id, branchId: null, ...args } as any)
	}
	return { user, lorebook, entry, member, branch, start }
}

const clock = (year: number, month: number | null = null, day: number | null = null) => ({
	year,
	month,
	day,
	hour: null,
	minute: null
})

describe("storyToday", () => {
	const AT = new Date("2026-06-15T23:30:00Z")

	test("reads the date and time of day in the given zone", async () => {
		const { storyToday } = await import("$lib/server/state/storyTime")
		expect(storyToday("Pacific/Auckland", AT)).toEqual({ year: 2026, month: 6, day: 16, hour: 11, minute: 30 })
		expect(storyToday("America/Los_Angeles", AT)).toEqual({ year: 2026, month: 6, day: 15, hour: 16, minute: 30 })
	})

	test("null and an unknown zone both read the server's zone", async () => {
		const { storyToday } = await import("$lib/server/state/storyTime")
		const local = {
			year: AT.getFullYear(),
			month: AT.getMonth() + 1,
			day: AT.getDate(),
			hour: AT.getHours(),
			minute: AT.getMinutes()
		}
		expect(storyToday(null, AT)).toEqual(local)
		expect(storyToday("Not/AZone", AT)).toEqual(local)
	})

	test("the owner's zone is read from the user row", async () => {
		const { ownerTimeZoneOf } = await import("$lib/server/state/storyTime")
		const f = await fixture()
		expect(await ownerTimeZoneOf(db(), f.user.id)).toBeNull()
		const { eq } = await import("drizzle-orm")
		await testDb.update(schema.users).set({ timeZone: "Asia/Tokyo" }).where(eq(schema.users.id, f.user.id))
		expect(await ownerTimeZoneOf(db(), f.user.id)).toBe("Asia/Tokyo")
	})
})

describe("storyStartOf", () => {
	test("a book that keeps no timeline is undated", async () => {
		const f = await fixture({ timelineEnabled: false })
		await f.entry(HISTORY_TYPE_ID, { year: 4 })
		expect(await f.start()).toEqual({ cause: "undated" })
	})

	test("present: the line's clock", async () => {
		const f = await fixture({ clock: { year: 12, month: 4 } })
		expect(await f.start()).toEqual({ cause: "present", clock: clock(12, 4) })
	})

	test("present: the newest dated history entry", async () => {
		const f = await fixture()
		await f.entry(HISTORY_TYPE_ID, { year: 3, month: 2 })
		await f.entry(HISTORY_TYPE_ID, { year: 5, month: 1, day: 9 })
		expect(await f.start()).toEqual({ cause: "present", clock: clock(5, 1, 9) })
	})

	test("latest: a Beginning, taking the latest of several", async () => {
		const f = await fixture()
		await f.entry(WORLD_LORE_TYPE_ID, { year: 7 })
		await f.entry(WORLD_LORE_TYPE_ID, { year: 11, month: 3 })
		await f.entry(WORLD_LORE_TYPE_ID, { year: 2 })
		expect(await f.start()).toEqual({ cause: "latest", clock: clock(11, 3) })
	})

	test("latest: an entry amendment (a held one is not a point)", async () => {
		const f = await fixture()
		const e = await f.entry(WORLD_LORE_TYPE_ID, {})
		const amend = (year: number, extra: Record<string, unknown> = {}) =>
			testDb
				.insert(schema.entryAmendments)
				.values({ lorebookId: f.lorebook.id, entryId: e.id, year, fields: { content: "x" }, ...extra } as any)
		await amend(4)
		await amend(9, { month: 6, day: 2 })
		await amend(30, { base: { content: { v: "…" } } })
		expect(await f.start()).toEqual({ cause: "latest", clock: clock(9, 6, 2) })
	})

	test("latest: a cast member's dated version", async () => {
		const f = await fixture()
		const m = await f.member()
		for (const year of [3, 8])
			await testDb.insert(schema.characterVersions).values({
				castMemberId: m.id,
				lorebookId: f.lorebook.id,
				nodeState: "active",
				nodeVisibility: "normal",
				writeOrder: 1,
				year
			} as any)
		expect(await f.start()).toEqual({ cause: "latest", clock: clock(8) })
	})

	test("latest: a presence arrival", async () => {
		const f = await fixture()
		const m = await f.member()
		for (const [i, year] of [6, 14, 10].entries())
			await testDb.insert(schema.castPresences).values({
				lorebookId: f.lorebook.id,
				lorebookBindingId: m.id,
				personalPosition: i,
				fromYear: year,
				fromMonth: 5
			})
		expect(await f.start()).toEqual({ cause: "latest", clock: clock(14, 5) })
	})

	test("latest: a row on a sibling line is not counted", async () => {
		const f = await fixture()
		const sibling = await f.branch()
		const mine = await f.branch()
		await f.entry(WORLD_LORE_TYPE_ID, { year: 5 })
		await f.entry(WORLD_LORE_TYPE_ID, { year: 99 }, sibling.id)
		expect(await f.start({ branchId: mine.id })).toEqual({ cause: "latest", clock: clock(5) })
		expect(await f.start({ branchId: sibling.id })).toEqual({ cause: "latest", clock: clock(99) })
		expect(await f.start()).toEqual({ cause: "latest", clock: clock(5) })
	})

	test("today: a free-form book, with the injected instant", async () => {
		const f = await fixture()
		expect(await f.start({ timeZone: "UTC", at: new Date("2026-11-15T08:05:00Z") })).toEqual({
			cause: "today",
			clock: { year: 2026, month: 11, day: 15, hour: null, minute: null }
		})
	})

	test("today: the owner's time zone moves the date", async () => {
		const f = await fixture()
		const at = new Date("2026-11-15T23:30:00Z")
		expect(await f.start({ timeZone: "Pacific/Auckland", at })).toEqual({
			cause: "today",
			clock: { year: 2026, month: 11, day: 16, hour: null, minute: null }
		})
		expect(await f.start({ timeZone: "America/Los_Angeles", at })).toEqual({
			cause: "today",
			clock: { year: 2026, month: 11, day: 15, hour: null, minute: null }
		})
	})

	test("today: the twelve-months calendar places it", async () => {
		const { OWN_BOOK_CALENDAR } = await import("$lib/server/lorebooks/ownBook")
		const f = await fixture({ calendar: OWN_BOOK_CALENDAR })
		expect(await f.start({ timeZone: "UTC", at: new Date("2026-11-15T08:05:00Z") })).toMatchObject({
			cause: "today",
			clock: { year: 2026, month: 11, day: 15 }
		})
	})

	test("asks: a ten-month calendar has no month 11", async () => {
		const f = await fixture({
			calendar: { months: Array.from({ length: 10 }, (_, i) => ({ name: `M${i + 1}`, days: 30 })), yearLabel: "Year" }
		})
		expect(await f.start({ timeZone: "UTC", at: new Date("2026-11-15T08:05:00Z") })).toEqual({ cause: "asks" })
	})
})
