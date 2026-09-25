/**
 * Statuses set inside node execution (plans/29 R-19, R-21; 09-B B11; 30 U5h) —
 * the app's half, through the REAL socket handlers and the real reply road
 * against the SHIPPED documents the bootstrap publishes, with a fake adapter
 * standing in for the model.
 *
 * ## What is pinned
 *
 *  1. **The live row carries the status.** A chat reply's row is announced
 *     saying *Jasmine is thinking*, then *Jasmine is composing*, then *Jasmine
 *     is typing* — `generationStatus` on the `sessionMessage` frame, where the
 *     retired `generationStage` enum used to be — and the row leaves the
 *     generating state with no status.
 *  2. **The session list carries it while the run is in flight**, and clears
 *     it after: `sessions:list` built mid-reply says what the run is doing;
 *     `sessions:runStatus` announces each change and `null` at the end.
 *  3. **Stop mid-typing is receipted with the status.** The receipt's
 *     `lastStatus` is *typing* at `generate`, `{speaker}` filled, and the
 *     inspector's sentence reads it: _Stopped at generate on request while
 *     Jasmine is typing._
 *  4. **A summary's frames count honestly.** With no live row, the summarize
 *     modal's own progress frames carry *summarising part 1 of 3* … from the
 *     each clause's true total, then *merging the drafts*, *naming the entry*.
 *  5. **A preview emits no status.** The token estimate performs no writes and
 *     nobody is watching it type.
 *  6. **`{speaker}` is the host's.** An envoy's turn says *Guide is typing*.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { renderStatusText, type StatusText } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." },
		narratorPromptConfig: null
	})
}))

/** Every session broadcast the host, the live row and the relay made, in order. */
const broadcasts: Array<{ sessionId: number; event: string; payload: any }> = []
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async (
		_io: any,
		sessionId: number,
		event: string,
		payload: any
	) => {
		broadcasts.push({ sessionId, event, payload })
	}
}))

/**
 * One seam for the `status.end()`-in-`finally` test below: `live.finish`
 * rejects exactly once, on request, while everything else about the live row
 * is the real thing. `vi.hoisted` so the mock factory (hoisted above this
 * file's own top) has something to close over.
 */
const liveRowHooks = vi.hoisted(() => ({ forceFinishReject: false }))
vi.mock("$lib/server/pipelines/runtime/liveRow", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/liveRow")
		>()
	return {
		...actual,
		createLiveRow: (opts: Parameters<typeof actual.createLiveRow>[0]) => {
			const real = actual.createLiveRow(opts)
			return {
				...real,
				async finish(end: Parameters<typeof real.finish>[0]) {
					if (liveRowHooks.forceFinishReject) {
						liveRowHooks.forceFinishReject = false
						throw new Error("live.finish rejected (test)")
					}
					return real.finish(end)
				}
			}
		}
	}
})

const CHUNKS = ["The gate ", "was sealed ", "with old iron."]
/** The summarize steps' canned answers, in the world spec's order: drafts, synth, name. */
const STEP_ANSWERS = {
	draft: "<content>• A gate, sealed with old iron.</content>",
	synth: "<content>The gate was sealed, so they went under it.</content>",
	name: "The Sealed Gate"
}
/** A gate the test holds between the first chunk and the rest — a Stop lands mid-stream. */
let holdStream: Promise<void> | null = null
let releaseStream: (() => void) | null = null
const armHold = () => {
	holdStream = new Promise<void>((r) => {
		releaseStream = r
	})
}
/** Fires when the fake has streamed its first chunk — "typing" is on the row by then. */
let firstChunk: (() => void) | null = null
/** Wait for the fake's first chunk, or say what had happened instead. */
const untilFirstChunk = () =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() =>
				reject(
					new Error(
						`no chunk streamed in 20s; events=${JSON.stringify(
							events.map((e) => [
								e.event,
								e.data?.error ??
									e.data?.status?.i18n?.en ??
									e.data?.stage
							])
						)} broadcasts=${JSON.stringify(
							broadcasts.map((b) => [
								b.event,
								b.payload?.sessionMessage?.generationStatus
									?.i18n?.en ??
									b.payload?.status?.i18n?.en ??
									b.payload?.sessionMessage?.isGenerating
							])
						)}`
					)
				),
			20_000
		)
		firstChunk = () => {
			clearTimeout(timer)
			firstChunk = null
			resolve()
		}
	})

