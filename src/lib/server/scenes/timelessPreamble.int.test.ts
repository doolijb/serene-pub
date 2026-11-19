/**
 * A lorebook that keeps no timeline puts no scene date in the summary
 * preamble and no day marks in a transcript, whatever stamps are stored; one
 * that keeps a timeline is unchanged.
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-timeless-preamble-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function world(timeline: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `timeless-preamble-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id, timelineEnabled: timeline })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()
	const stamp = (day: number) => ({
		storyClockYear: 5,
		storyClockMonth: 1,
		storyClockDay: day
	})
	const a = await insertSessionMessageRow(testDb, session.id, { content: "a", ...stamp(1) })
	const b = await insertSessionMessageRow(testDb, session.id, { content: "b", ...stamp(2) })
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			sessionId: session.id,
			openedAtMessageId: a.id,
			closedAtMessageId: b.id,
			openedStoryClockYear: 5,
			openedStoryClockMonth: 1,
			openedStoryClockDay: 2
		})
		.returning()
	return { session, scene, ids: [a.id, b.id] }
}

async function span(w: Awaited<ReturnType<typeof world>>) {
	const { readSummarizeSpan } = await import(
		"$lib/server/pipelines/runtime/host.read.summarize"
	)
	const node = { key: "n", definitionId: "d" } as any
	const host = {
		read: async () => w.ids.map((id) => ({ id }))
	} as any
	const scope = { sessionId: w.session.id } as any
	return (await readSummarizeSpan({
		db: testDb as any,
		scope,
		host,
		node,
		q: { sessionId: w.session.id, messageIds: w.ids }
	})) as { messages: Array<{ clock: unknown }> }
}

describe("a lorebook that keeps no timeline", () => {
	test("the preamble has no date and the transcript no day marks", async () => {
		const w = await world(false)
		const { sceneHeaderOf } = await import("$lib/server/scenes/liveScenes")
		const header = await sceneHeaderOf(testDb as any, w.scene)
		expect(header.date).toBeUndefined()
		const { messages } = await span(w)
		expect(messages.map((m) => m.clock ?? null)).toEqual([null, null])
	}, 60_000)

	test("a lorebook that keeps one is unchanged", async () => {
		const w = await world(true)
		const { sceneHeaderOf } = await import("$lib/server/scenes/liveScenes")
		const header = await sceneHeaderOf(testDb as any, w.scene)
		expect(header.date).toBeTruthy()
		const { messages } = await span(w)
		expect(messages.map((m) => (m.clock as any)?.day)).toEqual([1, 2])
	}, 60_000)
})
