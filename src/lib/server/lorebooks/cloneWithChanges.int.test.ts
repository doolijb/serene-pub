/**
 * 🚧 **Clone with changes and attach** (pr-6, B §B-4, R-p): the attached book
 * copied whole, the session moved onto the copy, its own book's changes
 * written in. The session reads the same thing before and after; the original
 * is never written (except that the session's own scene moves out of it).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues, insertSessionMessageRow } from "$lib/server/pipelines/testing/fixtures"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { SHARE_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-cloneWithChanges-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function place(lorebookId: number, title: string, extra: Record<string, unknown> = {}) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({ lorebookId, typeId: LOCATION_TYPE_ID, typeVersion: 1, position: ++n, title, ...extra } as any)
		.returning()
	return row!
}

/** A book of one person's, a session of another's reading it (shared), its own notes holding a place under one of the book's. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { ownBookFor } = await import("./ownBook")
	const user = await createTestUser(testDb, `clone-with-changes-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Shared World" })
		.returning()
	const square = await place(book.id, "The square")
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book.id, year: 5, month: 1, day: 2 }]))
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: "Run", lorebookId: book.id } as any)
		.returning()
	const m1 = await insertSessionMessageRow(testDb, session.id, { content: "Meet me at the gate." })
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: book.id,
			sessionId: session.id,
			historyEntryId: history.id,
			name: "Scene 1",
			channel: "main",
			selectedMessageIds: [m1.id]
		} as any)
		.returning()
	const notes = await ownBookFor(testDb as any, session.id)
	const door = await place(notes.id, "The secret door", { anchorEntryId: square.id, sourceMessageId: m1.id })
	return { user, book, square, history, session, scene, notes, door }
}

const titles = async (sessionId: number) => {
	const { sessionEntriesAsRead } = await import("./ownBook")
	return (await sessionEntriesAsRead(testDb as any, sessionId, "session", [LOCATION_TYPE_ID]))
		.map((e) => e.name)
		.sort()
}

describe("cloneWithChanges", () => {
	test("the session moves onto a copy that holds the notes; it reads the same; the original is untouched", async () => {
		const w = await world()
		const { cloneWithChanges } = await import("./ownBook")
		const entriesOf = async (id: number) =>
			testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, id))
		const before = await titles(w.session.id)
		const originalBefore = (await entriesOf(w.book.id)).map((e) => e.id).sort()
		expect(before).toEqual(["The secret door", "The square"])

		const done = await cloneWithChanges(testDb as any, { sessionId: w.session.id, userId: w.user.id })

		expect(done.name).toBe("Shared World (with Run's notes)")
		expect(done.applied).toEqual([w.door.id])
		const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(session!.lorebookId).toBe(done.lorebookId)
		expect(done.lorebookId).not.toBe(w.book.id)
		expect(await titles(w.session.id)).toEqual(before)

		// The own book holds no entries and overlays the copy.
		expect(await entriesOf(w.notes.id)).toHaveLength(0)
		const [notes] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, w.notes.id))
		expect(notes!.overlayOf).toBe(done.lorebookId)

		// The door sits under the copy's square, in the copy.
		const copy = await entriesOf(done.lorebookId)
		const copySquare = copy.find((e) => e.title === "The square")!
		const door = copy.find((e) => e.title === "The secret door")!
		expect(copySquare.id).not.toBe(w.square.id)
		expect(door.anchorEntryId).toBe(copySquare.id)

		// The original: the same entries; its history entry and square intact.
		expect((await entriesOf(w.book.id)).map((e) => e.id).sort()).toEqual(originalBefore)
		// The session's scene moved to the copy; the copy holds one of it, not two.
		const scenes = await testDb.select().from(schema.scenes).where(eq(schema.scenes.sessionId, w.session.id))
		expect(scenes.map((s) => s.id)).toEqual([w.scene.id])
		expect(scenes[0]!.lorebookId).toBe(done.lorebookId)
		const copySceneRows = await testDb.select().from(schema.scenes).where(eq(schema.scenes.lorebookId, done.lorebookId))
		expect(copySceneRows).toHaveLength(1)
		expect(await testDb.select().from(schema.scenes).where(eq(schema.scenes.lorebookId, w.book.id))).toHaveLength(0)
		// Its history entry is the copy's.
		expect((await entriesOf(done.lorebookId)).some((e) => e.id === scenes[0]!.historyEntryId)).toBe(true)
	})

	test("a named copy takes the name; refusals: no book, not the owner", async () => {
		const w = await world()
		const { cloneWithChanges, OwnBookRefusal } = await import("./ownBook")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `clone-stranger-${++n}`)
		await expect(
			cloneWithChanges(testDb as any, { sessionId: w.session.id, userId: stranger.id })
		).rejects.toThrow(SHARE_REFUSALS.notOwner)

		const [bare] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: false, name: "Bare" } as any)
			.returning()
		const err = await cloneWithChanges(testDb as any, { sessionId: bare.id, userId: w.user.id }).catch((e) => e)
		expect(err).toBeInstanceOf(OwnBookRefusal)
		expect(err.message).toBe(SHARE_REFUSALS.noBook)

		const done = await cloneWithChanges(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			name: "  My copy  "
		})
		expect(done.name).toBe("My copy")
	})
})
