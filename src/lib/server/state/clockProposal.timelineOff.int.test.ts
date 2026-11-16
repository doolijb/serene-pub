/**
 * 🚧 `clockMoveProblem` on a session whose governing book has no timeline: the
 * clock sentence, with the same step that lands on a timelined book answering
 * null.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { ...actual, db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-clockProposalOff-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let seq = 0
async function sessionOn(timelineEnabled: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `clock-proposal-off-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${seq}`, timelineEnabled })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${seq}`, lorebookId: book!.id, storyClockYear: 5, storyClockMonth: 1, storyClockDay: 1 })
		.returning()
	return session!
}

describe("clockMoveProblem follows the Timeline switch", () => {
	test("off: the clock sentence; on: the same step lands", async () => {
		const { clockMoveProblem } = await import("./clockProposal")
		const db = testDb as unknown as Db
		const off = await sessionOn(false)
		expect(await clockMoveProblem(db, off.id, 1, "days")).toBe(TIMELINE_OFF_SENTENCES.clock)
		const on = await sessionOn(true)
		expect(await clockMoveProblem(db, on.id, 1, "days")).toBeNull()
	})
})
