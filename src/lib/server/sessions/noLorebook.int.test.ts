/**
 * pr-6 B-2 (§B-3a): "no lorebook" is gone. A session with no shared book keeps
 * its clock, its scenes and its reading in its own book.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertSessionMessageRow } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-no-lorebook-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
/** A person and a session that reads no shared book, with its own book. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const user = await createTestUser(testDb, `no-lorebook-${++seq}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Alone ${seq}` })
		.returning()
	const own = await insertOwnBook(testDb as any, {
		sessionId: session.id,
		userId: user.id,
		name: session.name,
		overlayOf: null,
		primaryRuleset: session.primaryRuleset,
		rulesetVersion: session.rulesetVersion ?? null
	})
	return { user, session, own }
}

const clockOf = async (sessionId: number) =>
	(
		await testDb
			.select({
				year: schema.sessions.storyClockYear,
				month: schema.sessions.storyClockMonth,
				day: schema.sessions.storyClockDay
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]

describe("a session with no shared lorebook", () => {
	test("its story clock can be set, and advanced by a day, in Gregorian", async () => {
		const { setSessionStoryClock } = await import("$lib/server/sockets/storyClock")
		const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
		const w = await world()
		expect(w.session.lorebookId).toBeNull()
		const set = await setSessionStoryClock(w.session.id, w.user.id, {
			sessionId: w.session.id,
			to: { year: 2026, month: 2, day: 28 }
		} as any)
		expect(set.moved).toBe(true)
		expect(await clockOf(w.session.id)).toEqual({ year: 2026, month: 2, day: 28 })
		const stepped = await advanceSessionStoryClock(testDb as any, w.session.id, 1, "days")
		expect(stepped.clock).toMatchObject({ year: 2026, month: 3, day: 1 })
		expect(await clockOf(w.session.id)).toEqual({ year: 2026, month: 3, day: 1 })
	}, 60_000)

	test("sessionStoryNowOf reads the own book's clock once it has one", async () => {
		const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
		const w = await world()
		expect(await sessionStoryNowOf(testDb as any, w.session.id)).toBeNull()
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 3, storyClockMonth: 4, storyClockDay: 5 })
			.where(eq(schema.sessions.id, w.session.id))
		const now = await sessionStoryNowOf(testDb as any, w.session.id)
		expect(now).not.toBeNull()
		expect(JSON.stringify(now)).toContain("3")
	}, 60_000)

	test("openScene files the scene under the own book", async () => {
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await world()
		const m1 = await insertSessionMessageRow(testDb, w.session.id, { content: "We go tonight." })
		const res: any = await openScene(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			atMessageId: m1.id
		})
		const [scene] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, res.scene.id))
		expect(scene.lorebookId).toBe(w.own.id)
	}, 60_000)

	test("sessionReadingOf stays the SHARED book's line: null with none (the own book is every union's own half)", async () => {
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const w = await world()
		expect(await sessionReadingOf(testDb as any, w.session.id)).toBeNull()
	}, 60_000)
})
