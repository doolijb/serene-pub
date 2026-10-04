/**
 * Lorebooks plan Phase D (hygiene): the scene capture rules hold under a race,
 * and a scene list reply never carries the latent vector columns.
 *
 * - **The capture race.** "No message in two of a session's scenes" was
 *   checked by a read apart from the insert, so two saves of one selection
 *   each passed it before either landed. The check now runs on the write's
 *   transaction under the session's capture lock.
 * - **The projection.** `scenes:list` reaches every guest of the session and
 *   `scenes:listByLorebook` every view of the book; both spread the stored row,
 *   `embedding` and `embeddingModel` included.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	insertSessionMessageRow
} from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-capture-race-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

let seq = 0
async function makeWorld() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `capture-race-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Race Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 1 }]))
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()
	const m1 = await insertSessionMessageRow(testDb, session.id)
	const m2 = await insertSessionMessageRow(testDb, session.id)
	return { user, lorebook, history, session, messages: [m1, m2] }
}

describe("scenes — the capture rules under a race", () => {
	test("two creates capturing one message at once: one lands, the other is refused", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const w = await makeWorld()
		const create = () =>
			sceneCreateHandler.handler(
				fakeSocket(w.user.id),
				{
					scene: {
						lorebookId: w.lorebook.id,
						sessionId: w.session.id,
						historyEntryId: w.history.id,
						selectedMessageIds: [w.messages[0].id]
					}
				} as any,
				() => {}
			)
		const results = await Promise.allSettled([create(), create()])
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
		const refused = results.find((r) => r.status === "rejected") as
			| PromiseRejectedResult
			| undefined
		expect(String(refused?.reason?.message)).toMatch(/already in another scene/)

		const scenes = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.sessionId, w.session.id))
		expect(scenes).toHaveLength(1)
	})

	test("two updates moving one message into two scenes at once: one lands", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import("./scenes")
		const w = await makeWorld()
		const make = async () =>
			(
				await sceneCreateHandler.handler(
					fakeSocket(w.user.id),
					{
						scene: {
							lorebookId: w.lorebook.id,
							sessionId: w.session.id,
							historyEntryId: w.history.id
						}
					} as any,
					() => {}
				)
			).scene
		const a = await make()
		const b = await make()
		const capture = (id: number) =>
			sceneUpdateHandler.handler(
				fakeSocket(w.user.id),
				{ scene: { id, selectedMessageIds: [w.messages[1].id] } } as any,
				() => {}
			)
		const results = await Promise.allSettled([capture(a.id), capture(b.id)])
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)

		const holders = (
			await testDb
				.select()
				.from(schema.scenes)
				.where(eq(schema.scenes.sessionId, w.session.id))
		).filter((s) => (s.selectedMessageIds ?? []).includes(w.messages[1].id))
		expect(holders).toHaveLength(1)
	})
})

describe("scenes — list replies are projected", () => {
	test("scenes:list and scenes:listByLorebook carry no vector columns", async () => {
		const { sceneCreateHandler, sceneListHandler, sceneListByLorebookHandler } =
			await import("./scenes")
		const w = await makeWorld()
		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id,
					summary: "They met at the gate."
				}
			} as any,
			() => {}
		)
		await testDb
			.update(schema.scenes)
			.set({ embedding: [0.1, 0.2, 0.3], embeddingModel: "test-model" })
			.where(eq(schema.scenes.id, scene.id))

		const list = await sceneListHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id } as any,
			() => {}
		)
		const byBook = await sceneListByLorebookHandler.handler(
			fakeSocket(w.user.id),
			{ lorebookId: w.lorebook.id } as any,
			() => {}
		)
		for (const row of [list.sceneList[0], byBook.sceneList[0]] as any[]) {
			expect(row.id).toBe(scene.id)
			expect(row.summary).toBe("They met at the gate.")
			expect(row).not.toHaveProperty("embedding")
			expect(row).not.toHaveProperty("embeddingModel")
		}
	})
})
