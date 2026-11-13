/**
 * 🚧 Where scene boundaries come from (PROPOSAL-live-scenes §4): read off the
 * lines' story-clock stamps and the clock's moves — Suggested records a cue,
 * Automatic places the boundary, Manual does nothing — and the cue decided as
 * the owner's Yes or Not here. No model anywhere. Since 2026-11-12 the genre's
 * scenes routine finds them, a couple of rounds late: these tests land lines,
 * run the routine's walk (`sceneBoundariesOf`) and its outlet
 * (`proposeJudgedSceneCue`) as the routine does, and check the per-line hook
 * (`watchSceneBoundaries`) fires none of them itself.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "boundary-watcher-test-secret" }
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-boundary-watcher-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// The real core genres: Story registers the scenes routine.
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
/**
 * A person, a book with a history entry at Year 5 Mo 1 Day 2, and a session on
 * that day: Story (which registers the scenes routine), Suggested unless the
 * test's `scenes` says otherwise (`null`: the genre's own settings). `genreId`
 * names a genre nothing published, for a session on the core defaults.
 */
async function makeWorld(
	opts: { lorebook?: boolean; scenes?: Record<string, unknown> | null; genreId?: string } = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `boundary-watcher-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Watcher Book ${seq}`, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: opts.lorebook === false ? null : lorebook.id,
			...(opts.genreId ? { genreId: opts.genreId } : {}),
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: opts.scenes === null ? {} : { scenes: { mode: "suggested", ...opts.scenes } }
		} as any)
		.returning()
	return { user, lorebook, session }
}

/** A line, stamped with the session's clock as it stands (the message store's own write). */
async function say(sessionId: number, content: string, extra: Record<string, unknown> = {}) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role: "user", content, ...extra } as any)
}

/** Move the session's clock to a day (as a pipeline or a person would). */
async function setDay(sessionId: number, day: number) {
	await testDb
		.update(schema.sessions)
		.set({ storyClockDay: day })
		.where(eq(schema.sessions.id, sessionId))
}

async function watch(sessionId: number, messageId: number) {
	const { watchSceneBoundaries } = await import("./boundaryWatcher")
	return watchSceneBoundaries(testDb as any, { sessionId, messageId })
}

/** n plain lines on the current day. */
async function plain(sessionId: number, n: number) {
	const ids: number[] = []
	for (let i = 0; i < n; i++) ids.push((await say(sessionId, `Line ${i + 1}.`)).id)
	return ids
}

/**
 * The walk alone, as the routine's query asks it (a line is old at 2 rounds;
 * `every` wide enough for a young session's whole past), with Story's
 * first-scene `opening` boundary left out: these tests are about the others.
 */
async function found(sessionId: number, opts: { depth?: number; every?: number } = {}) {
	const { sceneBoundariesOf } = await import("./boundaryWatcher")
	const r = await sceneBoundariesOf(testDb as any, sessionId, { depth: opts.depth ?? 2, every: opts.every ?? 10 })
	return { ...r, boundaries: r.boundaries.filter((b) => b.trigger !== "opening") }
}

/** One run of the scenes routine: the walk, then each boundary through the outlet, in line order. */
async function runRoutine(sessionId: number, opts: { depth?: number; every?: number } = {}) {
	const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
	const walked = await found(sessionId, opts)
	const outcomes = []
	for (const b of walked.boundaries)
		outcomes.push(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId,
				channel: "main",
				atMessageId: b.at,
				reason: b.reason,
				trigger: b.trigger
			})
		)
	return { ...walked, outcomes }
}

async function cuesOf(sessionId: number) {
	return testDb
		.select()
		.from(schema.sceneCues)
		.where(eq(schema.sceneCues.sessionId, sessionId))
}

