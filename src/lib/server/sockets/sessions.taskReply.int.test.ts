/**
 * 🚧 The **reply group** of a session's background tasks (PLAN-genre-restructure
 * §4, lane 2, 2026-10-19), on a real turn: *Read the lorebook* decides
 * whether the lorebook's entries reach the reply's prompt (Story and Chat),
 * and *Read the scene* whether the place the story is in does. Neither adds
 * a model call. Minimal keeps reading the lorebook — a migrated roleplay
 * Chat replies exactly as before — and never reads the scene.
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
	return { db, getCryptoSecretKey: () => "task-reply-test-secret" }
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
let bookId: number
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-task-reply-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "task-reply-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reply-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Task reply test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })

	// One book: a keyed lore entry and one place.
	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "Vael" }).returning()
	bookId = book!.id
	const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
	await db.insert(schema.lorebookEntries).values(
		entryInsert({
			typeId: "core:entry/world-lore",
			lorebookId: bookId,
			name: "The Lantern of Vael",
			content: "The Lantern of Vael burns blue when the dead are near.",
			keys: ["lantern"],
			position: 1
		} as any)
	)
	await db.insert(schema.lorebookEntries).values(
		entryInsert({
			typeId: "core:entry/location",
			lorebookId: bookId,
			name: "The Crypt",
			content: "A cold vault under the chapel, its floor wet with seep.",
			position: 1
		} as any)
	)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	expect(p, `preset ${seedKey} is seeded`).toBeTruthy()
	return p!.id
}

async function aCharacter(name: string) {
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name, description: "A quiet companion.", isPersona: false }).returning()
	return c!.id
}

async function createOn(name: string, seedKey: string, characterIds: number[] = []) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: await presetId(seedKey) }, characterIds, personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db.update(schema.sessions).set({ lorebookId: bookId }).where(eq(schema.sessions.id, sessionId))
	return sessionId
}

/** The session's own task choices (the `tasks` field), over its preset's. */
async function setTasks(sessionId: number, tasks: Record<string, "full" | "review" | "off">) {
	// ⏳ Written where the retired tasks live now (PLAN-layering D4).
	const { applyLegacyTasks } = await import("$lib/server/utils/testDb")
	await applyLegacyTasks(db, sessionId, {
		v: 1,
		tasks: Object.fromEntries(Object.entries(tasks).map(([k, mode]) => [k, { mode }]))
	})
}

/** The reply's prompt for one turn, as text — the first compiled prompt of the turn. */
async function replyPrompt(sessionId: number, content: string): Promise<{ text: string; calls: number }> {
	const before = compiled.length
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const turn = compiled.slice(before)
	expect(turn.length, "a reply was asked for").toBeGreaterThan(0)
	return { text: JSON.stringify(turn[0]), calls: turn.length }
}

describe("the reply group (lane 2)", () => {
	it("Story · Minimal reads the lorebook by default; Read the lorebook Off keeps it out; one call either way", async () => {
		const sessionId = await createOn("reply-lore", "core-story-minimal", [await aCharacter("Wren")])
		const on = await replyPrompt(sessionId, "Tell me about the lantern.")
		expect(on.text).toContain("burns blue")
		expect(on.calls).toBe(1)
		expect(on.text).not.toContain("Where the story is now")

		await setTasks(sessionId, { "lore-retrieval": "off" })
		const off = await replyPrompt(sessionId, "And the lantern again?")
		expect(off.text).not.toContain("burns blue")
		expect(off.calls).toBe(1)
	}, 180_000)

	it("Read the scene puts the place the world's location names into the reply; Off leaves it out", async () => {
		const sessionId = await createOn("reply-scene", "core-story-minimal", [await aCharacter("Maren")])
		const { stateSet } = await import("./state")
		const set: any = await stateSet.handler(
			fakeSocket(ownerId),
			{ sessionId, owner: { kind: "session", id: sessionId }, slotId: "core:slot/location@1", value: "The Crypt" },
			emit
		)
		expect(set?.error, set?.error).toBeUndefined()

		const off = await replyPrompt(sessionId, "Where are we?")
		expect(off.text).not.toContain("Where the story is now")

		await setTasks(sessionId, { "scene-reading": "full", "lore-retrieval": "full" })
		const on = await replyPrompt(sessionId, "Where are we now?")
		expect(on.text).toContain("Where the story is now")
		expect(on.text).toContain("A cold vault under the chapel")
		expect(on.calls).toBe(1)
	}, 180_000)

	it("Chat: Read the lorebook Off keeps the attached book's excerpts out", async () => {
		const sessionId = await createOn("reply-chat", "core-chat-basic")
		const on = await replyPrompt(sessionId, "What does the lantern do?")
		expect(on.text).toContain("burns blue")
		await setTasks(sessionId, { "lore-retrieval": "off" })
		const off = await replyPrompt(sessionId, "Remind me about the lantern.")
		expect(off.text).not.toContain("burns blue")
		expect(off.calls).toBe(1)
	}, 180_000)
})
