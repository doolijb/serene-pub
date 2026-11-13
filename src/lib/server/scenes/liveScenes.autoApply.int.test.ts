/**
 * 🚧 The moments held changes apply by themselves (owner 2026-11-12, "At
 * scene close, unless a summary waits"), wired where they happen: a scene
 * closed by a person, by an opening scene, or by the scenes routine placing a boundary; held
 * while its summary runs or waits for review; applied when that summary is
 * saved, dismissed or fails; never the reason a close fails; nothing under
 * Review.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

vi.mock(
	"$lib/server/pipelines/runtime/sessionEvents",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("$lib/server/pipelines/runtime/sessionEvents")
		>()),
		emitSessionEvent: async () => {}
	})
)

/** How the next automatic Apply is made to fail: inside it (the write setting cannot be read), or at its door. */
const failing = { inside: false, atDoor: false }
vi.mock("$lib/server/state/loreWriteMode", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("$lib/server/state/loreWriteMode")>()
	return {
		...real,
		bookLoreWriteMode: (
			...args: Parameters<typeof real.bookLoreWriteMode>
		) =>
			failing.inside
				? Promise.reject(new Error("the setting could not be read"))
				: real.bookLoreWriteMode(...args)
	}
})
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()
	return {
		...real,
		applyHeldAutomatically: (
			...args: Parameters<typeof real.applyHeldAutomatically>
		) =>
			failing.atDoor
				? Promise.reject(new Error("boom"))
				: real.applyHeldAutomatically(...args)
	}
})

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-live-auto-apply-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	delete (globalThis as any).__SERENE_PUB_SOCKET_STATE__
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	failing.inside = false
	failing.atDoor = false
	delete (globalThis as any).__SERENE_PUB_SOCKET_STATE__
})

type World = Awaited<ReturnType<typeof world>>

