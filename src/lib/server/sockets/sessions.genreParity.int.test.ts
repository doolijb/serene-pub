/**
 * The product promise on the start screen (PLAN-genre-restructure §1-3 /
 * §3-2, ruled 2026-10-19): a **Chat** turn and a **Story · Minimal** turn each
 * cost exactly ONE model call, and nothing structural runs around them — no
 * reckoning, no sweep, no state push, no turn-order recalculation push. The
 * card's `callsPerTurn` is what a real turn measures, so the declaration
 * and the measurement are compared here, not asserted apart.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "genre-parity-test-secret" }
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
const pushes = vi.hoisted(() => [] as Array<{ sessionId: number; event: string; payload: any }>)
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, payload: any) => {
		pushes.push({ sessionId, event, payload })
	}
}))

const compiled: any[] = []
class FakeAdapter {
	injected: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		compiled.push(p)
		return this
	}
	async generateText() {
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent("Hello there.")
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-genre-parity-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "parity-owner")).id
	// A model for Reply, else dispatch refuses before any call is counted.
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "parity-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Genre parity test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
	// The routine runtime (lane 6): a Living turn's reckoning runs after it.
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetBySeed(seedKey: string) {
	const [p] = await db
		.select({ id: schema.sessionPresets.id, callsPerTurn: schema.sessionPresets.callsPerTurn })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	expect(p, `preset ${seedKey} is seeded`).toBeTruthy()
	return p!
}

/** One character to talk to: a Story needs somebody to reply; Chat has its Assistant. */
async function aCharacter(name: string) {
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name, description: "A quiet companion.", isPersona: false }).returning()
	return c!.id
}

async function createOn(name: string, seedKey: string, characterIds: number[] = []) {
	const preset = await presetBySeed(seedKey)
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: preset.id }, characterIds, personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return { sessionId: res.session.id as number, preset }
}

async function send(sessionId: number, content: string) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return res
}

/**
 * Pushes that mean something structural ran around the reply. The turn-order
 * write is state (canon A9) and lands on every genre; what matters here is
 * that it carries nothing — no prepared entry — so it is checked apart.
 */
const STRUCTURAL = (e: string) => e.startsWith("state:") || e === "sessions:channels" || e.startsWith("proposals")

async function measureTurn(sessionId: number) {
	const calls0 = compiled.length
	const pushes0 = pushes.length
	await send(sessionId, "Tell me something.")
	const calls = compiled.length - calls0
	const structural = pushes.slice(pushes0).filter((p) => p.sessionId === sessionId && STRUCTURAL(p.event)).map((p) => p.event)
	// The turn order after the reply: nothing prepared to speak next (the
	// push before it names the speaker about to reply, which is the point).
	const turnOrders = pushes.slice(pushes0).filter((p) => p.sessionId === sessionId && p.event === "sessions:turnOrder")
	const last = turnOrders.at(-1)
	if (last) expect(last.payload?.turnOrder?.order ?? []).toEqual([])
	const rows = await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId))
	return { calls, structural, replies: rows.filter((r) => r.role === "assistant").length }
}

describe("genre parity (ruled 2026-10-19)", () => {
	it("Chat · Basic: one call, one reply, nothing structural", async () => {
		const { sessionId, preset } = await createOn("parity-chat", "core-chat-basic")
		const t = await measureTurn(sessionId)
		expect(t.replies).toBe(1)
		expect(t.calls).toBe(1)
		expect(preset.callsPerTurn).toBe(1)
		expect(t.structural).toEqual([])
	}, 120_000)

	it("Story · Minimal: costs exactly what Chat costs — one call, nothing structural", async () => {
		const { sessionId, preset } = await createOn("parity-story-minimal", "core-story-minimal", [await aCharacter("Wren")])
		const t = await measureTurn(sessionId)
		expect(t.replies).toBe(1)
		expect(t.calls).toBe(1)
		expect(preset.callsPerTurn).toBe(1)
		expect(t.structural).toEqual([])
	}, 120_000)

	// 🚧 Lane 5b: the card's number is DERIVED from what the preset registers
	// (the reply's model calls plus each per-turn routine not Off) — and a
	// real turn measures all of it: since lane 6 the routine's share runs on
	// the routine queue after the reply.
	it("the derived calls per turn agree with a real turn: Minimal and Living alike", async () => {
		const { presetDerivedNumbers } = await import("$lib/server/pipelines/registrations/derived")
		const minimal = await createOn("parity-derived-minimal", "core-story-minimal", [await aCharacter("Ash")])
		const living = await createOn("parity-derived-living", "core-story-living", [await aCharacter("Bryn")])
		const derived = await presetDerivedNumbers(db as any, [minimal.preset.id, living.preset.id])
		const m = derived.get(minimal.preset.id)!
		const l = derived.get(living.preset.id)!
		expect(m).toMatchObject({ callsPerTurn: 1, replyCalls: 1, routineCalls: 0 })
		expect(l).toMatchObject({ callsPerTurn: 2, replyCalls: 1, routineCalls: 1 })
		expect(l.perTurnRoutines).toEqual([expect.stringContaining("story-reckoning")])
		expect((await measureTurn(minimal.sessionId)).calls).toBe(m.callsPerTurn)
		expect((await measureTurn(living.sessionId)).calls).toBe(l.callsPerTurn)
	}, 120_000)

	// The reckoning is a routine (after each round, lane 3), run by the
	// routine queue once the reply has settled (lane 6).
	it("Story · Living: the reply plus one reckoning call, as the card says", async () => {
		const { sessionId, preset } = await createOn("parity-story-living", "core-story-living", [await aCharacter("Maren")])
		const t = await measureTurn(sessionId)
		expect(t.replies).toBe(1)
		expect(preset.callsPerTurn).toBe(2)
		expect(t.calls).toBe(preset.callsPerTurn)
	}, 120_000)
})
