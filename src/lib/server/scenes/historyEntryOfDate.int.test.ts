/**
 * `historyEntryOfDate` (§0-B): the one place that answers "which history entry
 * is this date's", and makes it when asked to.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-history-entry-of-date-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
async function makeBook(
	dates: Array<{
		year: number
		month?: number
		day?: number
		branchId?: number
	}> = []
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `entry-of-date-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Dated ${seq}`, userId: user.id })
		.returning()
	const entries =
		dates.length > 0
			? await testDb
					.insert(schema.lorebookEntries)
					.values(
						historyValues(
							dates.map(
								(d) => ({ lorebookId: book.id, ...d }) as any
							)
						)
					)
					.returning()
			: []
	return { book, entries }
}

const historyRows = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)

async function ask(
	lorebookId: number,
	date: { year: number; month: number | null; day: number | null } | null,
	create: boolean,
	branchId: number | null = null
) {
	const { historyEntryOfDate } = await import("./historyEntryOfDate")
	return testDb.transaction(async (tx) =>
		historyEntryOfDate(
			tx as any,
			{ lorebookId, branchId, date },
			{ create }
		)
	)
}

describe("historyEntryOfDate", () => {
	test("answers the entry dated that day without making one; of two, the lower id", async () => {
		const { book, entries } = await makeBook([
			{ year: 5, month: 1, day: 2 },
			{ year: 5, month: 1, day: 2 },
			{ year: 5, month: 1, day: 3 }
		])
		const lower = entries[0].id < entries[1].id ? entries[0] : entries[1]
		const got = await ask(book.id, { year: 5, month: 1, day: 2 }, true)
		expect(got).toEqual({
			historyEntryId: lower.id,
			created: false,
			date: { year: 5, month: 1, day: 2 }
		})
		expect(await historyRows(book.id)).toHaveLength(3)
	}, 60_000)

	test("none that day: create false answers null; create true makes it after the last position, once", async () => {
		const { book, entries } = await makeBook([
			{ year: 5, month: 1, day: 2 }
		])
		const date = { year: 5, month: 1, day: 9 }
		expect(await ask(book.id, date, false)).toBeNull()
		expect(await historyRows(book.id)).toHaveLength(1)

		const made = await ask(book.id, date, true)
		expect(made!.created).toBe(true)
		const rows = await historyRows(book.id)
		expect(rows).toHaveLength(2)
		const row = rows.find((r) => r.id === made!.historyEntryId)!
		expect(row.fields).toMatchObject({ year: 5, month: 1, day: 9 })
		expect(row.position).toBe(entries[0].position + 1)

		expect(made!.date).toEqual({ year: 5, month: 1, day: 9 })
		expect(await ask(book.id, date, true)).toEqual({
			historyEntryId: made!.historyEntryId,
			created: false,
			date: { year: 5, month: 1, day: 9 }
		})
		expect(await historyRows(book.id)).toHaveLength(2)
	}, 60_000)

	test("a Day-count date dates by year only", async () => {
		const { book, entries } = await makeBook([{ year: 3 }])
		const date = { year: 3, month: null, day: 2 }
		expect(await ask(book.id, date, false)).toEqual({
			historyEntryId: entries[0].id,
			created: false,
			date: { year: 3, month: null, day: null }
		})

		const other = await makeBook()
		const made = await ask(other.book.id, date, true)
		expect(made!.created).toBe(true)
		const [row] = await historyRows(other.book.id)
		expect(row.fields).toMatchObject({ year: 3 })
		expect((row.fields as any).month ?? null).toBeNull()
		expect((row.fields as any).day ?? null).toBeNull()
	}, 60_000)

	test("a sibling line's entry is never the answer", async () => {
		const { book } = await makeBook([{ year: 5, month: 1, day: 2 }])
		const [branch] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "North" })
			.returning()
		const [sibling] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "South" })
			.returning()
		await testDb.insert(schema.lorebookEntries).values(
			historyValues([
				{
					lorebookId: book.id,
					year: 6,
					month: 1,
					day: 1,
					branchId: sibling.id
				} as any
			])
		)
		expect(
			await ask(book.id, { year: 6, month: 1, day: 1 }, false, branch.id)
		).toBeNull()
	}, 60_000)

	test("no date: the newest dated entry, else Year 1, Month 1, Day 1", async () => {
		const { book, entries } = await makeBook([
			{ year: 2, month: 1, day: 1 },
			{ year: 7, month: 4, day: 5 },
			{ year: 4, month: 1, day: 1 }
		])
		expect(await ask(book.id, null, true)).toEqual({
			historyEntryId: entries[1].id,
			created: false,
			date: { year: 7, month: 4, day: 5 }
		})

		const empty = await makeBook()
		const made = await ask(empty.book.id, null, true)
		expect(made!.created).toBe(true)
		const [row] = await historyRows(empty.book.id)
		expect(row.fields).toMatchObject({ year: 1, month: 1, day: 1 })
		expect(made!.date).toEqual({ year: 1, month: 1, day: 1 })
	}, 60_000)

	test("pickEntryOfDate: exact day, ties to the lowest id, no date the newest, a sibling line's row skipped", async () => {
		const { pickEntryOfDate } = await import("./historyEntryOfDate")
		const { MAIN_LINE, lineOf } = await import(
			"$lib/shared/lorebooks/lineReading"
		)
		const row = (
			id: number,
			fields: Record<string, number>,
			branchId: number | null = null
		) => ({ id, branchId, fields })
		const rows = [
			row(1, { year: 5, month: 1, day: 2 }),
			row(2, { year: 5, month: 1, day: 2 }),
			row(3, { year: 5, month: 1, day: 3 }),
			row(4, { year: 9, month: 1, day: 1 }, 99),
			row(5, {}),
			row(6, { year: 5, month: 1, day: 2 }, 98)
		]
		expect(
			pickEntryOfDate(rows, MAIN_LINE, { year: 5, month: 1, day: 2 })
		).toEqual({
			historyEntryId: 1,
			date: { year: 5, month: 1, day: 2 }
		})
		expect(
			pickEntryOfDate(rows, MAIN_LINE, { year: 5, month: 1, day: 8 })
		).toBeNull()
		expect(pickEntryOfDate(rows, MAIN_LINE, null)).toEqual({
			historyEntryId: 3,
			date: { year: 5, month: 1, day: 3 }
		})
		// Line 99 reads its own row (the newest) and main's; never line 98's.
		const line99 = lineOf(99, [{ id: 99 }, { id: 98 }])
		expect(pickEntryOfDate(rows, line99, null)).toEqual({
			historyEntryId: 4,
			date: { year: 9, month: 1, day: 1 }
		})
		expect(
			pickEntryOfDate(rows, line99, { year: 5, month: 1, day: 2 })!
				.historyEntryId
		).toBe(1)
	})
})

describe("one tie-break: the lowest id", () => {
	test("historyEntryOver: the later date, then the lower id", async () => {
		const { historyEntryOver } = await import("$lib/server/state/reading")
		const d = { year: 5, month: 1, day: 2 }
		expect(historyEntryOver({ id: 1, date: d }, { id: 2, date: d })).toBe(true)
		expect(historyEntryOver({ id: 2, date: d }, { id: 1, date: d })).toBe(false)
		expect(
			historyEntryOver(
				{ id: 9, date: { year: 6, month: null, day: null } },
				{ id: 1, date: d }
			)
		).toBe(true)
		expect(
			historyEntryOver(
				{ id: 1, date: d },
				{ id: 9, date: { year: 6, month: null, day: null } }
			)
		).toBe(false)
	})

	test("two main entries on the newest date: the finder and writeDatingAt answer the same, lower id", async () => {
		const { book, entries } = await makeBook([
			{ year: 4, month: 1, day: 1 },
			{ year: 5, month: 1, day: 2 },
			{ year: 5, month: 1, day: 2 }
		])
		const lowest = Math.min(entries[1].id, entries[2].id)
		const found = await ask(book.id, { year: 5, month: 1, day: 2 }, false)
		const { readingOf, writeDatingAt } = await import(
			"$lib/server/state/reading"
		)
		const reading = await readingOf(testDb as any, book.id)
		const dating = await writeDatingAt(testDb as any, reading)
		expect(found!.historyEntryId).toBe(lowest)
		expect(dating!.historyEntryId).toBe(lowest)
	}, 60_000)
})

describe("a fork's day-entry belongs to the line that owns the date (rule C)", () => {
	async function forkedBook() {
		const { book, entries } = await makeBook([
			{ year: 5, month: 1, day: 1 }
		])
		const [north] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book.id,
				name: "North",
				forkYear: 5,
				forkMonth: 1,
				forkDay: 3
			})
			.returning()
		return { book, entries, north }
	}

	test("North asking for its fork day, or earlier, creates one empty row on main; main then answers the same; a later day is North's own", async () => {
		const { book, north } = await forkedBook()
		const { compileSaveOf } = await import(
			"$lib/client/lorebooks/editor/compileSave"
		)
		const fork = { year: 5, month: 1, day: 3 }
		const before = { year: 5, month: 1, day: 2 }
		for (const date of [fork, before]) {
			const made = await ask(book.id, date, true, north.id)
			expect(made!.created).toBe(true)
			const row = (await historyRows(book.id)).find(
				(r) => r.id === made!.historyEntryId
			)!
			expect(row.branchId).toBeNull()
			expect(row.content).toBe("")
			const count = (await historyRows(book.id)).length

			const fromMain = await ask(book.id, date, true)
			expect(fromMain).toMatchObject({
				historyEntryId: made!.historyEntryId,
				created: false
			})
			const again = await ask(book.id, date, true, north.id)
			expect(again).toMatchObject({
				historyEntryId: made!.historyEntryId,
				created: false
			})
			expect(await historyRows(book.id)).toHaveLength(count)

			expect(
				compileSaveOf(
					{ branchId: row.branchId, ...date },
					{ branchId: north.id, moment: null }
				)
			).toEqual({
				kind: "amendment",
				branchId: north.id,
				date,
				atEntryDate: true
			})
		}

		const after = await ask(
			book.id,
			{ year: 5, month: 1, day: 4 },
			true,
			north.id
		)
		expect(after!.created).toBe(true)
		const own = (await historyRows(book.id)).find(
			(r) => r.id === after!.historyEntryId
		)!
		expect(own.branchId).toBe(north.id)
	}, 60_000)
})

describe("assertHistoryDateFree", () => {
	async function check(
		at: {
			lorebookId: number
			branchId: number | null
			date: { year: number; month?: number | null; day?: number | null } | null
			exceptId?: number
		}
	) {
		const { assertHistoryDateFree } = await import("./historyEntryOfDate")
		return testDb.transaction(async (tx) =>
			assertHistoryDateFree(tx as any, at as any)
		)
	}
	const d2 = { year: 5, month: 1, day: 2 }

	test("main: a taken date is refused with the sentence; exceptId lets the row pass; partial dates are distinct; undated rows are ignored", async () => {
		const { book, entries } = await makeBook([d2])
		const taken =
			"main already has a history entry for Year 5, Mo. 1, Day 2. Open it, or choose another date."
		await expect(
			check({ lorebookId: book.id, branchId: null, date: d2 })
		).rejects.toThrow(taken)
		await expect(
			check({
				lorebookId: book.id,
				branchId: null,
				date: { year: 5, month: 1, day: 2, hour: 9 } as any
			})
		).rejects.toThrow(taken)
		await check({
			lorebookId: book.id,
			branchId: null,
			date: d2,
			exceptId: entries[0].id
		})
		await check({ lorebookId: book.id, branchId: null, date: { year: 5 } })
		await check({
			lorebookId: book.id,
			branchId: null,
			date: { year: 5, month: 1 }
		})
		await check({ lorebookId: book.id, branchId: null, date: null })

		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: {} })
			.where(eq(schema.lorebookEntries.id, entries[0].id))
		await check({ lorebookId: book.id, branchId: null, date: d2 })
	}, 60_000)

	test("a foreign branch id is a BranchRefusal", async () => {
		const { BranchRefusal } = await import("$lib/server/state/reading")
		const { book } = await makeBook()
		await expect(
			check({ lorebookId: book.id, branchId: 987654, date: d2 })
		).rejects.toBeInstanceOf(BranchRefusal)
	}, 60_000)

	test("forks: rule C refuses at or before the fork day; after it the line is free of main's entries and of a sibling's", async () => {
		const { book, entries } = await makeBook([
			{ year: 5, month: 1, day: 1 },
			{ year: 5, month: 1, day: 5 }
		])
		const [north] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book.id,
				name: "North",
				forkYear: 5,
				forkMonth: 1,
				forkDay: 3
			})
			.returning()
		const [south] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book.id,
				name: "South",
				forkYear: 5,
				forkMonth: 1,
				forkDay: 3
			})
			.returning()
		const [loose] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "Loose" })
			.returning()
		const shared =
			"North shares everything up to Year 5, Mo. 1, Day 3 with main. Change that day here as an amendment, or choose a later date."
		await expect(
			check({
				lorebookId: book.id,
				branchId: north.id,
				date: { year: 5, month: 1, day: 3 }
			})
		).rejects.toThrow(shared)
		await expect(
			check({
				lorebookId: book.id,
				branchId: north.id,
				date: { year: 5, month: 1, day: 2 }
			})
		).rejects.toThrow(shared)
		// After the fork, a date main also has is free on North.
		await check({
			lorebookId: book.id,
			branchId: north.id,
			date: { year: 5, month: 1, day: 5 }
		})
		// North's own post-fork entry; South reuses its date; main too.
		await testDb.insert(schema.lorebookEntries).values(
			historyValues([
				{
					lorebookId: book.id,
					year: 5,
					month: 1,
					day: 6,
					branchId: north.id
				} as any
			])
		)
		await expect(
			check({
				lorebookId: book.id,
				branchId: north.id,
				date: { year: 5, month: 1, day: 6 }
			})
		).rejects.toThrow(
			"North already has a history entry for Year 5, Mo. 1, Day 6. Open it, or choose another date."
		)
		await check({
			lorebookId: book.id,
			branchId: south.id,
			date: { year: 5, month: 1, day: 6 }
		})
		await check({
			lorebookId: book.id,
			branchId: null,
			date: { year: 5, month: 1, day: 6 }
		})
		// A rule-C-breaking own row of North (dated before its fork) never refuses main.
		await testDb.insert(schema.lorebookEntries).values(
			historyValues([
				{
					lorebookId: book.id,
					year: 5,
					month: 1,
					day: 2,
					branchId: north.id
				} as any
			])
		)
		await check({
			lorebookId: book.id,
			branchId: null,
			date: { year: 5, month: 1, day: 2 }
		})
		// A dateless fork owns no dated history.
		await expect(
			check({
				lorebookId: book.id,
				branchId: loose.id,
				date: { year: 5, month: 1, day: 9 }
			})
		).rejects.toThrow(
			"Loose follows main with no fork date, so its dated history is main's. Change that day here as an amendment."
		)
		void entries
	}, 60_000)

	test("a dateless fork under a dated fork names the line that owns the day, not its parent", async () => {
		const { book } = await makeBook([{ year: 5, month: 1, day: 1 }])
		const [x] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book.id,
				name: "Xline",
				forkYear: 5,
				forkMonth: 1,
				forkDay: 3
			})
			.returning()
		const [d] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book.id,
				name: "Deep",
				forkedFromBranchId: x.id
			})
			.returning()
		// Year 5 Day 2 is at or before Xline's fork: main owns it, not Xline.
		await expect(
			check({
				lorebookId: book.id,
				branchId: d.id,
				date: { year: 5, month: 1, day: 2 }
			})
		).rejects.toThrow(
			"Deep follows main with no fork date, so its dated history is main's. Change that day here as an amendment."
		)
	}, 60_000)
})

describe("lorebookDayOfDate — does the lorebook hold this day", () => {
	test("answers the lorebook's entry for that exact day on the line, else null; reads only", async () => {
		const { lorebookDayOfDate } = await import("./historyEntryOfDate")
		const { book, entries } = await makeBook([
			{ year: 5, month: 1, day: 2 },
			{ year: 5, month: 1, day: 2 },
			{ year: 5 }
		])
		const lower = entries[0].id < entries[1].id ? entries[0] : entries[1]
		const hold = (date: { year: number; month: number | null; day: number | null }) =>
			testDb.transaction(async (tx) =>
				lorebookDayOfDate(tx as any, { lorebookId: book.id, branchId: null, date })
			)
		expect(await hold({ year: 5, month: 1, day: 2 })).toEqual({
			historyEntryId: lower.id,
			date: { year: 5, month: 1, day: 2 }
		})
		// A day alone: Year 5 Month 1 Day 3 is not held by the Year 5 entry.
		expect(await hold({ year: 5, month: 1, day: 3 })).toBeNull()
		expect(await historyRows(book.id)).toHaveLength(3)
	}, 60_000)
})

describe("historyEntryOfDate — calendarBookId", () => {
	test("a made day's date must land in the calendar of the book named, not the book it is made in", async () => {
		const { historyEntryOfDate } = await import("./historyEntryOfDate")
		const { book } = await makeBook()
		const { book: other } = await makeBook()
		await testDb
			.update(schema.lorebooks)
			.set({ storyCalendar: { months: [{ name: "Thaw", days: 30 }] } as any })
			.where(eq(schema.lorebooks.id, other.id))
		const make = (calendarBookId?: number) =>
			testDb.transaction(async (tx) =>
				historyEntryOfDate(
					tx as any,
					{ lorebookId: book.id, branchId: null, date: { year: 2, month: 2, day: 1 } },
					{ create: true, ...(calendarBookId ? { calendarBookId } : {}) }
				)
			)
		// One month in the other book's calendar: month 2 does not land there.
		await expect(make(other.id)).rejects.toThrow("does not fit this book's calendar")
		expect(await historyRows(book.id)).toHaveLength(0)
		// Absent, the book it is made in (free-form: lands).
		expect((await make()).created).toBe(true)
	}, 60_000)
})
