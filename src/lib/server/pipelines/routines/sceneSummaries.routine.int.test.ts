/**
 * 🚧 The scene summaries routine, end to end (2026-11-12): `core:spec/scene-summaries`
 * (UI *Summarize finished scenes*) on `every-n-rounds` (n 2), registered by Story,
 * the Lair and the Dungeon Crawler, dropped by Story's Minimal preset, absent from
 * Chat and the Guide. Its firing here is *Run now* (the same runner a cadence's
 * firing takes, `runRoutineFiring`), against published specs, with the model faked
 * and routines switched on.
 *
 * The session is Story with no seats in its turn order and every line a person's,
 * so each line closes its own round (see `scenes/sceneBoundaries.int.test.ts`): a
 * scene closed on line 2 is six rounds old once there are seven lines.
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
import { and, asc, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 })

let db: TestDb
let dataDir: string
let ownerId: number

class FakeAdapter {
	static calls = 0
	static gate: Promise<void> | null = null
	static entered: (() => void) | null = null
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	abort() {}
	async preflight() {}
	async generateText() {
		const n = ++FakeAdapter.calls
		FakeAdapter.entered?.()
		if (FakeAdapter.gate) await FakeAdapter.gate
		const text =
			n <= 2
				? "<content>They talked by the gate until dark.</content>"
				: "The Sealed Gate"
		return {
			compiledPrompt: {
				prompt: undefined,
				messages: undefined,
				meta: {}
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(text)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "scene-summaries-routine-secret"
	}
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

const SUMMARIES = "core:spec/scene-summaries"
const REGISTRATION = "every-n-rounds→scene-summaries"
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scene-summaries-routine-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "scene-summaries-owner")).id
	await db
		.insert(schema.userSettings)
		.values({ userId: ownerId, loreWriteMode: "full" })
	const [connection] = await db
		.insert(schema.connections)
		.values({ name: "Fake", type: "koboldcpp", baseUrl: "http://x" })
		.returning()
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({ name: "Fake sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		db as any,
		connection!.id,
		"fake-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db as any, "text->text", {
		connectionId: connection!.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling!.id
	})
	;(await import("./runs")).setRoutinesEnabled(true)
}, 240_000)

afterAll(async () => {
	;(await import("./runs")).setRoutinesEnabled(false)
	;(await import("./tick")).stopSystemTick()
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

beforeEach(() => {
	FakeAdapter.calls = 0
	FakeAdapter.gate = null
	FakeAdapter.entered = null
})

const asDb = () => db as unknown as Db

/** A session on `genreId` (and the preset `seedKey`, when given) with its own notes book and `lineCount` lines. */
async function make(
	opts: { genreId?: string; seedKey?: string; lineCount?: number } = {}
) {
	const suffix = `${++n}`
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Summaries Book ${suffix}` })
		.returning()
	await db
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: book!.id, year: 5, month: 1, day: 2 }])
		)
	let presetId: number | undefined
	if (opts.seedKey) {
		const [p] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, opts.seedKey))
		expect(p, opts.seedKey).toBeTruthy()
		presetId = p!.id
	}
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Summaries ${suffix}`,
			lorebookId: book!.id,
			genreId: opts.genreId ?? "core:genre/story",
			...(presetId ? { presetId } : {}),
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: {}
		} as any)
		.returning()
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: ownerId,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const lineIds: number[] = []
	for (let i = 0; i < (opts.lineCount ?? 7); i++)
		lineIds.push(await say(session!.id, `line ${i + 1}`))
	return { session: session!, book: book!, lineIds }
}

async function say(sessionId: number, content: string) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return (
		await insertLegacy(asDb(), { sessionId, role: "user", content } as any)
	).id
}

/** One scene over lines `from`..`to` (indexes), closed. */
async function closedScene(
	w: Awaited<ReturnType<typeof make>>,
	from = 0,
	to = 1
) {
	const { openScene, closeScene } = await import(
		"$lib/server/scenes/liveScenes"
	)
	const opened = await openScene(asDb(), {
		sessionId: w.session.id,
		userId: ownerId,
		channel: "main",
		atMessageId: w.lineIds[from]!
	})
	await closeScene(asDb(), {
		sceneId: opened.scene.id,
		userId: ownerId,
		atMessageId: w.lineIds[to]!
	})
	return opened.scene.id
}

const sceneRow = async (id: number) =>
	(await db.select().from(schema.scenes).where(eq(schema.scenes.id, id)))[0]!
const castOf = async (sceneId: number) =>
	(
		await db
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, sceneId))
	)
		.map((r) => `${r.role}:${r.bindingId}:${r.ordinal}`)
		.sort()
const runsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				eq(schema.pipelineRuns.specSlug, SUMMARIES)
			)
		)
		.orderBy(asc(schema.pipelineRuns.id))
const loreSourcesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.loreSources)
		.where(eq(schema.loreSources.sessionId, sessionId))

async function until<T>(
	read: () => Promise<T>,
	ok: (v: T) => boolean,
	what: string
): Promise<T> {
	for (let i = 0; i < 400; i++) {
		const v = await read()
		if (ok(v)) return v
		await new Promise((r) => setTimeout(r, 25))
	}
	throw new Error(`timed out waiting for ${what}`)
}

async function registrationOf(sessionId: number) {
	const { effectiveRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	return (await effectiveRegistrations(asDb(), sessionId))!.effective.find(
		(r) => r.pipeline === SUMMARIES
	)
}

async function setMode(sessionId: number, mode: "off" | "review" | "full") {
	const reg = (await registrationOf(sessionId))!
	const { rowOfChange } = await import(
		"$lib/server/pipelines/registrations/rows"
	)
	const { upsertRow } = await import(
		"$lib/server/pipelines/registrations/write"
	)
	await upsertRow(
		asDb(),
		rowOfChange(
			{ key: reg.key, mode },
			{ kind: "session", sessionId },
			"owner"
		)
	)
}

/** Run the routine once by hand and wait for its own run to end. */
async function fire(sessionId: number) {
	const reg = (await registrationOf(sessionId))!
	expect(reg.key).toBe(REGISTRATION)
	const { runRoutineNow } = await import("./run")
	const res = await runRoutineNow(asDb(), {
		sessionId,
		userId: ownerId,
		registrationKey: reg.key
	})
	expect(res).toEqual({ queued: true })
	return until(
		() => runsOf(sessionId),
		(r) => r.length > 0 && r.every((x) => x.endedAt != null),
		"the routine's run to end"
	)
}

describe("the scene summaries routine, end to end", () => {
	it("Full: a scene closed six rounds ago is saved by itself; the run returns before the model answers", async () => {
		const w = await make()
		const sceneId = await closedScene(w)
		const { settledLineOf } = await import("$lib/server/sessions/settle")
		const before = await sceneRow(sceneId)
		expect(before.nameIsDefault).toBe(true)
		const castBefore = await castOf(sceneId)
		const settledBefore = await settledLineOf(asDb(), w.session.id)

		// Hold the model: the run must end while the summary's call is still waiting.
		let open!: () => void
		FakeAdapter.gate = new Promise<void>((r) => (open = r))
		const entered = new Promise<void>((r) => (FakeAdapter.entered = r))
		const runs = await fire(w.session.id)
		expect(runs).toHaveLength(1)
		expect(runs[0]).toMatchObject({
			outcome: "ok",
			triggerFamily: "routine"
		})
		await entered
		expect((await sceneRow(sceneId)).summaryStatus).toBe("running")
		expect((await sceneRow(sceneId)).summary).toBe(before.summary)

		open()
		const row = await until(
			() => sceneRow(sceneId),
			(r) => r.summaryStatus === "done",
			"the summary to be saved"
		)
		expect(row.summary).toBe("They talked by the gate until dark.")
		expect(row.name).toBe("The Sealed Gate")
		expect(row.nameIsDefault).toBe(false)
		expect(row.summaryOrigin).toBe("routine")
		expect(await castOf(sceneId)).toEqual(castBefore)
		expect(await settledLineOf(asDb(), w.session.id)).toEqual(settledBefore)
		expect(await loreSourcesOf(w.session.id)).toEqual([])
	})

	it("Review: the scene goes to review as a pressed Summarize does, and nothing is saved", async () => {
		const w = await make()
		const sceneId = await closedScene(w)
		await setMode(w.session.id, "review")
		await fire(w.session.id)
		const row = await until(
			() => sceneRow(sceneId),
			(r) => r.summaryStatus === "review",
			"the scene to wait for review"
		)
		expect(row.summary ?? "").toBe("")
		expect(row.summaryOrigin).toBeNull()
		expect(row.nameIsDefault).toBe(true)
	})

	it("Off: nothing runs, and the scene stays none", async () => {
		const w = await make()
		const sceneId = await closedScene(w)
		await setMode(w.session.id, "off")
		const { runRoutineNow } = await import("./run")
		const reg = (await registrationOf(w.session.id))!
		expect(
			await runRoutineNow(asDb(), {
				sessionId: w.session.id,
				userId: ownerId,
				registrationKey: reg.key
			})
		).toEqual({
			refused:
				"That routine is Off in this session. Turn it on to run it."
		})
		expect(await runsOf(w.session.id)).toEqual([])
		expect((await sceneRow(sceneId)).summaryStatus).toBe("none")
		expect(FakeAdapter.calls).toBe(0)
	})

	it("a scene not yet old enough: the run ends, nothing starts", async () => {
		const w = await make({ lineCount: 6 })
		const sceneId = await closedScene(w)
		const runs = await fire(w.session.id)
		expect(runs[0]).toMatchObject({ outcome: "ok" })
		expect((await sceneRow(sceneId)).summaryStatus).toBe("none")
		expect(FakeAdapter.calls).toBe(0)
	})

	it("a custom name a person gave is not replaced by the routine's save", async () => {
		const w = await make()
		const sceneId = await closedScene(w)
		await db
			.update(schema.scenes)
			.set({ name: "My scene", nameIsDefault: false })
			.where(eq(schema.scenes.id, sceneId))
		await fire(w.session.id)
		const row = await until(
			() => sceneRow(sceneId),
			(r) => r.summaryStatus === "done",
			"the summary to be saved"
		)
		expect(row.name).toBe("My scene")
		expect(row.summaryOrigin).toBe("routine")
	})

	it("which genres and presets have it", async () => {
		const has = async (opts: Parameters<typeof make>[0]) =>
			(await registrationOf(
				(await make({ ...opts, lineCount: 0 })).session.id
			)) != null
		expect(await has({})).toBe(true)
		expect(await has({ seedKey: "core-story-living" })).toBe(true)
		expect(await has({ seedKey: "core-story-minimal" })).toBe(false)
		expect(await has({ genreId: "core:genre/lair" })).toBe(true)
		expect(await has({ genreId: "core:genre/dungeon-crawler" })).toBe(true)
		expect(await has({ genreId: "core:genre/chat" })).toBe(false)
		expect(await has({ genreId: "core:genre/guide" })).toBe(false)
	})

	it("Back across a routine-saved scene leaves it none with origin routine, and it is due again once closed and old enough", async () => {
		const w = await make({ lineCount: 4 })
		const { openScene, closeScene } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const opened = await openScene(asDb(), {
			sessionId: w.session.id,
			userId: ownerId,
			channel: "main",
			atMessageId: w.lineIds[0]!
		})
		await closeScene(asDb(), {
			sceneId: opened.scene.id,
			userId: ownerId,
			atMessageId: w.lineIds[3]!
		})
		const sceneId = opened.scene.id
		// Six rounds after its close line.
		for (let i = 0; i < 6; i++) await say(w.session.id, `later ${i}`)
		await fire(w.session.id)
		await until(
			() => sceneRow(sceneId),
			(r) => r.summaryStatus === "done",
			"the summary to be saved"
		)
		expect((await sceneRow(sceneId)).summaryOrigin).toBe("routine")

		// Back takes the turns after the summary back; the routine-saved scene is reopened.
		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		let reopened = await sceneRow(sceneId)
		for (let i = 0; i < 12 && reopened.closedAtMessageId != null; i++) {
			const res = await rewindTurn(asDb(), {
				sessionId: w.session.id,
				userId: ownerId
			})
			expect(res.ok, JSON.stringify(res)).toBe(true)
			reopened = await sceneRow(sceneId)
		}
		expect(reopened.closedAtMessageId).toBeNull()
		expect(reopened.summaryStatus).toBe("none")
		expect(reopened.summaryOrigin).toBe("routine")
		expect(reopened.summary).toBe("They talked by the gate until dark.")

		// The person plays on: the taken-back lines are replaced, the scene closes again, rounds pass.
		await db
			.delete(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, w.session.id),
					isNotNull(schema.sessionMessages.rewindOrdinal)
				)
			)
		const { sceneSummaryDueOf } = await import(
			"$lib/server/scenes/sceneSummaryDue"
		)
		const closeAt = await say(w.session.id, "the scene ends")
		await closeScene(asDb(), {
			sceneId,
			userId: ownerId,
			atMessageId: closeAt
		})
		// Not due until the close line is five lines behind (the round in progress is then six on).
		for (let i = 0; i < 5; i++) {
			expect(
				(await sceneSummaryDueOf(asDb(), w.session.id, { depth: 6 }))
					.sceneId,
				`after ${i} lines`
			).toBeNull()
			await say(w.session.id, `again ${i}`)
		}
		expect(
			await sceneSummaryDueOf(asDb(), w.session.id, { depth: 6 })
		).toEqual({ sceneId })
	})
})
