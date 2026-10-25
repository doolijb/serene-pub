/**
 * 🚧 Close out and the catch-up offer (pr-6, R-d, pass 9 S4; shapes §B-6): the stretch it summarizes, the closing
 * scene(s) it files, its refusals, Archive running it once, and the offer. The summaries themselves
 * (`runSceneSummaries`) are spied — `scenes:process` has its own coverage.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertSessionMessageRow } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { CLOSE_OUT_REFUSALS, catchUpLabel, catchUpNotice } from "$lib/shared/sessions/archive"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const summaries = vi.fn()
vi.mock("$lib/server/sockets/scenes", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/sockets/scenes")>()),
	runSceneSummaries: (...args: any[]) => summaries(...args)
}))

const sessionEventSpy = vi.fn()
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/pipelines/runtime/sessionEvents")>()),
	emitSessionEvent: (...args: any[]) => sessionEventSpy(...args)
}))

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 120_000)

beforeEach(() => {
	summaries.mockReset()
	sessionEventSpy.mockReset()
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noEmit = () => {}

let seq = 0
async function world(opts: { lines?: number; book?: number } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `closeout-owner-${++seq}`)
	const stranger = await createTestUser(testDb, `closeout-stranger-${++seq}`)
	let bookId = opts.book
	if (bookId == null) {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: `Close-out book ${seq}`, userId: owner.id })
			.returning()
		bookId = book.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: "core:genre/story", lorebookId: bookId, name: `Tale ${seq}` })
		.returning()
	const lines = []
	for (let i = 0; i < (opts.lines ?? 0); i++)
		lines.push(await insertSessionMessageRow(testDb, session.id, { content: `line ${i + 1}`, channel: "main" }))
	return { owner, stranger, session, bookId, lines }
}

const scenesOf = async (sessionId: number) =>
	testDb.select().from(schema.scenes).where(eq(schema.scenes.sessionId, sessionId)).orderBy(schema.scenes.id)

describe("closeOutStretchOf", () => {
	test("starts after the settle line and after the last closed main scene; null when nothing is left", async () => {
		const { closeOutStretchOf } = await import("$lib/server/sessions/closeOut")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await world({ lines: 8 })
		const db = testDb as unknown as Db
		const id = (n: number) => w.lines[n - 1].id
		expect(await closeOutStretchOf(db, w.session.id)).toEqual({
			fromMessageId: id(1),
			throughMessageId: id(8),
			lines: 8
		})
		await testDb.update(schema.sessions).set({ settledMessageId: id(2) }).where(eq(schema.sessions.id, w.session.id))
		expect(await closeOutStretchOf(db, w.session.id)).toMatchObject({ fromMessageId: id(3), lines: 6 })
		await openScene(db, { sessionId: w.session.id, userId: w.owner.id, channel: "main", atMessageId: id(3), closeAt: id(5) })
		expect(await closeOutStretchOf(db, w.session.id)).toEqual({
			fromMessageId: id(6),
			throughMessageId: id(8),
			lines: 3
		})
		await openScene(db, { sessionId: w.session.id, userId: w.owner.id, channel: "main", atMessageId: id(6), closeAt: id(8) })
		expect(await closeOutStretchOf(db, w.session.id)).toBeNull()
	}, 60_000)
})

describe("sessions:closeOut", () => {
	test("with no open scene: one closing scene over the stretch, summarized through the close-out registration", async () => {
		const { sessionsCloseOutHandler: h } = await import("./sessionArchive")
		const w = await world({ lines: 4 })
		const res = await h.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, noEmit)
		const scenes = await scenesOf(w.session.id)
		expect(scenes).toHaveLength(1)
		expect(scenes[0]).toMatchObject({
			openedAtMessageId: w.lines[0].id,
			closedAtMessageId: w.lines[3].id
		})
		expect(res).toEqual({ sessionId: w.session.id, sceneIds: [scenes[0].id] })
		expect(summaries).toHaveBeenCalledTimes(1)
		const [ids, userId, , opts] = summaries.mock.calls[0]
		expect(ids).toEqual([scenes[0].id])
		expect(userId).toBe(w.owner.id)
		expect(opts.via).toMatchObject({ specId: "core:spec/story-summarize-scene", minAge: 0 })
		expect(opts.via.registrationKey).toMatch(/close-out/)
	}, 60_000)

	test("with an open scene: it closes at the newest line, and a scene is filed over the gap before it", async () => {
		const { sessionsCloseOutHandler: h } = await import("./sessionArchive")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const w = await world({ lines: 6 })
		const open = await openScene(testDb as unknown as Db, {
			sessionId: w.session.id,
			userId: w.owner.id,
			channel: "main",
			atMessageId: w.lines[3].id
		})
		const res = await h.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, noEmit)
		const scenes = await scenesOf(w.session.id)
		expect(scenes).toHaveLength(2)
		const gap = scenes.find((s) => s.id !== open.scene.id)!
		expect(gap).toMatchObject({ openedAtMessageId: w.lines[0].id, closedAtMessageId: w.lines[2].id })
		const closed = scenes.find((s) => s.id === open.scene.id)!
		expect(closed.closedAtMessageId).toBe(w.lines[5].id)
		expect(res.sceneIds).toEqual([gap.id, closed.id])
		expect(summaries.mock.calls[0][0]).toEqual([gap.id, closed.id])
	}, 60_000)

	test("refuses: a stranger (notOwner), and when everything is in a scene already (nothing)", async () => {
		const { sessionsCloseOutHandler: h } = await import("./sessionArchive")
		const w = await world({ lines: 2 })
		await expect(h.handler(fakeSocket(w.stranger.id), { sessionId: w.session.id }, noEmit)).rejects.toThrow()
		const emitted: any[] = []
		const emit = (e: string, d: any) => emitted.push({ e, d })
		await expect(h.handler(fakeSocket(w.owner.id), { sessionId: 999_999 }, emit)).rejects.toThrow(
			CLOSE_OUT_REFUSALS.missing
		)
		await h.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, noEmit)
		const again = vi.fn()
		await expect(h.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, again)).rejects.toThrow(
			CLOSE_OUT_REFUSALS.nothing
		)
		expect(again.mock.calls.find((c) => c[0] === "sessions:closeOut:error")?.[1]).toMatchObject({
			error: CLOSE_OUT_REFUSALS.nothing
		})
		const stranger = vi.fn()
		await expect(h.handler(fakeSocket(w.stranger.id), { sessionId: w.session.id }, stranger)).rejects.toThrow()
		expect(stranger.mock.calls.find((c) => c[0] === "sessions:closeOut:error")?.[1]).toMatchObject({
			error: CLOSE_OUT_REFUSALS.missing
		})
	}, 60_000)

	test("notOwner: a guest is refused with its own sentence", async () => {
		const { sessionsCloseOutHandler: h } = await import("./sessionArchive")
		const w = await world({ lines: 2 })
		await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: w.stranger.id, isPlayer: true })
		const emit = vi.fn()
		await expect(h.handler(fakeSocket(w.stranger.id), { sessionId: w.session.id }, emit)).rejects.toThrow(
			CLOSE_OUT_REFUSALS.notOwner
		)
		expect(await scenesOf(w.session.id)).toHaveLength(0)
	}, 60_000)
})

describe("sessions:archive", () => {
	test("emits session-archived once and replies with the close-out's scenes; the archive stands when there is nothing to close out", async () => {
		const { sessionsArchiveHandler: h, sessionsUnarchiveHandler: u } = await import("./sessionArchive")
		const { sessionEvents } = await import("@serene-pub/sdk")
		const w = await world({ lines: 3 })
		const res = await h.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, noEmit)
		expect(sessionEventSpy).toHaveBeenCalledTimes(1)
		expect(sessionEventSpy.mock.calls[0][1]).toMatchObject({
			sessionId: w.session.id,
			event: sessionEvents.sessionArchived
		})
		const scenes = await scenesOf(w.session.id)
		expect(res.closeOut).toEqual({ sceneIds: scenes.map((s) => s.id) })
		expect(scenes).toHaveLength(1)
		expect(res.archivedAt).toBeTruthy()

		// Unarchive raises no event; archiving again with nothing left still archives, closeOut null.
		await u.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, noEmit)
		expect(sessionEventSpy).toHaveBeenCalledTimes(1)
		const again = await h.handler(fakeSocket(w.owner.id), { sessionId: w.session.id }, noEmit)
		expect(again.closeOut).toBeNull()
		expect(sessionEventSpy).toHaveBeenCalledTimes(2)
	}, 60_000)
})

describe("catchUpOfferFor", () => {
	test("offers the older session on the same shared book; null once this session has played", async () => {
		const { catchUpOfferFor } = await import("$lib/server/sessions/closeOut")
		const db = testDb as unknown as Db
		const old = await world({ lines: 3 })
		await testDb.update(schema.sessions).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(schema.sessions.id, old.session.id))
		const [fresh] = await testDb
			.insert(schema.sessions)
			.values({ userId: old.owner.id, isGroup: false, genreId: "core:genre/story", lorebookId: old.bookId })
			.returning()
		await insertSessionMessageRow(testDb, fresh.id, { content: "Welcome.", channel: "main", metadata: { isGreeting: true } as any })
		const offer = await catchUpOfferFor(db, fresh.id)
		expect(offer).toEqual({ fromSessionId: old.session.id, fromSessionName: old.session.name, lines: 3 })
		expect(catchUpNotice(offer!)).toContain(old.session.name!)
		expect(catchUpLabel(offer!)).toBe(`Catch up on ${old.session.name}`)
		// The older session has played itself, so it is offered nothing.
		expect(await catchUpOfferFor(db, old.session.id)).toBeNull()
		await insertSessionMessageRow(testDb, fresh.id, { content: "We set out.", channel: "main" })
		expect(await catchUpOfferFor(db, fresh.id)).toBeNull()
	}, 60_000)
})
