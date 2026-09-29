/**
 * The lorebook calendar and clock, over the wire (DESIGN-story-time P5 + the
 * lorebook clock).
 *
 *  - `lorebooks:setCalendar` round-trips a calendar, and refuses one that
 *    would strand an existing dated row — listing every one of them, which is
 *    the preflight — until the rows are fixed.
 *  - Once declared, dates are validated at entry (`entries:create`,
 *    `amendments:create`), so the preflight list cannot refill.
 *  - `entries:iterateNext` rolls over by the declared calendar, and not at all
 *    in a free-form book.
 *  - `lorebooks:setClock` stores the story's now per line; the story's now is
 *    that clock, else the newest history entry on the line.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import type { StoryCalendar } from "$lib/shared/lorebooks/storyDate"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-story-calendar-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number) => ({ user: { id: userId } }) as any

function recorder() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => events.push({ event, data })
	}
}

const THAW: StoryCalendar = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	weekdays: ["Moonday", "Ashday", "Restday"],
	firstWeekday: 0,
	yearLabel: "Year",
	leap: { every: 4, month: 3 }
}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeBook(userId: number, name: string) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return book
}

async function history(
	userId: number,
	lorebookId: number,
	date: { year: number; month?: number | null; day?: number | null },
	extra: Record<string, unknown> = {}
) {
	const { createEntryHandler } = await import("./entries")
	const { entry } = (await createEntryHandler.handler(
		socketOf(userId),
		{
			entry: {
				lorebookId,
				typeId: HISTORY_TYPE_ID,
				content: "Something happened.",
				year: date.year,
				month: date.month ?? null,
				day: date.day ?? null,
				...extra
			} as any
		},
		() => {}
	)) as any
	return entry
}

describe("lorebooks:setCalendar — round trip and the preflight", () => {
	test("a calendar is stored and read back; null returns the book to free-form", async () => {
		const user = await makeUser("cal-roundtrip")
		const book = await makeBook(user.id, "Ashfall")
		const { lorebookSetCalendarHandler, lorebookStoryTimeHandler } =
			await import("./lorebookStoryTime")
		const r = recorder()

		const set = (await lorebookSetCalendarHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, calendar: THAW },
			r.emit
		)) as any
		expect(set.lorebookId).toBe(book.id)
		expect(set.calendar).toEqual(THAW)
		expect(r.events.map((e) => e.event)).toContain("lorebooks:setCalendar")
		// The reply carries its scope, or the interest gate drops it.
		expect(r.events.every((e) => e.data.lorebookId === book.id)).toBe(true)

		const read = (await lorebookStoryTimeHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id },
			() => {}
		)) as any
		expect(read.calendar).toEqual(THAW)

		const cleared = (await lorebookSetCalendarHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, calendar: null },
			() => {}
		)) as any
		expect(cleared.calendar).toBeNull()
	}, 60_000)

	test("a malformed calendar is refused, not repaired", async () => {
		const user = await makeUser("cal-malformed")
		const book = await makeBook(user.id, "Ashfall")
		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		await expect(
			lorebookSetCalendarHandler.handler(
				socketOf(user.id),
				{ lorebookId: book.id, calendar: { months: [] } as any },
				() => {}
			)
		).rejects.toThrow(/at least one month/)
	}, 60_000)

	test("a calendar that strands existing dated rows is refused with every one listed", async () => {
		const user = await makeUser("cal-preflight")
		const book = await makeBook(user.id, "Ashfall")
		await history(user.id, book.id, { year: 3, month: 1, day: 30 })
		const stranded = await history(user.id, book.id, {
			year: 3,
			month: 1,
			day: 31
		})
		await history(user.id, book.id, { year: 3, month: 7 })

		const { lorebookSetCalendarHandler, lorebookCheckCalendarHandler } =
			await import("./lorebookStoryTime")

		const check = (await lorebookCheckCalendarHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, calendar: THAW },
			() => {}
		)) as any
		expect(check.lorebookId).toBe(book.id)
		expect(check.problems).toEqual([])
		expect(check.stranded.map((s: any) => s.key)).toEqual(
			expect.arrayContaining([`entry:${stranded.id}`])
		)
		expect(check.stranded).toHaveLength(2)

		await expect(
			lorebookSetCalendarHandler.handler(
				socketOf(user.id),
				{ lorebookId: book.id, calendar: THAW },
				() => {}
			)
		).rejects.toThrow(/2 dated/)

		// Fix them in place, and the switch goes through.
		const { eq } = await import("drizzle-orm")
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, book.id))
		await history(user.id, book.id, { year: 3, month: 1, day: 30 })
		const ok = (await lorebookSetCalendarHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, calendar: THAW },
			() => {}
		)) as any
		expect(ok.calendar).toEqual(THAW)
	}, 60_000)

	test("another user's book is refused", async () => {
		const owner = await makeUser("cal-owner")
		const other = await makeUser("cal-other")
		const book = await makeBook(owner.id, "Mine")
		const { lorebookSetCalendarHandler } = await import("./lorebookStoryTime")
		await expect(
			lorebookSetCalendarHandler.handler(
				socketOf(other.id),
				{ lorebookId: book.id, calendar: THAW },
				() => {}
			)
		).rejects.toThrow(/not found/i)
	}, 60_000)
})

describe("dates are validated at entry once a calendar is declared", () => {
	test("entries:create refuses a day past the month's length", async () => {
		const user = await makeUser("cal-entry")
		const book = await makeBook(user.id, "Ashfall")
		await testDb
			.update(schema.lorebooks)
			.set({ storyCalendar: THAW })
			.where((await import("drizzle-orm")).eq(schema.lorebooks.id, book.id))
		await expect(
			history(user.id, book.id, { year: 1, month: 1, day: 31 })
		).rejects.toThrow(/Thaw has 30 days/)
		await expect(
			history(user.id, book.id, { year: 1, month: 1, day: 30 })
		).resolves.toBeTruthy()
	}, 60_000)

	test("a free-form book takes any positive parts, as always", async () => {
		const user = await makeUser("cal-freeform-entry")
		const book = await makeBook(user.id, "Loose")
		await expect(
			history(user.id, book.id, { year: 1, month: 40, day: 250 })
		).resolves.toBeTruthy()
	}, 60_000)
})

describe("entries:iterateNext — rollover", () => {
	test("rolls over by the declared calendar", async () => {
		const user = await makeUser("cal-next")
		const book = await makeBook(user.id, "Ashfall")
		const { eq } = await import("drizzle-orm")
		await testDb
			.update(schema.lorebooks)
			.set({ storyCalendar: THAW })
			.where(eq(schema.lorebooks.id, book.id))
		const last = await history(user.id, book.id, {
			year: 3,
			month: 3,
			day: 28
		})
		const { iterateNextEntryHandler } = await import("./entries")
		const { entry } = (await iterateNextEntryHandler.handler(
			socketOf(user.id),
			{ id: last.id, typeId: HISTORY_TYPE_ID },
			() => {}
		)) as any
		expect([entry.year, entry.month, entry.day]).toEqual([4, 1, 1])
	}, 60_000)

	test("does not roll over in a free-form book", async () => {
		const user = await makeUser("cal-next-free")
		const book = await makeBook(user.id, "Loose")
		const last = await history(user.id, book.id, {
			year: 3,
			month: 3,
			day: 28
		})
		const { iterateNextEntryHandler } = await import("./entries")
		const { entry } = (await iterateNextEntryHandler.handler(
			socketOf(user.id),
			{ id: last.id, typeId: HISTORY_TYPE_ID },
			() => {}
		)) as any
		expect([entry.year, entry.month, entry.day]).toEqual([3, 3, 29])
	}, 60_000)
})

describe("the clock — the story's now", () => {
	test("falls back to the newest history entry, then reads the stored clock", async () => {
		const user = await makeUser("cal-clock")
		const book = await makeBook(user.id, "Ashfall")
		const { storyNowOf } = await import("$lib/server/state/storyTime")
		const { db } = await import("$lib/server/db")

		expect(await storyNowOf(db as any, book.id)).toBeNull()
		await history(user.id, book.id, { year: 2 })
		await history(user.id, book.id, { year: 5, month: 2 })
		expect(await storyNowOf(db as any, book.id)).toEqual({
			year: 5,
			month: 2,
			from: "history"
		})

		const { lorebookSetClockHandler } = await import("./lorebookStoryTime")
		const r = recorder()
		const set = (await lorebookSetClockHandler.handler(
			socketOf(user.id),
			{
				lorebookId: book.id,
				branchId: null,
				clock: { year: 4, month: 1, day: 9, hour: 22, minute: 30 }
			},
			r.emit
		)) as any
		expect(set.clocks.main).toEqual({
			year: 4,
			month: 1,
			day: 9,
			hour: 22,
			minute: 30
		})
		expect(r.events.every((e) => e.data.lorebookId === book.id)).toBe(true)
		// The clock wins even when it stands before the newest entry: it is
		// where the story stands, and a pin is not a present.
		expect(await storyNowOf(db as any, book.id)).toEqual({
			year: 4,
			month: 1,
			day: 9,
			hour: 22,
			minute: 30,
			from: "clock"
		})

		await lorebookSetClockHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, branchId: null, clock: null },
			() => {}
		)
		expect((await storyNowOf(db as any, book.id))?.from).toBe("history")
	}, 60_000)

	test("the now carries the calendar's spelling when one is declared", async () => {
		const user = await makeUser("cal-clock-label")
		const book = await makeBook(user.id, "Ashfall")
		const { eq } = await import("drizzle-orm")
		await testDb
			.update(schema.lorebooks)
			.set({ storyCalendar: THAW, storyClockYear: 1, storyClockMonth: 1, storyClockDay: 2 })
			.where(eq(schema.lorebooks.id, book.id))
		const { storyNowOf } = await import("$lib/server/state/storyTime")
		const { db } = await import("$lib/server/db")
		expect((await storyNowOf(db as any, book.id))?.label).toBe(
			"Ashday, 2 Thaw, Year 1"
		)
	}, 60_000)

	test("a clock that does not fit the calendar is refused", async () => {
		const user = await makeUser("cal-clock-bad")
		const book = await makeBook(user.id, "Ashfall")
		const { eq } = await import("drizzle-orm")
		await testDb
			.update(schema.lorebooks)
			.set({ storyCalendar: THAW })
			.where(eq(schema.lorebooks.id, book.id))
		const { lorebookSetClockHandler } = await import("./lorebookStoryTime")
		await expect(
			lorebookSetClockHandler.handler(
				socketOf(user.id),
				{ lorebookId: book.id, branchId: null, clock: { year: 1, month: 5 } },
				() => {}
			)
		).rejects.toThrow(/no month 5/)
		await expect(
			lorebookSetClockHandler.handler(
				socketOf(user.id),
				{ lorebookId: book.id, branchId: null, clock: { year: 1, hour: 24 } },
				() => {}
			)
		).rejects.toThrow(/hour/)
	}, 60_000)

	test("branch-aware: each line has its own clock and its own fallback", async () => {
		const user = await makeUser("cal-branch")
		const book = await makeBook(user.id, "Ashfall")
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "What if", forkYear: 3 })
			.returning()
		await history(user.id, book.id, { year: 3 })
		// Only the branch has year 9.
		await history(user.id, book.id, { year: 9 }, { branchId: fork.id })
		const { storyNowOf } = await import("$lib/server/state/storyTime")
		const { db } = await import("$lib/server/db")

		expect((await storyNowOf(db as any, book.id, null))?.year).toBe(3)
		expect((await storyNowOf(db as any, book.id, fork.id))?.year).toBe(9)

		const { lorebookSetClockHandler } = await import("./lorebookStoryTime")
		await lorebookSetClockHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, branchId: null, clock: { year: 20 } },
			() => {}
		)
		// Main's clock does not move the branch: it never inherits main's now.
		expect((await storyNowOf(db as any, book.id, null))?.year).toBe(20)
		expect((await storyNowOf(db as any, book.id, fork.id))?.year).toBe(9)

		const res = (await lorebookSetClockHandler.handler(
			socketOf(user.id),
			{ lorebookId: book.id, branchId: fork.id, clock: { year: 11 } },
			() => {}
		)) as any
		expect(res.clocks.branches).toEqual([
			{ branchId: fork.id, clock: { year: 11, month: null, day: null, hour: null, minute: null } }
		])
		expect((await storyNowOf(db as any, book.id, fork.id))?.year).toBe(11)
		expect((await storyNowOf(db as any, book.id, null))?.year).toBe(20)
	}, 60_000)

	test("a branch of another book is refused", async () => {
		const user = await makeUser("cal-branch-other")
		const book = await makeBook(user.id, "A")
		const elsewhere = await makeBook(user.id, "B")
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: elsewhere.id, name: "Other" })
			.returning()
		const { lorebookSetClockHandler } = await import("./lorebookStoryTime")
		await expect(
			lorebookSetClockHandler.handler(
				socketOf(user.id),
				{ lorebookId: book.id, branchId: fork.id, clock: { year: 1 } },
				() => {}
			)
		).rejects.toThrow(/branch/i)
	}, 60_000)
})
