/** A dated change's fields in the Edit history: recorded on edit, restored through the same save. */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-amendments-redlines-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number) => ({ user: { id: userId } }) as any
const emit = (() => {}) as any

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Ashfall", userId: user.id })
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			title: "Verity",
			content: "A novice.",
			keys: ["verity"],
			position: 1
		} as any)
		.returning()
	const m = await import("./amendments")
	await m.amendmentsCreateHandler.handler(
		socketOf(user.id),
		{
			lorebookId: book!.id,
			entryId: entry!.id,
			year: 2,
			month: 3,
			fields: { content: "A Keeper." }
		} as any,
		emit
	)
	const [amendment] = await testDb
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.entryId, entry!.id))
	return { user, book: book!, entry: entry!, amendment: amendment!, m }
}

const redlinesOf = (entryId: number) =>
	testDb
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.entryId, entryId))
		.orderBy(schema.loreRedlines.id)

describe("amendments:update and the Edit history", () => {
	test("create leaves no row; a fields edit leaves one with the amendment; a re-date leaves none", async () => {
		const w = await world()
		expect(await redlinesOf(w.entry.id)).toHaveLength(0)
		await w.m.amendmentsUpdateHandler.handler(
			socketOf(w.user.id),
			{
				lorebookId: w.book.id,
				id: w.amendment.id,
				subject: "entry",
				year: 5
			} as any,
			emit
		)
		expect(await redlinesOf(w.entry.id)).toHaveLength(0)
		await w.m.amendmentsUpdateHandler.handler(
			socketOf(w.user.id),
			{
				lorebookId: w.book.id,
				id: w.amendment.id,
				subject: "entry",
				fields: { content: "A Warden." }
			} as any,
			emit
		)
		const rows = await redlinesOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			amendmentId: w.amendment.id,
			cause: "save",
			userId: w.user.id
		})
		expect(rows[0]!.changes).toEqual({
			content: { before: { v: "A Keeper." }, after: { v: "A Warden." } }
		})
	})

	test("Restore puts the keys back and removes a key that was absent before", async () => {
		const { entryRestoreRedlineHandler, entryRedlinesHandler } =
			await import("./redlines")
		const w = await world()
		await w.m.amendmentsUpdateHandler.handler(
			socketOf(w.user.id),
			{
				lorebookId: w.book.id,
				id: w.amendment.id,
				subject: "entry",
				fields: { content: "A Warden.", keys: ["v"] }
			} as any,
			emit
		)
		const [row] = await redlinesOf(w.entry.id)
		expect(row!.changes.keys!.before).toBeNull()
		await entryRestoreRedlineHandler.handler(
			socketOf(w.user.id),
			{ redlineId: row!.id },
			emit
		)
		const [after] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, w.amendment.id))
		expect(after!.fields).toEqual({ content: "A Keeper." })
		const res = await entryRedlinesHandler.handler(
			socketOf(w.user.id),
			{ entryId: w.entry.id },
			emit
		)
		expect(res.redlines[0]).toMatchObject({
			cause: "restore",
			amendmentId: w.amendment.id
		})
		expect(res.redlines[0]!.version).toMatch(/^the change from /)
	})
})
