/**
 * 🚧 *Picture each new scene* (`image-on-scene`; PLAN-genre-restructure §4,
 * the events group, lane 2, 2026-10-19): when a scene opens on a Story's
 * `main`, the genre's Scene action is fired for the session's owner — only
 * with the task on and an image model set up, never for a scene filed after
 * the fact. The action's run itself is the Scene action's own (its spec's
 * tests); here the decision and the door it goes through.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "task-events-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
const fired = vi.hoisted(() => [] as Array<{ sessionId: number; action?: string; actor: { userId: number } }>)
const imageModel = vi.hoisted(() => ({ set: false }))
vi.mock("$lib/server/pipelines/runtime/fireAction", async (importOriginal) => ({
	...(await importOriginal<object>()),
	fireAction: async (_db: unknown, req: any) => {
		fired.push(req)
		return { kind: "ran", runId: "test" }
	}
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const original = await importOriginal<any>()
	return {
		...original,
		resolveCapabilityTarget: async (db: unknown, req: { capability: string }) =>
			req.capability === "text->image"
				? imageModel.set
					? { ok: true, connection: {}, sampling: null }
					: { ok: false, problem: { kind: "unset", capability: req.capability, message: "no image model" } }
				: original.resolveCapabilityTarget(db, req)
	}
})

let ownerId: number
let bookId: number
let livingId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-task-events-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "task-events-owner")).id
	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "Scenes" }).returning()
	bookId = book!.id
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	livingId = p!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function story(name: string, mode: "full" | "off") {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name,
			genreId: "core:genre/story",
			presetId: livingId,
			lorebookId: bookId,
			genreFields: { tasks: { v: 1, tasks: { "image-on-scene": { mode } } } }
		} as any)
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const line = await insertLegacy(db as any, { sessionId: session!.id, role: "user", channel: "main", content: "We arrive.", userId: ownerId })
	return { sessionId: session!.id as number, lineId: line.id as number }
}

describe("Picture each new scene (lane 2)", () => {
	it("off: a scene opening draws nothing", async () => {
		const { sessionId } = await story("scene-off", "off")
		const { onSceneOpened } = await import("$lib/server/sessions/taskEvents")
		expect(await onSceneOpened(db as any, { sessionId, channel: "main" })).toEqual({ fired: false, reason: "off" })
	}, 60_000)

	it("on, with no image model set up: nothing is started that could only fail", async () => {
		imageModel.set = false
		const { sessionId } = await story("scene-no-model", "full")
		const { onSceneOpened } = await import("$lib/server/sessions/taskEvents")
		expect(await onSceneOpened(db as any, { sessionId, channel: "main" })).toEqual({ fired: false, reason: "no image model" })
		expect(await onSceneOpened(db as any, { sessionId, channel: "sanctum" })).toMatchObject({ fired: false })
	}, 60_000)

	it("on: opening a scene fires the genre's Scene action for the owner, through the action door", async () => {
		imageModel.set = true
		fired.length = 0
		const { sessionId, lineId } = await story("scene-on", "full")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(db as any, { sessionId, userId: ownerId, atMessageId: lineId })
		expect(fired).toEqual([
			expect.objectContaining({ sessionId, action: "core:spec/story-illustrate-scene#illustrate-scene", actor: { userId: ownerId } })
		])
	}, 60_000)
})
