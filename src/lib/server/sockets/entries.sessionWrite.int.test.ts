/**
 * A summarize's saves are session writes (plan A12): an `entries:create` that
 * names the session it writes from lands on that session's line, and a history
 * entry it files is dated at the session's story now — never on main, never
 * dated across every line.
 *
 * The book: main, a branch "north" forked at Year 3, and a sibling "south".
 * Main holds Year 1 (before the fork) and Year 5 (after it — not north's
 * past); south holds Year 9 (a sibling's — never north's).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-entries-session-write-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

let seq = 0
async function seedBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `session-write-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Two Roads ${seq}`, userId: owner.id })
		.returning()
	const [north] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "north", forkYear: 3 })
		.returning()
	const [south] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "south" })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book.id, year: 1, month: 6, day: 1 } as any,
				{ lorebookId: book.id, year: 5, month: 1, day: 1 } as any,
				{
					lorebookId: book.id,
					year: 9,
					month: 1,
					day: 1,
					branchId: south.id
				} as any
			])
		)
	const session = async (
		branchId: number | null,
		clock: { year: number; month?: number; day?: number } | null,
		lorebookId: number = book.id
	) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					name: `on ${branchId ?? "main"}`,
					lorebookId,
					lorebookBranchId: branchId,
					storyClockYear: clock?.year ?? null,
					storyClockMonth: clock?.month ?? null,
					storyClockDay: clock?.day ?? null,
					isGroup: false
				} as any)
				.returning()
		)[0]
	return { owner, book, north, south, session }
}

/** The created row, read loosely: its date fields depend on its type. */
async function create(userId: number, params: any): Promise<{ entry: any }> {
	const { createEntryHandler } = await import("./entries")
	return createEntryHandler.handler(fakeSocket(userId), params, () => {})
}

const blankHistory = (lorebookId: number) => ({
	typeId: HISTORY_TYPE_ID,
	lorebookId,
	content: "",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false
})

const lore = (typeId: string, lorebookId: number) => ({
	typeId,
	lorebookId,
	name: "The toll bridge",
	content: "A bridge the north road crosses.",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	priority: 1
})

async function mainHistoryCount(lorebookId: number) {
	return (
		await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID),
					isNull(schema.lorebookEntries.branchId)
				)
			)
	).length
}

