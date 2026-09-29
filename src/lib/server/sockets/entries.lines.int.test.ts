/**
 * `entries:*` on the line being read (owner ruling 5, 2026-09-28).
 *
 * Every read here goes through the one line rule (`lineSql.ts`, the SQL form
 * of `$lib/shared/lorebooks/lineReading.ts`): counts, the session widget's
 * list. Every write respects it: a new entry's branch belongs to the book,
 * "next" stays on its line, and a shared entry is never filed under a
 * line's own entry (the anchor cascades, so deleting that line would take
 * the shared entry with it).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-entries-lines-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeBook(userId: number, name = "Lines") {
	const [book] = await testDb.insert(schema.lorebooks).values({ name, userId }).returning()
	return book
}

async function fork(
	lorebookId: number,
	name: string,
	over: Partial<typeof schema.lorebookBranches.$inferInsert> = {}
) {
	const [branch] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId, name, ...over })
		.returning()
	return branch
}

async function create(
	userId: number,
	lorebookId: number,
	extra: Record<string, unknown> = {}
) {
	const { createEntryHandler } = await import("./entries")
	const { entry } = await createEntryHandler.handler(
		fakeSocket(userId),
		{
			entry: {
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId,
				name: "Entry",
				content: "",
				...extra
			}
		} as any,
		noopEmit
	)
	return entry as any
}

async function history(
	userId: number,
	lorebookId: number,
	year: number,
	extra: Record<string, unknown> = {}
) {
	return create(userId, lorebookId, {
		typeId: HISTORY_TYPE_ID,
		year,
		month: null,
		day: null,
		...extra
	})
}

async function counts(userId: number, lorebookId: number, branchId: number | null) {
	const { entryCountsHandler } = await import("./entries")
	const res = await entryCountsHandler.handler(
		fakeSocket(userId),
		{ lorebookId, branchId } as any,
		noopEmit
	)
	return res.counts
}

describe("entries:counts — the line being read", () => {
	test("main counts shared rows; a fork counts its own too; a sibling's never", async () => {
		const user = await makeUser("counts-lines")
		const book = await makeBook(user.id)
		const a = await fork(book.id, "a")
		const b = await fork(book.id, "b")
		await create(user.id, book.id)
		await create(user.id, book.id, { branchId: a.id })
		await create(user.id, book.id, { branchId: b.id })
		// Archived rows are out of every figure, as the default list hides them.
		await create(user.id, book.id, { archived: true })
		const event = await history(user.id, book.id, 1)
		await testDb.insert(schema.scenes).values({
			lorebookId: book.id,
			historyEntryId: event.id,
			name: "fork scene",
			branchId: a.id
		} as any)

		const main = await counts(user.id, book.id, null)
		expect(main[WORLD_LORE_TYPE_ID]).toBe(1)
		expect(main.scene).toBe(0)
		const onA = await counts(user.id, book.id, a.id)
		expect(onA[WORLD_LORE_TYPE_ID]).toBe(2)
		expect(onA.scene).toBe(1)
	}, 60_000)

	test("a fork of a fork counts its parent's rows; a shared row dated after the cut is out", async () => {
		const user = await makeUser("counts-chain")
		const book = await makeBook(user.id)
		const a = await fork(book.id, "a", { forkYear: 5 })
		const c = await fork(book.id, "c", { forkedFromBranchId: a.id, forkYear: 7 })
		await history(user.id, book.id, 4) // main, before both cuts
		await history(user.id, book.id, 6) // main, after A's cut
		await history(user.id, book.id, 6, { branchId: a.id }) // A, before C's cut
		await history(user.id, book.id, 8, { branchId: a.id }) // A, after C's cut
		await history(user.id, book.id, 9, { branchId: c.id }) // C's own

		expect((await counts(user.id, book.id, null))[HISTORY_TYPE_ID]).toBe(2)
		expect((await counts(user.id, book.id, a.id))[HISTORY_TYPE_ID]).toBe(3)
		expect((await counts(user.id, book.id, c.id))[HISTORY_TYPE_ID]).toBe(3)
	}, 60_000)

	test("another book's branch is refused, in words", async () => {
		const user = await makeUser("counts-foreign")
		const book = await makeBook(user.id)
		const other = await makeBook(user.id, "Other")
		const foreign = await fork(other.id, "theirs")
		await expect(counts(user.id, book.id, foreign.id)).rejects.toThrow(
			"That branch is not a line of this lorebook."
		)
	}, 60_000)
})

describe("entries:create — the line an entry lands on", () => {
	test("another book's branch is refused", async () => {
		const user = await makeUser("create-foreign-branch")
		const book = await makeBook(user.id)
		const other = await makeBook(user.id, "Other")
		const foreign = await fork(other.id, "theirs")
		await expect(create(user.id, book.id, { branchId: foreign.id })).rejects.toThrow(
			"That branch is not a line of this lorebook."
		)
	}, 60_000)

	test("a declared field of the wrong type is refused, never stored", async () => {
		const user = await makeUser("create-declared")
		const book = await makeBook(user.id)
		await expect(
			create(user.id, book.id, { typeId: HISTORY_TYPE_ID, year: "412" })
		).rejects.toThrow(/'year' must be a whole number/)
	}, 60_000)
})

describe("Part of — never under another line's own entry", () => {
	test("a shared entry cannot be filed under a branch-only parent, on create or update", async () => {
		const user = await makeUser("anchor-lines")
		const book = await makeBook(user.id)
		const a = await fork(book.id, "a")
		const parent = await create(user.id, book.id, { branchId: a.id, name: "Fork hall" })
		const shared = await create(user.id, book.id, { name: "Shared room" })

		await expect(
			create(user.id, book.id, { name: "New shared", anchorEntryId: parent.id })
		).rejects.toThrow("An entry on main cannot be filed under one that exists only on a branch.")

		const { updateEntryHandler } = await import("./entries")
		await expect(
			updateEntryHandler.handler(
				fakeSocket(user.id),
				{ entry: { id: shared.id, typeId: WORLD_LORE_TYPE_ID, anchorEntryId: parent.id } } as any,
				noopEmit
			)
		).rejects.toThrow(/cannot be filed under one that exists only on a branch/)

		// The same line, and a shared parent, are both fine.
		const child = await create(user.id, book.id, {
			branchId: a.id,
			name: "Fork cellar",
			anchorEntryId: parent.id
		})
		expect(child.anchorEntryId).toBe(parent.id)
		const under = await create(user.id, book.id, {
			branchId: a.id,
			name: "Fork attic",
			anchorEntryId: shared.id
		})
		expect(under.anchorEntryId).toBe(shared.id)

		// And deleting the line leaves the shared entry where it was.
		await testDb.delete(schema.lorebookBranches).where(eq(schema.lorebookBranches.id, a.id))
		const still = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, shared.id))
		expect(still).toHaveLength(1)
	}, 60_000)
})

describe("entries:iterateNext — the next date stays on its line", () => {
	test("from a fork's own entry, from a shared entry read on a fork, and with no line named", async () => {
		const { iterateNextEntryHandler } = await import("./entries")
		const user = await makeUser("iterate-lines")
		const book = await makeBook(user.id)
		const a = await fork(book.id, "a")
		const own = await history(user.id, book.id, 3, { branchId: a.id })
		const shared = await history(user.id, book.id, 1)
		const next = (id: number, branchId?: number | null) =>
			iterateNextEntryHandler.handler(
				fakeSocket(user.id),
				{ id, typeId: HISTORY_TYPE_ID, ...(branchId !== undefined ? { branchId } : {}) } as any,
				noopEmit
			)

		expect((await next(own.id, a.id)).entry.branchId).toBe(a.id)
		expect((await next(shared.id, a.id)).entry.branchId).toBe(a.id)
		// Nothing named: the source entry's own line, never main by accident.
		expect((await next(own.id)).entry.branchId).toBe(a.id)
		expect((await next(shared.id)).entry.branchId).toBeNull()

		const other = await makeBook(user.id, "Other")
		const foreign = await fork(other.id, "theirs")
		await expect(next(own.id, foreign.id)).rejects.toThrow(
			"That branch is not a line of this lorebook."
		)
	}, 60_000)
})

describe("entries:sessionEntries — the session's line", () => {
	test("a session on fork A lists main's rows and A's, never B's", async () => {
		const { entrySessionEntriesHandler } = await import("./entries")
		const user = await makeUser("session-lines")
		const book = await makeBook(user.id)
		const a = await fork(book.id, "a")
		const b = await fork(book.id, "b")
		const mainRow = await create(user.id, book.id, { name: "Main" })
		const aRow = await create(user.id, book.id, { name: "On A", branchId: a.id })
		await create(user.id, book.id, { name: "On B", branchId: b.id })
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, lorebookId: book.id, lorebookBranchId: a.id })
			.returning()

		const res: any = await entrySessionEntriesHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(res.rows.map((r: any) => r.id).sort()).toEqual([mainRow.id, aRow.id].sort())
	}, 60_000)

	test("names, keys and marks read as amended by the session's clock", async () => {
		const { entrySessionEntriesHandler } = await import("./entries")
		const user = await makeUser("session-amended")
		const book = await makeBook(user.id)
		const row = await create(user.id, book.id, { name: "Old Name", keys: "old" })
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: book.id,
			entryId: row.id,
			year: 3,
			fields: { name: "New Name", keys: "new, newer", enabled: false }
		})
		const seat = async (clock: number | null) =>
			(
				await testDb
					.insert(schema.sessions)
					.values({ userId: user.id, isGroup: false, lorebookId: book.id, storyClockYear: clock } as any)
					.returning()
			)[0]!
		const at = async (clock: number | null) =>
			((await entrySessionEntriesHandler.handler(
				fakeSocket(user.id),
				{ sessionId: (await seat(clock)).id },
				noopEmit
			)) as any).rows.find((r: any) => r.id === row.id)

		expect(await at(null)).toMatchObject({ title: "New Name", keys: ["new", "newer"], off: true })
		expect(await at(1)).toMatchObject({ title: "Old Name", keys: ["old"], off: false })
	}, 60_000)
})

describe("entries:update — the content vector", () => {
	async function withVector(entryId: number) {
		await testDb.insert(schema.lorebookEntryVectors).values({
			entryId,
			vectorName: "core:vec/default@1",
			chunkIndex: 0,
			model: "test-model",
			dims: 2,
			vector: [0.1, 0.2]
		} as any)
	}
	const vectors = (entryId: number) =>
		testDb
			.select()
			.from(schema.lorebookEntryVectors)
			.where(eq(schema.lorebookEntryVectors.entryId, entryId))

	test("an archive toggle or a re-parent keeps it; a content edit drops it", async () => {
		const { updateEntryHandler } = await import("./entries")
		const user = await makeUser("vectors-lines")
		const book = await makeBook(user.id)
		const parent = await create(user.id, book.id, { name: "Parent" })
		const entry = await create(user.id, book.id, { name: "Child", content: "before" })
		const update = (patch: Record<string, unknown>) =>
			updateEntryHandler.handler(
				fakeSocket(user.id),
				{ entry: { id: entry.id, typeId: WORLD_LORE_TYPE_ID, ...patch } } as any,
				noopEmit
			)
		await withVector(entry.id)

		await update({ archived: true })
		await update({ anchorEntryId: parent.id })
		await update({})
		expect(await vectors(entry.id)).toHaveLength(1)

		await update({ content: "after" })
		expect(await vectors(entry.id)).toHaveLength(0)
	}, 60_000)
})
