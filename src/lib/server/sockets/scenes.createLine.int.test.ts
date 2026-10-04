/**
 * A scene is filed under a history entry its own line reads (plan A8).
 *
 * `scenes:create` checked the history entry's book and nothing else, so a
 * scene could be filed under an entry on a sibling line, or under an
 * ancestor's entry dated after the scene's line forked — a moment that line
 * never had. Such a scene cascade-deletes with an entry its line never read:
 * a main scene with a branch that is deleted, a fork's scene with the line it
 * left (`keepHistoryForForks` hands a fork only the entries it reads).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-create-line-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `scene-line-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Scene Line ${seq}`, userId: user.id })
		.returning()
	const history = async (year: number, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					...historyValues([{ lorebookId: lorebook.id, year }])[0],
					branchId
				})
				.returning()
		)[0]
	const fork = async (
		name: string,
		forkedFromBranchId: number | null,
		forkYear: number | null
	) =>
		(
			await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: lorebook.id,
					name,
					forkedFromBranchId,
					forkYear
				})
				.returning()
		)[0]
	const sessionOn = async (branchId: number | null) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({
					userId: user.id,
					isGroup: false,
					lorebookId: lorebook.id,
					lorebookBranchId: branchId
				})
				.returning()
		)[0]
	/** Save a scene under `historyEntryId`, from `sessionId` when given. */
	const save = async (historyEntryId: number, sessionId?: number) => {
		const { sceneCreateHandler } = await import("./scenes")
		return sceneCreateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					lorebookId: lorebook.id,
					...(sessionId !== undefined ? { sessionId } : {}),
					historyEntryId,
					summary: "What happened."
				}
			} as any,
			() => {}
		)
	}
	return { user, lorebook, history, fork, sessionOn, save }
}

describe("scenes:create files a scene only under a history entry its line reads", () => {
	test("from a session on a fork: its own entries and main's before the fork, never main's after it or a sibling's", async () => {
		const b = await makeBook()
		// main ─Y5─ C ; main ─Y2─ S (a sibling)
		const c = await b.fork("C", null, 5)
		const sibling = await b.fork("S", null, 2)
		const session = await b.sessionOn(c.id)
		const mainBefore = await b.history(3)
		const mainAfter = await b.history(8)
		const own = await b.history(9, c.id)
		const siblings = await b.history(1, sibling.id)

		expect((await b.save(mainBefore.id, session.id)).scene.branchId).toBe(c.id)
		expect((await b.save(own.id, session.id)).scene.branchId).toBe(c.id)
		await expect(b.save(mainAfter.id, session.id)).rejects.toThrow(
			/not on this session's line/
		)
		await expect(b.save(siblings.id, session.id)).rejects.toThrow(
			/not on this session's line/
		)
	}, 60_000)

	test("a fork of a fork reads its parent up to its own fork date, and main up to the earlier of the two", async () => {
		const b = await makeBook()
		// main ─Y5─ B ─Y7─ C
		const parent = await b.fork("B", null, 5)
		const c = await b.fork("C", parent.id, 7)
		const session = await b.sessionOn(c.id)

		await b.save((await b.history(6, parent.id)).id, session.id)
		await b.save((await b.history(4)).id, session.id)
		await expect(
			b.save((await b.history(8, parent.id)).id, session.id)
		).rejects.toThrow(/not on this session's line/)
		await expect(
			b.save((await b.history(6)).id, session.id)
		).rejects.toThrow(/not on this session's line/)
	}, 60_000)

	test("a scene saved outside a session is on main, so a line's own history entry is refused", async () => {
		const b = await makeBook()
		const line = await b.fork("What if", null, null)
		const onLine = await b.history(2, line.id)
		const onMain = await b.history(2)

		expect((await b.save(onMain.id)).scene.branchId).toBeNull()
		await expect(b.save(onLine.id)).rejects.toThrow(/not on main/)
	}, 60_000)
})

describe("scenes:create and a re-date of its history entry never interleave", () => {
	test("a scene saved while its entry moves past the line's fork date: one of the two is refused", async () => {
		const b = await makeBook()
		const { updateEntryHandler } = await import("./entries")
		const reading = await import("$lib/server/state/reading")
		// main ─Y5─ C: C reads main's Y3 entry, and would not read it at Y7.
		const c = await b.fork("C", null, 5)
		const session = await b.sessionOn(c.id)
		const entry = await b.history(3)

		// The save is held right after it has read the entry and its line —
		// where it decides the line reads the entry — while the re-date runs.
		const original = reading.lineOfBook
		let readDone!: () => void
		const read = new Promise<void>((r) => (readDone = r))
		let proceed!: () => void
		const resume = new Promise<void>((r) => (proceed = r))
		let armed = true
		const spy = vi.spyOn(reading, "lineOfBook").mockImplementation(async (handle, id, branchId) => {
			const line = await original(handle, id, branchId)
			if (armed && branchId === c.id) {
				armed = false
				readDone()
				await resume
			}
			return line
		})
		let saved: unknown
		let redated: unknown
		try {
			const saving = b.save(entry.id, session.id).then(
				(r) => r,
				(e: Error) => e
			)
			await Promise.race([read, saving])
			const moving = updateEntryHandler
				.handler(
					fakeSocket(b.user.id),
					{ entry: { id: entry.id, typeId: HISTORY_TYPE_ID, year: 7 } } as any,
					() => {}
				)
				.then(
					(r) => r,
					(e: Error) => e
				)
			await new Promise((r) => setTimeout(r, 300))
			proceed()
			saved = await saving
			redated = await moving
		} finally {
			spy.mockRestore()
		}
		expect(armed, "the save read its line").toBe(false)
		const [row] = await testDb
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))
		const year = (row!.fields as { year: number }).year
		const scenes = await testDb
			.select({ id: schema.scenes.id })
			.from(schema.scenes)
			.where(eq(schema.scenes.historyEntryId, entry.id))
		// Never both: a scene of C under an entry C no longer reads.
		expect(
			{ scenes: scenes.length, year },
			`save: ${saved instanceof Error ? saved.message : "saved"}; re-date: ${redated instanceof Error ? redated.message : "moved"}`
		).not.toEqual({ scenes: 1, year: 7 })
	}, 60_000)
})
