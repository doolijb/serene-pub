/**
 * 🚧 Live scenes, lane E (PROPOSAL-live-scenes §3, §7, §14): undoing a
 * mistaken boundary (reopen, merge), a closed scene in one write (*Mark as
 * scene*), live ranges seen as captured everywhere, `requestId` on the
 * scene refusals, cast on `scenes:list`, a moved boundary's summary left out
 * of date, and what follows *End scene here* in each scene mode.
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
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-lane-e-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const quiet = () => {}

function recorder() {
	const emits: Array<{ event: string; data: any }> = []
	const emit = async (event: string, data: any) => {
		emits.push({
			event,
			data: typeof data === "function" ? await data() : data
		})
	}
	return { emits, emit }
}

let seq = 0
/** A person, a book with a history entry, a character, a session reading the book (`scenes` its scene settings). */
async function makeWorld(scenes?: unknown) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `lane-e-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Lane E Book ${seq}`, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }])
		)
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

async function say(
	sessionId: number,
	content: string,
	extra: Record<string, unknown> = {}
) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, {
		sessionId,
		role: "user",
		content,
		...extra
	} as any)
}

async function lines(sessionId: number, n: number) {
	const out = []
	for (let i = 1; i <= n; i++) out.push(await say(sessionId, `Line ${i}.`))
	return out
}

async function sceneRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.id, id))
	return row
}

describe("scenes:open with closeAt — a closed scene in one write (Mark as scene)", () => {
	test("an earlier run beside the open scene; a later one closes it; overlaps and captured lines refused", async () => {
		const { sceneOpenHandler, sceneCreateHandler } = await import("./scenes")
		const w = await makeWorld({ mode: "manual" })
		const m = await lines(w.session.id, 9)
		const as = fakeSocket(w.user.id)
		const open: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[3].id },
			quiet
		)
		// Lines 1–2, wholly before the open scene: it stays open.
		const early: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[0].id, closeAt: m[1].id, requestId: "mark-1" },
			quiet
		)
		expect(early.requestId).toBe("mark-1")
		expect(early.scene.openedAtMessageId).toBe(m[0].id)
		expect(early.scene.closedAtMessageId).toBe(m[1].id)
		expect(early.scene.closedStoryClockYear).toBe(5)
		expect(early.scene.selectedMessageIds).toEqual([m[0].id, m[1].id])
		expect(early.closedScene).toBeUndefined()
		expect((await sceneRow(open.scene.id)).closedAtMessageId).toBeNull()

		// Into a scene: refused.
		await expect(
			sceneOpenHandler.handler(
				as,
				{ sessionId: w.session.id, atMessageId: m[1].id, closeAt: m[2].id },
				quiet
			)
		).rejects.toThrow(/overlap/)
		// After the open scene opened: it closes at the line before.
		const late: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[5].id, closeAt: m[6].id },
			quiet
		)
		expect(late.closedScene.id).toBe(open.scene.id)
		expect(late.closedScene.closedAtMessageId).toBe(m[4].id)
		expect(late.scene.closedAtMessageId).toBe(m[6].id)

		// A line captured by selection inside the run: refused whole.
		await sceneCreateHandler.handler(
			as,
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: open.scene.historyEntryId,
					selectedMessageIds: [m[8].id]
				}
			} as any,
			quiet
		)
		await expect(
			sceneOpenHandler.handler(
				as,
				{ sessionId: w.session.id, atMessageId: m[7].id, closeAt: m[8].id },
				quiet
			)
		).rejects.toThrow(/already in another scene/)
		// An end before the start, in words.
		await expect(
			sceneOpenHandler.handler(
				as,
				{ sessionId: w.session.id, atMessageId: m[7].id, closeAt: m[6].id },
				quiet
			)
		).rejects.toThrow(/cannot end before/)
	}, 60_000)
})

