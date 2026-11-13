/**
 * One history entry per date per line (★H1/★H2/★H3, owner, 2026-11-10), through
 * the socket handlers: a direct create or re-date onto a taken date is refused,
 * a fork owns only days after its fork date, and the "entry of this day" paths
 * (a blank session write, `entries:iterateNext`) find the existing entry.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(
			os.tmpdir(),
			"serene-pub-entries-history-date-unique-int-test-"
		)
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const T = 60_000
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noop = () => {}

type D = { year: number; month?: number; day?: number }

let seq = 0
async function seedBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `hist-unique-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Dates ${seq}`, userId: owner.id })
		.returning()
	const fork = { forkYear: 5, forkMonth: 1, forkDay: 3 }
	const [north] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "north", ...fork })
		.returning()
	const [south] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "south", ...fork })
		.returning()
	const seed = async (d: D, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					historyValues([
						{ lorebookId: book.id, ...d, branchId } as any
					])
				)
				.returning()
		)[0]
	const session = async (clock: D) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					name: "s",
					lorebookId: book.id,
					lorebookBranchId: null,
					storyClockYear: clock.year,
					storyClockMonth: clock.month ?? null,
					storyClockDay: clock.day ?? null,
					isGroup: false
				} as any)
				.returning()
		)[0]
	return { owner, book, north, south, seed, session }
}

const historyRows = async (lorebookId: number) =>
	testDb
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)

const blank = (lorebookId: number, d: D, extra: Record<string, any> = {}) => ({
	typeId: HISTORY_TYPE_ID,
	lorebookId,
	content: "",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	...d,
	...extra
})

async function create(userId: number, params: any): Promise<{ entry: any }> {
	const { createEntryHandler } = await import("./entries")
	return createEntryHandler.handler(fakeSocket(userId), params, noop)
}
async function update(userId: number, entry: any) {
	const { updateEntryHandler } = await import("./entries")
	return updateEntryHandler.handler(
		fakeSocket(userId),
		{ entry: { typeId: HISTORY_TYPE_ID, ...entry } } as any,
		noop
	)
}
async function iterate(userId: number, id: number, branchId?: number | null) {
	const { iterateNextEntryHandler } = await import("./entries")
	return iterateNextEntryHandler.handler(
		fakeSocket(userId),
		{ id, typeId: HISTORY_TYPE_ID, branchId } as any,
		noop
	)
}

const TAKEN = (line: string, date: string) =>
	`${line} already has a history entry for ${date}. Open it, or choose another date.`
const SHARES = (line: string, fork: string, parent: string) =>
	`${line} shares everything up to ${fork} with ${parent}. Change that day here as an amendment, or choose a later date.`

describe("entries:create refuses a taken history date", () => {
	test(
		"main date taken: refused with the sentence, nothing written",
		async () => {
			const w = await seedBook()
			await w.seed({ year: 2, month: 3, day: 4 })
			await expect(
				create(w.owner.id, {
					entry: blank(w.book.id, { year: 2, month: 3, day: 4 })
				})
			).rejects.toThrow(TAKEN("main", "Year 2, Mo. 3, Day 4"))
			expect(await historyRows(w.book.id)).toHaveLength(1)
		},
		T
	)

	test(
		"partial dates are distinct: Y2, Y2 M5, Y2 M5 D3 all create",
		async () => {
			const w = await seedBook()
			await create(w.owner.id, { entry: blank(w.book.id, { year: 2 }) })
			await create(w.owner.id, {
				entry: blank(w.book.id, { year: 2, month: 5 })
			})
			await create(w.owner.id, {
				entry: blank(w.book.id, { year: 2, month: 5, day: 3 })
			})
			expect(await historyRows(w.book.id)).toHaveLength(3)
		},
		T
	)

	test(
		"H3: a third create on a doubled date is refused",
		async () => {
			const w = await seedBook()
			await w.seed({ year: 2, month: 3, day: 4 })
			await w.seed({ year: 2, month: 3, day: 4 })
			await expect(
				create(w.owner.id, {
					entry: blank(w.book.id, { year: 2, month: 3, day: 4 })
				})
			).rejects.toThrow(TAKEN("main", "Year 2, Mo. 3, Day 4"))
			expect(await historyRows(w.book.id)).toHaveLength(2)
		},
		T
	)
})

describe("entries:update re-dating", () => {
	test(
		"re-date onto a taken date is refused",
		async () => {
			const w = await seedBook()
			await w.seed({ year: 2, month: 3, day: 4 })
			const other = await w.seed({ year: 2, month: 3, day: 9 })
			await expect(
				update(w.owner.id, { id: other.id, year: 2, month: 3, day: 4 })
			).rejects.toThrow(TAKEN("main", "Year 2, Mo. 3, Day 4"))
		},
		T
	)

	test(
		"a doubled date: an edit resending the unchanged date passes; a re-date away passes",
		async () => {
			const w = await seedBook()
			const a = await w.seed({ year: 2, month: 3, day: 4 })
			await w.seed({ year: 2, month: 3, day: 4 })
			await update(w.owner.id, {
				id: a.id,
				content: "edited",
				year: 2,
				month: 3,
				day: 4
			})
			const [row] = await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, a.id))
			expect(row.content).toBe("edited")
			await update(w.owner.id, { id: a.id, year: 2, month: 3, day: 7 })
			const [moved] = await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, a.id))
			expect((moved.fields as any).day).toBe(7)
		},
		T
	)
})

describe("forks own only days after their fork date (rule C)", () => {
	test(
		"north creating at its fork day or earlier is refused; after it passes",
		async () => {
			const w = await seedBook()
			const sentence = SHARES("north", "Year 5, Mo. 1, Day 3", "main")
			for (const d of [
				{ year: 5, month: 1, day: 3 },
				{ year: 4, month: 2, day: 1 }
			])
				await expect(
					create(w.owner.id, {
						entry: blank(w.book.id, d, { branchId: w.north.id })
					})
				).rejects.toThrow(sentence)
			expect(await historyRows(w.book.id)).toHaveLength(0)
			const { entry } = await create(w.owner.id, {
				entry: blank(
					w.book.id,
					{ year: 5, month: 1, day: 4 },
					{ branchId: w.north.id }
				)
			})
			expect(entry.branchId).toBe(w.north.id)
		},
		T
	)

	test(
		"a sibling fork creates at the same post-fork date; main is never refused because of a fork",
		async () => {
			const w = await seedBook()
			const d = { year: 5, month: 1, day: 4 }
			await create(w.owner.id, {
				entry: blank(w.book.id, d, { branchId: w.north.id })
			})
			await create(w.owner.id, {
				entry: blank(w.book.id, d, { branchId: w.south.id })
			})
			await create(w.owner.id, { entry: blank(w.book.id, d) })
			expect(await historyRows(w.book.id)).toHaveLength(3)
		},
		T
	)
})

describe("entries:iterateNext finds the entry of the next day", () => {
	test(
		"a next day that already has an entry is the answer; no row is made",
		async () => {
			const w = await seedBook()
			const a = await w.seed({ year: 2, month: 3, day: 4 })
			const b = await w.seed({ year: 2, month: 3, day: 5 })
			const { entry } = await iterate(w.owner.id, a.id)
			expect(entry.id).toBe(b.id)
			expect(await historyRows(w.book.id)).toHaveLength(2)
		},
		T
	)

	test(
		"from north onto a day at or before its fork with no main entry: one empty row on main",
		async () => {
			const w = await seedBook()
			const a = await w.seed({ year: 5, month: 1, day: 1 }, w.north.id)
			// north has nothing before its fork of its own, so the next day
			// (Y5 M1 D2) is main's to own.
			const before = (await historyRows(w.book.id)).length
			const { entry } = await iterate(w.owner.id, a.id, w.north.id)
			expect([
				(entry as any).year,
				(entry as any).month,
				(entry as any).day
			]).toEqual([5, 1, 2])
			expect(entry.branchId ?? null).toBeNull()
			expect(entry.content).toBe("")
			expect(await historyRows(w.book.id)).toHaveLength(before + 1)
		},
		T
	)
})

describe("a session write is the entry of its day", () => {
	test(
		"blank, on a day that has an entry: the answer is that entry; no row is made",
		async () => {
			const w = await seedBook()
			const a = await w.seed({ year: 2, month: 3, day: 4 })
			const s = await w.session({ year: 2, month: 3, day: 4 })
			const { entry } = await create(w.owner.id, {
				entry: blank(w.book.id, {} as D),
				sessionId: s.id
			})
			expect(entry.id).toBe(a.id)
			expect(await historyRows(w.book.id)).toHaveLength(1)
		},
		T
	)

	test(
		"with content, on a day that has an entry: refused with the sentence",
		async () => {
			const w = await seedBook()
			await w.seed({ year: 2, month: 3, day: 4 })
			const s = await w.session({ year: 2, month: 3, day: 4 })
			await expect(
				create(w.owner.id, {
					entry: blank(w.book.id, {} as D, { content: "Something." }),
					sessionId: s.id
				})
			).rejects.toThrow(TAKEN("main", "Year 2, Mo. 3, Day 4"))
			expect(await historyRows(w.book.id)).toHaveLength(1)
		},
		T
	)
})
