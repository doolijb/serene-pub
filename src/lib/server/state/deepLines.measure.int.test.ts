/**
 * Measurement 4 of the entry-time plan: reads on a lorebook whose lines are
 * chained 200 deep (each line forked from the one before), with entries and
 * dated changes spread over the chain. Timed, with a generous bound: the
 * chain is walked in memory per read and there is no depth limit.
 */

import { afterAll, beforeAll, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-deep-lines-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const DEPTH = 200
const PER_LINE = 5

test(`reads on ${DEPTH} chained lines`, async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "deep-lines")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Deep" })
		.returning()
	const bookId = book!.id

	// main: 200 entries; each line: 5 entries and 5 dated changes to main's entries.
	const mainEntries = await testDb
		.insert(schema.lorebookEntries)
		.values(
			Array.from({ length: 200 }, (_, i) =>
				entryInsert({
					lorebookId: bookId,
					typeId: "core:entry/world-lore",
					position: i + 1,
					name: `Main ${i}`,
					content: `main ${i}`
				} as any)
			)
		)
		.returning({ id: schema.lorebookEntries.id })

	let parent: number | null = null
	let position = 1000
	const lineIds: number[] = []
	for (let depth = 0; depth < DEPTH; depth++) {
		const made: { id: number }[] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: bookId,
				name: `Line ${depth}`,
				forkedFromBranchId: parent,
				forkYear: 100 + depth
			})
			.returning({ id: schema.lorebookBranches.id })
		const line = made[0]
		parent = line!.id
		lineIds.push(line!.id)
		await testDb.insert(schema.lorebookEntries).values(
			Array.from({ length: PER_LINE }, (_, i) =>
				entryInsert({
					lorebookId: bookId,
					typeId: "core:entry/world-lore",
					position: position++,
					name: `L${depth} ${i}`,
					content: `line ${depth} ${i}`,
					branchId: line!.id
				} as any)
			)
		)
		await testDb.insert(schema.entryAmendments).values(
			Array.from({ length: PER_LINE }, (_, i) => ({
				lorebookId: bookId,
				entryId: mainEntries[(depth * PER_LINE + i) % mainEntries.length]!.id,
				branchId: line!.id,
				year: 100 + depth,
				fields: { content: `changed on line ${depth}` },
				base: null
			}))
		)
	}

	const { readingOf } = await import("$lib/server/state/reading")
	const { entryOnReadingSql } = await import("$lib/server/state/entriesOnReading")
	const db = testDb as unknown as Db
	const time = async <T>(fn: () => Promise<T>) => {
		const t0 = performance.now()
		const value = await fn()
		return { ms: performance.now() - t0, value }
	}

	const rows: Record<string, number> = {}
	for (const [label, lineId] of [
		["main", null],
		["depth 1", lineIds[0]!],
		["depth 50", lineIds[49]!],
		["depth 200", lineIds[DEPTH - 1]!]
	] as const) {
		const reading = await time(() =>
			readingOf(db, bookId, { branch: lineId === null ? "main" : lineId, moment: { year: 100 + DEPTH, month: null, day: null } })
		)
		const listed = await time(() =>
			testDb
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(and(eq(schema.lorebookEntries.lorebookId, bookId), entryOnReadingSql(reading.value as never)))
		)
		rows[`${label}: readingOf ms`] = Math.round(reading.ms)
		rows[`${label}: entries query ms`] = Math.round(listed.ms)
		rows[`${label}: entries read`] = listed.value.length
	}
	// The numbers go to a file the caller names; a plain run only asserts the bounds.
	if (process.env.DEEP_LINES_OUT)
		await fs.writeFile(process.env.DEEP_LINES_OUT, JSON.stringify(rows, null, 1))
	// The deepest line reads main's entries and every ancestor's own.
	expect(rows["depth 200: entries read"]).toBe(200 + DEPTH * PER_LINE)
	expect(rows["depth 1: entries read"]).toBe(200 + PER_LINE)
	expect(rows["depth 200: readingOf ms"]).toBeLessThan(5_000)
	expect(rows["depth 200: entries query ms"]).toBeLessThan(5_000)
}, 300_000)
