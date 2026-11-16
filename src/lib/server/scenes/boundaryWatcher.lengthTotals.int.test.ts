/**
 * The `length` trigger keeps running totals across the walk (perf lane E, F6):
 * a walk that starts inside an already-open scene fires at the lines the
 * per-line re-read did. 12 lines of 8 rough tokens; `every: 3` starts the walk
 * at line 9 (round 13 - depth 2 - every 3 + 1), so lines 1-8 are read once,
 * before the loop.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "boundary-watcher-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-boundary-watcher-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// The real core genres: Story registers the scenes routine.
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function run(length: Record<string, number>) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `length-totals-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Length Book ${seq}`, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }
			])
		)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: {
				scenes: {
					mode: "suggested",
					triggers: { dayCrossed: false, length }
				}
			}
		} as any)
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const ids: number[] = []
	for (let i = 0; i < 12; i++)
		ids.push(
			(
				await insertLegacy(
					testDb as any,
					{
						sessionId: session.id,
						role: "user",
						content:
							`Line number ${String(i + 1).padStart(2, "0")} goes here.`.padEnd(
								32,
								"."
							)
					} as any
				)
			).id
		)
	const { sceneBoundariesOf } = await import("./boundaryWatcher")
	const r = await sceneBoundariesOf(testDb as any, session.id, {
		depth: 2,
		every: 3
	})
	return { ids, found: r.boundaries.map((b) => [b.at, b.trigger]) }
}

describe("length trigger running totals", () => {
	test("lines: 3 fires at line 10 (8 lines before the walk, then a reset)", async () => {
		const { ids, found } = await run({ lines: 3 })
		// Line 9 sees 8 lines (no); line 10 sees 9 (fires, scene restarts at it); line 11 sees 1.
		expect(found).toEqual([[ids[9], "length"]])
	}, 60_000)

	test("tokens: 20 fires at line 9 (64 tokens before it crossed 60), then restarts", async () => {
		const { ids, found } = await run({ tokens: 20 })
		// 8 lines x 8 tokens = 64; floor(64/20)=3 > floor(56/20)=2. Then 8 and 16 tokens: no.
		expect(found).toEqual([[ids[8], "length"]])
	}, 60_000)
})