describe("undoing a mistaken boundary", () => {
	test("closedAt: null reopens the lane's last scene; a later scene refuses it; every move resets the summary state", async () => {
		const { sceneOpenHandler, sceneCloseHandler, sceneMoveBoundaryHandler } =
			await import("./scenes")
		const w = await makeWorld({ mode: "manual" })
		const m = await lines(w.session.id, 4)
		const as = fakeSocket(w.user.id)
		const a: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[0].id },
			quiet
		)
		await sceneCloseHandler.handler(
			as,
			{ sceneId: a.scene.id, atMessageId: m[1].id },
			quiet
		)
		await testDb
			.update(schema.scenes)
			.set({ summary: "They talked.", summaryStatus: "done" })
			.where(eq(schema.scenes.id, a.scene.id))

		const moved: any = await sceneMoveBoundaryHandler.handler(
			as,
			{ sceneId: a.scene.id, closedAt: m[0].id },
			quiet
		)
		expect(moved.scene.summaryStatus).toBe("none")
		expect(moved.scene.summary).toBe("They talked.")

		const reopened: any = await sceneMoveBoundaryHandler.handler(
			as,
			{ sceneId: a.scene.id, closedAt: null, requestId: "reopen-1" },
			quiet
		)
		expect(reopened.requestId).toBe("reopen-1")
		expect(reopened.scene.closedAtMessageId).toBeNull()
		expect(reopened.scene.closedStoryClockYear).toBeNull()
		expect(reopened.scene.selectedMessageIds).toEqual([])
		await expect(
			sceneMoveBoundaryHandler.handler(
				as,
				{ sceneId: a.scene.id, closedAt: null },
				quiet
			)
		).rejects.toThrow(/already open/)

		// A scene after it on the lane: it cannot run on.
		await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[2].id },
			quiet
		)
		await expect(
			sceneMoveBoundaryHandler.handler(
				as,
				{ sceneId: a.scene.id, closedAt: null },
				quiet
			)
		).rejects.toThrow(/comes after it on this lane/)
	}, 60_000)

	test("scenes:merge joins a scene to the one before it; the open one's range passes on; the lane's first is refused", async () => {
		const { sceneOpenHandler, sceneMergeHandler } = await import("./scenes")
		const w = await makeWorld({ mode: "manual" })
		const m = await lines(w.session.id, 6)
		const as = fakeSocket(w.user.id)
		const a: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[0].id },
			quiet
		)
		const b: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[2].id },
			quiet
		)
		const c: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[4].id },
			quiet
		)
		await testDb
			.update(schema.scenes)
			.set({ summary: "The first.", summaryStatus: "done" })
			.where(eq(schema.scenes.id, a.scene.id))
		await testDb
			.update(schema.scenes)
			.set({ summary: "The second.", summaryStatus: "done" })
			.where(eq(schema.scenes.id, b.scene.id))

		const { emits, emit } = recorder()
		const merged: any = await sceneMergeHandler.handler(
			as,
			{ sceneId: b.scene.id, requestId: "merge-1" },
			emit
		)
		expect(merged.requestId).toBe("merge-1")
		expect(merged.removedSceneId).toBe(b.scene.id)
		expect(merged.scene.id).toBe(a.scene.id)
		expect(merged.scene.closedAtMessageId).toBe(m[3].id)
		expect(merged.scene.selectedMessageIds).toEqual(m.slice(0, 4).map((x) => x.id))
		expect(merged.scene.summary).toBe("The first.")
		expect(merged.scene.summaryStatus).toBe("none")
		expect(await sceneRow(b.scene.id)).toBeUndefined()
		expect(emits.map((e) => e.event)).toEqual(
			expect.arrayContaining(["scenes:merge", "scenes:list", "scenes:scenedMessageIds"])
		)

		// The open scene joins the one before it: that one is the open scene now.
		const again: any = await sceneMergeHandler.handler(
			as,
			{ sceneId: c.scene.id },
			quiet
		)
		expect(again.scene.id).toBe(a.scene.id)
		expect(again.scene.closedAtMessageId).toBeNull()
		expect(again.scene.selectedMessageIds).toEqual([])

		// The lane's first scene has nothing to join: refused, with the asker's id.
		const refused = recorder()
		await expect(
			sceneMergeHandler.handler(
				as,
				{ sceneId: a.scene.id, requestId: "merge-2" },
				refused.emit
			)
		).rejects.toThrow(/No scene comes before it/)
		expect(refused.emits).toEqual([
			{
				event: "scenes:merge:error",
				data: expect.objectContaining({ requestId: "merge-2" })
			}
		])
	}, 60_000)
})

