/**
 * A15 — a date the book's calendar allows is a date the database holds.
 *
 * History's declared date range is projected into a CHECK on
 * `lorebook_entries` at boot (`projectEntryConstraints`). It used to say month
 * 1–12, day 1–31 while the story-time rule says any month count, 1–1000-day
 * months and free-form days of the year — so "Add the next date in sequence"
 * after a free-form day 31 died at the INSERT, and a thirteen-month calendar
 * passed `assertDateLands` and then failed the same way, as a raw constraint
 * error.
 *
 * ⚠ `createTestDb` does NOT project entry constraints — which is exactly how
 * this stayed green: every other suite writes history rows with no CHECK in
 * the way. This one runs the boot's projection first, so it sees what an
 * installed database sees.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import type { StoryCalendar } from "$lib/shared/lorebooks/storyDate"
import {
	entryConstraintName,
	projectEntryConstraints
} from "$lib/server/pipelines/boot/entryProjection"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const HISTORY_CHECK = entryConstraintName(HISTORY_TYPE_ID, 1)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-history-date-bounds-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// The boot step `createTestDb` leaves out: the declared schema becomes
	// the CHECK every write below must pass.
	const report = await projectEntryConstraints(testDb as any)
	expect(report.errors).toEqual([])
	expect(report.constraints.added).toContain(HISTORY_CHECK)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number) => ({ user: { id: userId } }) as any

/** Thirteen months — the twelve of an ordinary year and one more. */
const THIRTEEN: StoryCalendar = {
	months: [
		...[
			"Deep",
			"Thaw",
			"Seed",
			"Bloom",
			"Rise",
			"High",
			"Long",
			"Ripe",
			"Reap",
			"Fall",
			"Frost",
			"Dark"
		].map((name) => ({ name, days: 28 })),
		{ name: "Between", days: 5 }
	]
}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeBook(
	userId: number,
	name: string,
	calendar: StoryCalendar | null = null
) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId, storyCalendar: calendar })
		.returning()
	return book
}

async function history(
	userId: number,
	lorebookId: number,
	date: { year: number; month?: number | null; day?: number | null }
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
				day: date.day ?? null
			} as any
		},
		() => {}
	)) as any
	return entry
}

async function next(userId: number, id: number) {
	const { iterateNextEntryHandler } = await import("./entries")
	const { entry } = (await iterateNextEntryHandler.handler(
		socketOf(userId),
		{ id, typeId: HISTORY_TYPE_ID },
		() => {}
	)) as any
	return entry
}

/** The date as stored — read back from the table, not from the reply. */
async function storedDate(id: number) {
	const [row] = await testDb
		.select({ fields: schema.lorebookEntries.fields })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
	const f = (row?.fields ?? {}) as Record<string, unknown>
	return [f.year, f.month, f.day]
}

describe("the projected constraint holds the story-time rule", () => {
	test("entries:iterateNext on free-form day 31 inserts day 32", async () => {
		const user = await makeUser("a15-next-free")
		const book = await makeBook(user.id, "Loose")
		const last = await history(user.id, book.id, {
			year: 5,
			month: 1,
			day: 31
		})
		const made = await next(user.id, last.id)
		expect([made.year, made.month, made.day]).toEqual([5, 1, 32])
		expect(await storedDate(made.id)).toEqual([5, 1, 32])
	})

	test("a free-form day of the year well past any month's length is kept", async () => {
		const user = await makeUser("a15-day-of-year")
		const book = await makeBook(user.id, "Loose")
		const made = await history(user.id, book.id, {
			year: 3,
			month: 1,
			day: 250
		})
		expect(await storedDate(made.id)).toEqual([3, 1, 250])
	})

	test("a 13-month calendar accepts a month-13 history entry", async () => {
		const user = await makeUser("a15-thirteen")
		const book = await makeBook(user.id, "Long year", THIRTEEN)
		const made = await history(user.id, book.id, {
			year: 7,
			month: 13,
			day: 5
		})
		expect(await storedDate(made.id)).toEqual([7, 13, 5])
		// And the next date rolls out of the thirteenth month into the next
		// year, through the same INSERT.
		const after = await next(user.id, made.id)
		expect(await storedDate(after.id)).toEqual([8, 1, 1])
	})
})

