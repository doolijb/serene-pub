/**
 * 🚧 Which finished scene is due a summary (`sceneSummaryDueOf`, the scene
 * summaries routine's look). One case per condition, each failing for exactly
 * that reason. The session is Story with no seats in its turn order and every
 * line a person's, so each line closes its own round: with N lines the round in
 * progress is N + 1 and line k is in round k (see `sceneBoundaries.int.test.ts`).
 * At depth 6 a scene closed on line 2 is due once there are 7 lines.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 })

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scene-summary-due-test-secret" }
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scene-summary-due-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "scene-summary-due-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeWorld(
	opts: { summary?: "never"; branchOf?: number; bookId?: number } = {}
) {
	const bookId =
		opts.bookId ??
		(
			await testDb
				.insert(schema.lorebooks)
				.values({ name: `Summary Due Book ${++seq}`, userId: ownerId })
				.returning()
		)[0]!.id
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: bookId,
			genreId: "core:genre/story",
			...(opts.branchOf ? { branchOfSessionId: opts.branchOf } : {}),
			metadata: opts.summary ? { scenes: { summary: opts.summary } } : {}
		} as any)
		.returning()
	return { session: session!, bookId }
}

async function say(
	sessionId: number,
	extra: Record<string, unknown> = {},
	channel?: string
) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(
		testDb as any,
		{
			sessionId,
			role: "user",
			content: `Line ${++seq}.`,
			...(channel ? { channel } : {}),
			...extra
		} as any
	)
}
async function lines(sessionId: number, n: number, extra = {}) {
	const ids: number[] = []
	for (let i = 0; i < n; i++) ids.push((await say(sessionId, extra)).id)
	return ids
}

async function scene(
	w: { session: { id: number }; bookId: number },
	opened: number | null,
	closed: number | null,
	extra: Record<string, unknown> = {}
) {
	const [row] = await testDb
		.insert(schema.scenes)
		.values({
			sessionId: w.session.id,
			lorebookId: w.bookId,
			channel: "main",
			openedAtMessageId: opened,
			closedAtMessageId: closed,
			...extra
		} as any)
		.returning()
	return row!.id
}

async function due(sessionId: number, depth = 6) {
	const { sceneSummaryDueOf } = await import("./sceneSummaryDue")
	return sceneSummaryDueOf(testDb as any, sessionId, { depth })
}

/** A world with 7 lines (so a scene closed on line 2 is exactly 6 rounds old) and the ids. */
async function seven(opts: Parameters<typeof makeWorld>[0] = {}) {
	const w = await makeWorld(opts)
	const ids = await lines(w.session.id, 7)
	return { ...w, ids }
}