/**
 * One fake for both roads: the reply road builds it bare and chains
 * `withStops/withCompiledPrompt/withStreaming`; the step road (`dispatchStep`,
 * the summarize spec) constructs it with the prompt config and the batch as a
 * session, and reads the answer off `completionResult`.
 */
class FakeAdapter {
	aborted = false
	/** The reply road hands the assembled prompt over; the step road never does. */
	private replyRoad = false
	private stepSystem: string
	constructor(p: any) {
		this.stepSystem = String(p?.promptConfig?.systemPrompt ?? "")
	}
	abort() {
		this.aborted = true
		releaseStream?.()
	}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		this.replyRoad = true
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		const step = this.stepSystem
		return {
			compiledPrompt: {
				prompt: "p",
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (!this.replyRoad) {
					// A summarize step: which one, from what its prompt asks.
					const lower = step.toLowerCase()
					onContent(
						/name|title/.test(lower) && !/draft|summar/.test(lower)
							? STEP_ANSWERS.name
							: /merg|synth|combine|final/.test(lower)
								? STEP_ANSWERS.synth
								: STEP_ANSWERS.draft
					)
					return
				}
				for (let i = 0; i < CHUNKS.length; i++) {
					if (this.aborted) return
					onContent(CHUNKS[i]!)
					if (i === 0) {
						firstChunk?.()
						if (holdStream) await holdStream
					}
					if (this.aborted) return
				}
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let characterId: number
/** The user's own presence — the round-robin needs somebody to take turns with. */
let personaId: number
let lorebookId: number

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any
const events: Array<{ event: string; data: any }> = []
const emit = (event: string, data: any) => {
	events.push({ event, data })
}

/** A session with Jasmine in it and one user line, ready for a turn. */
async function makeChatSession(tag: string, withLorebook = false) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			...(withLorebook ? { lorebookId } : {})
		})
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	await db.insert(schema.sessionPersonas).values({
		sessionId: session.id,
		personaId,
		position: 0
	})
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		userId,
		personaId,
		role: "user",
		content: `tell me about the gate (${tag})`
	} as any)
	return session.id
}

/**
 * Take a turn, naming who takes it.
 *
 * ⚠ The pick is not incidental since PLAN-turn-order A7. Firing is over the
 * session's **prepared order**, and these sessions are built by inserting
 * rows rather than by sending — so no event has ever recomputed their
 * order and there is nothing prepared. Naming the speaker is what
 * "Trigger Character" does, it is what the alias carries, and it is what
 * these tests are actually about: the status relay, which now fills
 * `{speaker}` from the trigger's word again (§4.6).
 */
