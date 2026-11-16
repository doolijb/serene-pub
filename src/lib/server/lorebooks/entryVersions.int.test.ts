/** The one writer of an entry's dated version, and the Beginning check it makes. */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { formatDate } from "$lib/shared/lorebooks/storyDate"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-entry-versions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const date = (year: number, month: number | null = null, day: number | null = null) => ({
	year,
	month,
	day
})
const words = (year: number) => formatDate(date(year))

async function world(typeId = WORLD_LORE_TYPE_ID, entryFields: Record<string, unknown> = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `entry-versions-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id })
		.returning()
	const mk = async (type: string, position: number, fields: Record<string, unknown>) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: type,
					typeVersion: 1,
					title: type === HISTORY_TYPE_ID ? null : "Verity",
					content: "A novice.",
					keys: [],
					position,
					fields
				} as any)
				.returning()
		)[0]!
	const entry = await mk(typeId, 1, entryFields)
	const event = await mk(HISTORY_TYPE_ID, 2, {})
	const branch = (
		await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book!.id, name: "other-line" })
			.returning()
	)[0]!
	const m = await import("./entryVersions")
	const write = (
		d: ReturnType<typeof date>,
		fields: Record<string, unknown>,
		extra: { branchId?: number | null; historyEntryId?: number | null } = {}
	) =>
		testDb.transaction((tx) =>
			m.writeEntryVersion(tx as any, {
				lorebookId: book!.id,
				entryId: entry.id,
				branchId: extra.branchId ?? null,
				date: d,
				fields,
				historyEntryId: extra.historyEntryId
			})
		)
	return { book: book!, entry, event, branch, m, write }
}

const rowsOf = (entryId: number) =>
	testDb
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.entryId, entryId))
		.orderBy(schema.entryAmendments.id)

describe("writeEntryVersion", () => {
	test("a first write makes a row", async () => {
		const w = await world()
		const r = await w.write(date(5), { content: "First." })
		expect(r.kind).toBe("made")
		const rows = await rowsOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(r.id).toBe(rows[0]!.id)
		expect(r.after).toEqual({ content: "First." })
		expect(rows[0]!.fields).toEqual({ content: "First." })
		expect(rows[0]!.historyEntryId).toBeNull()
	})

	test("a second write at the same line and date merges", async () => {
		const w = await world()
		await w.write(date(5), { content: "First.", summary: "Kept." })
		const r = await w.write(date(5), { content: "Second." })
		expect(r.kind).toBe("merged")
		if (r.kind !== "merged") return
		expect(r.before).toEqual({ content: "First.", summary: "Kept." })
		expect(r.after).toEqual({ content: "Second.", summary: "Kept." })
		const rows = await rowsOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(r.id).toBe(rows[0]!.id)
		expect(rows[0]!.fields).toEqual(r.after)
	})

	test("another date, or another line, makes a second row", async () => {
		const w = await world()
		await w.write(date(5), { content: "Main." })
		expect((await w.write(date(6), { content: "Later." })).kind).toBe("made")
		expect(
			(await w.write(date(5), { content: "Other." }, { branchId: w.branch.id })).kind
		).toBe("made")
		expect(await rowsOf(w.entry.id)).toHaveLength(3)
	})

	test("a held row at that date is never merged into", async () => {
		const w = await world()
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: w.book.id,
			entryId: w.entry.id,
			branchId: null,
			year: 5,
			fields: { content: "Held." },
			base: { content: { v: "A novice." } }
		} as any)
		const r = await w.write(date(5), { content: "Own." })
		expect(r.kind).toBe("made")
		const rows = await rowsOf(w.entry.id)
		expect(rows).toHaveLength(2)
		expect(rows[0]!.fields).toEqual({ content: "Held." })
	})

	test("a date before the Beginning throws the sentence; its own day is allowed", async () => {
		const w = await world(WORLD_LORE_TYPE_ID, { year: 5 })
		const sentence = `This entry began at ${words(5)}, so a change can't be dated ${words(4)}, before it. Date the change at or after ${words(5)}.`
		await expect(w.write(date(4), { content: "Early." })).rejects.toThrow(sentence)
		expect(await rowsOf(w.entry.id)).toHaveLength(0)
		await testDb.transaction(async (tx) => {
			expect(await w.m.beginningRefusal(tx as any, w.book.id, w.entry.id, date(4))).toBe(sentence)
			expect(await w.m.beginningRefusal(tx as any, w.book.id, w.entry.id, date(5))).toBeNull()
		})
		expect((await w.write(date(5), { content: "On the day." })).kind).toBe("made")
	})

	test("a history entry is not judged", async () => {
		const w = await world(HISTORY_TYPE_ID, { year: 5 })
		expect((await w.write(date(2), { content: "Early." })).kind).toBe("made")
	})

	test("old data with two rows at one date: the higher id is merged into", async () => {
		const w = await world()
		const [low, high] = await testDb
			.insert(schema.entryAmendments)
			.values([
				{ lorebookId: w.book.id, entryId: w.entry.id, branchId: null, year: 5, fields: { content: "Low." } },
				{ lorebookId: w.book.id, entryId: w.entry.id, branchId: null, year: 5, fields: { content: "High." } }
			] as any)
			.returning()
		const r = await w.write(date(5), { summary: "New." })
		expect(r.kind).toBe("merged")
		expect(r.id).toBe(high!.id)
		const rows = await rowsOf(w.entry.id)
		expect(rows.find((x) => x.id === low!.id)!.fields).toEqual({ content: "Low." })
		expect(rows.find((x) => x.id === high!.id)!.fields).toEqual({ content: "High.", summary: "New." })
	})

	test("a history entry id on a merge replaces; absent keeps", async () => {
		const w = await world()
		await w.write(date(5), { content: "A." }, { historyEntryId: w.event.id })
		await w.write(date(5), { content: "B." })
		expect((await rowsOf(w.entry.id))[0]!.historyEntryId).toBe(w.event.id)
		const w2 = await world()
		await w2.write(date(5), { content: "A." })
		await w2.write(date(5), { content: "B." }, { historyEntryId: w2.event.id })
		const rows = await rowsOf(w2.entry.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.historyEntryId).toBe(w2.event.id)
	})
})
