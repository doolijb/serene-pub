/**
 * The app's save, mark and Back for a summary the scene summaries routine
 * saves (`processScene` with `routine`, `saveSceneSummary` with `by: "routine"`,
 * `startRoutineSceneSummary`), against published specs and a faked model (and
 * only the model, the session events' ledger and nothing else).
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
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import type { CompiledPrompt } from "$lib/server/connectionAdapters/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const NO_PAYLOAD: CompiledPrompt = {
	prompt: undefined,
	messages: undefined,
	meta: {} as any
}

/** The model: a drafted and a combined summary, then a name. Can be held at a gate, or made to fail. */
class FakeStepAdapter implements FakeTextAdapter {
	static calls = 0
	/** The run family and queue priority each call was made under. */
	static seen: Array<{ family: string | undefined; priority: number }> = []
	static gate: Promise<void> | null = null
	static entered: (() => void) | null = null
	static failFromCall: number | null = null
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	abort() {}
	async preflight() {}
	async generateText() {
		const n = ++FakeStepAdapter.calls
		const { currentRunFamily, currentLlmPriority } = await import(
			"$lib/server/utils/llmQueue"
		)
		FakeStepAdapter.seen.push({
			family: currentRunFamily(),
			priority: currentLlmPriority()
		})
		FakeStepAdapter.entered?.()
		if (FakeStepAdapter.gate) await FakeStepAdapter.gate
		if (
			FakeStepAdapter.failFromCall != null &&
			n >= FakeStepAdapter.failFromCall
		)
			throw new Error("the model failed")
		const text =
			n <= 2
				? "<content>They talked by the gate until dark.</content>"
				: "The Sealed Gate"
		return {
			compiledPrompt: NO_PAYLOAD,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(text)
			}
		}
	}
}

const emitted: Array<{ event: string; payload: any }> = []
vi.mock(
	"$lib/server/pipelines/runtime/sessionEvents",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("$lib/server/pipelines/runtime/sessionEvents")
			>()
		return {
			...original,
			emitSessionEvent: async (db: any, args: any) => {
				emitted.push({ event: args.event, payload: args.payload })
				return original.emitSessionEvent(db, args)
			}
		}
	}
)
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
let n = 0
const asDb = () => testDb as unknown as Db
const CHAT_GENRE = "core:genre/story"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scenes-routine-summary-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Fake", type: "koboldcpp", baseUrl: "http://x" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Fake sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"fake-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}, 240_000)

afterAll(async () => {
	delete (globalThis as any).__SERENE_PUB_SOCKET_STATE__
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	FakeStepAdapter.calls = 0
	FakeStepAdapter.seen = []
	FakeStepAdapter.gate = null
	FakeStepAdapter.entered = null
	FakeStepAdapter.failFromCall = null
	emitted.length = 0
	delete (globalThis as any).__SERENE_PUB_SOCKET_STATE__
})

/** Hold the model's next call at a gate. `entered` resolves when a call reaches it; `open` lets it go. */
function holdModel() {
	let open!: () => void
	FakeStepAdapter.gate = new Promise<void>((r) => (open = r))
	const entered = new Promise<void>((r) => (FakeStepAdapter.entered = r))
	return { open, entered }
}

