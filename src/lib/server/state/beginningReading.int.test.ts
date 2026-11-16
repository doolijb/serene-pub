/**
 * An entry's Beginning is read by the readers that already cut any row whose
 * `fields` hold a numeric `year`: absent at a moment before it, present on it
 * and after it; an undated entry (Perpetual) is present everywhere; a book with
 * no Timeline reads no moment; a fork's cut applies as it does to any row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { readingOf } from "./reading"
import { entriesAsRead } from "./entriesOnReading"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-beginningReading-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function world(timelineEnabled: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `beginning-reading-${++n}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id, timelineEnabled })
		.returning()
	const lore = async (title: string, fields: Record<string, unknown>) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: WORLD_LORE_TYPE_ID,
					typeVersion: 1,
					title,
					content: title,
					keys: [],
					position: ++n,
					fields
				} as any)
				.returning()
		)[0]!
	const fork = async (year: number) =>
		(
			await db
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: book!.id,
					name: `Fork ${year}`,
					forkYear: year
				})
				.returning()
		)[0]!
	return { book: book!, lore, fork }
}

async function seen(
	bookId: number,
	pick: { branch?: number | "main"; moment?: { year: number } | null }
): Promise<string[]> {
	const reading = await readingOf(db as any, bookId, pick as any)
	const rows = await entriesAsRead(db as any, bookId, reading, "book", null)
	return rows.map((r) => r.name).sort()
}

describe("a Beginning on world lore", () => {
	it("is absent before its year and present from it, on main and on a line forked later", async () => {
		const w = await world(true)
		await w.lore("Began", { year: 5 })
		await w.lore("Always", {})
		const late = await w.fork(10)
		for (const branch of ["main", late.id] as const) {
			expect(
				await seen(w.book.id, { branch, moment: { year: 4 } })
			).toEqual(["Always"])
			expect(
				await seen(w.book.id, { branch, moment: { year: 5 } })
			).toEqual(["Always", "Began"])
			expect(
				await seen(w.book.id, { branch, moment: { year: 6 } })
			).toEqual(["Always", "Began"])
		}
	})

	it("a book with no Timeline reads no moment, so the entry is present on its own line", async () => {
		const w = await world(false)
		await w.lore("Began", { year: 5 })
		await w.lore("Always", {})
		expect(
			await seen(w.book.id, { branch: "main", moment: { year: 4 } })
		).toEqual(["Always", "Began"])
	})

	it("a fork's cut applies as before: an entry that began after the fork is absent there, Timeline off or on", async () => {
		for (const timelineEnabled of [false, true]) {
			const w = await world(timelineEnabled)
			await w.lore("Began", { year: 5 })
			await w.lore("Always", {})
			const early = await w.fork(3)
			expect(await seen(w.book.id, { branch: early.id })).toEqual([
				"Always"
			])
			expect(await seen(w.book.id, { branch: "main" })).toEqual([
				"Always",
				"Began"
			])
		}
	})
})
