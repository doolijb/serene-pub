/**
 * 🚧 Chat's memory and its filing tools (★K; PLAN-genre-restructure §1-2,
 * lane 2, 2026-10-19), on real turns with a scripted model: *Remember things*
 * files what the person told the Assistant every few turns — into the
 * session's own notes, made on first use, when no lorebook of theirs is
 * attached — and on Agentic the `remember` / `forget` tools file and take
 * back a note through the host's door, Review holding it in the session's
 * own notes. The tools are offered only where the session switched them on.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "chat-memory-test-secret" }
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

/** The tool the Agentic loop asks for on its first pass; null answers plainly. */
const script = vi.hoisted(() => ({ tool: null as null | { tool: string; args: Record<string, unknown> } }))
const prompts: string[] = []
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
		prompts.push(JSON.stringify(p))
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep an assistant's notes")
			? JSON.stringify({ notes: [{ name: "Cat", content: "Their cat is called Miso." }] })
			: asked.includes("You may use the tools listed below") && !asked.includes("What your tools have returned so far") && script.tool
				? "```tool_call\n" + JSON.stringify(script.tool) + "\n```"
				: "Noted."
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(text)
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-chat-memory-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "chat-memory-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "memory-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Chat memory test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function chat(name: string, seedKey: string, fields: Record<string, unknown>) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: p!.id }, characterIds: [], personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	// ⏳ The retired `tasks` field, written where it lives now (PLAN-layering
	// D4): the routines' modes. Every other field as before.
	const { tasks, ...rest } = fields
	const [row] = await db.select({ genreFields: schema.sessions.genreFields }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({ genreFields: { ...((row?.genreFields ?? {}) as Record<string, unknown>), ...rest } })
		.where(eq(schema.sessions.id, sessionId))
	if (tasks !== undefined) {
		const { applyLegacyTasks, setRoutineCadenceOptions } = await import("$lib/server/utils/testDb")
		await applyLegacyTasks(db as any, sessionId, tasks)
		// The old group's `every` is the memory routine's cadence option now
		// (an administrator's, R36; the upgrade does not carry it).
		const every = (tasks as { groups?: { sweep?: { every?: number } } }).groups?.sweep?.every
		if (typeof every === "number") {
			const { ASSISTANT_MEMORY_SPEC_ID } = await import("@serene-pub/core-catalog")
			const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
			const memory = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === ASSISTANT_MEMORY_SPEC_ID)
			if (memory) await setRoutineCadenceOptions(db as any, sessionId, memory.key, { n: every })
		}
	}
	return sessionId
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
}

async function notesOf(sessionId: number) {
	const [book] = await db.select({ id: schema.lorebooks.id }).from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))
	if (!book) return []
	return await db
		.select({ title: schema.lorebookEntries.title, content: schema.lorebookEntries.content, archived: schema.lorebookEntries.archived })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, book.id))
}

describe("Chat's memory (lane 2)", () => {
	// *Remember things* is a routine since PLAN-layering (lanes 3, 6):
	// `core:spec/assistant-memory`, every N turns, run by the routine queue
	// once the reply has settled.
	it("Remember things on Full files a note in the session's own notes, made on first use — with no lorebook attached", async () => {
		const sessionId = await chat("memory-sweep", "core-chat-basic", {
			tasks: { v: 1, groups: { sweep: { every: 1 } }, tasks: { memory: { mode: "full" } } }
		})
		expect(await notesOf(sessionId)).toEqual([])
		await send(sessionId, "My cat is called Miso.")
		expect(await notesOf(sessionId)).toEqual([expect.objectContaining({ title: "Cat", content: "Their cat is called Miso.", archived: false })])
	}, 180_000)

	it("off: nothing is noted", async () => {
		const sessionId = await chat("memory-off", "core-chat-basic", { tasks: { v: 1, groups: { sweep: { every: 1 } }, tasks: {} } })
		await send(sessionId, "My dog is called Pip.")
		expect(await notesOf(sessionId)).toEqual([])
	}, 180_000)

	it("Agentic: remember files a note through the host's door (Review: the session's own notes), forget takes it back", async () => {
		const sessionId = await chat("memory-tools", "core-chat-agentic", {
			tools: ["lorebook-write"],
			tasks: { v: 1, groups: { sweep: { every: 99 } }, tasks: { memory: { mode: "review" } } }
		})
		script.tool = { tool: "remember", args: { name: "Tea", content: "Likes green tea, no sugar." } }
		await send(sessionId, "Remember that I like green tea.")
		expect(await notesOf(sessionId)).toEqual([expect.objectContaining({ title: "Tea", archived: false })])
		expect(prompts.some((p) => p.includes("waiting for the person"))).toBe(true)

		script.tool = { tool: "forget", args: { name: "Tea" } }
		await send(sessionId, "Forget the tea thing.")
		expect(await notesOf(sessionId)).toEqual([expect.objectContaining({ title: "Tea", archived: true })])
		script.tool = null
	}, 240_000)

	it("the filing tools are offered only where the session switched them on", async () => {
		const { writeToolsAllowed } = await import("$lib/server/pipelines/runtime/tools/writeTools")
		const none = await chat("tools-none", "core-chat-agentic", { tools: ["clock"], tasks: { v: 1, tasks: {} } })
		expect([...(await writeToolsAllowed(db as any, none))]).toEqual([])
		const memory = await chat("tools-memory", "core-chat-agentic", { tools: ["clock"], tasks: { v: 1, tasks: { memory: { mode: "full" } } } })
		expect([...(await writeToolsAllowed(db as any, memory))].sort()).toEqual(["forget", "remember"])
		const all = await chat("tools-all", "core-chat-agentic", { tools: ["lorebook-write", "image"], tasks: { v: 1, tasks: {} } })
		expect([...(await writeToolsAllowed(db as any, all))].sort()).toEqual(["forget", "generate_image", "remember", "write_entry"])
	}, 180_000)
})
