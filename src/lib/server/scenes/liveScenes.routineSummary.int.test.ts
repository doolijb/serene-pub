/**
 * A summary the scene summaries routine saved (`scenes.summary_origin = 'routine'`)
 * is not yet the record: the settle line ignores it, and Back takes its scene as
 * an unsummarized one (the status goes `none`, the origin stays, Forward puts the
 * `done` summary back). A person's `done` summary still stops Back.
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
	return { db, getCryptoSecretKey: () => "scene-routine-summary-secret" }
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
		path.join(os.tmpdir(), "serene-pub-vitest-scene-routine-summary-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "scene-routine-summary-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeWorld() {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Routine Summary Book ${++seq}`, userId: ownerId })
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
	return { session }
}

async function say(
	sessionId: number,
	content: string,
	role: "user" | "assistant" = "user"
) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role, content } as any)
}

const scenesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
		.orderBy(asc(schema.scenes.id))

/** Four lines and one scene over all of them, closed at the newest line, its summary `done` as `origin` saved it. */
async function closedSceneSummarizedBy(origin: "routine" | "person" | null) {
	const { session } = await makeWorld()
	const { openScene, closeScene } = await import("./liveScenes")
	const m1 = await say(session.id, "one")
	await say(session.id, "two", "assistant")
	await say(session.id, "three")
	const m4 = await say(session.id, "four", "assistant")
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
			summaryOrigin: origin
		})
		.where(eq(schema.scenes.id, opened.scene.id))
	return { session, sceneId: opened.scene.id, last: m4.id }
}

describe("the settle line reads who saved a summary", () => {
	it("ignores a routine-saved `done` scene and counts a person's, NULL or `person`", async () => {
		const { settledLineOf } = await import("$lib/server/sessions/settle")
		const routine = await closedSceneSummarizedBy("routine")
		expect(
			await settledLineOf(testDb as any, routine.session.id)
		).toBeNull()
		const person = await closedSceneSummarizedBy("person")
		expect(await settledLineOf(testDb as any, person.session.id)).toBe(
			person.last
		)
		const unmarked = await closedSceneSummarizedBy(null)
		expect(await settledLineOf(testDb as any, unmarked.session.id)).toBe(
			unmarked.last
		)
	}, 60_000)
})

describe("Back and Forward across a routine-saved summary", () => {
	it("Back reopens the scene, status `none`, origin kept; Forward restores the `done` summary", async () => {
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const { session, sceneId } = await closedSceneSummarizedBy("routine")
		const [before] = await scenesOf(session.id)

		const back = await rewindTurn(testDb as any, {
			sessionId: session.id,
			userId: ownerId
		})
		expect(back.ok).toBe(true)
		const [during] = await scenesOf(session.id)
		expect(during.id).toBe(sceneId)
		expect(during.closedAtMessageId).toBeNull()
		expect(during.summaryStatus).toBe("none")
		expect(during.summaryOrigin).toBe("routine")
		expect(during.summary).toBe("They talked.")
		// The draft mark goes, which is what lets the routine take it again.
		expect(during.processedBySpecId).toBeNull()

		const fwd = await forwardTurn(testDb as any, {
			sessionId: session.id,
			userId: ownerId
		})
		expect(fwd.ok).toBe(true)
		const [after] = await scenesOf(session.id)
		expect(after).toEqual(before)
		expect(after.summaryStatus).toBe("done")
		expect(after.summaryOrigin).toBe("routine")
		expect(after.summary).toBe("They talked.")
	}, 60_000)

	it("a person's `done` scene still stops Back, with today's sentence", async () => {
		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		const { session } = await closedSceneSummarizedBy("person")
		const [before] = await scenesOf(session.id)
		const res = await rewindTurn(testDb as any, {
			sessionId: session.id,
			userId: ownerId
		})
		expect(res.ok).toBe(false)
		expect(JSON.stringify(res)).toContain(
			"This part of the story is in the lorebook now."
		)
		expect((await scenesOf(session.id))[0]).toEqual(before)
	}, 60_000)
})