/** A person, a book with a history day, a session on that day reading it with its own notes, and `lines` story lines. */
async function world(
	opts: {
		mode?: "full" | "review"
		automaticScenes?: boolean
		lines?: number
	} = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `live-auto-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	await db
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: book!.id, year: 5, month: 1, day: 2 }])
		)
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: opts.automaticScenes
				? { scenes: { mode: "automatic" } }
				: {}
		})
		.returning()
	const { insertOwnBook, ownBookFor } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: user.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const notes = (await ownBookFor(asDb(), session!.id)).id
	const { insertLegacy } = await import("$lib/server/messages/store")
	const lines = []
	for (let i = 0; i < (opts.lines ?? 6); i++)
		lines.push(
			await insertLegacy(asDb(), {
				sessionId: session!.id,
				role: "user",
				content: `line ${i + 1}`
			} as any)
		)
	return { user, book: book!, session: session!, notes, lines, suffix }
}

/** A new entry in the session's notes, written at a line. */
async function note(w: World, title: string, at: number) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: w.notes,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `About ${title}.`,
			sourceMessageId: at
		})
		.returning()
	return row!.id
}

const inNotes = async (w: World) =>
	(
		await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.notes))
	)
		.map((r) => r.id)
		.sort((a, b) => a - b)

const records = (w: World) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(
			and(
				eq(schema.loreImprints.sessionId, w.session.id),
				eq(schema.loreImprints.origin, "apply")
			)
		)
		.orderBy(schema.loreImprints.id)

const openAt = async (w: World, at: number) => {
	const { openScene } = await import("./liveScenes")
	return openScene(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id,
		channel: "main",
		atMessageId: at
	})
}

const setSummary = (
	sceneId: number,
	summaryStatus: "none" | "running" | "review" | "done" | "failed"
) =>
	db
		.update(schema.scenes)
		.set({ summaryStatus })
		.where(eq(schema.scenes.id, sceneId))

const sceneRow = async (id: number) =>
	(await db.select().from(schema.scenes).where(eq(schema.scenes.id, id)))[0]!

/** Two notes: one in the first two lines (a scene's worth), one after. Returns their ids. */
async function twoNotes(w: World) {
	const early = await note(w, "Ashfall Keep", w.lines[0]!.id)
	const late = await note(w, "Brine Gate", w.lines[3]!.id)
	return { early, late }
}

describe("a scene closes", () => {
	it("closed by a person (closeScene): what it covers applies, later items stay held; the record names the scene, not a person", async () => {
		const { closeScene } = await import("./liveScenes")
		const w = await world()
		const { early, late } = await twoNotes(w)
		const open = await openAt(w, w.lines[0]!.id)
		await closeScene(asDb(), {
			sceneId: open.scene.id,
			userId: w.user.id,
			atMessageId: w.lines[1]!.id
		})
		expect(await inNotes(w)).toEqual([late])
		const [record] = await records(w)
		expect(record).toMatchObject({
			subjectId: early,
			cause: { automatic: "scene-close", sceneId: open.scene.id }
		})
		expect((record!.cause as any).by).toBeUndefined()
		const [row] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(row!.settledMessageId).toBe(w.lines[0]!.id)
	})

	it("closed by openScene closing the open scene: applies", async () => {
		const w = await world()
		const { early, late } = await twoNotes(w)
		const first = await openAt(w, w.lines[0]!.id)
		await openAt(w, w.lines[2]!.id)
		expect((await sceneRow(first.scene.id)).closedAtMessageId).toBe(
			w.lines[1]!.id
		)
		expect(await inNotes(w)).toEqual([late])
		expect((await records(w)).map((r) => r.subjectId)).toEqual([early])
	})

	it("a scene filed already closed (Mark as scene) is no trigger", async () => {
		const { openScene } = await import("./liveScenes")
		const w = await world()
		const { early, late } = await twoNotes(w)
		await openScene(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId: w.lines[0]!.id,
			closeAt: w.lines[1]!.id
		})
		expect(await inNotes(w)).toEqual([early, late].sort((a, b) => a - b))
		expect(await records(w)).toEqual([])
	})

	it("closed by the scenes routine placing a boundary in Automatic mode: applies", async () => {
		const {
			sceneBoundariesOf,
			proposeJudgedSceneCue,
			watchSceneBoundaries
		} = await import("./boundaryWatcher")
		const w = await world({ automaticScenes: true, lines: 2 })
		const early = await note(w, "Ashfall Keep", w.lines[0]!.id)
		const first = await openAt(w, w.lines[0]!.id)
		await db
			.update(schema.sessions)
			.set({ storyClockDay: 3 })
			.where(eq(schema.sessions.id, w.session.id))
		const { insertLegacy } = await import("$lib/server/messages/store")
		const next = await insertLegacy(asDb(), {
			sessionId: w.session.id,
			role: "user",
			content: "Next day."
		} as any)
		// The per-line hook places nothing; the scenes routine, two rounds on, does.
		expect(
			await watchSceneBoundaries(asDb(), {
				sessionId: w.session.id,
				messageId: next.id
			})
		).toBeNull()
		expect(await inNotes(w)).not.toEqual([])
		await insertLegacy(asDb(), {
			sessionId: w.session.id,
			role: "user",
			content: "And on."
		} as any)
		const { boundaries } = await sceneBoundariesOf(asDb(), w.session.id, {
			depth: 2,
			every: 10
		})
		expect(boundaries).toEqual([
			{ at: next.id, trigger: "dayCrossed", reason: "the day changed" }
		])
		const placed = await proposeJudgedSceneCue(asDb(), {
			sessionId: w.session.id,
			channel: "main",
			atMessageId: boundaries[0]!.at,
			reason: boundaries[0]!.reason,
			trigger: boundaries[0]!.trigger
		})
		expect(placed).toMatchObject({
			outcome: "placed",
			closedSceneId: first.scene.id
		})
		expect(await inNotes(w)).toEqual([])
		expect((await records(w)).map((r) => r.subjectId)).toEqual([early])
	})

	it("nothing applies when the lorebook mode in force is Review", async () => {
		const { closeScene } = await import("./liveScenes")
		const w = await world({ mode: "review" })
		const { early, late } = await twoNotes(w)
		const open = await openAt(w, w.lines[0]!.id)
		await closeScene(asDb(), {
			sceneId: open.scene.id,
			userId: w.user.id,
			atMessageId: w.lines[1]!.id
		})
		expect(await inNotes(w)).toEqual([early, late].sort((a, b) => a - b))
		expect(await records(w)).toEqual([])
	})

	it("the lists reach the room by the global server when no socket is at hand", async () => {
		const { closeScene } = await import("./liveScenes")
		const { interestKey } = await import("$lib/shared/sockets/interest")
		const w = await world()
		await twoNotes(w)
		const emitted: { to: string; event: string; data: any }[] = []
		;(globalThis as any).__SERENE_PUB_SOCKET_STATE__ = {
			io: {
				sockets: {
					adapter: {
						rooms: new Map([[`user_${w.user.id}`, new Set(["s1"])]])
					},
					sockets: new Map([
						[
							"s1",
							{
								id: "s1",
								interest: new Set([
									interestKey(
										"sessions:appliedBatches",
										w.session.id
									)
								])
							}
						]
					])
				},
				to: (to: string) => ({
					emit: (event: string, data: any) =>
						emitted.push({ to, event, data })
				}),
				in: () => ({ fetchSockets: async () => [] })
			}
		}
		const open = await openAt(w, w.lines[0]!.id)
		await closeScene(asDb(), {
			sceneId: open.scene.id,
			userId: w.user.id,
			atMessageId: w.lines[1]!.id
		})
		const pushed = emitted.filter(
			(e) => e.event === "sessions:appliedBatches"
		)
		expect(pushed).toHaveLength(1)
		expect(pushed[0]!.data.batches[0]).toMatchObject({
			automatic: "scene-close",
			sceneId: open.scene.id
		})
	})

	it.each([
		["inside the Apply", "inside"],
		["at its door", "atDoor"]
	] as const)(
		"a failing automatic Apply (%s) leaves the scene closed and saved",
		async (_say, how) => {
			const { closeScene } = await import("./liveScenes")
			const w = await world()
			const { early, late } = await twoNotes(w)
			const open = await openAt(w, w.lines[0]!.id)
			failing[how] = true
			const res = await closeScene(asDb(), {
				sceneId: open.scene.id,
				userId: w.user.id,
				atMessageId: w.lines[1]!.id
			})
			failing[how] = false
			expect(res.scene.closedAtMessageId).toBe(w.lines[1]!.id)
			expect((await sceneRow(open.scene.id)).closedAtMessageId).toBe(
				w.lines[1]!.id
			)
			expect(await inNotes(w)).toEqual(
				[early, late].sort((a, b) => a - b)
			)
			expect(await records(w)).toEqual([])
		}
	)
})

describe("a summary waits, then the wait ends", () => {
	/** A scene closed over the first two lines, with its summary in `status`, and the notes either side of its close. */
	async function closedWaiting(w: World, status: "running" | "review") {
		const { closeScene } = await import("./liveScenes")
		const ids = await twoNotes(w)
		const open = await openAt(w, w.lines[0]!.id)
		await setSummary(open.scene.id, status)
		await closeScene(asDb(), {
			sceneId: open.scene.id,
			userId: w.user.id,
			atMessageId: w.lines[1]!.id
		})
		return { ...ids, sceneId: open.scene.id }
	}

	it.each(["running", "review"] as const)(
		"held while the summary is %s",
		async (status) => {
			const w = await world()
			const { early, late, sceneId } = await closedWaiting(w, status)
			expect((await sceneRow(sceneId)).summaryStatus).toBe(status)
			expect(await inNotes(w)).toEqual(
				[early, late].sort((a, b) => a - b)
			)
			expect(await records(w)).toEqual([])
		}
	)

	it("applied when the summary is saved through scenes:update", async () => {
		const { sceneUpdateHandler } = await import(
			"$lib/server/sockets/scenes"
		)
		const w = await world()
		const { early, late, sceneId } = await closedWaiting(w, "review")
		await sceneUpdateHandler.handler(
			{ user: { id: w.user.id }, io: {} } as any,
			{ scene: { id: sceneId, summary: "The keep burned." } as any },
			() => {}
		)
		expect((await sceneRow(sceneId)).summaryStatus).toBe("done")
		expect(await inNotes(w)).toEqual([late])
		expect(
			(await records(w)).map((r) => [
				r.subjectId,
				(r.cause as any).automatic
			])
		).toEqual([[early, "scene-summary"]])
	})

	it("released and applied when the review is dismissed", async () => {
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		await import("$lib/server/sockets/scenes")
		const w = await world()
		const { early, late, sceneId } = await closedWaiting(w, "review")
		const id = activityStore.startScene({
			userId: w.user.id,
			sceneId,
			lorebookId: w.book.id,
			summaryStatusBefore: "none"
		})
		activityStore.updateScene(id, { status: "review" })
		activityStore.remove(id, "dismissed")
		await vi.waitFor(
			async () => expect((await records(w)).length).toBe(1),
			{ timeout: 20_000 }
		)
		expect((await sceneRow(sceneId)).summaryStatus).toBe("none")
		expect((await records(w))[0]).toMatchObject({
			subjectId: early,
			cause: { automatic: "scene-close", sceneId }
		})
		expect(await inNotes(w)).toEqual([late])
	})

	it("released and applied when the summary fails", async () => {
		const { processScene } = await import("$lib/server/sockets/scenes")
		const w = await world()
		const { early, late, sceneId } = await closedWaiting(w, "review")
		// The run finds no lines to read (they are hidden now), so it fails by its own sentence.
		await db
			.update(schema.sessionMessages)
			.set({ isHidden: true })
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
		await setSummary(sceneId, "none")
		await expect(
			processScene(w.user.id, { sceneId }, () => {})
		).rejects.toThrow()
		await vi.waitFor(
			async () => expect((await records(w)).length).toBe(1),
			{ timeout: 20_000 }
		)
		expect((await sceneRow(sceneId)).summaryStatus).toBe("failed")
		expect((await records(w))[0]).toMatchObject({
			subjectId: early,
			cause: { automatic: "scene-close", sceneId }
		})
		expect(await inNotes(w)).toEqual([late])
	})
})
