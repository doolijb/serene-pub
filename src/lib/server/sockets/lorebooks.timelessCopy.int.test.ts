/**
 * `lorebooks:duplicate` with `timeless` — a timeless copy of a book as it reads
 * now on a line; without it the exact copy is unchanged. A shared reader may
 * make one (the copy is theirs), the reply and the refusal echo the asker's
 * `requestId`, a session's notes are refused with a sentence, and the source's
 * Timeline switch is untouched.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { and, eq, sql } from "drizzle-orm"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELESS_COPY_NOTES_REFUSAL } from "$lib/server/lorebooks/timelessCopy"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-timeless-socket-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

/** A book with a history entry, an entry changed in 1202, and a line. */
async function seedBook(userId: number, name: string) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name, storyClockYear: 1201 })
		.returning()
	const [line] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: "Line", forkYear: 1210 })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId: book.id,
				typeId: HISTORY_TYPE_ID,
				position: 1,
				content: "Founding.",
				year: 1200
			} as any)
		)
		.returning()
	const [keep] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId: book.id,
				typeId: "core:entry/world-lore",
				position: 1,
				name: "Keep",
				content: "Old."
			} as any)
		)
		.returning()
	await testDb.insert(schema.entryAmendments).values({
		lorebookId: book.id,
		entryId: keep.id,
		year: 1202,
		fields: { content: "New." }
	})
	return { book, line, history, keep }
}

const contentOf = async (bookId: number, title: string) =>
	(
		await testDb
			.select({ content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, bookId),
					eq(schema.lorebookEntries.title, title)
				)
			)
	)[0]?.content

const amendmentsOf = async (bookId: number) =>
	(
		await testDb
			.select({ n: sql<number>`count(*)::int` })
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, bookId))
	)[0].n

describe("lorebooks:duplicate with timeless", () => {
	test("the param makes a timeless copy; the source keeps its switch and its dated change", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-owner")
		const { book } = await seedBook(owner.id, "Source")
		const res = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: book.id, timeless: { branchId: null } },
			noopEmit
		)
		expect(res.lorebook.name).toBe("Source (timeless)")
		expect(await contentOf(res.lorebook.id, "Keep")).toBe("New.")
		expect(await amendmentsOf(res.lorebook.id)).toBe(0)
		const [copy] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, res.lorebook.id))
		expect(copy.timelineEnabled).toBe(false)
		const [source] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		expect(source.timelineEnabled).toBe(true)
		expect(await amendmentsOf(book.id)).toBe(1)
		expect(await contentOf(book.id, "Keep")).toBe("Old.")
	}, 60_000)

	test("a name is used when given", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-name")
		const { book } = await seedBook(owner.id, "Named source")
		const res = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{
				lorebookId: book.id,
				name: "  Flat  ",
				timeless: { branchId: null }
			},
			noopEmit
		)
		expect(res.lorebook.name).toBe("Flat")
	}, 60_000)

	test("without the param Duplicate is unchanged: the dated change still copies", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-plain")
		const { book } = await seedBook(owner.id, "Plain source")
		const res = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: book.id },
			noopEmit
		)
		expect(res.lorebook.name).toBe("Plain source (copy)")
		expect(await amendmentsOf(res.lorebook.id)).toBe(1)
		expect(await contentOf(res.lorebook.id, "Keep")).toBe("Old.")
		const [copy] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, res.lorebook.id))
		expect(copy.timelineEnabled).toBe(true)
		expect(res).not.toHaveProperty("requestId")
	}, 60_000)

	test("a shared reader may make one, and the copy is theirs", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-sharer")
		const guest = await makeUser("timeless-sock-guest")
		const { book } = await seedBook(owner.id, "Shared source")
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: book.id, userId: guest.id } as any)
		const res = await lorebooksDuplicateHandler.handler(
			fakeSocket(guest.id),
			{ lorebookId: book.id, timeless: { branchId: null } },
			noopEmit
		)
		const [copy] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, res.lorebook.id))
		expect(copy.userId).toBe(guest.id)
		expect(copy.timelineEnabled).toBe(false)
	}, 60_000)

	test("the reply and the refusal echo requestId", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-echo")
		const { book, line } = await seedBook(owner.id, "Echo source")
		const res = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{
				lorebookId: book.id,
				timeless: { branchId: line.id },
				requestId: "ask-1"
			},
			noopEmit
		)
		expect(res.requestId).toBe("ask-1")

		const emitted: [string, any][] = []
		await expect(
			lorebooksDuplicateHandler.handler(
				fakeSocket(owner.id),
				{
					lorebookId: book.id,
					timeless: { branchId: 999999 },
					requestId: "ask-2"
				},
				(event: string, data: any) => emitted.push([event, data])
			)
		).rejects.toThrow()
		const refusal = emitted.find(
			([event]) => event === "lorebooks:duplicate:error"
		)
		expect(refusal?.[1].requestId).toBe("ask-2")
		expect(typeof refusal?.[1].error).toBe("string")
	}, 60_000)

	test("a malformed timeless is refused with a sentence", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-bad")
		const { book } = await seedBook(owner.id, "Bad source")
		for (const timeless of [
			"main",
			null,
			{ branchId: "x" },
			{ branchId: 1.5 },
			{}
		]) {
			const emitted: [string, any][] = []
			await expect(
				lorebooksDuplicateHandler.handler(
					fakeSocket(owner.id),
					{
						lorebookId: book.id,
						timeless: timeless as any,
						requestId: "bad"
					},
					(event: string, data: any) => emitted.push([event, data])
				)
			).rejects.toThrow()
			const refusal = emitted.find(
				([event]) => event === "lorebooks:duplicate:error"
			)
			expect(refusal?.[1].error).toBe(
				"A timeless copy needs the line to read: null for main, or a line's number."
			)
		}
		// The failed asks left no copy behind.
		const copies = await testDb
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(
				and(
					eq(schema.lorebooks.userId, owner.id),
					eq(schema.lorebooks.name, "Bad source (timeless)")
				)
			)
		expect(copies).toHaveLength(0)
	}, 60_000)

	test("a session's notes are refused with the sentence", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("timeless-sock-notes")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: "Notes host"
			} as any)
			.returning()
		const [notes] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: owner.id,
				name: "Notes",
				sessionId: session.id
			} as any)
			.returning()
		const emitted: [string, any][] = []
		await expect(
			lorebooksDuplicateHandler.handler(
				fakeSocket(owner.id),
				{
					lorebookId: notes.id,
					timeless: { branchId: null },
					requestId: "notes"
				},
				(event: string, data: any) => emitted.push([event, data])
			)
		).rejects.toThrow(TIMELESS_COPY_NOTES_REFUSAL)
		const refusal = emitted.find(
			([event]) => event === "lorebooks:duplicate:error"
		)
		expect(refusal?.[1]).toEqual({
			requestId: "notes",
			error: TIMELESS_COPY_NOTES_REFUSAL
		})
	}, 60_000)
})
