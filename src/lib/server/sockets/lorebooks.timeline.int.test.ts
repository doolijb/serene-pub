/**
 * 🚧 The **Timeline** switch on `lorebooks:update`: only the book's owner sets
 * it, the notes that overlay the book follow it in the same save, and notes
 * that overlay a lorebook refuse it. A value that is not on or off is refused.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lorebooksTimeline-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const quiet = (async () => {}) as any
const as = (id: number) => ({ user: { id } }) as any

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `lb-timeline-${++n}`)
}

async function book(userId: number, values: Partial<typeof schema.lorebooks.$inferInsert> = {}) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Codex ${++n}`, ...values })
		.returning()
	return row!
}

async function stored(id: number) {
	const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, id))
	return row!
}

async function setSwitch(userId: number, id: number, timelineEnabled: unknown) {
	const { lorebooksUpdateHandler } = await import("./lorebooks")
	return lorebooksUpdateHandler.handler(as(userId), { lorebook: { id }, timelineEnabled } as any, quiet)
}

async function notesOver(owner: number, overlayOf: number, timelineEnabled = true) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner, isGroup: false, name: `Run ${++n}`, lorebookId: overlayOf })
		.returning()
	return book(owner, { sessionId: s!.id, overlayOf, timelineEnabled })
}

describe("the Timeline switch on lorebooks:update", () => {
	test("the owner switches it off; notes over the book follow, and follow back on", async () => {
		const me = await person()
		const codex = await book(me.id)
		const notes = await notesOver(me.id, codex.id)
		const res = await setSwitch(me.id, codex.id, false)
		expect(res.lorebook.timelineEnabled).toBe(false)
		expect((await stored(codex.id)).timelineEnabled).toBe(false)
		expect((await stored(notes.id)).timelineEnabled).toBe(false)
		const back = await setSwitch(me.id, codex.id, true)
		expect(back.lorebook.timelineEnabled).toBe(true)
		expect((await stored(notes.id)).timelineEnabled).toBe(true)
	})

	test("a save that does not send it leaves it alone", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const me = await person()
		const codex = await book(me.id, { timelineEnabled: false })
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id, name: "Renamed", timelineEnabled: true } as any },
			quiet
		)
		expect((await stored(codex.id)).timelineEnabled).toBe(false)
	})

	test("a person it is shared with, and anyone else, cannot change it", async () => {
		const owner = await person()
		const reader = await person()
		const stranger = await person()
		const codex = await book(owner.id)
		await testDb.insert(schema.lorebookShares).values({ lorebookId: codex.id, userId: reader.id })
		await expect(setSwitch(reader.id, codex.id, false)).rejects.toThrow("Lorebook not found.")
		await expect(setSwitch(stranger.id, codex.id, false)).rejects.toThrow("Lorebook not found.")
		expect((await stored(codex.id)).timelineEnabled).toBe(true)
	})

	test("notes that overlay a lorebook refuse it; notes that are the whole world may be switched", async () => {
		const me = await person()
		const codex = await book(me.id)
		const notes = await notesOver(me.id, codex.id)
		await expect(setSwitch(me.id, notes.id, false)).rejects.toThrow(
			"A session's own notes follow their session's lorebook."
		)
		expect((await stored(notes.id)).timelineEnabled).toBe(true)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: me.id, isGroup: false, name: "Alone" })
			.returning()
		const whole = await book(me.id, { sessionId: s!.id })
		const res = await setSwitch(me.id, whole.id, false)
		expect(res.lorebook.timelineEnabled).toBe(false)
	})

	test("a value that is not on or off is refused", async () => {
		const me = await person()
		const codex = await book(me.id)
		for (const bad of ["false", 0, null])
			await expect(setSwitch(me.id, codex.id, bad)).rejects.toThrow("The timeline is on or off.")
		expect((await stored(codex.id)).timelineEnabled).toBe(true)
	})
})
