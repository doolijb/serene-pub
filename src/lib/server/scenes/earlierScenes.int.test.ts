/**
 * 🚧 The earlier-scenes read: which closed main-channel scenes of a session
 * have a usable summary and could show in the reply prompt.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "earlier-scenes-secret" }
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
		path.join(os.tmpdir(), "serene-pub-vitest-earlier-scenes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "earlier-scenes-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeSession() {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Earlier Scenes Book ${++seq}`, userId: ownerId })
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
			userId: ownerId,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: {}
		})
		.returning()
	return { ...session, lorebookId: lorebook.id }
}

type SceneValues = Partial<typeof schema.scenes.$inferInsert>

/** A closed range scene `done` with a summary, unless `over` says otherwise. */
async function addScene(
	sessionId: number,
	start: number,
	over: SceneValues = {}
) {
	const [session] = await testDb
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const [row] = await testDb
		.insert(schema.scenes)
		.values({
			sessionId,
			lorebookId: session.lorebookId!,
			channel: "main",
			openedAtMessageId: start,
			closedAtMessageId: start + 3,
			summary: `Summary from ${start}.`,
			summaryStatus: "done",
			...over
		})
		.returning()
	return row
}

const read = async (sessionId: number) => {
	const { earlierScenesOf } = await import("./earlierScenes")
	return earlierScenesOf(testDb as any, sessionId)
}

describe("earlierScenesOf", () => {
	it("returns an eligible scene with its shown name, trimmed summary and first line; oldest first by start, not by id", async () => {
		const session = await makeSession()
		const late = await addScene(session.id, 50, {
			name: "Scene 2",
			nameIsDefault: true,
			summary: "  Later.\n"
		})
		const early = await addScene(session.id, 10, {
			name: "Scene 1",
			nameIsDefault: true
		})
		expect(late.id).toBeLessThan(early.id)
		expect(await read(session.id)).toEqual([
			{
				sceneId: early.id,
				name: "Scene 1",
				summary: "Summary from 10.",
				firstLineId: 10
			},
			{
				sceneId: late.id,
				name: "Scene 2",
				summary: "Later.",
				firstLineId: 50
			}
		])
	})

	it("shows a default name as numbered on its lane, not as stored", async () => {
		const session = await makeSession()
		await addScene(session.id, 10, { name: "Scene 7", nameIsDefault: true })
		const [only] = await read(session.id)
		expect(only.name).toBe("Scene 1")
	})

	it("returns a selection scene by its smallest selected line", async () => {
		const session = await makeSession()
		const picked = await addScene(session.id, 0, {
			openedAtMessageId: null,
			closedAtMessageId: null,
			selectedMessageIds: [31, 29, 40],
			name: "Picked"
		})
		expect(await read(session.id)).toEqual([
			{
				sceneId: picked.id,
				name: "Picked",
				summary: "Summary from 0.",
				firstLineId: 29
			}
		])
	})

	it("leaves out every scene without a usable summary, and the scenes around them still show", async () => {
		const session = await makeSession()
		const other = await makeSession()
		const keepA = await addScene(session.id, 10, { name: "A" })
		for (const [i, over] of (
			[
				{ summaryStatus: "running" },
				{ summaryStatus: "review" },
				{ summaryStatus: "failed" },
				{ summaryStatus: "none", summary: null },
				{ summaryStatus: "none" },
				{ summaryStatus: "done", closedAtMessageId: null },
				{ channel: "side" },
				{ summary: "   " },
				{ summary: null },
				{
					openedAtMessageId: null,
					closedAtMessageId: null,
					selectedMessageIds: []
				}
			] as SceneValues[]
		).entries())
			await addScene(session.id, 100 + i * 10, {
				name: `out ${i}`,
				...over
			})
		const [entry] = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.limit(1)
		await addScene(session.id, 300, {
			name: "compiled",
			historyEntryId: entry.id
		})
		await addScene(other.id, 20, { name: "elsewhere" })
		const keepB = await addScene(session.id, 400, { name: "B" })
		expect((await read(session.id)).map((s) => s.sceneId)).toEqual([
			keepA.id,
			keepB.id
		])
	})

	it("counts a person's summary and a routine's alike", async () => {
		const session = await makeSession()
		const a = await addScene(session.id, 10, { summaryOrigin: "person" })
		const b = await addScene(session.id, 20, { summaryOrigin: null })
		const c = await addScene(session.id, 30, { summaryOrigin: "routine" })
		expect((await read(session.id)).map((s) => s.sceneId)).toEqual([
			a.id,
			b.id,
			c.id
		])
	})

	it("drops a routine-saved scene when Back resets it, and brings it back with Forward", async () => {
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { openScene, closeScene } = await import("./liveScenes")
		const session = await makeSession()
		const say = (content: string, role: "user" | "assistant" = "user") =>
			insertLegacy(
				testDb as any,
				{
					sessionId: session.id,
					role,
					content
				} as any
			)
		const m1 = await say("one")
		await say("two", "assistant")
		await say("three")
		const m4 = await say("four", "assistant")
		const opened = await openScene(testDb as any, {
			sessionId: session.id,
			userId: ownerId,
			atMessageId: m1.id
		})
		await closeScene(testDb as any, {
			sceneId: opened.scene.id,
			userId: ownerId,
			atMessageId: m4.id
		})
		await testDb
			.update(schema.scenes)
			.set({
				summary: "They talked.",
				summaryStatus: "done",
				summaryOrigin: "routine"
			})
			.where(eq(schema.scenes.id, opened.scene.id))
		expect((await read(session.id)).map((s) => s.sceneId)).toEqual([
			opened.scene.id
		])

		const back = await rewindTurn(testDb as any, {
			sessionId: session.id,
			userId: ownerId
		})
		expect(back.ok).toBe(true)
		expect(await read(session.id)).toEqual([])

		const fwd = await forwardTurn(testDb as any, {
			sessionId: session.id,
			userId: ownerId
		})
		expect(fwd.ok).toBe(true)
		const again = await read(session.id)
		expect(again.map((s) => s.sceneId)).toEqual([opened.scene.id])
		expect(again[0].summary).toBe("They talked.")
	}, 60_000)

	it("returns only the newest 200 by start, oldest first", async () => {
		const { EARLIER_SCENES_MOST } = await import("./earlierScenes")
		const session = await makeSession()
		const total = EARLIER_SCENES_MOST + 5
		await testDb.insert(schema.scenes).values(
			Array.from({ length: total }, (_, i) => ({
				sessionId: session.id,
				lorebookId: session.lorebookId!,
				channel: "main",
				// Inserted newest first, so id order is the reverse of story order.
				openedAtMessageId: (total - i) * 10,
				closedAtMessageId: (total - i) * 10 + 3,
				summary: `s${total - i}`,
				summaryStatus: "done" as const,
				name: `n${total - i}`
			}))
		)
		const got = await read(session.id)
		expect(got).toHaveLength(EARLIER_SCENES_MOST)
		expect(got[0].firstLineId).toBe(60)
		expect(got.at(-1)!.firstLineId).toBe(total * 10)
		expect(got.map((s) => s.firstLineId)).toEqual(
			[...got.map((s) => s.firstLineId)].sort((a, b) => a - b)
		)
	}, 60_000)
})
