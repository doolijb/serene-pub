/**
 * 🚧 ★S-4 (owner, 2026-11-04): a scene row says why it opened and why its cast
 * moves — derived at read by `sceneCauses` (`liveScenes.ts`), never stored.
 *
 * - `openedBecause`: the `placed` cues at the scene's opening line, in the
 *   chip's own words (`sceneCueWording`). A scene a person opened — by hand or
 *   by accepting a cue — has none.
 * - `castCause`: an OPEN scene under a genre with `scenes.castRefresh`, scene
 *   mode not Manual. Never on a closed scene.
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

/** A test genre that opts into the cast refresh, and one that does not. */
const REFRESHING = "test:genre/opening"
const PLAIN = "test:genre/plain"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-scene-causes-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { sessionEvents } = await import("@serene-pub/sdk")
	const publish = async (slug: string, version: Record<string, unknown>) => {
		const [spec] = await testDb.insert(schema.pipelineSpecs).values({ slug, name: slug }).returning()
		const [row] = await testDb
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				status: "published",
				canonicalHash: `test-${slug}`,
				...version
			} as any)
			.returning()
		await testDb
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: row.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
	}
	await publish("test:spec/opening-create", {
		inputGenre: REFRESHING,
		inputEvent: sessionEvents.sessionCreated,
		genre: {
			name: { en: "Opening" },
			family: "test",
			shape: { channels: ["main"], scenes: { first: true, castRefresh: true } }
		}
	})
	await publish("test:spec/plain-create", {
		inputGenre: PLAIN,
		inputEvent: sessionEvents.sessionCreated,
		genre: { name: { en: "Plain" }, family: "test", shape: { channels: ["main"] } }
	})
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeWorld(opts: { genreId?: string; scenes?: unknown } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `scene-causes-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Causes Book ${seq}`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			genreId: opts.genreId ?? PLAIN,
			metadata: opts.scenes ? { scenes: opts.scenes } : {}
		} as any)
		.returning()
	return { user, lorebook, session }
}

async function say(sessionId: number, content: string) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role: "user", content } as any)
}

type World = Awaited<ReturnType<typeof makeWorld>>

/** A scene opened at `atMessageId` (closed at `closedAt` when given). */
async function sceneAt(w: World, atMessageId: number, closedAt: number | null = null) {
	return (
		await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: w.lorebook.id,
				sessionId: w.session.id,
				channel: "main",
				name: "A scene",
				openedAtMessageId: atMessageId,
				closedAtMessageId: closedAt
			} as any)
			.returning()
	)[0]
}

async function cue(
	sessionId: number,
	atMessageId: number,
	trigger: string,
	state: "open" | "placed" | "accepted",
	reason?: string
) {
	await testDb.insert(schema.sceneCues).values({
		sessionId,
		channel: "main",
		atMessageId,
		trigger,
		state,
		...(reason ? { reason } : {})
	} as any)
}

async function causesOf(...scenes: Array<typeof schema.scenes.$inferSelect>) {
	const { sceneCauses } = await import("./liveScenes")
	return sceneCauses(testDb as any, scenes)
}