const trigger = async (sessionId: number, speaker?: string) => {
	const { triggerGenerateMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return triggerGenerateMessageHandler.handler(
		fakeSocket(userId),
		{
			sessionId,
			once: true,
			...(speaker ? { speaker } : { characterId })
		},
		emit
	)
}

/** The row statuses announced for one session, consecutive repeats folded. */
function rowStatuses(sessionId: number): StatusText[] {
	const out: StatusText[] = []
	for (const b of broadcasts) {
		if (b.sessionId !== sessionId || b.event !== "sessionMessage") continue
		const status = b.payload?.sessionMessage?.generationStatus
		if (!status) continue
		if (
			out.length &&
			JSON.stringify(out[out.length - 1]) === JSON.stringify(status)
		)
			continue
		out.push(status)
	}
	return out
}

const listStatuses = (sessionId: number) =>
	broadcasts
		.filter(
			(b) => b.sessionId === sessionId && b.event === "sessions:runStatus"
		)
		.map((b) => b.payload.status as StatusText | null)

const rendered = (s: StatusText | null | undefined) =>
	s ? renderStatusText(s) : null

const messagesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-run-status-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "run-status")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Jasmine", description: "A knight." })
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "You",
			description: "",
			isPersona: true
		} as any)
		.returning()
	personaId = persona.id
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Status Lore", userId })
		.returning()
	lorebookId = lorebook.id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(db, textConn.id, "status-7b"))!
		.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 200,
				temperature: 0.2
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the live row and the session list", () => {
	it("a chat reply says thinking, composing, typing on its row — {speaker} filled — and the list carries it while running", async () => {
		const sessionId = await makeChatSession("row")
		broadcasts.length = 0
		armHold()

		// Held mid-stream: the run is typing and the list is asked what it is doing.
		const running = trigger(sessionId)
		await untilFirstChunk()
		const { sessionsListHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const midway: any = await sessionsListHandler.handler(
			fakeSocket(userId),
			{},
			() => {}
		)
		const midRow = midway.sessionList.find((s: any) => s.id === sessionId)
		expect(rendered(midRow?.runStatus)).toBe("Jasmine is typing")
		releaseStream!()
		const res: any = await running
		expect(res?.error, res?.error).toBeUndefined()

		/**
		 * The row's statuses, in order, `{speaker}` filled by the host —
		 * **including the reads'** since PLAN-turn-order A7.
		 *
		 * *Thinking* used to be withheld: the reads ran before the speaker
		 * node decided and before the row it opened existed, so there was
		 * nobody to name and nowhere to say it. Both facts are there from
		 * the first node now — the fired entry names the speaker, and
		 * `placeholder` is the second node — so the reads' status reaches
		 * the row like every other.
		 */
		expect(rowStatuses(sessionId).map(rendered)).toEqual([
			"Jasmine is thinking",
			"Jasmine is composing",
			"Jasmine is typing"
		])
		expect(rowStatuses(sessionId)[2]).toEqual({
			i18n: { en: "{speaker} is typing" },
			vars: { speaker: "Jasmine" }
		})
		// The list's push: each change, then the end.
		expect(listStatuses(sessionId).map(rendered)).toEqual([
			"Jasmine is thinking",
			"Jasmine is composing",
			"Jasmine is typing",
			null
		])
		// The retired enum was never written; the status leaves with the run.
		const rows = await messagesOf(sessionId)
		const reply = rows[rows.length - 1]!
		expect(reply.isGenerating).toBe(false)
		expect(reply.generationStatus).toBeNull()
		expect(reply.generationStage).toBeNull()
		expect(
			broadcasts.some(
				(b) =>
					b.event === "sessionMessage" &&
					b.payload?.sessionMessage?.generationStage != null
			)
		).toBe(false)
		// And a list built after says nothing about it.
		const after: any = await sessionsListHandler.handler(
			fakeSocket(userId),
			{},
			() => {}
		)
		expect(
			after.sessionList.find((s: any) => s.id === sessionId).runStatus
		).toBeUndefined()
	})

	it("the progress card's frames carry the status too", async () => {
		const sessionId = await makeChatSession("card")
		events.length = 0
		const res: any = await trigger(sessionId)
		expect(res?.error, res?.error).toBeUndefined()
		const statuses = events
			.filter((e) => e.event === "pipelines:progress" && e.data?.status)
			.map((e) => rendered(e.data.status))
		// *Thinking* included since A7: the speaker is known from the first
		// node, so the reads' status is no longer withheld — see the first
		// case.
		expect(statuses).toEqual([
			"Jasmine is thinking",
			"Jasmine is composing",
			"Jasmine is typing"
		])
	})
})