/** A person, a book with a history day, a session with its own notes book, six lines, and one closed scene over lines 1–2. */
async function world(opts: { mode?: "full" | "review" | "off" } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `routine-summary-${suffix}`)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Routine Book ${suffix}` })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: book!.id, year: 5, month: 1, day: 2 }])
		)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			genreId: CHAT_GENRE,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: {}
		} as any)
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
	for (let i = 0; i < 6; i++)
		lines.push(
			await insertLegacy(asDb(), {
				sessionId: session!.id,
				role: i % 2 === 0 ? "user" : "assistant",
				content: `line ${i + 1}`
			} as any)
		)
	const { openScene, closeScene } = await import(
		"$lib/server/scenes/liveScenes"
	)
	const first = await openScene(asDb(), {
		sessionId: session!.id,
		userId: user.id,
		channel: "main",
		atMessageId: lines[0]!.id
	})
	await closeScene(asDb(), {
		sceneId: first.scene.id,
		userId: user.id,
		atMessageId: lines[1]!.id
	})
	return {
		user,
		book: book!,
		session: session!,
		notes,
		lines,
		sceneId: first.scene.id
	}
}
type World = Awaited<ReturnType<typeof world>>

const sceneRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, id))
	)[0]!
const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!
const castOf = async (sceneId: number) =>
	(
		await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, sceneId))
	)
		.map((r) => `${r.role}:${r.bindingId}:${r.ordinal}`)
		.sort()
const loreSourcesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.loreSources)
		.where(eq(schema.loreSources.sessionId, sessionId))
const applied = () =>
	emitted.filter((e) => e.event === "core:event/scene-summary-applied@1")
const cardOf = async (w: World, sceneId = w.sceneId) => {
	const { activityStore } = await import("$lib/server/utils/activityStore")
	return activityStore
		.getFor(w.user.id, false)
		.find(
			(a) => a.kind === "scene_summarize" && a.sceneId === sceneId
		) as any
}

/** The routine's run, as the outlet starts it, but awaited. */
async function routineRun(
	w: World,
	mode: "review" | "full",
	sceneId = w.sceneId,
	sent: Array<[string, any]> = []
) {
	const { processScene } = await import("./scenes")
	return processScene(
		w.user.id,
		{ sceneId },
		(event, data) => void sent.push([event, data]),
		{
			routine: { mode }
		}
	)
}

async function note(w: World, title: string, at: number) {
	const [row] = await testDb
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
		await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.notes))
	)
		.map((r) => r.id)
		.sort((a, b) => a - b)

describe("the routine under Full saves by itself", () => {
	it("saves the summary, done, origin routine, the spec that ran; the model's name replaces an automatic name; no record, settle or event", async () => {
		const w = await world()
		const { settledLineOf } = await import("$lib/server/sessions/settle")
		const sent: Array<[string, any]> = []
		expect((await sceneRow(w.sceneId)).nameIsDefault).toBe(true)
		await routineRun(w, "full", w.sceneId, sent)

		const row = await sceneRow(w.sceneId)
		expect(row.summary).toBe("They talked by the gate until dark.")
		expect(row.summaryStatus).toBe("done")
		expect(row.summaryOrigin).toBe("routine")
		expect(row.processedBySpecId).toBe("core:spec/story-summarize-scene")
		expect(row.name).toBe("The Sealed Gate")
		expect(row.nameIsDefault).toBe(false)

		expect(await loreSourcesOf(w.session.id)).toEqual([])
		expect(await settledLineOf(asDb(), w.session.id)).toBeNull()
		expect((await sessionRow(w.session.id)).settledMessageId).toBeNull()
		expect(applied()).toEqual([])
		// No review window opens: the card ends as used, and nothing says `complete`.
		expect(sent.filter(([e]) => e === "scenes:process:complete")).toEqual(
			[]
		)
		expect(await cardOf(w)).toBeUndefined()
	})

	it("keeps a name a person gave", async () => {
		const w = await world()
		await testDb
			.update(schema.scenes)
			.set({ name: "My scene", nameIsDefault: false })
			.where(eq(schema.scenes.id, w.sceneId))
		await routineRun(w, "full")
		const row = await sceneRow(w.sceneId)
		expect(row.name).toBe("My scene")
		expect(row.nameIsDefault).toBe(false)
		expect(row.summaryStatus).toBe("done")
	})

	it("leaves the known cast exactly as the close stored it, a silent member included", async () => {
		const w = await world()
		const { resolveOrCreateBinding } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		const [silent] = await testDb
			.insert(schema.characters)
			.values({
				userId: w.user.id,
				name: "Silent One",
				description: "Never speaks."
			})
			.returning()
		const binding = await resolveOrCreateBinding({
			lorebookId: w.book.id,
			characterId: silent!.id
		})
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		await writeSceneCast(
			w.sceneId,
			{ participantCharacters: [binding!] },
			asDb()
		)
		const before = await castOf(w.sceneId)
		const resolvedBefore = (await sceneRow(w.sceneId)).castResolvedAt
		expect(before).toHaveLength(1)

		await routineRun(w, "full")
		expect(await castOf(w.sceneId)).toEqual(before)
		expect((await sceneRow(w.sceneId)).castResolvedAt).toEqual(
			resolvedBefore
		)
	})

	it("queues its model calls as a routine's, and a person's pressed run as an action's", async () => {
		const { llmQueue, LLM_PRIORITY } = await import(
			"$lib/server/utils/llmQueue"
		)
		const w = await world()
		const held = holdModel()
		const run = routineRun(w, "full")
		await held.entered
		// The call the queue holds right now is a routine's.
		expect(
			llmQueue.snapshot().some((s) => s.priority === LLM_PRIORITY.routine)
		).toBe(true)
		held.open()
		await run
		expect(FakeStepAdapter.seen.length).toBeGreaterThanOrEqual(3)
		for (const s of FakeStepAdapter.seen)
			expect(s).toEqual({
				family: "routine",
				priority: LLM_PRIORITY.routine
			})

		// A person's pressed run keeps the action family (people's replies still go first of the two: `llmQueue.test.ts` "model-queue priority").
		FakeStepAdapter.seen = []
		const w2 = await world()
		const { processScene } = await import("./scenes")
		await processScene(w2.user.id, { sceneId: w2.sceneId }, () => {})
		for (const s of FakeStepAdapter.seen)
			expect(s).toEqual({
				family: "action",
				priority: LLM_PRIORITY.interactive
			})
	})

	it("holds neither the generation lock nor the busy door while the model works", async () => {
		const { keyedLockHeld } = await import(
			"$lib/server/utils/sessionGenerationLock"
		)
		const { sessionBusy } = await import("$lib/server/sessions/rewind")
		const w = await world()
		const held = holdModel()
		const run = routineRun(w, "full")
		await held.entered
		expect((await sceneRow(w.sceneId)).summaryStatus).toBe("running")
		expect(keyedLockHeld("generation", w.session.id)).toBe(false)
		expect(await sessionBusy(asDb(), w.session.id)).toBe(false)
		held.open()
		await run
	})

	it("lines taken back meanwhile: nothing is saved and the scene goes back to `none`, to be summarized again", async () => {
		const w = await world()
		const held = holdModel()
		const run = routineRun(w, "full").catch((e) => e as Error)
		await held.entered
		await testDb
			.update(schema.sessionMessages)
			.set({ rewindOrdinal: 1 })
			.where(eq(schema.sessionMessages.id, w.lines[1]!.id))
		held.open()
		await run
		// Never `failed`: the routine does not retry a failed scene, and Back
		// into a scene must leave it to be summarized again.
		await vi.waitFor(async () =>
			expect((await sceneRow(w.sceneId)).summaryStatus).toBe("none")
		)
		const row = await sceneRow(w.sceneId)
		expect(row.summary).toBeNull()
		expect(row.summaryOrigin).toBeNull()
		expect(row.processedBySpecId).toBeNull()
	})

	it("refuses to save when lore writes were turned Off meanwhile", async () => {
		const w = await world()
		const held = holdModel()
		const run = routineRun(w, "full").catch((e) => e as Error)
		await held.entered
		await testDb
			.update(schema.userSettings)
			.set({ loreWriteMode: "off" })
			.where(eq(schema.userSettings.userId, w.user.id))
		held.open()
		await run
		await vi.waitFor(async () =>
			expect((await sceneRow(w.sceneId)).summaryStatus).toBe("failed")
		)
		const card = await cardOf(w)
		expect(card).toMatchObject({ status: "error" })
		expect(card.errorMessage).toBe(LORE_WRITES_OFF)
	})

	it("writes nothing when a person saved the scene's summary meanwhile, and says so", async () => {
		const w = await world()
		const held = holdModel()
		const run = routineRun(w, "full")
		await held.entered
		await testDb
			.update(schema.scenes)
			.set({
				summary: "By hand.",
				summaryStatus: "done",
				summaryOrigin: "person"
			})
			.where(eq(schema.scenes.id, w.sceneId))
		held.open()
		await run
		const row = await sceneRow(w.sceneId)
		expect(row.summary).toBe("By hand.")
		expect(row.summaryOrigin).toBe("person")
		expect(row.processedBySpecId).toBeNull()
		expect(await cardOf(w)).toBeUndefined()
	})
})

describe("the routine under Review parks the result as a pressed Summarize does", () => {
	it("review status, the card in review with a pending result, `complete` sent, nothing saved", async () => {
		const w = await world()
		const sent: Array<[string, any]> = []
		const res = await routineRun(w, "review", w.sceneId, sent)
		expect(res?.content).toBe("They talked by the gate until dark.")
		const row = await sceneRow(w.sceneId)
		expect(row.summaryStatus).toBe("review")
		expect(row.summary).toBeNull()
		expect(row.summaryOrigin).toBeNull()
		expect(row.processedBySpecId).toBe("core:spec/story-summarize-scene")
		expect(row.nameIsDefault).toBe(true)
		const card = await cardOf(w)
		expect(card).toMatchObject({ status: "review" })
		expect(card.pendingResult.content).toBe(
			"They talked by the gate until dark."
		)
		expect(
			sent.filter(([e]) => e === "scenes:process:complete")
		).toHaveLength(1)
		expect(await loreSourcesOf(w.session.id)).toEqual([])
		// Saving the review is a person's save: it makes the summary theirs.
		const { sceneUpdateHandler } = await import("./scenes")
		await sceneUpdateHandler.handler(
			{ user: { id: w.user.id } } as any,
			{
				scene: { id: w.sceneId, summary: res!.content },
				activityId: card.id
			} as any,
			() => {}
		)
		const saved = await sceneRow(w.sceneId)
		expect(saved.summaryOrigin).toBe("person")
		expect(saved.summaryStatus).toBe("done")
		expect(await loreSourcesOf(w.session.id)).toHaveLength(1)
	})
})

describe("a person's save on a routine-saved summary makes it theirs", () => {
	it("origin person, a lore_sources row, one scene-summary-applied, settled through the scene", async () => {
		const w = await world()
		await routineRun(w, "full")
		expect((await sceneRow(w.sceneId)).summaryOrigin).toBe("routine")
		expect(applied()).toHaveLength(0)

		const { sceneUpdateHandler } = await import("./scenes")
		await sceneUpdateHandler.handler(
			{ user: { id: w.user.id } } as any,
			{
				scene: { id: w.sceneId, summary: "They talked, and parted." }
			} as any,
			() => {}
		)
		const row = await sceneRow(w.sceneId)
		expect(row.summaryOrigin).toBe("person")
		expect(row.summary).toBe("They talked, and parted.")
		const rows = await loreSourcesOf(w.session.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			subjectKind: "scene",
			subjectId: w.sceneId,
			fromMessageId: w.lines[0]!.id,
			throughMessageId: w.lines[1]!.id
		})
		expect(applied()).toHaveLength(1)
		expect((await sessionRow(w.session.id)).settledMessageId).toBe(
			w.lines[1]!.id
		)
		const { settledLineOf } = await import("$lib/server/sessions/settle")
		expect(await settledLineOf(asDb(), w.session.id)).toBe(w.lines[1]!.id)

		// A second plain edit of a person's summary records nothing more.
		await sceneUpdateHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ scene: { id: w.sceneId, summary: "Again." } } as any,
			() => {}
		)
		expect(await loreSourcesOf(w.session.id)).toHaveLength(1)
		expect(applied()).toHaveLength(1)
	})
})

describe("held lorebook changes release to the channel's newest closed scene", () => {
	/** The summary of scene A runs (held at the model) while scene B opens and closes after it, with a change held in each. */
	async function held(w: World) {
		const early = await note(w, "Ashfall Keep", w.lines[0]!.id)
		const late = await note(w, "Brine Gate", w.lines[3]!.id)
		const gate = holdModel()
		const run = routineRun(w, "full").catch((e) => e as Error)
		await gate.entered
		const { openScene, closeScene } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const second = await openScene(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId: w.lines[2]!.id
		})
		await closeScene(asDb(), {
			sceneId: second.scene.id,
			userId: w.user.id,
			atMessageId: w.lines[3]!.id
		})
		// The summary's wait holds every automatic Apply from its scene's start.
		expect(await inNotes(w)).toEqual([early, late].sort((a, b) => a - b))
		return { gate, run, early, late }
	}
	const empty = async (w: World) =>
		vi.waitFor(async () => expect(await inNotes(w)).toEqual([]), {
			timeout: 20_000
		})

	it("when the summary is saved", async () => {
		const w = await world()
		const { gate, run } = await held(w)
		gate.open()
		await run
		expect((await sceneRow(w.sceneId)).summaryStatus).toBe("done")
		await empty(w)
	})

	it("when the summary fails", async () => {
		const w = await world()
		FakeStepAdapter.failFromCall = 1
		const { gate, run } = await held(w)
		gate.open()
		await run
		await vi.waitFor(async () =>
			expect((await sceneRow(w.sceneId)).summaryStatus).toBe("failed")
		)
		await empty(w)
	})

	it("when the summary is cancelled", async () => {
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		const w = await world()
		const { gate, run } = await held(w)
		activityStore.cancel((await cardOf(w)).id)
		gate.open()
		await run
		const stopped = await sceneRow(w.sceneId)
		expect(stopped.summaryStatus).toBe("none")
		// A person stopping it has decided: the draft mark is set, so the
		// routine does not start this scene again.
		expect(stopped.processedBySpecId).toBe("core:spec/scene-summaries")
		const { sceneSummaryDueOf } = await import(
			"$lib/server/scenes/sceneSummaryDue"
		)
		// (This world holds a second closed scene, which may be due; the
		// stopped one never is.)
		expect(
			(await sceneSummaryDueOf(testDb as any, w.session.id, { depth: 0 })).sceneId
		).not.toBe(w.sceneId)
		await empty(w)
	})
})

describe("startRoutineSceneSummary", () => {
	it("returns started before the model answers, then the run saves", async () => {
		const { startRoutineSceneSummary } = await import("./scenes")
		const w = await world()
		const gate = holdModel()
		const out = await startRoutineSceneSummary({
			sessionId: w.session.id,
			sceneId: w.sceneId,
			mode: "full"
		})
		expect(out).toEqual({ started: true })
		await gate.entered
		expect((await sceneRow(w.sceneId)).summaryStatus).toBe("running")
		gate.open()
		await vi.waitFor(
			async () =>
				expect((await sceneRow(w.sceneId)).summaryStatus).toBe("done"),
			{
				timeout: 20_000
			}
		)
		expect((await sceneRow(w.sceneId)).summaryOrigin).toBe("routine")
		// Run as the session's owner, a routine's calls.
		for (const s of FakeStepAdapter.seen) expect(s.family).toBe("routine")
	})

	it("says why when the scene is not `none`, not this session's, gone, or lore writes are Off", async () => {
		const { startRoutineSceneSummary } = await import("./scenes")
		const w = await world()
		await testDb
			.update(schema.scenes)
			.set({ summaryStatus: "done" })
			.where(eq(schema.scenes.id, w.sceneId))
		const done = await startRoutineSceneSummary({
			sessionId: w.session.id,
			sceneId: w.sceneId,
			mode: "full"
		})
		expect(done).toMatchObject({ started: false })
		expect((done as { note: string }).note).toBeTruthy()

		const other = await world()
		const foreign = await startRoutineSceneSummary({
			sessionId: other.session.id,
			sceneId: w.sceneId,
			mode: "full"
		})
		expect(foreign.started).toBe(false)
		const gone = await startRoutineSceneSummary({
			sessionId: w.session.id,
			sceneId: 9_999_999,
			mode: "full"
		})
		expect(gone.started).toBe(false)

		const off = await world()
		await testDb
			.update(schema.userSettings)
			.set({ loreWriteMode: "off" })
			.where(eq(schema.userSettings.userId, off.user.id))
		const refused = await startRoutineSceneSummary({
			sessionId: off.session.id,
			sceneId: off.sceneId,
			mode: "review"
		})
		expect(refused).toEqual({ started: false, note: LORE_WRITES_OFF })
		expect((await sceneRow(off.sceneId)).summaryStatus).toBe("none")
		expect(FakeStepAdapter.calls).toBe(0)
	})
})
