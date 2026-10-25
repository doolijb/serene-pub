/**
 * 🚧 The judged scene cue (pr-6s2 G5, R-i): the ask-time check's conditions
 * and the commit — Suggested offers the chip, Automatic places the boundary,
 * `ask` offers under Automatic, Manual records nothing. No model anywhere.
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-judged-scene-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeWorld(scenes?: unknown) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `judged-scene-${++seq}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, metadata: scenes ? { scenes } : {} })
		.returning()
	return { user, session }
}

async function say(sessionId: number, content: string) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role: "user", content } as any)
}

async function lines(sessionId: number, n: number) {
	const ids: number[] = []
	for (let i = 0; i < n; i++) ids.push((await say(sessionId, `Line ${i + 1}.`)).id)
	return ids
}

const cuesOf = (sessionId: number) =>
	testDb.select().from(schema.sceneCues).where(eq(schema.sceneCues.sessionId, sessionId))
const scenesOf = (sessionId: number) =>
	testDb.select().from(schema.scenes).where(eq(schema.scenes.sessionId, sessionId))

describe("the judged scene cue", () => {
	test("Suggested: due with the lines; the commit offers a chip with the stored reason", async () => {
		const { judgedSceneCheckOf, proposeJudgedSceneCue, offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "suggested" })
		const ids = await lines(w.session.id, 7)
		expect(await judgedSceneCheckOf(testDb as any, w.session.id, {})).toEqual({
			due: true,
			channel: "main",
			lines: ids
		})
		const r = await proposeJudgedSceneCue(testDb as any, {
			sessionId: w.session.id,
			channel: "main",
			atMessageId: ids[3]!,
			reason: "the party left the inn"
		})
		expect(r).toMatchObject({ outcome: "suggested" })
		expect(r.cueId).toBeTypeOf("number")
		const offered = await offeredSceneCues(testDb as any, w.session.id)
		expect(offered).toHaveLength(1)
		expect(offered[0]).toMatchObject({ messageId: ids[3], reason: "the party left the inn" })
	}, 60_000)

	test("Automatic: the boundary is placed at the line and the cue is placed", async () => {
		const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "automatic" })
		const ids = await lines(w.session.id, 7)
		const r = await proposeJudgedSceneCue(testDb as any, {
			sessionId: w.session.id,
			channel: "main",
			atMessageId: ids[3]!,
			reason: "the party left the inn"
		})
		expect(r.outcome).toBe("placed")
		const scenes = await scenesOf(w.session.id)
		expect(scenes.find((s) => s.id === r.openedSceneId)).toMatchObject({ openedAtMessageId: ids[3] })
		expect((await cuesOf(w.session.id))[0]).toMatchObject({ state: "placed", trigger: "judged" })
	}, 60_000)

	test("Automatic with ask: suggested, no scene", async () => {
		const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "automatic" })
		const ids = await lines(w.session.id, 7)
		const r = await proposeJudgedSceneCue(testDb as any, {
			sessionId: w.session.id,
			channel: "main",
			atMessageId: ids[3]!,
			reason: "a new day",
			ask: true
		})
		expect(r.outcome).toBe("suggested")
		expect(await scenesOf(w.session.id)).toEqual([])
		expect((await cuesOf(w.session.id))[0]).toMatchObject({ state: "open" })
	}, 60_000)

	test("Manual: not due, the commit is skipped, no cue row", async () => {
		const { judgedSceneCheckOf, proposeJudgedSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "manual" })
		const ids = await lines(w.session.id, 7)
		expect(await judgedSceneCheckOf(testDb as any, w.session.id, {})).toEqual({
			due: false,
			why: "off: scenes are Manual here"
		})
		expect(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId: w.session.id,
				channel: "main",
				atMessageId: ids[3]!,
				reason: "x"
			})
		).toEqual({
			outcome: "skipped",
			note: "the scene mode is Manual, so a judged cue is never placed or offered"
		})
		expect(await cuesOf(w.session.id)).toEqual([])
	}, 60_000)

	test("five lines are too few", async () => {
		const { judgedSceneCheckOf } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "suggested" })
		await lines(w.session.id, 5)
		expect(await judgedSceneCheckOf(testDb as any, w.session.id, {})).toEqual({
			due: false,
			why: "off: fewer than 6 lines since the scene began"
		})
	}, 60_000)

	test("a cue already open on the lane blocks the check and the commit", async () => {
		const { judgedSceneCheckOf, proposeJudgedSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "suggested" })
		const ids = await lines(w.session.id, 7)
		await testDb.insert(schema.sceneCues).values({
			sessionId: w.session.id,
			channel: "main",
			atMessageId: ids[1]!,
			trigger: "judged",
			reason: "r",
			state: "open"
		})
		expect(await judgedSceneCheckOf(testDb as any, w.session.id, {})).toEqual({
			due: false,
			why: "off: a scene cue is already waiting"
		})
		expect(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId: w.session.id,
				channel: "main",
				atMessageId: ids[4]!,
				reason: "r"
			})
		).toEqual({ outcome: "skipped", note: "a scene cue is already waiting on this lane" })
	}, 60_000)

	test("a second commit at the same line after a dismissal is already judged", async () => {
		const { proposeJudgedSceneCue, decideSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "suggested" })
		const ids = await lines(w.session.id, 7)
		const p = { sessionId: w.session.id, channel: "main", atMessageId: ids[3]!, reason: "r" }
		const first = await proposeJudgedSceneCue(testDb as any, p)
		await decideSceneCue(testDb as any, { cueId: first.cueId!, userId: w.user.id, accept: false })
		expect(await proposeJudgedSceneCue(testDb as any, p)).toEqual({
			outcome: "skipped",
			note: "this line was already judged"
		})
	}, 60_000)

	test("a blank reason and a line of another session are refused", async () => {
		const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "suggested" })
		const other = await makeWorld({ mode: "suggested" })
		const ids = await lines(w.session.id, 7)
		const foreign = await lines(other.session.id, 1)
		expect(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId: w.session.id,
				channel: "main",
				atMessageId: ids[3]!,
				reason: "   "
			})
		).toEqual({ outcome: "refused", note: "a judged cue needs its reason" })
		expect(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId: w.session.id,
				channel: "main",
				atMessageId: foreign[0]!,
				reason: "r"
			})
		).toEqual({ outcome: "refused", note: `message ${foreign[0]} is not a live line of this lane` })
	}, 60_000)
})