describe("live ranges are seen everywhere", () => {
	test("scenes:scenedMessageIds lists the open scene's lines, and a tick selection may not take them", async () => {
		const { sceneOpenHandler, scenedMessageIdsHandler, sceneCreateHandler } =
			await import("./scenes")
		const w = await makeWorld({ mode: "manual" })
		const m = await lines(w.session.id, 4)
		const as = fakeSocket(w.user.id)
		const open: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[1].id },
			quiet
		)
		const scened: any = await scenedMessageIdsHandler.handler(
			as,
			{ sessionId: w.session.id },
			quiet
		)
		expect(scened.scenedMessageIds).toEqual(m.slice(1).map((x) => x.id))
		await expect(
			sceneCreateHandler.handler(
				as,
				{
					scene: {
						lorebookId: w.lorebook.id,
						sessionId: w.session.id,
						historyEntryId: open.scene.historyEntryId,
						selectedMessageIds: [m[0].id, m[3].id]
					}
				} as any,
				quiet
			)
		).rejects.toThrow(/1 of the selected messages is already in another scene/)
		// The line before the open scene is still free.
		const { scene } = await sceneCreateHandler.handler(
			as,
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: open.scene.historyEntryId,
					selectedMessageIds: [m[0].id]
				}
			} as any,
			quiet
		)
		expect(scene.selectedMessageIds).toEqual([m[0].id])
	}, 60_000)

	test("scenes:list carries each scene's cast", async () => {
		const { sceneOpenHandler, sceneListHandler } = await import("./scenes")
		const w = await makeWorld({ mode: "manual" })
		const line = await say(w.session.id, "We go tonight.", {
			role: "assistant",
			characterId: w.vell.id
		})
		await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: line.id },
			quiet
		)
		const res: any = await sceneListHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			quiet
		)
		expect(res.sceneList).toHaveLength(1)
		expect(res.sceneList[0].participantCharacters).toHaveLength(1)
		expect(res.sceneList[0].mentionedCharacters).toEqual([])
		expect(res.sceneList[0].embedding).toBeUndefined()
	}, 60_000)
})

describe("requestId on the scene refusals", () => {
	test("a refused update or delete names its asker; a summary written is done", async () => {
		const { sceneUpdateHandler, sceneDeleteHandler, sceneOpenHandler } =
			await import("./scenes")
		const w = await makeWorld({ mode: "manual" })
		const line = await say(w.session.id, "One.")
		const as = fakeSocket(w.user.id)
		for (const [handler, params, event] of [
			[sceneUpdateHandler, { scene: { id: 987654, name: "x" }, requestId: "rename-1" }, "scenes:update:error"],
			[sceneDeleteHandler, { id: 987654, requestId: "delete-1" }, "scenes:delete:error"]
		] as const) {
			const { emits, emit } = recorder()
			await expect((handler as any).handler(as, params, emit)).rejects.toThrow(
				"Scene not found."
			)
			expect(emits).toEqual([
				{
					event,
					data: { requestId: (params as any).requestId, error: "Scene not found." }
				}
			])
		}

		const open: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: line.id },
			quiet
		)
		const saved: any = await sceneUpdateHandler.handler(
			as,
			{ scene: { id: open.scene.id, summary: "Written." }, requestId: "save-1" },
			quiet
		)
		expect(saved.requestId).toBe("save-1")
		expect(saved.scene.summaryStatus).toBe("done")
		const cleared: any = await sceneUpdateHandler.handler(
			as,
			{ scene: { id: open.scene.id, summary: "  " } },
			quiet
		)
		expect(cleared.scene.summaryStatus).toBe("none")
	}, 60_000)
})

