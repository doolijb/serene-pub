/**
 * A4 fix: historyEntries:iterateNext used to insert the new entry at
 * `existingEntry.position + 1` with no shift of entries already occupying
 * that position (or later) — so calling iterateNext on an entry that wasn't
 * the last one in the list produced two rows sharing the same position,
 * leaving ordering ambiguous. The fix wraps the shift + insert in one
 * transaction so positions stay unique and contiguous.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-history-positions-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

describe("historyEntries:iterateNext — position collisions (PGlite integration)", () => {
	test("inserting after a middle entry shifts later entries instead of colliding", async () => {
		const { iterateNextHistoryEntryHandler } = await import(
			"./historyEntries"
		)

		const user = await makeUser("history-positions-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Positions Test Book", userId: user.id })
			.returning()

		// Three entries at positions 0, 1, 2.
		const [entry0] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id, position: 0 })
			.returning()
		await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id, position: 1 })
		await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id, position: 2 })

		// iterateNext on the FIRST entry (position 0) — the new entry wants
		// position 1, which the second entry already occupies.
		await iterateNextHistoryEntryHandler.handler(
			fakeSocket(user.id),
			{ id: entry0.id } as any,
			noopEmit
		)

		const allEntries = await testDb.query.historyEntries.findMany({
			where: eq(schema.historyEntries.lorebookId, lorebook.id),
			orderBy: asc(schema.historyEntries.position)
		})

		const positions = allEntries.map((e) => e.position)
		const uniquePositions = new Set(positions)
		expect(uniquePositions.size).toBe(positions.length)
		expect(positions).toEqual([0, 1, 2, 3])
	})
})