describe("Stop mid-typing", () => {
	it("the receipt keeps the last status at generate, and the inspector sentence reads it", async () => {
		const sessionId = await makeChatSession("stop")
		broadcasts.length = 0
		armHold()
		const running = trigger(sessionId)
		await untilFirstChunk()

		// The message's own Stop, through the real handler.
		const { sessionMessagesCancelHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionMessagesCancelHandler.handler(
			fakeSocket(userId),
			{ sessionId },
			() => {}
		)
		const res: any = await running
		expect(res?.stopped ?? res?.error ?? res?.success).toBeDefined()

		const rows = await messagesOf(sessionId)
		const reply = rows[rows.length - 1]!
		expect(reply.isGenerating).toBe(false)
		expect(reply.generationOutcome).toBe("stopped")
		expect(reply.generationStatus).toBeNull()

		const [run] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, sessionId))
		expect(run).toBeDefined()
		const receipt = run!.receipt as any
		expect(receipt.outcome).toBe("cancelled")
		expect(receipt.lastStatus).toEqual({
			nodeKey: "generate",
			text: {
				i18n: { en: "{speaker} is typing" },
				vars: { speaker: "Jasmine" }
			}
		})
		// F34: the status is on no node row.
		expect(receipt.nodes.some((n: any) => "status" in n)).toBe(false)

		// The inspector's one sentence, as the client projects it.
		const { verdict, lastStatusOf } = await import(
			"$lib/client/components/pipelines/inspector/receiptView"
		)
		const inspected = {
			runId: run!.runId,
			specSlug: "core:spec/respond",
			specVersion: "1",
			specHash: null,
			specHashIsCurrent: true,
			specHashRenamedAt: null,
			outcome: receipt.outcome,
			haltNodeKey: receipt.haltNodeKey ?? null,
			haltReason: receipt.haltReason ?? null,
			elapsedMs: 0,
			tokensSpent: 0,
			isPreview: false,
			artifacts: [],
			sessionId,
			startedAt: new Date().toISOString(),
			receipt
		}
		const last = lastStatusOf(inspected)
		expect(last?.nodeKey).toBe("generate")
		expect(
			verdict(inspected, { status: renderStatusText(last!.text) })
		).toBe("Stopped at generate on request while Jasmine is typing.")
		// And the list heard the end.
		expect(listStatuses(sessionId).at(-1)).toBeNull()
	})
})

describe("status.end() runs even when live.finish rejects", () => {
	it("still tells the session list null, and the turn is not failed by it", async () => {
		const sessionId = await makeChatSession("finish-throws")
		broadcasts.length = 0
		liveRowHooks.forceFinishReject = true

		const res: any = await trigger(sessionId)

		// The run-end hook's own throw is absorbed by the executor as a
		// receipt note (`RunOptions.onRunEnd`), not a failed turn: the reply
		// itself went to the end and wrote its text.
		expect(res?.error, res?.error).toBeUndefined()
		expect(liveRowHooks.forceFinishReject).toBe(false) // the hook fired
		// `status.end()` ran in `finally`, despite `live.finish` throwing —
		// the list still hears the run is over rather than being stuck on
		// its last status ("Jasmine is typing").
		expect(listStatuses(sessionId).at(-1)).toBeNull()
	})
})

