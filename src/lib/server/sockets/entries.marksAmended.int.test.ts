/**
 * Marks tell the truth under amendments (plan A14).
 *
 * An entry's **Off** and **Pin** marks, its name and its keys can each be
 * set by a dated amendment, and a session reads the entry as its line's
 * amendments leave it by its clock. Two readers disagreed with that:
 *
 * - the Lore entries widget's list (`entries:sessionEntries`) SHOWED the
 *   amended values but searched, filtered and sorted on the stored columns,
 *   so "Pinned" and "Off" could list rows reading the opposite, and a search
 *   found an entry by a name it no longer has;
 * - `entries:setMarks` wrote the base row and answered with it, so a mark a
 *   dated amendment decides seemed to change and did not. It now answers
 *   with the marks as the asking session reads them and names the amendment
 *   that holds a mark (`heldBy`).
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-entries-marks-amended-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const asUser = (id: number) => ({ user: { id } }) as any
const noop = () => {}

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `marks-amended-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Marks ${seq}`, userId: user.id })
		.returning()
	const entry = async (name: string, extra: Record<string, unknown> = {}) => {
		const { createEntryHandler } = await import("./entries")
		const { entry } = (await createEntryHandler.handler(
			asUser(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book!.id,
					name,
					content: "",
					...extra
				}
			} as any,
			noop
		)) as any
		return entry as { id: number }
	}
	/** An amendment on main, from Year `year` on. */
	const amend = async (entryId: number, year: number, fields: Record<string, unknown>) =>
		(
			await testDb
				.insert(schema.entryAmendments)
				.values({ lorebookId: book!.id, entryId, year, fields })
				.returning()
		)[0]!
	/** A session reading the book at `clock` (null: the head). */
	const session = async (clock: number | null = null) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: user.id,
					isGroup: false,
					lorebookId: book!.id,
					storyClockYear: clock
				} as any)
				.returning()
		)[0]!
	const list = async (sessionId: number, params: Record<string, unknown> = {}) => {
		const { entrySessionEntriesHandler } = await import("./entries")
		return (await entrySessionEntriesHandler.handler(
			asUser(user.id),
			{ sessionId, ...params } as any,
			noop
		)) as any
	}
	const titles = async (sessionId: number, params: Record<string, unknown> = {}) =>
		((await list(sessionId, params)).rows as { title: string }[]).map((r) => r.title)
	const mark = async (params: Record<string, unknown>) => {
		const { entrySetMarksHandler } = await import("./entries")
		return (await entrySetMarksHandler.handler(asUser(user.id), params as any, noop)) as any
	}
	return { user, book: book!, entry, amend, session, list, titles, mark }
}

describe("entries:sessionEntries asks the entry as the session reads it", () => {
	test("Off and Pinned list what the amendments leave switched off and pinned, and count those", async () => {
		const b = await makeBook()
		const quiet = await b.entry("Quiet")
		const silenced = await b.entry("Silenced")
		const restored = await b.entry("Restored", { enabled: false })
		const pinnedLater = await b.entry("Pinned later")
		const unpinned = await b.entry("Unpinned", { constant: true })
		await b.amend(silenced.id, 2, { enabled: false })
		await b.amend(restored.id, 2, { enabled: true })
		await b.amend(pinnedLater.id, 2, { constant: true })
		await b.amend(unpinned.id, 2, { constant: false })
		void quiet

		const now = await b.session(5)
		expect(await b.titles(now.id, { filter: "off" })).toEqual(["Silenced"])
		expect((await b.list(now.id, { filter: "off" })).total).toBe(1)
		expect(await b.titles(now.id, { filter: "pinned" })).toEqual(["Pinned later"])

		// Before Year 2 the amendments have not happened: the stored marks stand.
		const before = await b.session(1)
		expect(await b.titles(before.id, { filter: "off" })).toEqual(["Restored"])
		expect(await b.titles(before.id, { filter: "pinned" })).toEqual(["Unpinned"])
	}, 60_000)

	test("a search finds an entry by the name and keys it has now, never by the ones an amendment replaced", async () => {
		const b = await makeBook()
		const renamed = await b.entry("Old Mill", { keys: "mill" })
		await b.entry("Harbour", { keys: "docks" })
		await b.amend(renamed.id, 2, { name: "Burnt Mill", keys: ["ashes", "ruin"] })

		const now = await b.session(5)
		expect(await b.titles(now.id, { query: "burnt" })).toEqual(["Burnt Mill"])
		expect(await b.titles(now.id, { query: "ruin" })).toEqual(["Burnt Mill"])
		expect(await b.titles(now.id, { query: "old" })).toEqual([])
		// At Year 1 it is the Old Mill still.
		expect(await b.titles((await b.session(1)).id, { query: "old" })).toEqual(["Old Mill"])
	}, 60_000)

	test("an entry an amendment archives is left out from its date, and one it brings back is listed, as retrieval reads them", async () => {
		const b = await makeBook()
		await b.entry("Standing")
		const archivedLater = await b.entry("Archived later")
		const restoredLater = await b.entry("Restored later")
		await testDb
			.update(schema.lorebookEntries)
			.set({ archived: true })
			.where(eq(schema.lorebookEntries.id, restoredLater.id))
		await b.amend(archivedLater.id, 2, { archived: true })
		await b.amend(restoredLater.id, 2, { archived: false })

		const now = await b.session(5)
		expect(await b.titles(now.id)).toEqual(["Restored later", "Standing"])
		expect((await b.list(now.id)).total).toBe(2)
		// Before Year 2 the amendments have not happened: the stored mark stands.
		expect(await b.titles((await b.session(1)).id)).toEqual(["Archived later", "Standing"])
	}, 60_000)

	test("narrowed to entry ids, it answers only those, with their marks as the session reads them", async () => {
		const b = await makeBook()
		await b.entry("Other")
		const asked = await b.entry("Asked", { constant: true })
		await b.amend(asked.id, 2, { constant: false, enabled: false })

		const res = await b.list((await b.session(5)).id, { entryIds: [asked.id] })
		expect(res.rows.map((r: any) => [r.title, r.pinned, r.off])).toEqual([["Asked", false, true]])
		expect(res.total).toBe(1)
	}, 60_000)

	test("by name, an entry sorts under the name it has now, and pages over what the filter left", async () => {
		const b = await makeBook()
		const zed = await b.entry("Zed")
		await b.entry("Mira")
		await b.entry("Bram")
		await b.amend(zed.id, 2, { name: "Aster" })

		const now = await b.session(5)
		expect(await b.titles(now.id, { sort: "name" })).toEqual(["Aster", "Bram", "Mira"])
		const page = await b.list(now.id, { sort: "name", limit: 2, offset: 2 })
		expect(page.rows.map((r: any) => r.title)).toEqual(["Mira"])
		expect(page.total).toBe(3)
		// A page past the end is the last real page.
		const past = await b.list(now.id, { sort: "name", limit: 2, offset: 6 })
		expect(past.offset).toBe(2)
		expect(past.rows.map((r: any) => r.title)).toEqual(["Mira"])
	}, 60_000)
})

