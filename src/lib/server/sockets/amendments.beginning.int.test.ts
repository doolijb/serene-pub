/**
 * A dated change of an entry that has a Beginning: never dated before it, never
 * carrying a decay; a history entry's dated change is judged as before.
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
		path.join(os.tmpdir(), "serene-pub-vitest-amendments-beginning-")
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

async function world(typeId: string, fields: Record<string, unknown>) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `amend-beginning-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id })
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId,
			typeVersion: 1,
			title: typeId === HISTORY_TYPE_ID ? null : "Verity",
			content: "A novice.",
			keys: [],
			position: 1,
			fields
		} as any)
		.returning()
	const m = await import("./amendments")
	const file = (year: number, extra: Record<string, unknown> = {}) =>
		m.amendmentsCreateHandler.handler(
			socketOf(user.id),
			{
				lorebookId: book!.id,
				entryId: entry!.id,
				year,
				fields: { content: "Later." },
				...extra
			} as any,
			emit
		)
	return { user, book: book!, entry: entry!, m, file }
}

const rowsOf = (entryId: number) =>
	testDb
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.entryId, entryId))

describe("a dated change of an entry with a Beginning", () => {
	test("carrying a decay is refused with the sentence", async () => {
		const w = await world(WORLD_LORE_TYPE_ID, { year: 5 })
		await expect(w.file(6, { fields: { decayRate: 0.5 } })).rejects.toThrow(
			"A dated change can't change an entry's decay: the decay is part of the entry, so changing it means changing the entry itself."
		)
		expect(await rowsOf(w.entry.id)).toHaveLength(0)
	})

	test("before the Beginning is refused; on its day and after are accepted", async () => {
		const w = await world(WORLD_LORE_TYPE_ID, { year: 5 })
		await expect(w.file(4)).rejects.toThrow(
			`This entry began at ${words(5)}, so a change can't be dated ${words(4)}, before it. Date the change at or after ${words(5)}.`
		)
		expect(await rowsOf(w.entry.id)).toHaveLength(0)
		await w.file(5)
		await w.file(6)
		expect(await rowsOf(w.entry.id)).toHaveLength(2)
	})

	test("moving a change before the Beginning is refused; moving it after is accepted", async () => {
		const w = await world(WORLD_LORE_TYPE_ID, { year: 5 })
		await w.file(7)
		const [row] = await rowsOf(w.entry.id)
		const move = (year: number) =>
			w.m.amendmentsUpdateHandler.handler(
				socketOf(w.user.id),
				{
					lorebookId: w.book.id,
					subject: "entry",
					id: row!.id,
					year
				} as any,
				emit
			)
		await expect(move(3)).rejects.toThrow(`began at ${words(5)}`)
		expect((await rowsOf(w.entry.id))[0]!.year).toBe(7)
		await move(5)
		expect((await rowsOf(w.entry.id))[0]!.year).toBe(5)
	})

	test("an entry with no Beginning is not judged", async () => {
		const w = await world(WORLD_LORE_TYPE_ID, {})
		await w.file(1)
		expect(await rowsOf(w.entry.id)).toHaveLength(1)
	})

	test("a history entry's dated change is unchanged", async () => {
		const w = await world(HISTORY_TYPE_ID, { year: 5 })
		await w.file(2)
		expect(await rowsOf(w.entry.id)).toHaveLength(1)
	})
})
