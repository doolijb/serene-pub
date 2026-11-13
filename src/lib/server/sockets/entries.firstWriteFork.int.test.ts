/**
 * A branch session riding its parent's line forks its own line on its first
 * `entries:create` — inside the write's transaction, after every check, so a
 * refused write forks nothing (plan §32 §5a; `sessionLoreWrite` forks nothing).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

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
		path.join(os.tmpdir(), "serene-pub-vitest-first-write-fork-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

let seq = 0
/** A book with a fork at Year 3, and a session riding it that forks its own on first write. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `first-write-fork-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Two Roads ${seq}`, userId: owner.id })
		.returning()
	const [north] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: "north", forkYear: 3 })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			name: `on north ${seq}`,
			lorebookId: book!.id,
			lorebookBranchId: north!.id,
			lineOnFirstWrite: true,
			storyClockYear: 4
		})
		.returning()
	return { owner, book: book!, north: north!, session: session! }
}

const create = async (userId: number, params: any): Promise<{ entry: any }> => {
	const { createEntryHandler } = await import("./entries")
	return createEntryHandler.handler(fakeSocket(userId), params, () => {})
}

const linesOf = (bookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))

const sessionOf = async (id: number) =>
	(await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, id)))[0]!

const entryBody = (typeId: string, lorebookId: number, extra: object = {}) => ({
	typeId,
	lorebookId,
	name: "The toll bridge",
	content: "A bridge the north road crosses.",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	priority: 1,
	...extra
})

describe("entries:create forks the session's own line on its first write", () => {
	test("forks once, and the row lands on the new line", async () => {
		const w = await world()
		const first = await create(w.owner.id, {
			entry: entryBody(WORLD_LORE_TYPE_ID, w.book.id),
			sessionId: w.session.id
		})
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.north.id)
		expect(first.entry.branchId).toBe(after.lorebookBranchId)
		expect(await linesOf(w.book.id)).toHaveLength(2)

		const second = await create(w.owner.id, {
			entry: entryBody(WORLD_LORE_TYPE_ID, w.book.id),
			sessionId: w.session.id
		})
		expect(second.entry.branchId).toBe(after.lorebookBranchId)
		expect(await linesOf(w.book.id)).toHaveLength(2)
	})

	test("a write refused inside the transaction forks nothing", async () => {
		const w = await world()
		// Year 2 is before north's fork: main owns that day, so a content write
		// onto it from the branch is refused by the date check in the transaction.
		await expect(
			create(w.owner.id, {
				entry: entryBody(HISTORY_TYPE_ID, w.book.id, {
					year: 2,
					month: 1,
					day: 1
				}),
				sessionId: w.session.id
			})
		).rejects.toThrow(/shares everything up to/)
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.north.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
	})

	test("filed under an entry only the line it rode has, it is checked on its own line and forks nothing", async () => {
		const w = await world()
		const parent = await create(w.owner.id, {
			entry: entryBody(WORLD_LORE_TYPE_ID, w.book.id, {
				name: "The north road",
				branchId: w.north.id
			})
		})
		expect(parent.entry.branchId).toBe(w.north.id)
		await expect(
			create(w.owner.id, {
				entry: entryBody(WORLD_LORE_TYPE_ID, w.book.id, {
					anchorEntryId: parent.entry.id
				}),
				sessionId: w.session.id
			})
		).rejects.toThrow(/exists only on another line/)
		const after = await sessionOf(w.session.id)
		expect(after.lineOnFirstWrite).toBe(true)
		expect(after.lorebookBranchId).toBe(w.north.id)
		expect(await linesOf(w.book.id)).toHaveLength(1)
	})
})
