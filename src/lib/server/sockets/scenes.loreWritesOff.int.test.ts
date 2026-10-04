/**
 * "Lorebook writes from sessions: Off" refuses a session's scene work the
 * same way it refuses a summarize, a compile and a graph build (plan A22):
 * `scenes:process` (the summary a session scene's review drafts) and
 * `scenes:update` (the review's save) on a scene a session opened are
 * refused with the same sentence, and nothing is written or started. A
 * scene the lorebook screens made — no session — is a person at a book, and
 * the switch says nothing about it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
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
		path.join(os.tmpdir(), "serene-pub-scenes-lore-writes-off-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit() {} }) } }) as any

/** A person with lore writes Off, their book, a session reading it, one scene. */
async function world(username: string, opts: { fromSession: boolean }) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, username)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "off" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Book", userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session.id, userId: user.id, role: "user", content: "Hello." } as any)
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: book.id,
			historyEntryId: history.id,
			name: "Original",
			...(opts.fromSession
				? { sessionId: session.id, selectedMessageIds: [message.id] }
				: {})
		})
		.returning()
	return { user, scene }
}

async function storedScene(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.id, id))
	return row
}

describe("lore writes Off — a session's scene", () => {
	test("scenes:process is refused with the Off sentence, and no run starts", async () => {
		const { sceneProcessHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { user, scene } = await world("scenes-off-process", { fromSession: true })

		const emitted: Array<[string, any]> = []
		await expect(
			sceneProcessHandler.handler(
				fakeSocket(user.id),
				{ sceneId: scene.id } as any,
				(e: string, d: any) => emitted.push([e, d])
			)
		).rejects.toThrow()
		const refusal = emitted.find(([e]) => e === "scenes:process:error")
		expect(refusal?.[1].error).toBe(LORE_WRITES_OFF)
		expect(
			activityStore
				.getFor(user.id, false)
				.some((a) => a.kind === "scene_summarize" && a.sceneId === scene.id)
		).toBe(false)
	})

	test("scenes:update is refused with the Off sentence, and the scene stays as it was", async () => {
		const { sceneUpdateHandler } = await import("./scenes")
		const { user, scene } = await world("scenes-off-update", { fromSession: true })

		const emitted: Array<[string, any]> = []
		await expect(
			sceneUpdateHandler.handler(
				fakeSocket(user.id),
				{ scene: { id: scene.id, name: "Renamed", summary: "New" } } as any,
				(e: string, d: any) => emitted.push([e, d])
			)
		).rejects.toThrow()
		const refusal = emitted.find(([e]) => e === "scenes:update:error")
		expect(refusal?.[1].error).toBe(LORE_WRITES_OFF)
		const row = await storedScene(scene.id)
		expect(row.name).toBe("Original")
		expect(row.summary ?? null).toBeNull()
	})

	test("a scene the lorebook screens made (no session) still saves", async () => {
		const { sceneUpdateHandler } = await import("./scenes")
		const { user, scene } = await world("scenes-off-book", { fromSession: false })
		const res = await sceneUpdateHandler.handler(
			fakeSocket(user.id),
			{ scene: { id: scene.id, name: "Renamed" } } as any,
			() => {}
		)
		expect(res.scene.name).toBe("Renamed")
	})
})