describe("Suggested — the default (★1)", () => {
	test("a line on a new story day raises a cue at it, two rounds on; the same line again raises nothing new", async () => {
		const w = await makeWorld()
		const m1 = await say(w.session.id, "Night falls.")
		expect(await watch(w.session.id, m1.id)).toBeNull()
		await setDay(w.session.id, 3)
		const m2 = await say(w.session.id, "Morning.")
		// The per-line hook fires no trigger now, and the routine finds none yet.
		expect(await watch(w.session.id, m2.id)).toBeNull()
		expect(await cuesOf(w.session.id)).toEqual([])
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		await say(w.session.id, "Later.")
		const run = await runRoutine(w.session.id)
		expect(run.boundaries).toEqual([{ at: m2.id, trigger: "dayCrossed", reason: "the day changed" }])
		expect(run.outcomes).toMatchObject([{ outcome: "suggested" }])
		// Run again, and place the same boundary again: still one cue.
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
		await proposeJudgedSceneCue(testDb as any, {
			sessionId: w.session.id,
			channel: "main",
			atMessageId: m2.id,
			reason: "the day changed",
			trigger: "dayCrossed"
		})
		const cues = await cuesOf(w.session.id)
		expect(cues).toHaveLength(1)
		expect(cues[0]).toMatchObject({ atMessageId: m2.id, trigger: "dayCrossed", state: "open", channel: "main", reason: null })

		const { offeredSceneCues } = await import("./boundaryWatcher")
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([
			{ id: cues[0]!.id, channel: "main", messageId: m2.id, triggers: ["dayCrossed"], reason: "the day changed" }
		])
	}, 60_000)

	test("Not here dismisses every cue at the line, and it is never offered there again", async () => {
		const { decideSceneCue, offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld()
		await say(w.session.id, "Before.")
		await setDay(w.session.id, 4)
		const m2 = await say(w.session.id, "After.")
		await plain(w.session.id, 1)
		const first = await runRoutine(w.session.id)
		expect(first.boundaries.map((b) => b.at)).toEqual([m2.id])
		const [cue] = await cuesOf(w.session.id)
		const out = await decideSceneCue(testDb as any, { cueId: cue!.id, userId: w.user.id, accept: false })
		expect(out).toEqual({ sessionId: w.session.id, sceneId: null })
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
		// The same trigger at the same line: the walk starts after a decided cue, and
		// the outlet leaves the dismissed row standing, nothing new.
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
		expect(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId: w.session.id,
				channel: "main",
				atMessageId: m2.id,
				reason: "the day changed",
				trigger: "dayCrossed"
			})
		).toMatchObject({ outcome: "skipped", note: "this line's scene cue was already decided" })
		const again = await cuesOf(w.session.id)
		expect(again).toHaveLength(1)
		expect(again[0]!.state).toBe("dismissed")
		await expect(
			decideSceneCue(testDb as any, { cueId: cue!.id, userId: w.user.id, accept: true })
		).rejects.toThrow("That suggestion was already set aside.")
	}, 60_000)

	test("Yes opens the scene at the line, as the owner — and a stranger cannot decide it", async () => {
		const { decideSceneCue, offeredSceneCues } = await import("./boundaryWatcher")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await makeWorld()
		await say(w.session.id, "Before.")
		await setDay(w.session.id, 5)
		const m2 = await say(w.session.id, "After.")
		await plain(w.session.id, 1)
		await runRoutine(w.session.id)
		const [cue] = await cuesOf(w.session.id)
		const stranger = await createTestUser(testDb, `boundary-stranger-${++seq}`)
		await expect(
			decideSceneCue(testDb as any, { cueId: cue!.id, userId: stranger.id, accept: true })
		).rejects.toThrow("Only the session's owner decides where its scenes begin.")
		const out = await decideSceneCue(testDb as any, { cueId: cue!.id, userId: w.user.id, accept: true })
		expect(out.sceneId).toBeTypeOf("number")
		const [scene] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, out.sceneId!))
		expect(scene).toMatchObject({ openedAtMessageId: m2.id, closedAtMessageId: null, channel: "main" })
		const [decided] = await cuesOf(w.session.id)
		expect(decided!.state).toBe("accepted")
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
	}, 60_000)

	test("a cue behind the channel's latest boundary is moot and not offered", async () => {
		const { offeredSceneCues } = await import("./boundaryWatcher")
		const { openScene } = await import("./liveScenes")
		const w = await makeWorld()
		await say(w.session.id, "One.")
		await setDay(w.session.id, 6)
		await say(w.session.id, "Two.")
		const m3 = await say(w.session.id, "Three.")
		await plain(w.session.id, 1)
		// The routine's cue waits at the day-6 line, and is offered...
		await runRoutine(w.session.id)
		expect(await offeredSceneCues(testDb as any, w.session.id)).toHaveLength(1)
		// ...until a scene opens after it.
		await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m3.id })
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
	}, 60_000)
})