describe("openedBecause", () => {
	test("a scene a cue placed carries the chip's words; the cues at its line join in chip order", async () => {
		const { offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld()
		const line = await say(w.session.id, "The next morning.")
		// Written in the reverse of chip order: the words must not follow it.
		await cue(w.session.id, line.id, "timeAction", "placed")
		await cue(w.session.id, line.id, "dayCrossed", "placed")
		const scene = await sceneAt(w, line.id)

		// The same two cues, offered as a chip in a session of their own.
		const twin = await makeWorld()
		const twinLine = await say(twin.session.id, "The next morning.")
		await cue(twin.session.id, twinLine.id, "timeAction", "open")
		await cue(twin.session.id, twinLine.id, "dayCrossed", "open")
		const [chip] = await offeredSceneCues(testDb as any, twin.session.id)

		expect(chip.triggers).toEqual(["dayCrossed", "timeAction"])
		expect((await causesOf(scene)).get(scene.id)?.openedBecause).toBe(chip.reason)
	}, 60_000)

	test("a judged cue says its own reason", async () => {
		const w = await makeWorld()
		const line = await say(w.session.id, "Everything changes.")
		await cue(w.session.id, line.id, "judged", "placed", "the mood turned")
		const scene = await sceneAt(w, line.id)

		expect((await causesOf(scene)).get(scene.id)?.openedBecause).toContain("the mood turned")
	}, 60_000)

	test("a scene a person opened has none: no cue, or an accepted one", async () => {
		const w = await makeWorld()
		const first = await say(w.session.id, "By hand.")
		const second = await say(w.session.id, "By accepting.")
		await cue(w.session.id, second.id, "dayCrossed", "accepted")
		const byHand = await sceneAt(w, first.id, second.id - 1)
		const accepted = await sceneAt(w, second.id)

		const causes = await causesOf(byHand, accepted)
		expect(causes.get(byHand.id)?.openedBecause).toBeUndefined()
		expect(causes.get(accepted.id)?.openedBecause).toBeUndefined()
		expect(causes.has(byHand.id)).toBe(false)
	}, 60_000)
})

describe("castCause", () => {
	test("present on the open scene of a castRefresh genre, in any mode but Manual", async () => {
		const { openSceneCastCause } = await import("./boundaryWatcher")
		const w = await makeWorld({ genreId: REFRESHING, scenes: { mode: "suggested" } })
		const line = await say(w.session.id, "Go.")
		const scene = await sceneAt(w, line.id)

		const cause = (await causesOf(scene)).get(scene.id)?.castCause
		expect(cause).toBe(openSceneCastCause("Opening"))
		expect(cause).toContain("Manual")
	}, 60_000)

	test("absent under Manual, on a closed scene, and for a genre without castRefresh", async () => {
		const manual = await makeWorld({ genreId: REFRESHING, scenes: { mode: "manual" } })
		const manualLine = await say(manual.session.id, "Go.")
		const manualScene = await sceneAt(manual, manualLine.id)

		const open = await makeWorld({ genreId: REFRESHING, scenes: { mode: "suggested" } })
		const openLine = await say(open.session.id, "Go.")
		const closeLine = await say(open.session.id, "Stop.")
		const closed = await sceneAt(open, openLine.id, closeLine.id)

		const plain = await makeWorld({ genreId: PLAIN, scenes: { mode: "suggested" } })
		const plainLine = await say(plain.session.id, "Go.")
		const plainScene = await sceneAt(plain, plainLine.id)

		const causes = await causesOf(manualScene, closed, plainScene)
		expect(causes.get(manualScene.id)?.castCause).toBeUndefined()
		expect(causes.get(closed.id)?.castCause).toBeUndefined()
		expect(causes.get(plainScene.id)?.castCause).toBeUndefined()
	}, 60_000)

	test("scenes from two sessions in one call: each session's causes are its own", async () => {
		const { openSceneCastCause } = await import("./boundaryWatcher")
		const refreshing = await makeWorld({ genreId: REFRESHING, scenes: { mode: "suggested" } })
		const refreshingLine = await say(refreshing.session.id, "Go.")
		const refreshingScene = await sceneAt(refreshing, refreshingLine.id)

		const plain = await makeWorld({ genreId: PLAIN, scenes: { mode: "suggested" } })
		const plainLine = await say(plain.session.id, "Go.")
		await cue(plain.session.id, plainLine.id, "judged", "placed", "the mood turned")
		const plainScene = await sceneAt(plain, plainLine.id)

		const causes = await causesOf(refreshingScene, plainScene)
		expect(causes.get(refreshingScene.id)).toEqual({
			castCause: openSceneCastCause("Opening")
		})
		expect(causes.get(plainScene.id)?.castCause).toBeUndefined()
		expect(causes.get(plainScene.id)?.openedBecause).toContain("the mood turned")
	}, 60_000)
})