describe("a summary — no live row", () => {
	it("the modal's frames say summarising part n of the TRUE total, then the merge and the name", async () => {
		const sessionId = await makeChatSession("summary", true)
		// Three long lines: each alone fills a batch at the default budget, so
		// the each clause has three parts and the status can count them.
		const long = (seed: string) =>
			Array.from({ length: 2000 }, (_, i) => `${seed}${i % 7}`).join(" ")
		await db.insert(schema.sessionMessages).values(
			["one", "two", "three"].map((seed) => ({
				sessionId,
				role: "assistant",
				characterId,
				content: long(seed)
			})) as any
		)
		events.length = 0
		const { sessionsSummarizeHandler } = await import(
			"$lib/server/sockets/summarize"
		)
		const res: any = await sessionsSummarizeHandler.handler(
			fakeSocket(userId),
			{ sessionId, messageIds: "all", loreType: "world" },
			emit
		)
		const errors = events.filter(
			(e) => e.event === "sessions:summarize:error"
		)
		expect(errors, JSON.stringify(errors)).toEqual([])
		expect(res?.content).toBeTruthy()

		const frames = events
			.filter(
				(e) =>
					e.event === "sessions:summarize:progress" && e.data?.status
			)
			.map((e) => ({
				text: rendered(e.data.status),
				batch: e.data.batch,
				total: e.data.totalBatches,
				phase: e.data.phase
			}))
		const drafting = frames.filter((f) => f.phase === "drafting")
		expect(drafting.map((f) => f.text)).toEqual([
			"summarising part 1 of 3",
			"summarising part 2 of 3",
			"summarising part 3 of 3"
		])
		// Honest counts: the each clause's total from the first frame on —
		// not the "seen so far" the node events could only guess.
		expect(drafting.map((f) => [f.batch, f.total])).toEqual([
			[1, 3],
			[2, 3],
			[3, 3]
		])
		expect(frames.map((f) => f.text).slice(3)).toEqual([
			"merging the drafts",
			"naming the entry"
		])
		// No live row: nothing landed on a message.
		expect(rowStatuses(sessionId)).toEqual([])
		// The same statuses reach the session list too (R-19 fix,
		// 2026-09-16): summarize now builds its `runSpec` request with
		// `io`, same as every other trigger, so `sessions:runStatus`
		// carries them and `null` once the run ends — not just the modal's
		// own `sessions:summarize:progress` frame.
		expect(listStatuses(sessionId).map(rendered)).toEqual([
			...frames.map((f) => f.text),
			null
		])
	})
})

describe("a preview", () => {
	it("emits no status — nobody is watching a token estimate type", async () => {
		const sessionId = await makeChatSession("preview")
		broadcasts.length = 0
		events.length = 0
		const { promptTokenCountHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await promptTokenCountHandler.handler(
			fakeSocket(userId),
			{ sessionId, content: "and the gate?", role: "user" },
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		expect(rowStatuses(sessionId)).toEqual([])
		expect(listStatuses(sessionId)).toEqual([])
		expect(
			events.some(
				(e) => e.event === "pipelines:progress" && e.data?.status
			)
		).toBe(false)
	})
})

describe("an envoy's turn", () => {
	it("resolves {speaker} to the envoy's name — Guide is typing", async () => {
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(userId),
			{
				session: {
					name: "guide statuses",
					genreId: "core:genre/guide"
				},
				characterIds: [],
				personaIds: [],
				characterPositions: {},
				tags: []
			} as any,
			emit
		)
		expect(created?.error, created?.error).toBeUndefined()
		const sessionId = created.session.id as number
		await db.insert(schema.sessionMessages).values({
			sessionId,
			userId,
			role: "user",
			content: "where are my characters?"
		} as any)
		broadcasts.length = 0
		// Held mid-stream, as the chat case is: the envoy's name is resolved
		// once the placeholder says who (the run decides the speaker since
		// 2026-09-21, not the trigger), and an unheld fake finishes the whole
		// reply inside that lookup — a race no model is fast enough to win.
		armHold()
		const running = trigger(sessionId, "envoy:mascot")
		await untilFirstChunk()
		// The envoy's name is three reads (the session's genre, the declared
		// envoys, the owner's language) and the fake streams its first chunk
		// before they land: the hold is what lets the status reach the row.
		await expect
			.poll(() => rowStatuses(sessionId).map(rendered), { timeout: 5000 })
			.toContain("Guide is typing")
		releaseStream!()
		const res: any = await running
		expect(res?.error, res?.error).toBeUndefined()
		const statuses = rowStatuses(sessionId).map(rendered)
		expect(statuses).toContain("Guide is typing")
		expect(statuses.every((s) => !s!.includes("{speaker}"))).toBe(true)
	})
})
