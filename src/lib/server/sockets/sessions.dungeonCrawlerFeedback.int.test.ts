/**
 * 🚧 Dungeon Crawler's **"a reply is on its way"** (owner 2026-10-15: "I'm
 * not seeing the visual feedback that a message is being processed, like in
 * the chat genre") — over the REAL send road, against the SHIPPED story
 * turn, a fake adapter whose Planner call takes its time.
 *
 * The Narrator's row opens only after the Planner's call and the dice (the
 * roll line lands above it), so what the player sees before then is the
 * run's own word for what it is doing, from its first step:
 *
 *  1. every status frame the session's users hear says the run is a reply
 *     on Story (`reply: { channel: 'main' }`) — what the page draws its
 *     waiting row from (`pendingReply.ts`) — and the run's end says `null`;
 *  2. while the Planner's call runs, the run's status already reads *The
 *     Planner is thinking* (the registry and the session's frames) and no
 *     row on Story is generating yet;
 *  3. the statuses then move on — *Rolling the dice*, *The Planner keeps the
 *     books*, *The Narrator tells it* — and by the Narrator's call its row is
 *     open and generating.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const PLANNER_DELAY_MS = 150

/** What the session list heard, in order. */
const frames: Array<{ event: string; runId?: string; status: unknown; reply?: { channel: string } }> = []
/** What the run's caller heard (`pipelines:runStarted` / `pipelines:progress`), in order. */
const emitted: Array<{ event: string; payload: any }> = []
/** The world as each model call found it. */
const seen: Record<string, { generatingOnStory: number; status: string | undefined; storyRows: number }> = {}

async function snapshot(at: string) {
	const { statusesBySession } = await import("$lib/server/pipelines/runtime/runRegistry")
	const rows = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, currentSession))
	const story = rows.filter((r) => (r.channel ?? "main") === "main")
	const status = statusesBySession().get(currentSession) as any
	seen[at] = {
		generatingOnStory: story.filter((r) => r.isGenerating).length,
		status: status?.i18n?.en,
		storyRows: story.length
	}
}
let currentSession = 0

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "dungeon-crawler-rounds-test-secret" }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	// The session list's status frames, in order (`sessions:runStatus`).
	broadcastToSessionUsers: async (_io: unknown, _sessionId: number, event: string, payload: any) => {
		if (event === "sessions:runStatus")
			frames.push({ event, runId: payload?.runId, status: payload?.status ?? null, reply: payload?.reply })
	}
}))

const CLASSES = { question: "Which calling?", options: [{ key: "ranger", label: "Ranger" }, { key: "thief", label: "Thief" }] }
const SHEET = {
	name: "", class: "", abilities: ["Track", "Shoot"], gear: ["Bow", "Rope"], hp: 15,
	backstory: "Grew up in the marches.", shape: "", difficulty: "", goalMode: ""
}
const WORLD = {
	goal: "Find the drowned king.",
	rooms: [
		{ id: "gate", name: "The Sunken Gate", description: "Wet stone and a rusted portcullis.", exits: ["The Hall"] },
		{ id: "hall", name: "The Hall", description: "Pillars in black water.", exits: ["The Sunken Gate"] }
	],
	npcs: [{ name: "Moss", description: "A wary ferryman who speaks in riddles." }],
	leads: ["A bell rings below."],
	notes: "The king is not dead."
}
const OPENING = "Water laps at your boots as the portcullis groans."
const PLANNER_SAYS = "Dice here are rolled in the open, and the stakes come first."

/** The story turn's hidden Planner: one secret, for the guest's seat (set per test). */
const PLANNER_BOOKS: Record<string, unknown> = {
	deltas: [], world: { rooms: [], npcs: [], leads: [], goalProgress: "none", notes: "" },
	clock: { minutes: 5 }, secrets: [], narratorBrief: "They wait.", roundSummary: "The party waited."
}

/** Every call the fake model took: its prompt. */
const calls: string[] = []