describe("an invalid date is still refused, with a plain sentence", () => {
	/** A refusal a person can read: no constraint name, no SQL. */
	const plain = (e: unknown) => {
		const message = String((e as Error)?.message ?? e)
		expect(message).not.toMatch(/entry_fields__|Failed query|violates/)
		return message
	}

	test("a month the calendar does not have — assertDateLands is still the gate", async () => {
		const user = await makeUser("a15-no-month-14")
		const book = await makeBook(user.id, "Long year", THIRTEEN)
		const err = await history(user.id, book.id, {
			year: 7,
			month: 14,
			day: 1
		}).catch((e) => e)
		expect(plain(err)).toBe(
			"That date does not fit this book's calendar: There is no month 14: this calendar has 13."
		)
	})

	test("a day past the month's length in a declared calendar", async () => {
		const user = await makeUser("a15-short-month")
		const book = await makeBook(user.id, "Long year", THIRTEEN)
		const err = await history(user.id, book.id, {
			year: 7,
			month: 13,
			day: 6
		}).catch((e) => e)
		expect(plain(err)).toMatch(/Between has 5 days in year 7, not 6\./)
	})

	test("a month or a day of zero in a free-form book", async () => {
		const user = await makeUser("a15-zero")
		const book = await makeBook(user.id, "Loose")
		const month = await history(user.id, book.id, {
			year: 7,
			month: 0
		}).catch((e) => e)
		expect(plain(month)).toMatch(/A month is a whole number, 1 or more\./)
		const day = await history(user.id, book.id, {
			year: 7,
			month: 2,
			day: 0
		}).catch((e) => e)
		expect(plain(day)).toMatch(/A day is a whole number, 1 or more\./)
	})

	test("the database floor still stands behind the gate", async () => {
		// A write that skips every handler (an import, a script) still cannot
		// store a zeroth month: the CHECK keeps the rule's floor.
		const user = await makeUser("a15-raw")
		const book = await makeBook(user.id, "Loose")
		const { sql } = await import("drizzle-orm")
		const { asDriverRejection } = await import("$lib/server/utils/testDb")
		await expect(
			asDriverRejection(
				testDb.execute(sql`
					INSERT INTO "lorebook_entries"
						("lorebook_id","type_id","type_version","position","fields")
					VALUES (${book.id}, ${HISTORY_TYPE_ID}, 1, 900, '{"year": 1, "month": 0}'::jsonb)`)
			)
		).rejects.toThrow(new RegExp(HISTORY_CHECK))
	})
})

/**
 * One rule, one sentence, and the person hears it (A15 review, 2026-09-30).
 *
 * Every dated writer answers `storyTimeProblem` — history, amendments, fork
 * dates, placements, clocks. Before: in a free-form book history took a day
 * with no month while the other four refused it in four different sentences,
 * and none of these handlers emitted its own `:error`, so `register()` swapped
 * every one of those sentences for "An error occurred while processing your
 * request." Each is checked here the way `register()` sees it: what was
 * emitted as `<event>:error`, beside what was thrown.
 */
