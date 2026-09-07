/**
 * Round-9 audit fix (LOW): the singular update handler for each lore-entry
 * type (worldLoreEntries:update, historyEntries:update,
 * characterLoreEntries:update) had no `position` exclusion, unlike the
 * separately IDOR-checked updatePositions batch handlers that back the real
 * reorder UI — a raw client could still set an arbitrary/colliding position
 * value through the singular update. Fixed by adding `position` to each
 * handler's existing field-exclusion allowlist, matching how id/lorebookId/
 * createdAt/etc. are already excluded.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	type LorebookEntry
} from "$lib/shared/entries/types"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	characterLoreValues,
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
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
		path.join(os.tmpdir(), "serene-pub-lore-position-exclusion-int-test-")
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

async function makeLorebook(userId: number) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Position Exclusion Book", userId })
		.returning()
	return lorebook
}

describe("entries:update — world lore position exclusion (PGlite integration)", () => {
	test("ignores a client-supplied position while applying other fields", async () => {
		const { updateEntryHandler } = await import("./entries")
		const user = await makeUser("world-lore-position-user")
		const lorebook = await makeLorebook(user.id)
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues([
					{
						lorebookId: lorebook.id,
						name: "Entry",
						content: "x",
						position: 3
					}
				])
			)
			.returning()

		const res = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					id: entry.id,
					name: "Renamed",
					position: 999
				} as any
			},
			noopEmit
		)

		expect(res.entry.name).toBe("Renamed")
		expect(res.entry.position).toBe(3)
	})
})

describe("entries:update — history position exclusion (PGlite integration)", () => {
	test("ignores a client-supplied position while applying other fields", async () => {
		const { updateEntryHandler } = await import("./entries")
		const user = await makeUser("history-position-user")
		const lorebook = await makeLorebook(user.id)
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: lorebook.id, position: 2 }]))
			.returning()

		const res = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					id: entry.id,
					year: 1999,
					position: 999
				} as any
			},
			noopEmit
		)

		// The brand at work: `res.entry` is the union of every declared shape,
		// so reading a date off it needs the narrowing the type id already
		// justifies.
		expect((res.entry as LorebookEntry<typeof HISTORY_TYPE_ID>).year).toBe(
			1999
		)
		expect(res.entry.position).toBe(2)
	})
})

describe("entries:update — character lore position exclusion (PGlite integration)", () => {
	test("ignores a client-supplied position while applying other fields", async () => {
		const { updateEntryHandler } = await import("./entries")
		const user = await makeUser("character-lore-position-user")
		const lorebook = await makeLorebook(user.id)
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				characterLoreValues([
					{
						lorebookId: lorebook.id,
						name: "Entry",
						content: "x",
						position: 4
					}
				])
			)
			.returning()

		const res = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: CHARACTER_LORE_TYPE_ID,
					id: entry.id,
					name: "Renamed",
					position: 999
				} as any
			},
			noopEmit
		)

		expect(res.entry.name).toBe("Renamed")
		expect(res.entry.position).toBe(4)
	})
})