class FakeAdapter {
	injected: any
	responseFormat: any
	aborted = false
	abort() {
		this.aborted = true
	}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const prompt = JSON.stringify(this.injected ?? "")
		calls.push(prompt)
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (prompt.includes("keep the books out of sight")) {
					await snapshot("planner")
					// The Planner takes its time: the player must see it working.
					await new Promise((r) => setTimeout(r, PLANNER_DELAY_MS))
					await snapshot("planner-done")
					return onContent(JSON.stringify(PLANNER_BOOKS))
				}
				if (!prompt.includes("Offer three") && !prompt.includes("writing a player's") && !prompt.includes("you build the world") && !prompt.includes("keeping one player's") && !prompt.includes("the story is about to begin") && !prompt.includes("You are talking with one player"))
					await snapshot("narrator")
				if (prompt.includes("Offer three to five classes")) return onContent(JSON.stringify(CLASSES))
				if (prompt.includes("writing a player's character sheet")) return onContent(JSON.stringify(SHEET))
				if (prompt.includes("you build the world they walk into")) return onContent(JSON.stringify(WORLD))
				if (prompt.includes("keeping one player's character sheet"))
					return onContent(JSON.stringify({ standingOrder: "", abilities: [], gear: [] }))
				if (prompt.includes("the story is about to begin")) return onContent(OPENING)
				if (prompt.includes("keep the books out of sight")) return onContent(JSON.stringify(PLANNER_BOOKS))
				if (prompt.includes("You are talking with one player")) return onContent(PLANNER_SAYS)
				onContent("The Narrator speaks.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
let guestId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any

function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-rounds-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "dc-owner")).id
	guestId = (await createTestUser(db, "dc-guest")).id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "dc-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Dungeon Crawler test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

async function createSession(name: string) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: preset!.id },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	// 🚧 The fixtures seat characters directly, standing in for the sheet —
	// so Story opens here as the applied sheet opens it (composer states,
	// owner ruling 2026-10-15; the sheet's own open is pinned in
	// sessions.dungeonCrawler.int.test.ts).
	await db.update(schema.sessions).set({ composerStates: {} }).where(eq(schema.sessions.id, res.session.id))
	return res.session.id as number
}

const rowsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

async function annexOf(sessionId: number) {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return ((row!.annex as any)?.core ?? {}) as Record<string, any>
}

const emit = (event: string, payload: any) => {
	emitted.push({ event, payload })
}

const enOf = (s: any): string | undefined => (s == null ? undefined : (s.i18n?.en ?? s.en))
const distinct = (xs: Array<string | undefined>) =>
	xs.filter((x, i) => x !== undefined && x !== xs[i - 1]) as string[]

describe("a story turn says it is working from its first step", () => {
	it("the status reads 'The Planner is thinking' through the Planner's call, before the Narrator's row opens; then the dice, the books, the Narrator", async () => {
		const sessionId = await createSession("feedback")
		currentSession = sessionId
		await db.insert(schema.sessionPersonas).values({ sessionId, userId: ownerId, seatName: "Ann" } as any)
		emitted.length = 0
		frames.length = 0
		const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
		const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(ownerId),
			{ sessionId, content: "Ann lights a torch.", channel: "main" } as any,
			emit as any
		)
		expect(res?.error, res?.error).toBeUndefined()
		await settle()

		// 1. The reply's frames say so, on Story, from the first; then its end.
		const respond = frames.filter((f) => f.reply)
		expect(respond.length).toBeGreaterThan(0)
		const runId = respond[0]!.runId
		const ofRun = frames.filter((f) => f.runId === runId)
		expect(ofRun.every((f) => f.reply?.channel === "main")).toBe(true)
		expect(ofRun.at(-1)!.status).toBeNull()

		// 2. Through the Planner's call: working, out loud, with no row yet.
		// A11 (2026-10-18): the Narrator's row opens BEFORE the Planner is asked, so a line sent meanwhile is not lost.
		expect(seen.planner).toMatchObject({ generatingOnStory: 1, status: "The Planner is thinking" })
		expect(seen["planner-done"]).toMatchObject({ generatingOnStory: 1, status: "The Planner is thinking" })

		// 3. The Narrator's call: its row is open and generating.
		expect(seen.narrator?.generatingOnStory).toBe(1)
		expect(seen.narrator?.status).toBe("The Narrator tells it")

		// The stages, in order, as the session's users heard them.
		expect(distinct(ofRun.map((f) => enOf(f.status)))).toEqual([
			"The Planner is thinking",
			"Settling the round",
			"The Planner keeps the books",
			"The Narrator tells it"
		])

		// And the turn still lands: the Narrator's line, filled, last on Story.
		const story = (
			await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId)).orderBy(asc(schema.sessionMessages.id))
		).filter((r) => (r.channel ?? "main") === "main")
		expect(story.at(-1)!.content).toBe("The Narrator speaks.")
		expect(story.at(-1)!.isGenerating).toBe(false)
	})
})