describe("entries:create from a session writes on the session's line", () => {
	test("a history entry filed from a branch session with a clock lands on the branch, dated at the clock; main is untouched", async () => {
		const w = await seedBook()
		const s = await w.session(w.north.id, { year: 4, month: 2, day: 10 })
		const before = await mainHistoryCount(w.book.id)

		const { entry } = await create(w.owner.id, {
			entry: blankHistory(w.book.id),
			sessionId: s.id
		})

		expect(entry.branchId).toBe(w.north.id)
		expect([entry.year, entry.month, entry.day]).toEqual([4, 2, 10])
		expect(await mainHistoryCount(w.book.id)).toBe(before)
	})

	test("a session following its line's present files the step after the newest entry ITS line reads", async () => {
		const w = await seedBook()
		const s = await w.session(w.north.id, null)

		const { entry } = await create(w.owner.id, {
			entry: blankHistory(w.book.id),
			sessionId: s.id
		})

		// Main's Year 5 is after north's fork and south's Year 9 is a
		// sibling's, so north's newest is main's Year 1, Month 6, Day 1.
		expect(entry.branchId).toBe(w.north.id)
		expect([entry.year, entry.month, entry.day]).toEqual([1, 6, 2])
	})

	test("world and character lore saved from a branch session carry its line", async () => {
		const w = await seedBook()
		const s = await w.session(w.north.id, { year: 4 })

		const world = await create(w.owner.id, {
			entry: lore(WORLD_LORE_TYPE_ID, w.book.id),
			sessionId: s.id
		})
		const character = await create(w.owner.id, {
			entry: lore(CHARACTER_LORE_TYPE_ID, w.book.id),
			sessionId: s.id
		})

		expect(world.entry.branchId).toBe(w.north.id)
		expect(character.entry.branchId).toBe(w.north.id)
	})

	test("the session decides the line, not the request", async () => {
		const w = await seedBook()
		const s = await w.session(w.north.id, { year: 4 })

		const { entry } = await create(w.owner.id, {
			entry: {
				...lore(WORLD_LORE_TYPE_ID, w.book.id),
				branchId: w.south.id
			},
			sessionId: s.id
		})

		expect(entry.branchId).toBe(w.north.id)
	})

	test("a session that does not read this book is refused with a sentence", async () => {
		const w = await seedBook()
		const [otherBook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Elsewhere", userId: w.owner.id })
			.returning()
		const s = await w.session(null, null, otherBook.id)
		const emitted: Array<[string, any]> = []
		const { createEntryHandler } = await import("./entries")

		await expect(
			createEntryHandler.handler(
				fakeSocket(w.owner.id),
				{
					entry: lore(WORLD_LORE_TYPE_ID, w.book.id),
					sessionId: s.id
				} as any,
				(event, data) => emitted.push([event, data])
			)
		).rejects.toThrow()
		expect(emitted).toContainEqual([
			"entries:create:error",
			{ error: "That session does not read this lorebook." }
		])
	})

	test("character lore that names its character adds the cast member with the entry, and is anchored to it", async () => {
		const w = await seedBook()
		const s = await w.session(w.north.id, { year: 4 })
		const [wren] = await testDb
			.insert(schema.characters)
			.values({ userId: w.owner.id, name: "Wren", description: "" })
			.returning()

		const { entry } = await create(w.owner.id, {
			entry: lore(CHARACTER_LORE_TYPE_ID, w.book.id),
			sessionId: s.id,
			lorebookBindingCharacterId: wren.id
		})

		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(members.map((m) => m.characterId)).toEqual([wren.id])
		expect(entry.lorebookBindingId).toBe(members[0].id)
		// Named from the card, as every other way of adding a member names it.
		expect(members[0].name).toBe("Wren")

		// A second save for the same character reuses the member.
		const again = await create(w.owner.id, {
			entry: { ...lore(CHARACTER_LORE_TYPE_ID, w.book.id), name: "More" },
			sessionId: s.id,
			lorebookBindingCharacterId: wren.id
		})
		expect(again.entry.lorebookBindingId).toBe(members[0].id)
		const after = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(after).toHaveLength(1)
	})

	test("a refused character-lore save adds no cast member", async () => {
		const w = await seedBook()
		const [otherBook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Elsewhere", userId: w.owner.id })
			.returning()
		const s = await w.session(null, null, otherBook.id)
		const [wren] = await testDb
			.insert(schema.characters)
			.values({ userId: w.owner.id, name: "Wren", description: "" })
			.returning()

		await expect(
			create(w.owner.id, {
				entry: lore(CHARACTER_LORE_TYPE_ID, w.book.id),
				sessionId: s.id,
				lorebookBindingCharacterId: wren.id
			})
		).rejects.toThrow("That session does not read this lorebook.")

		const members = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(members).toEqual([])
	})

	test("a character the writer cannot bind is refused, and nothing is written", async () => {
		const w = await seedBook()
		const other = await seedBook()
		const s = await w.session(null, null)
		const [theirs] = await testDb
			.insert(schema.characters)
			.values({ userId: other.owner.id, name: "Stranger", description: "" })
			.returning()

		await expect(
			create(w.owner.id, {
				entry: lore(CHARACTER_LORE_TYPE_ID, w.book.id),
				sessionId: s.id,
				lorebookBindingCharacterId: theirs.id
			})
		).rejects.toThrow("You can't add that character to this book's cast.")

		const members = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(members).toEqual([])
	})

	test("another person's session is refused", async () => {
		const w = await seedBook()
		const other = await seedBook()
		const theirs = await other.session(null, null, w.book.id)

		await expect(
			create(w.owner.id, {
				entry: lore(WORLD_LORE_TYPE_ID, w.book.id),
				sessionId: theirs.id
			})
		).rejects.toThrow("Only the session's owner can save lore from it.")
	})
})
