/**
 * The entry lock's door: `entries:setMarks { locked }` (owner ruling EL1).
 * Written at once to the stored row, never dated, never an Edit history row;
 * allowed to whoever may edit the row by hand, refused in words to anyone
 * else and on a provided lorebook's row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entries-lock-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const asUser = (id: number) => ({ user: { id } }) as any
const noop = () => {}
const REFUSED = "Entry not found or access denied."

let seq = 0
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `lock-owner-${++seq}`)
	const stranger = await createTestUser(testDb, `lock-stranger-${seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Lock ${seq}`, userId: owner.id })
		.returning()
	const { createEntryHandler } = await import("./entries")
	const { entry } = (await createEntryHandler.handler(
		asUser(owner.id),
		{ entry: { typeId: WORLD_LORE_TYPE_ID, lorebookId: book!.id, name: "The Mill", content: "" } } as any,
		noop
	)) as any
	const setMarks = async (userId: number, params: Record<string, unknown>, sent: any[] = []) => {
		const { entrySetMarksHandler } = await import("./entries")
		return (await entrySetMarksHandler.handler(
			asUser(userId),
			params as any,
			((event: string, data: any) => sent.push({ event, data })) as any
		)) as any
	}
	const stored = async (id: number) =>
		(await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!
	const redlines = async (id: number) =>
		(await testDb.select().from(schema.loreRedlines).where(eq(schema.loreRedlines.entryId, id))).length
	return { owner, stranger, book: book!, entry: entry as { id: number }, setMarks, stored, redlines }
}

describe("entries:setMarks { locked }", () => {
	test("the owner locks and unlocks: the reply says so, the column holds it, no history row is written", async () => {
		const w = await world()
		const sent: any[] = []
		const locked = await w.setMarks(w.owner.id, { entryId: w.entry.id, locked: true, request: "r1" }, sent)
		expect(locked).toMatchObject({ entryId: w.entry.id, locked: true, request: "r1" })
		expect((await w.stored(w.entry.id)).entryLock).toBe(true)
		// The row the list and the editor read carries the lock.
		const row = sent.find((s) => s.event === "entries:update")!.data.entry
		expect(row.entryLock).toBe(true)
		const unlocked = await w.setMarks(w.owner.id, { entryId: w.entry.id, locked: false })
		expect(unlocked.locked).toBe(false)
		expect((await w.stored(w.entry.id)).entryLock).toBe(false)
		expect(await w.redlines(w.entry.id)).toBe(0)
	}, 60_000)

	test("a lock changes no other mark", async () => {
		const w = await world()
		const res = await w.setMarks(w.owner.id, { entryId: w.entry.id, locked: true })
		expect(res).toMatchObject({ off: false, pinned: false, locked: true })
		const row = await w.stored(w.entry.id)
		expect(row.enabled).toBe(true)
		expect(row.constant).toBe(false)
	}, 60_000)

	test("an ask naming no mark is told to say which, the lock among them", async () => {
		const w = await world()
		const res = await w.setMarks(w.owner.id, { entryId: w.entry.id })
		expect(res.error).toBe("Say which mark: off, pinned, locked, or more than one.")
	}, 60_000)

	test("another person is refused in words and the row is untouched", async () => {
		const w = await world()
		const res = await w.setMarks(w.stranger.id, { entryId: w.entry.id, locked: true })
		expect(res.error).toBe(REFUSED)
		expect((await w.stored(w.entry.id)).entryLock).toBe(false)
	}, 60_000)

	test("a session's notes entry: the session's owner locks it, a guest cannot", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.owner.id, isGroup: false } as any)
			.returning()
		const own = await ownBookFor(testDb as any, session!.id)
		const shape = await w.stored(w.entry.id)
		const [note] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: own.id,
				typeId: shape.typeId,
				typeVersion: shape.typeVersion,
				title: "A note",
				content: "x",
				position: 1
			} as any)
			.returning()
		const guest = await createTestUser(testDb, `lock-guest-${seq}`)
		await testDb.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: guest.id })
		expect((await w.setMarks(guest.id, { entryId: note!.id, locked: true })).error).toBe(REFUSED)
		expect((await w.stored(note!.id)).entryLock).toBe(false)
		const res = await w.setMarks(w.owner.id, { entryId: note!.id, locked: true })
		expect(res.locked).toBe(true)
		expect((await w.stored(note!.id)).entryLock).toBe(true)
	}, 60_000)

	test("a provided lorebook's row is refused in the pub's own words", async () => {
		const w = await world()
		const uuid = "00000000-0000-4000-8000-000000000a1c"
		await testDb
			.update(schema.lorebooks)
			.set({
				uuid,
				extraJson: {
					provided: { plugin: "core", slug: "core:lock", version: "1.0.0", sha256: "x", uuid, entries: {} }
				}
			} as any)
			.where(eq(schema.lorebooks.id, w.book.id))
		const res = await w.setMarks(w.owner.id, { entryId: w.entry.id, locked: true })
		expect(res.error).toBe("This lorebook comes with the pub: make your own copy to change it.")
		expect((await w.stored(w.entry.id)).entryLock).toBe(false)
	}, 60_000)
})
