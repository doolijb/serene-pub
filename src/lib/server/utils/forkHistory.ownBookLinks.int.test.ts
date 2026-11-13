/**
 * 🚧 A link kept in a session's own notes (a notes book other than the history
 * entry's own book) is that session's own: it is not "main uses this entry".
 * `pointedAt` (what a deleted line's forks keep) and `linesUsing` (what a
 * re-date is refused for) leave it out; the lorebook's own links still count.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { assertRedateKeepsLines, keepHistoryForForks } from "./forkHistory"

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
		path.join(os.tmpdir(), "serene-pub-vitest-forkHistory-own-book-links-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

/** A deleted line holding a history entry, one fork from it, and a second session's notes with two entries. */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const user = await createTestUser(testDb, `fh-own-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const line = async (
		name: string,
		from: number | null,
		forkYear: number | null
	) =>
		(
			await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: book!.id,
					name: `${name} ${suffix}`,
					forkedFromBranchId: from,
					forkYear
				})
				.returning()
		)[0]!
	const gone = await line("gone", null, 5)
	const first = await line("first", gone.id, 7)
	const [dating] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: book!.id,
					content: "The founding.",
					year: 3,
					branchId: gone.id
				}
			])
		)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `S${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	const notes = await insertOwnBook(db(), {
		sessionId: session!.id,
		userId: user.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const room = async (lorebookId: number, title: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId,
					typeId: "core:entry/location",
					typeVersion: 1,
					position: ++n,
					title,
					content: "…"
				})
				.returning()
		)[0]!
	const link = async (lorebookId: number, branchId: number | null) => {
		const a = await room(lorebookId, `A${++n}`)
		const b = await room(lorebookId, `B${++n}`)
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId,
			branchId,
			fromEntryId: a.id,
			toEntryId: b.id,
			historyEntryId: dating!.id,
			relationshipType: "leads to"
		})
	}
	const lines = [gone, first].map((l) => ({
		id: l.id,
		name: l.name,
		forkedFromBranchId: l.forkedFromBranchId,
		forkYear: l.forkYear,
		forkMonth: l.forkMonth,
		forkDay: l.forkDay
	}))
	return { book: book!, gone, first, dating: dating!, notes, link, lines }
}

async function deleteLine(w: Awaited<ReturnType<typeof world>>) {
	return testDb.transaction(async (tx) => {
		const kept = await keepHistoryForForks(
			tx as unknown as Db,
			w.book.id,
			w.gone.id,
			w.lines
		)
		await tx
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, w.gone.id))
		return kept
	})
}

describe("a link in another session's notes is not the lorebook's use of a history entry", () => {
	test("pointedAt: a link only in the notes keeps nothing; one in the lorebook keeps the entry", async () => {
		const w = await world()
		await w.link(w.notes.id, w.first.id)
		expect((await deleteLine(w)).moved.size).toBe(0)

		const c = await world()
		await c.link(c.book.id, c.first.id)
		expect((await deleteLine(c)).moved.get(c.dating.id)).toBe(c.first.id)
	})

	test("linesUsing: a re-date past the fork is refused for a lorebook link, not for a link in the notes", async () => {
		const w = await world()
		await w.link(w.notes.id, w.first.id)
		await expect(
			testDb.transaction((tx) =>
				assertRedateKeepsLines(tx as unknown as Db, w.dating.id, {
					year: 9,
					month: null,
					day: null
				})
			)
		).resolves.toBeUndefined()

		const c = await world()
		await c.link(c.book.id, c.first.id)
		await expect(
			testDb.transaction((tx) =>
				assertRedateKeepsLines(tx as unknown as Db, c.dating.id, {
					year: 9,
					month: null,
					day: null
				})
			)
		).rejects.toThrow(/cannot move past/)
	})
})
