/**
 * 🚧 PROPOSAL-live-scenes §15 G8 + G10, against published specs and a faked
 * model (and only the model):
 *
 * - **G10** — `scenes:process` on a Chat session runs the Chat genre's
 *   declared `core:spec/chat-summarize-scene`, and on a Lair session the
 *   Lair's: the response names it, `processed_by_spec_id` records it, and
 *   the run's receipt (`pipeline_runs.spec_slug`) is that spec's. Lane B
 *   could only test the fallback; here `bootstrapPipelines` publishes the
 *   catalogue, so the genre's own spec is installed.
 * - **G8** — the summary status follows the review: the run leaves a scene
 *   `review` (never `done`), Apply (`scenes:update` with the summary) makes
 *   it `done`, a discarded review puts back the status from before the run
 *   (a regenerate's discard included), a cancel puts it back as before, and
 *   a status the server lost by stopping is settled at boot.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues, insertSessionMessageRow } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import type { CompiledPrompt } from "$lib/server/connectionAdapters/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const NO_PAYLOAD: CompiledPrompt = { prompt: undefined, messages: undefined, meta: {} as any }

/** Every model step answers the same: a drafted, combined and named summary. */
class FakeStepAdapter implements FakeTextAdapter {
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	abort() {}
	async preflight() {}
	async generateText() {
		return {
			compiledPrompt: NO_PAYLOAD,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("<content>They talked by the gate until dark.</content>")
			}
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeStepAdapter })
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

const CHAT_GENRE = "core:genre/chat"
const LAIR_GENRE = "core:genre/lair"
const CHAT_SPEC = "core:spec/chat-summarize-scene"
const LAIR_SPEC = "core:spec/lair-summarize-scene"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-scenes-review-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)

	// Every step resolves its model through the instance default, as the
	// first Summarize on a fresh install does (summarizeRun.int.test.ts).
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Fake", type: "koboldcpp", baseUrl: "http://x" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Fake sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = await ensureConnectionModel(testDb as any, connection.id, "fake-7b")
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const quiet = () => {}

let seq = 0
/** A person, a book with one history entry, a session of `genreId`, two lines and a closed live scene over them. */
async function makeScene(genreId: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `scenes-review-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Review Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id, genreId } as any)
		.returning()
	const m1 = await insertSessionMessageRow(testDb, session.id, { content: "Meet me at the gate." })
	const m2 = await insertSessionMessageRow(testDb, session.id, {
		role: "assistant",
		content: "I waited there until dark."
	})
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			sessionId: session.id,
			historyEntryId: history.id,
			name: "Scene 1",
			channel: "main",
			openedAtMessageId: m1.id,
			closedAtMessageId: m2.id,
			selectedMessageIds: [m1.id, m2.id]
		} as any)
		.returning()
	return { user, lorebook, session, scene }
}

async function sceneRow(id: number) {
	const [row] = await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, id))
	return row!
}

async function runProcess(userId: number, sceneId: number) {
	const { sceneProcessHandler } = await import("./scenes")
	return (await sceneProcessHandler.handler(fakeSocket(userId), { sceneId }, quiet)) as any
}

/** Settle the background restore a discard kicks off. */
const settle = () => new Promise((r) => setTimeout(r, 100))

describe("G10: a genre's declared summarize-scene spec runs when it is published", () => {
	test("the catalogue publishes both genres' specs, and the genres declare them", async () => {
		const { publishedVersionOf } = await import("$lib/server/pipelines/boot/bootstrap")
		expect(await publishedVersionOf(testDb as any, CHAT_SPEC)).not.toBeNull()
		expect(await publishedVersionOf(testDb as any, LAIR_SPEC)).not.toBeNull()
		const { getGenre } = await import("@serene-pub/sdk")
		expect((getGenre(CHAT_GENRE) as any)?.summarize?.scene).toBe(CHAT_SPEC)
		expect((getGenre(LAIR_GENRE) as any)?.summarize?.scene).toBe(LAIR_SPEC)
	})

	for (const [label, genreId, specId] of [
		["Chat", CHAT_GENRE, CHAT_SPEC],
		["Lair", LAIR_GENRE, LAIR_SPEC]
	] as const) {
		test(`a ${label} session's scene runs ${specId}`, async () => {
			const w = await makeScene(genreId)
			const res = await runProcess(w.user.id, w.scene.id)
			expect(res.specId).toBe(specId)
			// Its own spec, installed — no fallback note.
			expect(res.note).toBeUndefined()
			expect(res.content).toBeTruthy()

			const row = await sceneRow(w.scene.id)
			expect(row.processedBySpecId).toBe(specId)
			// The run's receipt is the genre's spec's.
			const runs = await testDb
				.select({ spec: schema.pipelineRuns.specSlug })
				.from(schema.pipelineRuns)
				.where(eq(schema.pipelineRuns.sessionId, w.session.id))
			expect(runs.map((r) => r.spec)).toContain(specId)
			expect(runs.map((r) => r.spec)).not.toContain("core:spec/summarize-scene")
		})
	}
})