describe("the scene due a summary", () => {
	it("a closed, unsummarized scene six rounds old is due", async () => {
		const w = await seven()
		const id = await scene(w, w.ids[0]!, w.ids[1]!)
		expect(await due(w.session.id)).toEqual({ sceneId: id })
	})

	it("the oldest of two due scenes comes first, and one at a time", async () => {
		const w = await makeWorld()
		const ids = await lines(w.session.id, 9)
		const later = await scene(w, ids[2]!, ids[3]!)
		const earlier = await scene(w, ids[0]!, ids[1]!)
		expect(later).toBeLessThan(earlier)
		expect(await due(w.session.id)).toEqual({ sceneId: earlier })
	})

	it("a scene closed depth - 1 rounds ago is not due; depth rounds ago it is", async () => {
		const w = await makeWorld()
		const ids = await lines(w.session.id, 6)
		const id = await scene(w, ids[0]!, ids[1]!)
		const young = await due(w.session.id)
		expect(young.sceneId).toBeNull()
		await say(w.session.id)
		expect(await due(w.session.id)).toEqual({ sceneId: id })
	})

	it("an open scene is not taken", async () => {
		const w = await seven()
		await scene(w, w.ids[0]!, null)
		const r = await due(w.session.id)
		expect(r.sceneId).toBeNull()
		expect(r.why).toMatch(/no finished scene/)
	})

	it("a scene not on main is not taken", async () => {
		const w = await seven()
		await scene(w, w.ids[0]!, w.ids[1]!, { channel: "whisper" })
		expect((await due(w.session.id)).sceneId).toBeNull()
	})

	it("a scene with no range (captured by tick) is not taken", async () => {
		const w = await seven()
		await scene(w, null, w.ids[1]!)
		expect((await due(w.session.id)).sceneId).toBeNull()
	})

	for (const status of ["running", "review", "done", "failed"] as const)
		it(`a scene whose summary is ${status} is not taken`, async () => {
			const w = await seven()
			await scene(w, w.ids[0]!, w.ids[1]!, { summaryStatus: status })
			expect((await due(w.session.id)).sceneId).toBeNull()
		})

	it("a summary a person saved and a boundary move reset (text kept, nothing processed it) is not taken", async () => {
		const w = await seven()
		await scene(w, w.ids[0]!, w.ids[1]!, {
			summary: "A person wrote this."
		})
		expect((await due(w.session.id)).sceneId).toBeNull()
	})

	it("a review a person discarded (blank, a spec processed it) is not taken", async () => {
		const w = await seven()
		await scene(w, w.ids[0]!, w.ids[1]!, {
			summary: null,
			processedBySpecId: "core:spec/story-summarize-scene"
		})
		expect((await due(w.session.id)).sceneId).toBeNull()
	})

	it("a routine-saved summary that Back reset (origin routine, none, text kept, draft mark cleared) is taken again", async () => {
		const w = await seven()
		const id = await scene(w, w.ids[0]!, w.ids[1]!, {
			summary: "The routine wrote this.",
			summaryOrigin: "routine",
			processedBySpecId: null
		})
		expect(await due(w.session.id)).toEqual({ sceneId: id })
	})

	it("...but not once a person has drafted it again and discarded the draft", async () => {
		// After Back, a pressed Summarize (or the routine under Review) marks the
		// draft; discarding it puts the status back and leaves the mark. The
		// routine must not then save by itself what the person threw away.
		const w = await seven()
		await scene(w, w.ids[0]!, w.ids[1]!, {
			summary: "The routine wrote this.",
			summaryOrigin: "routine",
			processedBySpecId: "core:spec/story-summarize-scene"
		})
		expect((await due(w.session.id)).sceneId).toBeNull()
	})

	it("one at a time: nothing is due while any scene's summary is being written", async () => {
		const w = await seven()
		await scene(w, w.ids[0]!, w.ids[1]!, { summaryStatus: "running" })
		await scene(w, w.ids[2]!, w.ids[3]!)
		const r = await due(w.session.id)
		expect(r.sceneId).toBeNull()
		expect(r.why).toBe("a scene's summary is being written")
	})

	it("Summaries Never: none", async () => {
		const w = await seven({ summary: "never" })
		await scene(w, w.ids[0]!, w.ids[1]!)
		const r = await due(w.session.id)
		expect(r.sceneId).toBeNull()
		expect(r.why).toMatch(/Never/)
	})

	it("a rewound turn: none", async () => {
		const w = await seven()
		await scene(w, w.ids[0]!, w.ids[1]!)
		await testDb
			.update(schema.sessionMessages)
			.set({ rewindOrdinal: 1 })
			.where(eq(schema.sessionMessages.id, w.ids[6]!))
		const r = await due(w.session.id)
		expect(r.sceneId).toBeNull()
		expect(r.why).toMatch(/taken back/)
	})

	it("a branch: a scene over the copied lines is not taken, one on the branch's own lines is", async () => {
		const trunk = await makeWorld()
		const b = await makeWorld({
			branchOf: trunk.session.id,
			bookId: trunk.bookId
		})
		// Branches copy messages (with `metadata.copyOf`), never scene rows.
		const copied = await lines(b.session.id, 3, { metadata: { copyOf: 1 } })
		const overCopied = await scene(b, copied[0]!, copied[1]!)
		const own = await lines(b.session.id, 6)
		expect((await due(b.session.id)).sceneId).toBeNull()
		const ownScene = await scene(b, own[0]!, own[1]!)
		expect(ownScene).toBeGreaterThan(overCopied)
		await lines(b.session.id, 2)
		expect(await due(b.session.id)).toEqual({ sceneId: ownScene })
	})
})