describe("entries:setMarks says when a dated amendment decides the mark", () => {
	test("from a session the amendment holds: the base is written, the reply says how the session reads it and which amendment wins", async () => {
		const b = await makeBook()
		const kept = await b.entry("Kept on")
		const on = await b.amend(kept.id, 3, { enabled: true })
		const now = await b.session(5)

		const res = await b.mark({ entryId: kept.id, off: true, sessionId: now.id })
		expect(res).toMatchObject({
			entryId: kept.id,
			lorebookId: b.book.id,
			off: false,
			pinned: false,
			heldBy: {
				field: "enabled",
				date: { year: 3, month: null, day: null },
				label: expect.stringMatching(/3/),
				amendmentId: on.id
			}
		})
		const [stored] = await testDb
			.select({ enabled: schema.lorebookEntries.enabled })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, kept.id))
		expect(stored!.enabled).toBe(false)
	}, 60_000)

	test("a session whose clock is before the amendment reads the base: the mark takes, and nothing holds it", async () => {
		const b = await makeBook()
		const kept = await b.entry("Kept on")
		await b.amend(kept.id, 3, { constant: false })
		const early = await b.session(1)

		const res = await b.mark({ entryId: kept.id, pinned: true, sessionId: early.id })
		expect(res).toMatchObject({ off: false, pinned: true })
		expect(res.heldBy).toBeUndefined()
	}, 60_000)

	test("with no session the book is read on main at its head, where every main amendment has happened", async () => {
		const b = await makeBook()
		const kept = await b.entry("Pinned for good")
		const pin = await b.amend(kept.id, 7, { constant: true })

		const res = await b.mark({ entryId: kept.id, pinned: false })
		expect(res).toMatchObject({
			pinned: true,
			heldBy: { field: "constant", amendmentId: pin.id }
		})
	}, 60_000)

	test("the reply and the refusal carry the ask's request token, so the tab that asked settles on its own answer", async () => {
		const b = await makeBook()
		const kept = await b.entry("Tokened")
		const now = await b.session(5)

		const res = await b.mark({ entryId: kept.id, off: true, sessionId: now.id, request: "tab-a:1" })
		expect(res).toMatchObject({ entryId: kept.id, off: true, request: "tab-a:1" })
		const refused = await b.mark({ entryId: kept.id, sessionId: now.id, request: "tab-a:2" })
		expect(refused).toMatchObject({ entryId: kept.id, request: "tab-a:2", error: expect.any(String) })
	}, 60_000)

	test("a session the asker cannot open is refused, and nothing is written", async () => {
		const b = await makeBook()
		const other = await makeBook()
		const kept = await b.entry("Mine")
		const theirs = await other.session(null)

		const res = await b.mark({ entryId: kept.id, off: true, sessionId: theirs.id })
		expect(res.error).toBe("Session not found.")
		const [stored] = await testDb
			.select({ enabled: schema.lorebookEntries.enabled })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, kept.id))
		expect(stored!.enabled).toBe(true)
	}, 60_000)
})