describe("G8: the summary status follows the review", () => {
	test("a run leaves `review`, never `done`; Apply makes it `done`", async () => {
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { sceneUpdateHandler } = await import("./scenes")
		const w = await makeScene(CHAT_GENRE)
		const res = await runProcess(w.user.id, w.scene.id)
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("review")
		// The Activity card says *Ready to review* of the same run.
		expect(activityStore.getById(res.activityId)?.status).toBe("review")

		const saved: any = await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ scene: { id: w.scene.id, summary: res.content }, activityId: res.activityId },
			quiet
		)
		expect(saved.scene.summaryStatus).toBe("done")
		await settle()
		// Applied: the review went as `acted`, which restores nothing.
		expect(activityStore.getById(res.activityId)).toBeUndefined()
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("done")
	})

	test("a discarded review puts back what the scene was: `none`, and `done` over an applied summary", async () => {
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const w = await makeScene(CHAT_GENRE)
		const first = await runProcess(w.user.id, w.scene.id)
		activityStore.remove(first.activityId, "dismissed")
		await settle()
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("none")

		// A summary applied, then a re-run discarded: back to `done`.
		await testDb
			.update(schema.scenes)
			.set({ summary: "Applied before.", summaryStatus: "done" })
			.where(eq(schema.scenes.id, w.scene.id))
		const second = await runProcess(w.user.id, w.scene.id)
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("review")
		activityStore.remove(second.activityId, "dismissed")
		await settle()
		const row = await sceneRow(w.scene.id)
		expect(row.summaryStatus).toBe("done")
		expect(row.summary).toBe("Applied before.")
	})

	test("a regenerate from the review, then a discard, restores the status from before the FIRST run", async () => {
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const w = await makeScene(CHAT_GENRE)
		await runProcess(w.user.id, w.scene.id)
		// The review window's regenerate: a second run over a scene in `review`.
		const again = await runProcess(w.user.id, w.scene.id)
		expect(activityStore.getById(again.activityId)).toMatchObject({
			status: "review",
			summaryStatusBefore: "none"
		})
		activityStore.remove(again.activityId, "dismissed")
		await settle()
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("none")
	})

	test("a discard never overwrites a status that moved while the review waited", async () => {
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const w = await makeScene(CHAT_GENRE)
		await testDb
			.update(schema.scenes)
			.set({ summary: "Old.", summaryStatus: "done" })
			.where(eq(schema.scenes.id, w.scene.id))
		const res = await runProcess(w.user.id, w.scene.id)
		// A moved boundary meanwhile leaves the summary out of date (`none`).
		await testDb
			.update(schema.scenes)
			.set({ summaryStatus: "none" })
			.where(eq(schema.scenes.id, w.scene.id))
		activityStore.remove(res.activityId, "dismissed")
		await settle()
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("none")
	})

	test("a cancelled run puts back what the scene was, as before", async () => {
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const w = await makeScene(CHAT_GENRE)
		await testDb
			.update(schema.scenes)
			.set({ summary: "Kept.", summaryStatus: "done" })
			.where(eq(schema.scenes.id, w.scene.id))
		const run = runProcess(w.user.id, w.scene.id)
		// Cancel as soon as the run's card exists.
		let id: string | undefined
		for (let i = 0; i < 200 && !id; i++) {
			id = activityStore
				.getFor(w.user.id, false)
				.find((a) => a.kind === "scene_summarize" && a.sceneId === w.scene.id)?.id
			if (!id) await new Promise((r) => setTimeout(r, 5))
		}
		expect(id).toBeTruthy()
		activityStore.cancel(id!)
		await run.catch(() => null)
		await settle()
		expect((await sceneRow(w.scene.id)).summaryStatus).toBe("done")
	})

	test("at boot, a scene left `running` or `review` with no run behind it is settled to `none`; a live run's is kept", async () => {
		const { reconcileDerelictSceneSummaries } = await import("$lib/server/scenes/summaryStatus")
		const a = await makeScene(CHAT_GENRE)
		const b = await makeScene(CHAT_GENRE)
		const c = await makeScene(CHAT_GENRE)
		await testDb.update(schema.scenes).set({ summaryStatus: "running" }).where(eq(schema.scenes.id, a.scene.id))
		await testDb
			.update(schema.scenes)
			.set({ summaryStatus: "review", summary: "Text kept." })
			.where(eq(schema.scenes.id, b.scene.id))
		await testDb.update(schema.scenes).set({ summaryStatus: "running" }).where(eq(schema.scenes.id, c.scene.id))
		const moved = await reconcileDerelictSceneSummaries(testDb as any, [c.scene.id])
		expect(moved).toBeGreaterThanOrEqual(2)
		expect((await sceneRow(a.scene.id)).summaryStatus).toBe("none")
		const rb = await sceneRow(b.scene.id)
		expect(rb.summaryStatus).toBe("none")
		expect(rb.summary).toBe("Text kept.")
		expect((await sceneRow(c.scene.id)).summaryStatus).toBe("running")
		// Nothing else moved.
		const left = await testDb
			.select({ id: schema.scenes.id })
			.from(schema.scenes)
			.where(and(eq(schema.scenes.summaryStatus, "review")))
		expect(left).toEqual([])
	})
})
