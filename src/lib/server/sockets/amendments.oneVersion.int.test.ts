/**
 * An entry has one dated change per line and date: a second write at that date
 * updates it, and a move onto a taken date is refused.
 */
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
		path.join(os.tmpdir(), "serene-pub-vitest-amendments-one-version-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socketOf = (userId: number) => ({ user: { id: userId } }) as any
const emit = (() => {}) as any
const words = (year: number) => formatDate({ year, month: null, day: null })

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `amend-one-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id })
		.returning()
	const mkEntry = async (
		typeId: string,
		title: string | null,
		position: number
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId,
					typeVersion: 1,
					title,
					content: "A novice.",
					keys: [],
					position,
					fields: {}
				} as any)
				.returning()
		)[0]!
	const entry = await mkEntry(WORLD_LORE_TYPE_ID, "Verity", 1)
	const event = await mkEntry(HISTORY_TYPE_ID, null, 2)
	const branch = (
		await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book!.id, name: "other-line" })
			.returning()
	)[0]!
	const m = await import("./amendments")
	const file = (
		year: number,
		fields: Record<string, unknown>,
		extra: Record<string, unknown> = {}
	) =>
		m.amendmentsCreateHandler.handler(
			socketOf(user.id),
			{
				lorebookId: book!.id,
				entryId: entry.id,
				year,
				fields,
				...extra
			} as any,
			emit
		)
	const move = (id: number, year: number) =>
		m.amendmentsUpdateHandler.handler(
			socketOf(user.id),
			{ lorebookId: book!.id, subject: "entry", id, year } as any,
			emit
		)
	return { user, book: book!, entry, event, branch, m, file, move }
}

const rowsOf = (entryId: number) =>
	testDb
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.entryId, entryId))
		.orderBy(schema.entryAmendments.id)

describe("one change per entry, line and date", () => {
	test("a second create at one date merges into the row and records an edit", async () => {
		const w = await world()
		await w.file(5, { content: "First.", summary: "Kept." })
		await w.file(5, { content: "Second." })
		const rows = await rowsOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.fields).toMatchObject({
			content: "Second.",
			summary: "Kept."
		})
		const redlines = await testDb
			.select()
			.from(schema.loreRedlines)
			.where(eq(schema.loreRedlines.amendmentId, rows[0]!.id))
		expect(redlines).toHaveLength(1)
		expect(redlines[0]!.cause).toBe("save")
		expect((redlines[0]!.changes as any).content).toEqual({
			before: { v: "First." },
			after: { v: "Second." }
		})
	})

	test("another line, or another date, is a second row", async () => {
		const w = await world()
		await w.file(5, { content: "Main." })
		await w.file(5, { content: "Other line." }, { branchId: w.branch.id })
		await w.file(6, { content: "Later." })
		expect(await rowsOf(w.entry.id)).toHaveLength(3)
		await w.file(
			5,
			{ content: "Other line again." },
			{ branchId: w.branch.id }
		)
		expect(await rowsOf(w.entry.id)).toHaveLength(3)
	})

	test("a held change at that date and line is not merged into", async () => {
		const w = await world()
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: w.book.id,
			entryId: w.entry.id,
			branchId: null,
			year: 5,
			fields: { content: "Held." },
			base: { content: { v: "A novice." } }
		} as any)
		await w.file(5, { content: "Own." })
		const rows = await rowsOf(w.entry.id)
		expect(rows).toHaveLength(2)
		expect(rows[0]!.fields).toEqual({ content: "Held." })
	})

	test("a merge keeps the stored history entry unless the create carries one", async () => {
		const w = await world()
		await w.file(5, { content: "A." }, { historyEntryId: w.event.id })
		await w.file(5, { content: "B." })
		expect((await rowsOf(w.entry.id))[0]!.historyEntryId).toBe(w.event.id)
		const w2 = await world()
		await w2.file(5, { content: "A." })
		await w2.file(5, { content: "B." }, { historyEntryId: w2.event.id })
		const rows = await rowsOf(w2.entry.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.historyEntryId).toBe(w2.event.id)
	})

	test("moving onto a taken date is refused; onto a free date, or one only another line has, moves", async () => {
		const w = await world()
		await w.file(5, { content: "Five." })
		await w.file(6, { content: "Six." })
		await w.file(
			8,
			{ content: "Eight on other line." },
			{ branchId: w.branch.id }
		)
		const [five, six] = await rowsOf(w.entry.id)
		await expect(w.move(six!.id, 5)).rejects.toThrow(
			`This entry already has a version dated ${words(5)} on this line. Pick another date, or change that version instead.`
		)
		const after = await rowsOf(w.entry.id)
		expect(after.map((r) => r.year)).toEqual([5, 6, 8])
		await w.move(six!.id, 7)
		await w.move(five!.id, 8)
		expect((await rowsOf(w.entry.id)).map((r) => r.year)).toEqual([8, 7, 8])
	})
})
