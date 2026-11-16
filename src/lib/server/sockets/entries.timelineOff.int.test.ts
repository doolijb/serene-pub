/**
 * 🚧 A session's history write on a book with no timeline: refused with the
 * sentence before anything is written (Summarize to lorebook's New day); the
 * same write on a timelined book, a session's world lore on a book with none,
 * and a person's own history entry are unchanged.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entriesTimelineOff-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
const socket = (userId: number) => ({ user: { id: userId } }) as any

async function world(timelineEnabled: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `entries-timeline-off-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: owner.id, timelineEnabled })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: `Run ${seq}`, lorebookId: book!.id })
		.returning()
	return { owner, book: book!, session: session! }
}

const entryOf = (typeId: string, lorebookId: number, extra: Record<string, unknown> = {}) => ({
	typeId,
	lorebookId,
	content: "A day.",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	...extra
})

async function create(userId: number, params: any) {
	const { createEntryHandler } = await import("./entries")
	return createEntryHandler.handler(socket(userId), params, () => {})
}

const historyCount = async (lorebookId: number) =>
	(
		await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
	).length

describe("a session's history write follows the Timeline switch", () => {
	test("off: refused with the sentence, nothing written; the person's own create is not refused", async () => {
		const w = await world(false)
		await expect(
			create(w.owner.id, { entry: entryOf(HISTORY_TYPE_ID, w.book.id), sessionId: w.session.id })
		).rejects.toThrow(TIMELINE_OFF_SENTENCES.history)
		expect(await historyCount(w.book.id)).toBe(0)
		const own = await create(w.owner.id, { entry: entryOf(HISTORY_TYPE_ID, w.book.id, { year: 4 }) })
		expect(own.entry).toBeTruthy()
		expect(await historyCount(w.book.id)).toBe(1)
	})

	test("off: a session's world lore is still saved", async () => {
		const w = await world(false)
		const { entry } = await create(w.owner.id, {
			entry: entryOf(WORLD_LORE_TYPE_ID, w.book.id, { name: "The bridge" }),
			sessionId: w.session.id
		})
		expect(entry).toBeTruthy()
	})

	test("on: the session's history day is written as before", async () => {
		const w = await world(true)
		const { entry } = await create(w.owner.id, {
			entry: entryOf(HISTORY_TYPE_ID, w.book.id),
			sessionId: w.session.id
		})
		expect(entry).toBeTruthy()
		expect(await historyCount(w.book.id)).toBe(1)
	})
})