describe("every dated writer refuses one rule in one sentence, said to the person", () => {
	const DAY_NEEDS_MONTH = "A day needs a month."

	/** Run a handler as `register()` does; keep its `:error` and its throw. */
	async function refused(
		handler: { event: string; handler: (...a: any[]) => Promise<any> },
		userId: number,
		params: unknown
	) {
		const errors: string[] = []
		const thrown = await handler
			.handler(socketOf(userId), params, (event: string, data: any) => {
				if (event === `${handler.event}:error`) errors.push(data?.error)
			})
			.then(
				() => null,
				(e: unknown) => e as Error
			)
		expect(thrown, `${handler.event} should refuse`).not.toBeNull()
		expect(errors, `${handler.event} should say why`).toHaveLength(1)
		expect(errors[0]).not.toMatch(/entry_fields__|Failed query|violates|An error occurred/)
		return errors[0]
	}

	test("a day with no month, in a free-form book", async () => {
		const user = await makeUser("a15-day-no-month")
		const book = await makeBook(user.id, "Loose")
		const base = await history(user.id, book.id, { year: 1, month: 1, day: 1 })
		const [member] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "{{char:1}}", name: "Ann" })
			.returning()
		const E = await import("./entries")
		const A = await import("./amendments")
		const T = await import("./lorebookStoryTime")
		const date = { year: 3, month: null, day: 5 }

		expect(
			await refused(E.createEntryHandler, user.id, {
				entry: {
					lorebookId: book.id,
					typeId: HISTORY_TYPE_ID,
					content: "No month.",
					...date
				}
			})
		).toBe(`That date can't be saved: ${DAY_NEEDS_MONTH}`)
		expect(
			await refused(E.updateEntryHandler, user.id, {
				entry: { id: base.id, typeId: HISTORY_TYPE_ID, month: null }
			})
		).toBe(`That date can't be saved: ${DAY_NEEDS_MONTH}`)
		expect(
			await refused(A.amendmentsCreateHandler, user.id, {
				lorebookId: book.id,
				entryId: base.id,
				...date,
				fields: { content: "Changed." }
			})
		).toBe(`That date can't be saved: ${DAY_NEEDS_MONTH}`)
		expect(
			await refused(A.amendmentsForkHandler, user.id, {
				lorebookId: book.id,
				name: "What if",
				forkYear: date.year,
				forkMonth: date.month,
				forkDay: date.day
			})
		).toBe(`The fork date can't be saved: ${DAY_NEEDS_MONTH}`)
		expect(
			await refused(A.amendmentsPlaceHandler, user.id, {
				lorebookId: book.id,
				castId: member.id,
				personalPosition: 1,
				fromYear: date.year,
				fromMonth: date.month,
				fromDay: date.day
			})
		).toBe(`The arrival can't be saved: ${DAY_NEEDS_MONTH}`)
		expect(
			await refused(T.lorebookSetClockHandler, user.id, {
				lorebookId: book.id,
				branchId: null,
				clock: date
			})
		).toBe(DAY_NEEDS_MONTH)

		// And nothing was stored under the refused date.
		const rows = await testDb
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, book.id))
		expect(rows.map((r) => (r.fields as any).month)).toEqual([1])
	})

	test("a zeroth month, and a month the calendar does not have", async () => {
		const user = await makeUser("a15-said-to-person")
		const loose = await makeBook(user.id, "Loose")
		const E = await import("./entries")
		const T = await import("./lorebookStoryTime")
		expect(
			await refused(E.createEntryHandler, user.id, {
				entry: {
					lorebookId: loose.id,
					typeId: HISTORY_TYPE_ID,
					content: "Month zero.",
					year: 3,
					month: 0
				}
			})
		).toBe("That date can't be saved: A month is a whole number, 1 or more.")
		expect(
			await refused(T.lorebookSetClockHandler, user.id, {
				lorebookId: loose.id,
				branchId: null,
				clock: { year: 3, month: 0 }
			})
		).toBe("A month is a whole number, 1 or more.")

		const long = await makeBook(user.id, "Long year", THIRTEEN)
		expect(
			await refused(E.createEntryHandler, user.id, {
				entry: {
					lorebookId: long.id,
					typeId: HISTORY_TYPE_ID,
					content: "Month fourteen.",
					year: 3,
					month: 14
				}
			})
		).toBe(
			"That date does not fit this book's calendar: There is no month 14: this calendar has 13."
		)
	})

	test("a clock's time of day is held to the shared range", async () => {
		const user = await makeUser("a15-clock-hour")
		const book = await makeBook(user.id, "Loose")
		const T = await import("./lorebookStoryTime")
		expect(
			await refused(T.lorebookSetClockHandler, user.id, {
				lorebookId: book.id,
				branchId: null,
				clock: { year: 3, month: 1, day: 1, hour: 24 }
			})
		).toBe("An hour is a whole number, 0 to 23.")
		expect(
			await refused(T.lorebookSetClockHandler, user.id, {
				lorebookId: book.id,
				branchId: null,
				clock: { year: 3, month: 1, day: 1, hour: 5, minute: 60 }
			})
		).toBe("A minute is a whole number, 0 to 59.")
	})
})
