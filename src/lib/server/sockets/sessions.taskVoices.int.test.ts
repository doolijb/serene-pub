/**
 * 🚧 The **extra voices** (PLAN-genre-restructure §4, lane 2, 2026-10-19), on
 * a real Story send with auto-advance on Round: once the round is over, *Let
 * others speak up* gives one character who did not speak last one more line,
 * and *Narrator asides* has the narrator add one (the Narrate action) —
 * each at most once a round, written into the turn order (canon A9) and
 * fired by auto-advance, never decided by the reply. Off, a round is exactly
 * its cast.
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
	return { db, getCryptoSecretKey: () => "task-voices-test-secret" }
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
	broadcastToSessionUsers: async () => {}
}))

let calls = 0
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
		calls++
		return this
	}
	async generateText() {
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent("A line.")
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
	const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
	// Auto-advance re-enters through the events it causes: settle until quiet.
	for (let i = 0; i < 12; i++) await settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-task-voices-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "task-voices-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "voices-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Task voices test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function minimalWithTwo(name: string, tasks: Record<string, "full" | "off">) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	const ids: number[] = []
	for (const n of ["Ash", "Bram"]) {
		const [c] = await db.insert(schema.characters).values({ userId: ownerId, name: `${n} ${name}`, description: "A traveller.", isPersona: false }).returning()
		ids.push(c!.id)
	}
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: p!.id }, characterIds: ids, personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	const [row] = await db.select({ genreFields: schema.sessions.genreFields }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({
			genreFields: {
				...((row?.genreFields ?? {}) as Record<string, unknown>),
				autoAdvance: "round"
			}
		})
		.where(eq(schema.sessions.id, sessionId))
	// ⏳ The retired voices tasks, written where they live now: the genre
	// fields `sideCast` / `narratorInterjections` (PLAN-layering D4).
	const { applyLegacyTasks } = await import("$lib/server/utils/testDb")
	await applyLegacyTasks(db, sessionId, {
		v: 1,
		tasks: Object.fromEntries(Object.entries(tasks).map(([k, mode]) => [k, { mode }]))
	})
	return { sessionId, ids }
}

async function send(sessionId: number) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const before = calls
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content: "Well?", channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const rows = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)
	const at = rows.map((r) => r.role).lastIndexOf("user")
	return { since: rows.slice(at + 1), calls: calls - before }
}

describe("the extra voices (lane 2)", () => {
	it("off: the round is its cast — two characters, two lines", async () => {
		const { sessionId } = await minimalWithTwo("voices-off", {})
		const t = await send(sessionId)
		expect(t.since.filter((r) => r.role === "assistant" && !r.isNarratorResponse)).toHaveLength(2)
		expect(t.since.some((r) => r.isNarratorResponse)).toBe(false)
		expect(t.calls).toBe(2)
	}, 240_000)

	it("on: after the round one character speaks up and the narrator adds a line — once each", async () => {
		const { sessionId, ids } = await minimalWithTwo("voices-on", { "side-cast": "full", "narrator-interjections": "full" })
		const t = await send(sessionId)
		const lines = t.since.filter((r) => r.role === "assistant" && !r.isNarratorResponse)
		expect(lines.map((r) => r.characterId)).toEqual([ids[0], ids[1], ids[0]])
		expect(t.since.filter((r) => r.isNarratorResponse)).toHaveLength(1)
		expect(t.calls, "two extra calls a round, no more").toBe(4)

		// A new round: the same again, never more.
		const again = await send(sessionId)
		expect(again.calls).toBe(4)
	}, 240_000)
})
