/**
 * A person's save of a scene's cast keeps an Edit history row made by them:
 * one `save` row (or `restore` when the write is a Restore) when the member
 * set changed; none for the same members reordered, a rename, a summary only,
 * or a scene being created.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scenes-castredlines-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/** A person, a book with a history entry and three members. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `scenecastredlines-${++seq}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book.id }]))
		.returning()
	const members: { id: number }[] = []
	for (const name of ["Ann", "Bo", "Cy"]) {
		const [m] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				binding: `{{char:${name}-${seq}}}`,
				name
			})
			.returning()
		members.push(m)
	}
	return { user, book, history, members }
}

type World = Awaited<ReturnType<typeof world>>

async function createScene(w: World, cast?: number[]) {
	const { sceneCreateHandler } = await import("./scenes")
	const res = await sceneCreateHandler.handler(
		fakeSocket(w.user.id),
		{
			scene: {
				lorebookId: w.book.id,
				historyEntryId: w.history.id,
				name: "Scene",
				summary: "Summary",
				...(cast ? { participantCharacters: cast } : {})
			} as any
		},
		noopEmit
	)
	return res.scene
}

async function update(w: World, scene: Record<string, unknown>) {
	const { sceneUpdateHandler } = await import("./scenes")
	return sceneUpdateHandler.handler(
		fakeSocket(w.user.id),
		{ scene: scene as any },
		noopEmit
	)
}

const redlinesOf = (sceneId: number) =>
	testDb
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.sceneId, sceneId))

describe("a person's save of a scene's cast", () => {
	test("scenes:create with a cast records nothing", async () => {
		const w = await world()
		const scene = await createScene(w, [w.members[0].id, w.members[1].id])
		expect(scene.participantCharacters).toHaveLength(2)
		expect(await redlinesOf(scene.id)).toEqual([])
	})

	test("scenes:update with a changed cast records one save row made by the person", async () => {
		const w = await world()
		const [a, b, c] = w.members
		const scene = await createScene(w, [a.id, b.id])
		await update(w, { id: scene.id, participantCharacters: [a.id, c.id] })
		const rows = await redlinesOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ cause: "save", userId: w.user.id })
		expect(rows[0].changes).toEqual({
			participantCharacters: {
				before: { v: [a.id, b.id] },
				after: { v: [a.id, c.id] }
			}
		})
	})

	test("the same members reordered, a rename and a summary only record nothing", async () => {
		const w = await world()
		const [a, b] = w.members
		const scene = await createScene(w, [a.id, b.id])
		await update(w, { id: scene.id, participantCharacters: [b.id, a.id] })
		await update(w, { id: scene.id, name: "Renamed" })
		await update(w, { id: scene.id, summary: "Another summary." })
		expect(await redlinesOf(scene.id)).toEqual([])
	})

	test("saveSceneSummary with cause restore records a restore row", async () => {
		const w = await world()
		const [a, b, c] = w.members
		const scene = await createScene(w, [a.id, b.id])
		const { saveSceneSummary } = await import("./scenes")
		await saveSceneSummary({
			by: "person",
			userId: w.user.id,
			cause: "restore",
			params: {
				scene: { id: scene.id, participantCharacters: [c.id] }
			} as any,
			emitToUser: noopEmit
		})
		const rows = await redlinesOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ cause: "restore", userId: w.user.id })
	})
})
