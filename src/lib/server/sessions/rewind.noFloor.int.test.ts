/**
 * 🚧 Back with no floor where the genre steps by message (owner 2026-11-13:
 * "Back takes any intro"). In Story one press takes the newest live line on
 * the story lane whatever it is, a greeting and a character's first reply
 * before anybody has written included, down to a session with no messages;
 * Forward puts each back. A genre that takes a whole turn keeps its floor.
 *
 * The genre's step is read off the REGISTERED genres here: `getGenre` is the
 * real one. A stand-in for it once hid that Story's step was never registered.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "rewind-no-floor-test-secret" }
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-rewind-no-floor-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "rewind-no-floor-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeSession(genreId?: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `No Floor Book ${++seq}`, userId: ownerId })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: lorebook.id,
			metadata: {},
			...(genreId ? { genreId } : {})
		} as any)
		.returning()
	return session!
}

async function line(
	sessionId: number,
	content: string,
	role: "user" | "assistant",
	metadata?: Record<string, unknown>
) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, {
		sessionId,
		role,
		content,
		...(metadata ? { metadata } : {})
	} as any)
}
const greeting = (sessionId: number, content: string) =>
	line(sessionId, content, "assistant", { isGreeting: true })

const rowsOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
const liveIds = async (sessionId: number) =>
	(await rowsOf(sessionId)).filter((r) => r.rewindOrdinal === null).map((r) => r.id)
const scenesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
		.orderBy(asc(schema.scenes.id))

async function back(sessionId: number) {
	const { rewindTurn } = await import("$lib/server/sessions/rewind")
	return rewindTurn(testDb as any, { sessionId, userId: ownerId }) as Promise<any>
}
async function forward(sessionId: number) {
	const { forwardTurn } = await import("$lib/server/sessions/rewind")
	return forwardTurn(testDb as any, { sessionId, userId: ownerId }) as Promise<any>
}

describe("the genres as registered", () => {
	it("Story steps by message; the Lair takes the whole turn", async () => {
		const { getGenre } = await import("@serene-pub/sdk")
		expect(getGenre("core:genre/story")?.history?.back).toBe("message")
		expect(getGenre("core:genre/lair")?.history?.back).not.toBe("message")
	})
})

describe("Story: Back has no floor", () => {
	it("takes the opening greetings one per press down to an empty session; Forward restores each", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		const g2 = await greeting(s.id, "Birch is already talking.")
		// A row's `updatedAt` moves when Back and Forward touch it; nothing else may.
		const settled = (rows: Awaited<ReturnType<typeof rowsOf>>) =>
			rows.map(({ updatedAt: _updatedAt, ...rest }) => rest)
		const before = settled(await rowsOf(s.id))

		const first = await back(s.id)
		expect(first).toMatchObject({ ok: true, messageIds: [g2.id] })
		expect(await liveIds(s.id)).toEqual([g1.id])

		const second = await back(s.id)
		expect(second).toMatchObject({ ok: true, messageIds: [g1.id] })
		expect(await liveIds(s.id)).toEqual([])

		// Nothing is left to take.
		const { REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect(await back(s.id)).toEqual({ ok: false, error: REWIND_REFUSALS.nothing })

		expect((await forward(s.id)).ok).toBe(true)
		expect(await liveIds(s.id)).toEqual([g1.id])
		expect((await forward(s.id)).ok).toBe(true)
		expect(settled(await rowsOf(s.id))).toEqual(before)
	}, 60_000)

	it("a create run is never a unit's run: taking a greeting it wrote leaves what creating the session wrote", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		// The greeting as a real session has it: written by the session's create run.
		const [createRun] = await testDb
			.insert(schema.pipelineRuns)
			.values({
				runId: `r-no-floor-create-${s.id}`,
				specSlug: "core:spec/story-create",
				specVersion: "1",
				sessionId: s.id,
				userId: ownerId,
				outcome: "ok",
				triggerSource: "test",
				seed: "s",
				startedAt: new Date(),
				endedAt: new Date(),
				receipt: { nodes: [] }
			} as any)
			.returning()
		await testDb.insert(schema.pipelineRunArtifacts).values({
			runId: createRun!.id,
			seq: 0,
			kind: "message",
			entityId: g1.id,
			action: "created"
		})
		const { turnUnitOf } = await import("$lib/server/sessions/rewind")
		const verdict = await turnUnitOf(testDb as any, s.id, { includePersonLines: true })
		expect(verdict.ok).toBe(true)
		if (!verdict.ok) return
		expect(verdict.unit.ids).toEqual([g1.id])
		// No run: so nothing the create run wrote elsewhere is taken back.
		expect(verdict.unit.runs).toEqual([])
		expect(verdict.unit.run).toBeNull()
		expect(await back(s.id)).toMatchObject({ ok: true, messageIds: [g1.id] })
	}, 60_000)

	it("a row that takes no turn is still taken, last", async () => {
		const s = await makeSession()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const sys = await insertLegacy(testDb as any, {
			sessionId: s.id,
			role: "system",
			userId: ownerId,
			channel: "main",
			content: "Time passes: 1 hour."
		} as any)
		expect(await back(s.id)).toMatchObject({ ok: true, messageIds: [sys.id] })
		expect(await liveIds(s.id)).toEqual([])
	}, 60_000)

	it("the button's state names the greeting as the newest message", async () => {
		const s = await makeSession()
		await greeting(s.id, "Ash looks up from the fire.")
		const { rewindStateOf } = await import("$lib/server/sessions/rewind")
		const state = await rewindStateOf(testDb as any, s.id)
		expect(state.back).toBeNull()
		expect(state.backTakes?.newestMessage).toMatchObject({ yours: false, filed: 0 })
		// The step is sent for the words, and still sent when Back cannot be pressed.
		expect(state.step).toBe("message")
		const empty = await makeSession()
		expect(await rewindStateOf(testDb as any, empty.id)).toMatchObject({
			back: "There is nothing to go back to yet.",
			step: "message"
		})
		const lair = await makeSession("core:genre/lair")
		expect((await rewindStateOf(testDb as any, lair.id)).step).toBe("turn")
	}, 60_000)

	it("a character's first reply before anybody has written is taken", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		const reply = await line(s.id, "Birch speaks first.", "assistant")
		expect(await back(s.id)).toMatchObject({ ok: true, messageIds: [reply.id] })
		expect(await liveIds(s.id)).toEqual([g1.id])
		expect((await forward(s.id)).ok).toBe(true)
		expect(await liveIds(s.id)).toEqual([g1.id, reply.id])
	}, 60_000)

	it("the first scene, opened at the first greeting, goes with it and comes back", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(testDb as any, { sessionId: s.id, userId: ownerId, atMessageId: g1.id })
		const before = await scenesOf(s.id)
		expect(before).toHaveLength(1)

		expect((await back(s.id)).ok).toBe(true)
		expect(await scenesOf(s.id)).toEqual([])

		expect((await forward(s.id)).ok).toBe(true)
		expect(await scenesOf(s.id)).toEqual(before)
	}, 60_000)

	it("after the greetings, lines go one per press and the greeting is reached in its turn", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		const p1 = await line(s.id, "Hello.", "user")
		const a1 = await line(s.id, "Ash nods.", "assistant")
		for (const taken of [a1.id, p1.id, g1.id])
			expect(await back(s.id)).toMatchObject({ ok: true, messageIds: [taken] })
		expect(await liveIds(s.id)).toEqual([])
	}, 60_000)

	it("a line written into an emptied session replaces what was ahead, and is the story's first line again", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(testDb as any, { sessionId: s.id, userId: ownerId, atMessageId: g1.id })
		expect((await back(s.id)).ok).toBe(true)
		const { forwardStackHeight } = await import("$lib/server/sessions/rewind")
		expect(await forwardStackHeight(testDb as any, s.id)).toBe(1)

		// What a send does before it writes: the rows ahead are deleted for good.
		const { discardForwardStack } = await import("$lib/server/messages/store")
		await discardForwardStack(testDb as any, s.id)
		const fresh = await line(s.id, "A new beginning.", "user")

		expect(await forwardStackHeight(testDb as any, s.id)).toBe(0)
		// No row is left before it on the channel, which is what lets the first
		// scene open at this line (the opening rule asks for no earlier row).
		expect((await rowsOf(s.id)).map((r) => r.id)).toEqual([fresh.id])
		expect(await scenesOf(s.id)).toEqual([])
		const { REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect((await forward(s.id)).error).toBe(REWIND_REFUSALS.noneAhead)
	}, 60_000)

	it("a branch's copied line is where Back stops, and an archived session refuses", async () => {
		const branch = await makeSession()
		await line(branch.id, "Copied from the original.", "assistant", { isGreeting: true, copyOf: 1 })
		const { REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect(await back(branch.id)).toEqual({ ok: false, error: REWIND_REFUSALS.fork })

		const archived = await makeSession()
		await greeting(archived.id, "Ash looks up from the fire.")
		await testDb
			.update(schema.sessions)
			.set({ archivedAt: new Date() } as any)
			.where(eq(schema.sessions.id, archived.id))
		const refused = await back(archived.id)
		expect(refused.ok).toBe(false)
		expect(await liveIds(archived.id)).toHaveLength(1)
	}, 60_000)

	it("the settle line still refuses", async () => {
		const s = await makeSession()
		const g1 = await greeting(s.id, "Ash looks up from the fire.")
		const { settleThrough } = await import("$lib/server/sessions/settle")
		await testDb.transaction((tx) => settleThrough(tx as any, s.id, g1.id, {}))
		const { REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect(await back(s.id)).toEqual({ ok: false, error: REWIND_REFUSALS.settled })
	}, 60_000)
})

describe("the Lair keeps its floor", () => {
	it("with no line from a person yet, there is nothing to go back to", async () => {
		const s = await makeSession("core:genre/lair")
		await line(s.id, "The keeper sets the scene.", "assistant")
		const { REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect(await back(s.id)).toEqual({ ok: false, error: REWIND_REFUSALS.nothing })
	}, 60_000)

	it("a turn is still taken whole, and never below the first person line", async () => {
		const s = await makeSession("core:genre/lair")
		const opening = await line(s.id, "The keeper sets the scene.", "assistant")
		const p1 = await line(s.id, "I open the door.", "user")
		const a1 = await line(s.id, "It creaks.", "assistant")
		const taken = await back(s.id)
		expect(taken.ok).toBe(true)
		expect([...taken.messageIds].sort((a: number, b: number) => a - b)).toEqual([p1.id, a1.id])
		expect(await liveIds(s.id)).toEqual([opening.id])
		const { REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect(await back(s.id)).toEqual({ ok: false, error: REWIND_REFUSALS.nothing })
	}, 60_000)
})