describe("End scene here (§7): what follows, by scene mode", () => {
	async function endHere(mode: string, endAt: "middle" | "newest") {
		const { sceneOpenHandler, sceneCloseHandler } = await import("./scenes")
		const w = await makeWorld({ mode })
		const m = await lines(w.session.id, 3)
		const as = fakeSocket(w.user.id)
		const open: any = await sceneOpenHandler.handler(
			as,
			{ sessionId: w.session.id, atMessageId: m[0].id },
			quiet
		)
		const at = endAt === "middle" ? m[1] : m[2]
		const closed: any = await sceneCloseHandler.handler(
			as,
			{ sceneId: open.scene.id, atMessageId: at.id },
			quiet
		)
		const cues = await testDb
			.select()
			.from(schema.sceneCues)
			.where(eq(schema.sceneCues.sessionId, w.session.id))
		return { w, m, open, closed, cues }
	}

	test("Automatic opens the next scene at the following line", async () => {
		const { m, closed, cues } = await endHere("automatic", "middle")
		expect(closed.scene.closedAtMessageId).toBe(m[1].id)
		expect(closed.openedScene.openedAtMessageId).toBe(m[2].id)
		expect(closed.openedScene.closedAtMessageId).toBeNull()
		expect(cues).toEqual([])
	}, 60_000)

	test("Suggested leaves a cue at the following line, offered as the chip", async () => {
		const { w, m, closed, cues } = await endHere("suggested", "middle")
		expect(closed.openedScene).toBeUndefined()
		expect(cues).toMatchObject([
			{ atMessageId: m[2].id, trigger: "endedHere", state: "open" }
		])
		const { offeredSceneCues } = await import("$lib/server/scenes/boundaryWatcher")
		expect(await offeredSceneCues(testDb as any, w.session.id)).toMatchObject([
			{ messageId: m[2].id, triggers: ["endedHere"], reason: "the last scene ended" }
		])
	}, 60_000)

	test("Manual closes, and nothing follows", async () => {
		const { closed, cues } = await endHere("manual", "middle")
		expect(closed.openedScene).toBeUndefined()
		expect(cues).toEqual([])
	}, 60_000)

	test("at the newest line, the lane's next line takes it: a chip in Suggested, a scene in Automatic", async () => {
		const { watchSceneBoundaries } = await import("$lib/server/scenes/boundaryWatcher")
		const suggested = await endHere("suggested", "newest")
		expect(suggested.cues).toMatchObject([
			{ atMessageId: null, trigger: "endedHere", state: "pending" }
		])
		const next = await say(suggested.w.session.id, "Morning.")
		const watched = await watchSceneBoundaries(testDb as any, {
			sessionId: suggested.w.session.id,
			messageId: next.id
		})
		expect(watched).toMatchObject({ triggers: ["endedHere"], outcome: "suggested" })

		const automatic = await endHere("automatic", "newest")
		expect(automatic.closed.openedScene).toBeUndefined()
		const after = await say(automatic.w.session.id, "Morning.")
		const placed = await watchSceneBoundaries(testDb as any, {
			sessionId: automatic.w.session.id,
			messageId: after.id
		})
		expect(placed).toMatchObject({ triggers: ["endedHere"], outcome: "placed" })
		const [opened] = await testDb
			.select()
			.from(schema.scenes)
			.where(
				and(
					eq(schema.scenes.sessionId, automatic.w.session.id),
					eq(schema.scenes.openedAtMessageId, after.id)
				)
			)
		expect(opened?.closedAtMessageId).toBeNull()
	}, 60_000)

	test("a close naming no line (a divider's End scene) is the close alone", async () => {
		const { sceneOpenHandler, sceneCloseHandler } = await import("./scenes")
		const w = await makeWorld({ mode: "automatic" })
		const m = await lines(w.session.id, 2)
		const open: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: m[0].id },
			quiet
		)
		const closed: any = await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: open.scene.id },
			quiet
		)
		expect(closed.openedScene).toBeUndefined()
		const cues = await testDb
			.select()
			.from(schema.sceneCues)
			.where(eq(schema.sceneCues.sessionId, w.session.id))
		expect(cues).toEqual([])
	}, 60_000)
})
