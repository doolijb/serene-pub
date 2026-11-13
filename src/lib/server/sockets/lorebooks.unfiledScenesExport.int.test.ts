/**
 * 🚧 §0-B / ★4b — a scene not yet compiled (`historyEntryId` null) is never
 * dropped: it is exported nested under the history entry of its day (else
 * under a dated, empty entry the document carries; nothing is written to the
 * book), with its display name written frozen; and a copy keeps it unfiled
 * with that name.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-unfiled-export-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
let seq = 0

async function makeUser(name: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${name}-${++seq}`)
}

/** A book with a history entry at Year 5 Mo 1 Day 2 and a session on it. */
async function makeBook() {
	const user = await makeUser("unfiled")
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Unfiled Book", userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }])
		)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()
	return { user, lorebook, history, session }
}

async function unfiled(
	b: Awaited<ReturnType<typeof makeBook>>,
	values: Partial<typeof schema.scenes.$inferInsert>
) {
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: b.lorebook.id,
			historyEntryId: null,
			summary: "It happened.",
			...values
		})
		.returning()
	return scene
}

async function exportBook(b: Awaited<ReturnType<typeof makeBook>>) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { specBookWithGraph } = await buildLorebookExportData(
		b.lorebook.id,
		b.user.id
	)
	return specBookWithGraph as any
}

const historyOf = (doc: any) =>
	doc.entries.filter((e: any) => e.extensions.serenepub.entryType === "history")

describe("an unfiled scene in an export", () => {
	test("nests under the history entry of its day, with its display name", async () => {
		const b = await makeBook()
		const scene = await unfiled(b, {
			name: "Scene 4 · Day 2",
			nameIsDefault: true,
			openedStoryClockYear: 5,
			openedStoryClockMonth: 1,
			openedStoryClockDay: 2
		})
		const doc = await exportBook(b)
		const history = historyOf(doc)
		expect(history).toHaveLength(1)
		const scenes = history[0].extensions.serenepub.scenes
		expect(scenes).toHaveLength(1)
		// No session, so no lane to number on: shown, and written, as stored.
		expect(scenes[0].name).toBe("Scene 4 · Day 2")
		expect(scene.id).toBeGreaterThan(0)
	})

	test("rides a synthesized dated history entry when none matches; nothing is written", async () => {
		const b = await makeBook()
		await unfiled(b, {
			name: "Custom A",
			openedStoryClockYear: 9,
			openedStoryClockMonth: 3,
			openedStoryClockDay: 4
		})
		await unfiled(b, {
			name: "Custom B",
			openedStoryClockYear: 9,
			openedStoryClockMonth: 3,
			openedStoryClockDay: 4
		})
		await unfiled(b, { name: "Dateless" })
		const before = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, b.lorebook.id))

		const doc = await exportBook(b)
		const history = historyOf(doc)
		// The book's own entry, plus one for the day no entry matched.
		expect(history).toHaveLength(2)
		const carrying = history.filter(
			(e: any) => e.extensions.serenepub.scenes?.length
		)
		const byName = (n: string) =>
			carrying.find((e: any) =>
				e.extensions.serenepub.scenes.some((s: any) => s.name === n)
			)
		const day = byName("Custom A")
		expect(byName("Custom B")).toBe(day)
		expect(day.content).toBe("")
		expect(day.extensions.serenepub).toMatchObject({ year: 9, month: 3, day: 4 })
		// The dateless scene rides the newest dated entry.
		expect(byName("Dateless")).toBeDefined()

		const after = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, b.lorebook.id))
		expect(after).toHaveLength(before.length)
	})

	test("a scene on another book's line does not fail the export (the export carries main's scenes only); the other still nests under its day's entry", async () => {
		const b = await makeBook()
		const other = await makeBook()
		const [foreign] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: other.lorebook.id, name: "elsewhere" })
			.returning()
		const clock = {
			openedStoryClockYear: 5,
			openedStoryClockMonth: 1,
			openedStoryClockDay: 2
		}
		await unfiled(b, { name: "Nested", ...clock })
		await unfiled(b, { name: "Stray", branchId: foreign.id, ...clock })
		const doc = await exportBook(b)
		const history = historyOf(doc)
		expect(history).toHaveLength(1)
		expect(
			history[0].extensions.serenepub.scenes.map((s: any) => s.name)
		).toEqual(["Nested"])
	})

	test("round-trips: the import gets the scene, under a history entry", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const b = await makeBook()
		await unfiled(b, {
			name: "Kept",
			openedStoryClockYear: 9,
			openedStoryClockMonth: 3,
			openedStoryClockDay: 4
		})
		const doc = await exportBook(b)
		const other = await makeUser("unfiled-importer")
		const res = await lorebookImportHandler.handler(
			fakeSocket(other.id),
			{ lorebookJson: JSON.stringify(doc) },
			noopEmit
		)
		const imported = await testDb.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, res.lorebook!.id)
		})
		expect(imported.map((s) => s.name)).toEqual(["Kept"])
		expect(imported[0].historyEntryId).not.toBeNull()
		expect(imported[0].nameIsDefault).toBe(false)
	})
})

describe("an unfiled scene in a copy", () => {
	test("is copied unfiled with its display name, custom from here on", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const b = await makeBook()
		const msg = async (content: string) =>
			(
				await testDb
					.insert(schema.sessionMessages)
					.values({ sessionId: b.session.id, role: "user", content } as any)
					.returning()
			)[0]
		const m1 = await msg("a")
		const m2 = await msg("b")
		const m3 = await msg("c")
		const first = await unfiled(b, {
			sessionId: b.session.id,
			name: "Scene 1",
			nameIsDefault: true,
			openedAtMessageId: m1.id,
			closedAtMessageId: m2.id
		})
		const second = await unfiled(b, {
			sessionId: b.session.id,
			name: "Scene 5 · Day 2",
			nameIsDefault: true,
			openedAtMessageId: m3.id
		})
		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id },
			noopEmit
		)
		const copied = await testDb.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, copy.id),
			orderBy: (s, { asc }) => asc(s.id)
		})
		expect(copied.map((s) => s.name)).toEqual(["Scene 1", "Scene 2 · Day 2"])
		expect(copied.every((s) => s.historyEntryId === null)).toBe(true)
		expect(copied.every((s) => s.nameIsDefault === false)).toBe(true)
		expect(copied.every((s) => s.sessionId === null)).toBe(true)
		expect(first.id).not.toBe(second.id)
	})
})
