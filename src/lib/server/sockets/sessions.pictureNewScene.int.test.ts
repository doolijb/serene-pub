/**
 * 🚧 *Picture each new scene* (PLAN-genre-restructure §4; a **routine** since
 * PLAN-layering, lanes 3 and 6, 2026-10-20): `core:spec/story-illustrate-new-scene`,
 * registered in the Story genre's defaults on `onEvent(sceneOpened)` and
 * switched Off (R8). When a live scene opens, `scene-opened` is emitted (a
 * session moment) and the routine — when its mode is not Off — runs for the
 * session's owner on the routine queue. A scene filed after the fact (a
 * range) opens nothing. The picture's own run is the Scene graph's (its
 * spec's tests); here, the moment and the routine it wakes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "picture-new-scene-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let ownerId: number
let bookId: number
let livingId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-picture-new-scene-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "picture-scene-owner")).id
	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "Scenes" }).returning()
	bookId = book!.id
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	livingId = p!.id
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

async function story(name: string, mode: "full" | "off") {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name,
			genreId: "core:genre/story",
			presetId: livingId,
			lorebookId: bookId
		} as any)
		.returning()
	// The retired task, written where it lives now: the routine's mode (PLAN-layering D4).
	const { applyLegacyTasks } = await import("$lib/server/utils/testDb")
	await applyLegacyTasks(db, session!.id, { v: 1, tasks: { "image-on-scene": { mode } } })
	const { insertLegacy } = await import("$lib/server/messages/store")
	const first = await insertLegacy(db as any, { sessionId: session!.id, role: "user", channel: "main", content: "We arrive.", userId: ownerId })
	const second = await insertLegacy(db as any, { sessionId: session!.id, role: "user", channel: "main", content: "We look around.", userId: ownerId })
	return { sessionId: session!.id as number, lineId: first.id as number, laterId: second.id as number }
}

async function pictureRuns(sessionId: number) {
	const { STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID } = await import("@serene-pub/core-catalog")
	return db
		.select({
			triggerFamily: schema.pipelineRuns.triggerFamily,
			registrationKey: schema.pipelineRuns.registrationKey,
			userId: schema.pipelineRuns.userId,
			receipt: schema.pipelineRuns.receipt
		})
		.from(schema.pipelineRuns)
		.where(and(eq(schema.pipelineRuns.sessionId, sessionId), eq(schema.pipelineRuns.specSlug, STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID)))
}

describe("Picture each new scene (a routine on scene-opened)", () => {
	it("Off (the genre's default): a scene opening draws nothing", async () => {
		const { sessionId, lineId } = await story("scene-off", "off")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(db as any, { sessionId, userId: ownerId, atMessageId: lineId })
		await settle()
		expect(await pictureRuns(sessionId)).toEqual([])
	}, 60_000)

	it("on, with no model that can draw: unavailable — it never runs, and the session says what is missing (R56)", async () => {
		const { sessionId, lineId } = await story("scene-unserved", "full")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(db as any, { sessionId, userId: ownerId, atMessageId: lineId })
		await settle()
		expect(await pictureRuns(sessionId)).toEqual([])
		const { sessionRoutines } = await import("$lib/server/pipelines/routines/log")
		const routines = await sessionRoutines(db as any, sessionId, { isOwner: true } as any)
		const picture = routines.find((r: any) => /illustrate-new-scene/.test(r.registrationKey))!
		expect(picture.needs).toMatch(/^Unavailable: needs a model that can .*draw pictures/)
		expect(picture.runNow).toBe(false)
	}, 60_000)

	it("on: opening a scene runs the routine for the session's owner, woken by scene-opened", async () => {
		// A model set for what it needs (R56): a text model and one that draws.
		const [conn] = await db.insert(schema.connections).values({ name: "Draws", type: "openai", baseUrl: "http://draws/v1" } as any).returning()
		const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
		await setCapabilityDefault(db as any, "text->text", { connectionId: conn!.id })
		await setCapabilityDefault(db as any, "text->image", { connectionId: conn!.id })
		const { sessionId, lineId } = await story("scene-on", "full")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const opened = await openScene(db as any, { sessionId, userId: ownerId, atMessageId: lineId })
		await settle()
		const runs = await pictureRuns(sessionId)
		expect(runs).toHaveLength(1)
		expect(runs[0]).toMatchObject({ triggerFamily: "routine", userId: ownerId, registrationKey: expect.stringMatching(/^on-event→/) })
		const inlet = ((runs[0]!.receipt as any).nodes as any[]).find((n) => (n.nodeKey ?? n.key) === "input")
		const out = inlet?.outputs ?? inlet?.output
		expect(out?.cause).toMatchObject({ moment: "event", event: "core:event/scene-opened@1", sceneId: opened.scene.id })
		expect(out?.scene).toBe(opened.scene.id)
	}, 60_000)

	it("a scene filed after the fact (a range) opens nothing", async () => {
		const { sessionId, lineId, laterId } = await story("scene-range", "full")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(db as any, { sessionId, userId: ownerId, atMessageId: lineId, closeAt: laterId })
		await settle()
		expect(await pictureRuns(sessionId)).toEqual([])
	}, 60_000)
})
