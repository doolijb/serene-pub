/**
 * 🚧 Scene boundaries under Back · Forward (pr-6 A2): a boundary anchored to
 * a row Back takes is removed or moved, and Forward puts it back as it was.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scene-rewind-test-secret" }
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-scene-rewind-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "scene-rewind-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeWorld() {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Scene Rewind Book ${++seq}`, userId: ownerId })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: {}
		})
		.returning()
	return { session }
}

async function say(sessionId: number, content: string, role: "user" | "assistant" = "user") {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role, content } as any)
}

const scenesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
		.orderBy(asc(schema.scenes.id))

async function back(sessionId: number) {
	const { rewindTurn } = await import("$lib/server/sessions/rewind")
	const res = await rewindTurn(testDb as any, { sessionId, userId: ownerId })
	expect(res.ok).toBe(true)
}
async function forward(sessionId: number) {
	const { forwardTurn } = await import("$lib/server/sessions/rewind")
	const res = await forwardTurn(testDb as any, { sessionId, userId: ownerId })
	expect(res.ok).toBe(true)
}

describe("scene boundaries under Back and Forward", () => {
	it("a scene opened at a taken row goes, the one before reopens; Forward puts both back", async () => {
		const { session } = await makeWorld()
		const { openScene } = await import("./liveScenes")
		const m1 = await say(session.id, "one")
		await say(session.id, "two", "assistant")
		await openScene(testDb as any, { sessionId: session.id, userId: ownerId, atMessageId: m1.id })
		const m3 = await say(session.id, "three")
		await say(session.id, "four", "assistant")
		await openScene(testDb as any, { sessionId: session.id, userId: ownerId, atMessageId: m3.id })
		const before = await scenesOf(session.id)
		expect(before).toHaveLength(2)
		expect(before[0].closedAtMessageId).not.toBeNull()

		await back(session.id)
		const during = await scenesOf(session.id)
		expect(during).toHaveLength(1)
		expect(during[0].id).toBe(before[0].id)
		expect(during[0].closedAtMessageId).toBeNull()

		await forward(session.id)
		const after = await scenesOf(session.id)
		expect(after).toHaveLength(2)
		expect(after[1].id).toBe(before[1].id)
		expect(after[1].openedAtMessageId).toBe(m3.id)
		expect(after[0].closedAtMessageId).toBe(before[0].closedAtMessageId)
		expect(after[0].selectedMessageIds).toEqual(before[0].selectedMessageIds)
	}, 60_000)

	it("a scene closed at a taken row is open again; Forward closes it as before", async () => {
		const { session } = await makeWorld()
		const { openScene, closeScene } = await import("./liveScenes")
		const m1 = await say(session.id, "one")
		await say(session.id, "two", "assistant")
		const m3 = await say(session.id, "three")
		const m4 = await say(session.id, "four", "assistant")
		const opened = await openScene(testDb as any, { sessionId: session.id, userId: ownerId, atMessageId: m1.id })
		await closeScene(testDb as any, { sceneId: opened.scene.id, userId: ownerId, atMessageId: m4.id })
		const before = await scenesOf(session.id)
		expect(before[0].closedAtMessageId).toBe(m4.id)
		expect(m3.id).toBeLessThan(m4.id)

		await back(session.id)
		const during = await scenesOf(session.id)
		expect(during[0].closedAtMessageId).toBeNull()

		await forward(session.id)
		const after = await scenesOf(session.id)
		expect(after).toEqual(before)
	}, 60_000)

	it("a scene with an applied summary is left exactly as it was", async () => {
		const { session } = await makeWorld()
		const { openScene, closeScene } = await import("./liveScenes")
		const m1 = await say(session.id, "one")
		const m2 = await say(session.id, "two", "assistant")
		await say(session.id, "three")
		await say(session.id, "four", "assistant")
		const opened = await openScene(testDb as any, { sessionId: session.id, userId: ownerId, atMessageId: m1.id })
		await closeScene(testDb as any, { sceneId: opened.scene.id, userId: ownerId, atMessageId: m2.id })
		await testDb.update(schema.scenes).set({ summaryStatus: "done" }).where(eq(schema.scenes.id, opened.scene.id))
		const before = await scenesOf(session.id)

		await back(session.id)
		expect(await scenesOf(session.id)).toEqual(before)
	}, 60_000)
})