describe("a time action", () => {
	test("a person's or a press's clock move leaves the channel's next line a time-action marker; the routine places it", async () => {
		const { noteTimeAction, offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld()
		await say(w.session.id, "We rest.")
		await noteTimeAction(testDb as any, { sessionId: w.session.id })
		const pending = await cuesOf(w.session.id)
		expect(pending).toMatchObject([{ atMessageId: null, trigger: "timeAction", state: "pending", channel: "main" }])
		// Twice is still one waiting cue per channel.
		await noteTimeAction(testDb as any, { sessionId: w.session.id })
		expect(await cuesOf(w.session.id)).toHaveLength(1)
		const m2 = await say(w.session.id, "Three hours later.")
		// The hook binds the marker to the landed line and leaves it pending: never offered.
		expect(await watch(w.session.id, m2.id)).toBeNull()
		expect(await cuesOf(w.session.id)).toMatchObject([{ atMessageId: m2.id, trigger: "timeAction", state: "pending" }])
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
		await plain(w.session.id, 1)
		const run = await runRoutine(w.session.id)
		expect(run.boundaries.map((b) => b.trigger)).toEqual(["timeAction"])
		const offered = await offeredSceneCues(testDb as any, w.session.id)
		expect(offered).toMatchObject([{ messageId: m2.id, triggers: ["timeAction"], reason: "time passed" }])
	}, 60_000)

	test("the day crossed and time passed at one line make one chip, both reasons", async () => {
		const { noteTimeAction, offeredSceneCues } = await import("./boundaryWatcher")
		const w = await makeWorld()
		await say(w.session.id, "Dusk.")
		await setDay(w.session.id, 3)
		await noteTimeAction(testDb as any, { sessionId: w.session.id })
		const m2 = await say(w.session.id, "Dawn.")
		await watch(w.session.id, m2.id)
		await plain(w.session.id, 1)
		const run = await runRoutine(w.session.id)
		expect(run.boundaries.map((b) => [b.at, b.trigger])).toEqual([
			[m2.id, "dayCrossed"],
			[m2.id, "timeAction"]
		])
		const offered = await offeredSceneCues(testDb as any, w.session.id)
		expect(offered).toHaveLength(1)
		expect(offered[0]).toMatchObject({
			messageId: m2.id,
			triggers: ["dayCrossed", "timeAction"],
			reason: "the day changed · time passed"
		})
	}, 60_000)
})

describe("the other modes and triggers", () => {
	test("Manual records nothing, whatever crosses", async () => {
		const { noteTimeAction } = await import("./boundaryWatcher")
		const w = await makeWorld({ scenes: { mode: "manual" } })
		await say(w.session.id, "One.")
		await setDay(w.session.id, 9)
		await noteTimeAction(testDb as any, { sessionId: w.session.id })
		const m2 = await say(w.session.id, "Two.")
		expect(await watch(w.session.id, m2.id)).toBeNull()
		await plain(w.session.id, 2)
		expect(await found(w.session.id)).toEqual({ boundaries: [], why: "scenes are Manual here" })
		expect(await cuesOf(w.session.id)).toEqual([])
	}, 60_000)

	test("Automatic places the boundary at the line, closing the open scene at the line before", async () => {
		const { openScene } = await import("./liveScenes")
		const w = await makeWorld({ scenes: { mode: "automatic" } })
		const m1 = await say(w.session.id, "One.")
		const first = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		const m2 = await say(w.session.id, "Two.")
		await setDay(w.session.id, 3)
		const m3 = await say(w.session.id, "Next day.")
		expect(await watch(w.session.id, m3.id)).toBeNull()
		await plain(w.session.id, 1)
		const { outcomes } = await runRoutine(w.session.id)
		expect(outcomes).toHaveLength(1)
		const r = outcomes[0]!
		expect(r).toMatchObject({ outcome: "placed", closedSceneId: first.scene.id })
		const scenes = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.sessionId, w.session.id))
		const closed = scenes.find((s) => s.id === first.scene.id)!
		const opened = scenes.find((s) => s.id === r.openedSceneId)!
		expect(closed.closedAtMessageId).toBe(m2.id)
		expect(opened).toMatchObject({ openedAtMessageId: m3.id, closedAtMessageId: null })
		const [cue] = await cuesOf(w.session.id)
		expect(cue!.state).toBe("placed")
	}, 60_000)

	test("narration and length fire only when switched on; a session with no lorebook is never walked", async () => {
		const w = await makeWorld({
			scenes: { triggers: { dayCrossed: false, narration: true, length: { lines: 2 } } }
		})
		await say(w.session.id, "A.")
		await say(w.session.id, "B.")
		const m3 = await say(w.session.id, "C.")
		// C is not old enough to be read yet.
		expect((await found(w.session.id)).boundaries).toEqual([])
		const m4 = await say(w.session.id, "The wind howls.", { isNarratorResponse: true, role: "assistant" })
		expect((await watch(w.session.id, m4.id))).toBeNull()
		expect((await found(w.session.id)).boundaries.map((b) => [b.at, b.trigger])).toEqual([[m3.id, "length"]])
		await say(w.session.id, "E.")
		expect((await found(w.session.id)).boundaries.map((b) => [b.at, b.trigger])).toEqual([
			[m3.id, "length"],
			[m4.id, "narration"]
		])

		const bare = await makeWorld({ lorebook: false })
		await say(bare.session.id, "One.")
		await setDay(bare.session.id, 7)
		const b2 = await say(bare.session.id, "Two.")
		expect(await watch(bare.session.id, b2.id)).toBeNull()
		await plain(bare.session.id, 2)
		expect((await found(bare.session.id)).boundaries).toEqual([])
		expect((await runRoutine(bare.session.id)).outcomes).toEqual([])
		expect(await cuesOf(bare.session.id)).toEqual([])
	}, 60_000)

	test("the routine reads the main channel alone: a side channel raises no cue, even after a scene was placed on it", async () => {
		const { openScene } = await import("./liveScenes")
		const w = await makeWorld()
		await say(w.session.id, "Psst.", { channel: "sanctum" })
		await setDay(w.session.id, 3)
		const s2 = await say(w.session.id, "Later, aside.", { channel: "sanctum" })
		expect(await watch(w.session.id, s2.id)).toBeNull()
		await openScene(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "sanctum",
			atMessageId: s2.id
		})
		await setDay(w.session.id, 4)
		const s3 = await say(w.session.id, "Next day, aside.", { channel: "sanctum" })
		// The hook fires no trigger on it any more, and the walk never reads it.
		expect(await watch(w.session.id, s3.id)).toBeNull()
		await plain(w.session.id, 3)
		expect((await runRoutine(w.session.id)).boundaries).toEqual([])
		expect(await cuesOf(w.session.id)).toEqual([])
	}, 60_000)

	test("a long pause in play fires when the next line comes more than the hours after", async () => {
		const w = await makeWorld({ scenes: { triggers: { dayCrossed: false, pause: { hours: 2 } } } })
		const m1 = await say(w.session.id, "See you tomorrow.")
		await testDb
			.update(schema.messages)
			.set({ createdAt: new Date(Date.now() - 5 * 3_600_000) })
			.where(eq(schema.messages.id, m1.id))
		const m2 = await say(w.session.id, "Back.")
		expect(await watch(w.session.id, m2.id)).toBeNull()
		await plain(w.session.id, 1)
		const run = await runRoutine(w.session.id)
		expect(run.boundaries.map((b) => [b.at, b.trigger])).toEqual([[m2.id, "pause"]])
		expect(run.outcomes).toMatchObject([{ outcome: "suggested" }])
	}, 60_000)

	test("the scene settings the cascade gives: the session's override over the defaults", async () => {
		const { sessionSceneContext, writeSceneSettings } = await import(
			"$lib/server/sessions/sceneSettings"
		)
		// A genre nothing published: the core defaults, whatever Story's own are.
		const w = await makeWorld({ scenes: null, genreId: "test:genre/unpublished" })
		expect((await sessionSceneContext(testDb as any, w.session.id))?.settings.mode).toBe("suggested")
		await writeSceneSettings(testDb as any, w.session.id, { mode: "automatic", summary: "onClose" })
		const ctx = await sessionSceneContext(testDb as any, w.session.id)
		expect(ctx).toMatchObject({ mayPlace: true, settings: { mode: "automatic", summary: "onClose" } })
		await expect(
			writeSceneSettings(testDb as any, w.session.id, { mode: "often" } as any)
		).rejects.toThrow(/one of manual, suggested, automatic/)
		await writeSceneSettings(testDb as any, w.session.id, null)
		const [row] = await testDb
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(and(eq(schema.sessions.id, w.session.id)))
		expect((row!.metadata as Record<string, unknown>).scenes).toBeUndefined()
	}, 60_000)
})
