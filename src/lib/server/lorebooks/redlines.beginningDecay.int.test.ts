/** A person's save of an entry's Beginning and decay rate, its Edit-history row, and Restore. */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
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
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-redlines-bd-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(async () => {
	;(await import("$lib/server/pipelines/runtime/runRegistry"))._reset()
})

const socketOf = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin } }) as any

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	return {
		sent,
		emit: ((event: string, data: any) =>
			void sent.push({ event, data })) as any
	}
}

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `${++n}`
	const user = await createTestUser(testDb, `redline-${tag}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${tag}`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Session ${tag}`,
			lorebookId: book!.id
		})
		.returning()
	const entry = await add(book!.id, "Mira", "A baker.")
	return { user, book: book!, session: session!, entry, tag }
}

async function add(
	lorebookId: number,
	title: string,
	content: string,
	over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content,
			keys: ["mira"],
			...over
		})
		.returning()
	return row!
}

const rowOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const redlinesOf = (entryId: number) =>
	testDb
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.entryId, entryId))
		.orderBy(schema.loreRedlines.id)

const save = async (userId: number, entry: Record<string, unknown>) => {
	const { updateEntryHandler } = await import("../sockets/entries")
	return updateEntryHandler.handler(
		socketOf(userId),
		{ entry: { typeId: WORLD_LORE_TYPE_ID, ...entry } as any },
		recorder().emit
	)
}

const restore = async (userId: number, redlineId: number) => {
	const { entryRestoreRedlineHandler } = await import("../sockets/redlines")
	return entryRestoreRedlineHandler.handler(
		socketOf(userId),
		{ redlineId },
		recorder().emit
	)
}

const beginningOf = (row: { fields: unknown }) => {
	const f = (row.fields ?? {}) as Record<string, unknown>
	return { year: f.year ?? null, month: f.month ?? null, day: f.day ?? null }
}

describe("an entry's Beginning and decay rate in its Edit history", () => {
	test("one save records one row naming both, and Restore puts back 0 and Perpetual", async () => {
		const w = await world()
		await save(w.user.id, {
			id: w.entry.id,
			decayRate: 0.4,
			year: 5,
			month: 2
		})
		const rows = await redlinesOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(Object.keys(rows[0]!.changes).sort()).toEqual([
			"decayRate",
			"month",
			"year"
		])
		expect(rows[0]!.changes.decayRate).toEqual({
			before: { v: 0 },
			after: { v: 0.4 }
		})
		expect(rows[0]!.changes.year).toEqual({
			before: { v: null },
			after: { v: 5 }
		})
		const after = await rowOf(w.entry.id)
		expect(after.decayRate).toBe(0.4)
		expect(beginningOf(after)).toEqual({ year: 5, month: 2, day: null })

		await restore(w.user.id, rows[0]!.id)
		const back = await rowOf(w.entry.id)
		expect(back.decayRate).toBe(0)
		expect(beginningOf(back)).toEqual({
			year: null,
			month: null,
			day: null
		})
	})

	test("a save changing only the rate records the rate", async () => {
		const w = await world()
		await save(w.user.id, { id: w.entry.id, decayRate: 0.7 })
		const rows = await redlinesOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(Object.keys(rows[0]!.changes)).toEqual(["decayRate"])
		await restore(w.user.id, rows[0]!.id)
		expect((await rowOf(w.entry.id)).decayRate).toBe(0)
	})
})
