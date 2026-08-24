/**
 * `scenes.castResolvedAt` distinguishes "this scene's cast was genuinely
 * resolved" from "nobody ever looked" — a distinction the cast columns
 * themselves cannot make, since an empty array means both. Without it a
 * legitimately castless scene would be re-extracted on every single build,
 * forever.
 *
 * The marker is written ONLY by a write that actually carries cast. That
 * conditioning is the whole substance of the feature: an unconditional marker
 * would let a summarized-but-never-resolved scene claim it needs no
 * extraction, silently re-enacting the bug the column exists to end. The
 * reachable path for that is real — SummarizeLoreModal emits scenes:create
 * with a summary, and nothing forces cast to accompany it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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
		path.join(os.tmpdir(), "serene-pub-castresolved-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}
const noopEmit = () => {}

async function setup(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, label)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const [historyEntry] = await testDb
		.insert(schema.historyEntries)
		.values({ lorebookId: lorebook.id })
		.returning()
	return { user, lorebook, historyEntry }
}

async function readScene(id: number) {
	return testDb.query.scenes.findFirst({
		where: eq(schema.scenes.id, id)
	})
}

describe("scenes:create — castResolvedAt", () => {
	test("create WITH cast marks the scene resolved", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const { user, lorebook, historyEntry } = await setup("cast-create-with")

		const res = await sceneCreateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Aria met Bram.",
					participantCharacters: [],
					mentionedCharacters: []
				} as any
			},
			noopEmit
		)

		// Empty arrays still count: "resolved to nobody" is a real outcome and
		// is exactly what the marker exists to record.
		expect(res.scene.castResolvedAt).not.toBeNull()
	})

	test("create with a summary but NO cast does NOT mark it resolved", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const { user, lorebook, historyEntry } = await setup(
			"cast-create-without"
		)

		const res = await sceneCreateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Aria met Bram."
				} as any
			},
			noopEmit
		)

		// The side door: if this were marked, the scene would claim it needs no
		// extraction while having never been resolved.
		expect(res.scene.castResolvedAt).toBeNull()
	})
})

describe("scenes:update — castResolvedAt", () => {
	test("an update carrying cast marks the scene resolved", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const { user, lorebook, historyEntry } = await setup("cast-update-with")

		const created = await sceneCreateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Aria met Bram."
				} as any
			},
			noopEmit
		)
		expect(created.scene.castResolvedAt).toBeNull()

		await sceneUpdateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					id: created.scene.id,
					participantCharacters: [],
					mentionedCharacters: []
				} as any
			},
			noopEmit
		)

		const after = await readScene(created.scene.id)
		expect(after!.castResolvedAt).not.toBeNull()
	})

	test("a rename-only update does NOT mark the scene resolved", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const { user, lorebook, historyEntry } =
			await setup("cast-update-rename")

		const created = await sceneCreateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "Aria met Bram."
				} as any
			},
			noopEmit
		)

		await sceneUpdateHandler.handler(
			fakeSocket(user.id),
			{ scene: { id: created.scene.id, name: "Renamed" } as any },
			noopEmit
		)

		const after = await readScene(created.scene.id)
		expect(after!.name).toBe("Renamed")
		// Touching a scene for an unrelated reason must not silently claim its
		// cast was resolved.
		expect(after!.castResolvedAt).toBeNull()
	})

	test("a summary-only edit does NOT mark the scene resolved", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const { user, lorebook, historyEntry } = await setup(
			"cast-update-summary"
		)

		const created = await sceneCreateHandler.handler(
			fakeSocket(user.id),
			{
				scene: {
					lorebookId: lorebook.id,
					historyEntryId: historyEntry.id,
					name: "Scene",
					summary: "old"
				} as any
			},
			noopEmit
		)

		await sceneUpdateHandler.handler(
			fakeSocket(user.id),
			{ scene: { id: created.scene.id, summary: "rewritten" } as any },
			noopEmit
		)

		const after = await readScene(created.scene.id)
		expect(after!.summary).toBe("rewritten")
		// A rewritten summary arguably invalidates the old cast — it certainly
		// doesn't establish a new one.
		expect(after!.castResolvedAt).toBeNull()
	})
})
