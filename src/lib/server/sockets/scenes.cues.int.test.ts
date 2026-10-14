/**
 * 🚧 Live scenes, lane D (PROPOSAL-live-scenes §4–§7): the socket doors over
 * the boundary watcher and the summary modes — `scenes:cues`,
 * `scenes:decideCue`, `scenes:processAll`, `scenes:openScenes` — and the
 * session's scene settings saved through `sessions:update`.
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

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-scene-cues-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

function recorder() {
	const emits: Array<{ event: string; data: any }> = []
	const emit = async (event: string, data: any) => {
		emits.push({ event, data: typeof data === "function" ? await data() : data })
	}
	return { emits, emit }
}

let seq = 0
async function makeWorld(scenes?: unknown) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `scene-cues-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Cues Book ${seq}`, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
	const [vell] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Vell", description: "A smuggler." } as any)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: scenes ? { scenes } : {}
		})
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: vell.id } as any)
	return { user, lorebook, session, vell }
}

async function say(sessionId: number, content: string, extra: Record<string, unknown> = {}) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role: "user", content, ...extra } as any)
}

async function nextDayCue(w: Awaited<ReturnType<typeof makeWorld>>) {
	const { watchSceneBoundaries } = await import("$lib/server/scenes/boundaryWatcher")
	await say(w.session.id, "Before.")
	await testDb
		.update(schema.sessions)
		.set({ storyClockDay: 3 })
		.where(eq(schema.sessions.id, w.session.id))
	const line = await say(w.session.id, "After.")
	await watchSceneBoundaries(testDb as any, { sessionId: w.session.id, messageId: line.id })
	return line
}

describe("scenes:cues", () => {
	test("the session's offered cues and its settings, resolved; a stranger is refused", async () => {
		const { sceneCuesHandler } = await import("./scenes")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await makeWorld({ summary: "onClose" })
		const line = await nextDayCue(w)
		const { emits, emit } = recorder()
		const res: any = await sceneCuesHandler.handler(fakeSocket(w.user.id), { sessionId: w.session.id }, emit)
		expect(res.sessionId).toBe(w.session.id)
		expect(res.mayPlace).toBe(true)
		expect(res.settings).toMatchObject({ mode: "suggested", summary: "onClose" })
		expect(res.cues).toMatchObject([{ messageId: line.id, triggers: ["dayCrossed"], reason: "the day changed" }])
		expect(emits.map((e) => e.event)).toEqual(["scenes:cues"])

		const stranger = await createTestUser(testDb, `scene-cues-stranger-${++seq}`)
		await expect(
			sceneCuesHandler.handler(fakeSocket(stranger.id), { sessionId: w.session.id }, () => {})
		).rejects.toThrow("Session not found or access denied.")
	}, 60_000)
})

describe("scenes:decideCue", () => {
	test("Yes opens the scene, and the open reply's cascades follow — the list, the scened lines, the cues", async () => {
		const { sceneDecideCueHandler } = await import("./scenes")
		const w = await makeWorld()
		const line = await nextDayCue(w)
		const [cue] = await testDb
			.select()
			.from(schema.sceneCues)
			.where(eq(schema.sceneCues.sessionId, w.session.id))
		const { emits, emit } = recorder()
		const res: any = await sceneDecideCueHandler.handler(
			fakeSocket(w.user.id),
			{ cueId: cue!.id, accept: true, requestId: "q1" },
			emit
		)
		expect(res).toMatchObject({ requestId: "q1", sessionId: w.session.id })
		expect(res.sceneId).toBeTypeOf("number")
		const events = emits.map((e) => e.event)
		expect(events).toEqual(
			expect.arrayContaining(["scenes:decideCue", "scenes:open", "scenes:list", "scenes:scenedMessageIds", "scenes:cues"])
		)
		const cues = emits.find((e) => e.event === "scenes:cues")!.data
		expect(cues.cues).toEqual([])
		const [scene] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, res.sceneId))
		expect(scene!.openedAtMessageId).toBe(line.id)
	}, 60_000)

	test("Not here answers with no scene and the cues pushed again; a refusal echoes the request", async () => {
		const { sceneDecideCueHandler } = await import("./scenes")
		const w = await makeWorld()
		await nextDayCue(w)
		const [cue] = await testDb
			.select()
			.from(schema.sceneCues)
			.where(eq(schema.sceneCues.sessionId, w.session.id))
		const { emits, emit } = recorder()
		const res: any = await sceneDecideCueHandler.handler(
			fakeSocket(w.user.id),
			{ cueId: cue!.id, accept: false },
			emit
		)
		expect(res.sceneId).toBeNull()
		expect(emits.map((e) => e.event)).toEqual(["scenes:decideCue", "scenes:cues"])
		const refused = recorder()
		await expect(
			sceneDecideCueHandler.handler(
				fakeSocket(w.user.id),
				{ cueId: cue!.id, accept: true, requestId: "q2" },
				refused.emit
			)
		).rejects.toThrow("That suggestion was already set aside.")
		expect(refused.emits).toEqual([
			{ event: "scenes:decideCue:error", data: { requestId: "q2", error: "That suggestion was already set aside." } }
		])
	}, 60_000)
})

describe("scenes:processAll — Summarize all (N)", () => {
	test("never the open scene, never one running or in review; the named ones, or every one with no summary yet", async () => {
		const { scenesToSummarize } = await import("./scenes")
		const rows = [
			{ id: 4, summary: null, summaryStatus: "none", opened: 1, closed: 3 },
			{ id: 2, summary: "Written.", summaryStatus: "none", opened: null, closed: null },
			{ id: 5, summary: null, summaryStatus: "failed", opened: 4, closed: 6 },
			{ id: 6, summary: null, summaryStatus: "running", opened: 7, closed: 8 },
			{ id: 7, summary: null, summaryStatus: "none", opened: 9, closed: null },
			// 🚧 §15 G8: a finished run waiting for the person is not re-run.
			{ id: 3, summary: null, summaryStatus: "review", opened: 10, closed: 11 }
		]
		expect(scenesToSummarize(rows, null)).toEqual([4, 5])
		expect(scenesToSummarize(rows, new Set([2, 3, 6, 7]))).toEqual([2])
	})

	test("a live scene whose boundary moved (text kept, status none) is out of date and queued; a selection capture's text still counts as written", async () => {
		const { scenesToSummarize } = await import("./scenes")
		const rows = [
			{ id: 8, summary: "Before the move.", summaryStatus: "none", opened: 1, closed: 3 },
			{ id: 9, summary: "Before the move.", summaryStatus: "failed", opened: 4, closed: 6 },
			{ id: 10, summary: "Current.", summaryStatus: "done", opened: 7, closed: 8 },
			{ id: 11, summary: "Written before the status.", summaryStatus: "none", opened: null, closed: null }
		]
		expect(scenesToSummarize(rows, null)).toEqual([8, 9])
	})

	test("the owner only, and refused when the session's summaries are Never", async () => {
		const { sceneProcessAllHandler } = await import("./scenes")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await makeWorld({ summary: "never" })
		const refused = recorder()
		await expect(
			sceneProcessAllHandler.handler(
				fakeSocket(w.user.id),
				{ sessionId: w.session.id, requestId: "p1" },
				refused.emit
			)
		).rejects.toThrow("This session's scene summaries are off (Summaries: Never).")
		expect(refused.emits[0]).toMatchObject({ event: "scenes:processAll:error", data: { requestId: "p1" } })
		const stranger = await createTestUser(testDb, `scene-cues-p-${++seq}`)
		await expect(
			sceneProcessAllHandler.handler(fakeSocket(stranger.id), { sessionId: w.session.id }, () => {})
		).rejects.toThrow("Only the session's owner summarizes its scenes.")
	}, 60_000)

	test("an open scene alone queues nothing", async () => {
		const { sceneProcessAllHandler } = await import("./scenes")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "Still going.")
		await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		const { emits, emit } = recorder()
		const res: any = await sceneProcessAllHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, requestId: "p2" },
			emit
		)
		expect(res).toEqual({ requestId: "p2", sessionId: w.session.id, sceneIds: [] })
		expect(emits.map((e) => e.event)).toEqual(["scenes:processAll"])
	}, 60_000)
})

describe("scenes:openScenes — Chronicle's Open scene card", () => {
	test("each open scene's lines so far, since when, and its proposed cast with evidence — nothing written", async () => {
		const { sceneOpenScenesHandler } = await import("./scenes")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "We go tonight.", { role: "assistant", characterId: w.vell.id })
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		await say(w.session.id, "Agreed.")
		await say(w.session.id, "Shh.", { isHidden: true })
		const { emits, emit } = recorder()
		const res: any = await sceneOpenScenesHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, request: "o1" },
			emit
		)
		expect(res.request).toBe("o1")
		expect(res.settings.mode).toBe("suggested")
		expect(res.scenes).toHaveLength(1)
		const [card] = res.scenes
		expect(card).toMatchObject({
			id: opened.scene.id,
			channel: "main",
			openedAtMessageId: m1.id,
			lineCount: 2
		})
		expect(card.since).toMatch(/5/)
		expect(card.cast.some((c: any) => c.name === "Vell" && typeof c.evidence === "string")).toBe(true)
		expect(emits.map((e) => e.event)).toEqual(["scenes:openScenes"])
	}, 60_000)
})

describe("On close (§5)", () => {
	test("closing a scene starts its summary in the background — the close reply does not wait", async () => {
		const { sceneCloseHandler } = await import("./scenes")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld({ summary: "onClose" })
		const m1 = await say(w.session.id, "One.")
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		await say(w.session.id, "Two.")
		const { emits, emit } = recorder()
		await sceneCloseHandler.handler(fakeSocket(w.user.id), { sceneId: opened.scene.id }, emit)
		// The summary run is the scene's own: it moves the scene's summary
		// status (it fails here, with no model to run on — and says so).
		let status = "none"
		for (let i = 0; i < 100 && status === "none"; i++) {
			await new Promise((r) => setTimeout(r, 50))
			const [row] = await testDb
				.select({ s: schema.scenes.summaryStatus })
				.from(schema.scenes)
				.where(eq(schema.scenes.id, opened.scene.id))
			status = row!.s
		}
		// A run that produced a summary waits for review (§15 G8), never `done`.
		expect(["running", "failed", "review"]).toContain(status)
		expect(emits.map((e) => e.event)).toContain("scenes:close")
	}, 60_000)

	test("On request: closing summarizes nothing", async () => {
		const { sceneCloseHandler } = await import("./scenes")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld()
		const m1 = await say(w.session.id, "One.")
		const opened = await openScene(testDb as any, { sessionId: w.session.id, userId: w.user.id, atMessageId: m1.id })
		await sceneCloseHandler.handler(fakeSocket(w.user.id), { sceneId: opened.scene.id }, () => {})
		await new Promise((r) => setTimeout(r, 300))
		const [row] = await testDb
			.select({ s: schema.scenes.summaryStatus })
			.from(schema.scenes)
			.where(eq(schema.scenes.id, opened.scene.id))
		expect(row!.s).toBe("none")
	}, 60_000)
})
