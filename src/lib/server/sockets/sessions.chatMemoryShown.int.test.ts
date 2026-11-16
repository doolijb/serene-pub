/**
 * 🚧 *Remember things* shows the model the notes its lines name and reads its
 * answer against them (lane lore-match), on real Chat turns with a scripted
 * model: a note returned under a name it was shown is rewritten in place,
 * never filed twice; a note it was not shown takes the text as a new
 * paragraph; with nothing named the brief has no block.
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
	return { db, getCryptoSecretKey: () => "chat-memory-shown-test-secret" }
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

/** The notes the memory call answers with, and every prompt a model was sent. */
const script = vi.hoisted(() => ({
	notes: [] as Array<{ name: string; content: string }>,
	prompts: [] as string[]
}))
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
		script.prompts.push(JSON.stringify(p))
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep an assistant's notes")
			? JSON.stringify({ notes: script.notes })
			: "Noted."
		return {
			compiledPrompt: this.injected ?? {
				prompt: "p",
				messages: undefined,
				meta: {}
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) =>
				onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-chat-memory-shown-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "chat-memory-shown-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"memory-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Chat memory shown test sampling",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 300,
				temperature: 0.2
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(
		true
	)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(
		false
	)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function chat(
	name: string,
	seedKey: string,
	fields: Record<string, unknown>
) {
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: p!.id },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	// ⏳ The retired `tasks` field, written where it lives now (PLAN-layering
	// D4): the routines' modes. Every other field as before.
	const { tasks, ...rest } = fields
	const [row] = await db
		.select({ genreFields: schema.sessions.genreFields })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({
			genreFields: {
				...((row?.genreFields ?? {}) as Record<string, unknown>),
				...rest
			}
		})
		.where(eq(schema.sessions.id, sessionId))
	if (tasks !== undefined) {
		const { applyLegacyTasks, setRoutineCadenceOptions } = await import(
			"$lib/server/utils/testDb"
		)
		await applyLegacyTasks(db as any, sessionId, tasks)
		// The old group's `every` is the memory routine's cadence option now
		// (an administrator's, R36; the upgrade does not carry it).
		const every = (tasks as { groups?: { sweep?: { every?: number } } })
			.groups?.sweep?.every
		if (typeof every === "number") {
			const { ASSISTANT_MEMORY_SPEC_ID } = await import(
				"@serene-pub/core-catalog"
			)
			const { effectiveRegistrations } = await import(
				"$lib/server/pipelines/registrations/resolve"
			)
			const memory = (await effectiveRegistrations(
				db as never,
				sessionId
			))!.effective.find((r) => r.pipeline === ASSISTANT_MEMORY_SPEC_ID)
			if (memory)
				await setRoutineCadenceOptions(
					db as any,
					sessionId,
					memory.key,
					{ n: every }
				)
		}
	}
	return sessionId
}

async function send(
	sessionId: number,
	content: string,
	notes: Array<{ name: string; content: string }>
) {
	script.notes = notes
	script.prompts.length = 0
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"./sessions"
	)
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

async function notesOf(sessionId: number) {
	const [book] = await db
		.select({ id: schema.lorebooks.id })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
	if (!book) return []
	return await db
		.select({
			title: schema.lorebookEntries.title,
			content: schema.lorebookEntries.content,
			archived: schema.lorebookEntries.archived
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, book.id))
}

const memoryPrompts = () =>
	script.prompts.filter((p) => p.includes("You keep an assistant's notes"))
const says = (prompt: string, text: string) =>
	prompt.includes(JSON.stringify(text).slice(1, -1))
const everyTurn = {
	tasks: {
		v: 1,
		groups: { sweep: { every: 1 } },
		tasks: { memory: { mode: "full" } }
	}
}

describe("Remember things and what is already kept (lane lore-match)", () => {
	it("a note the lines name is shown and, returned under its name, rewritten: one note, never two", async () => {
		const sessionId = await chat(
			"memory-shown",
			"core-chat-basic",
			everyTurn
		)
		await send(sessionId, "I have a pet called Miso.", [
			{ name: "Cat", content: "Their cat is called Miso." }
		])
		expect(
			says(memoryPrompts()[0]!, "Already kept:"),
			"nothing kept yet, no block"
		).toBe(false)
		expect(await notesOf(sessionId)).toEqual([
			expect.objectContaining({
				title: "Cat",
				content: "Their cat is called Miso."
			})
		])

		await send(sessionId, "My cat turned three today.", [
			{
				name: "cat",
				content: "Their cat is called Miso and is three years old."
			}
		])
		const [prompt] = memoryPrompts()
		expect(says(prompt!, "Already kept:")).toBe(true)
		expect(
			says(
				prompt!,
				'- {"name":"Cat","content":"Their cat is called Miso."}'
			)
		).toBe(true)
		expect(await notesOf(sessionId)).toEqual([
			expect.objectContaining({
				title: "Cat",
				content: "Their cat is called Miso and is three years old.",
				archived: false
			})
		])
	}, 240_000)

	it("a note the model was not shown takes the text as a new paragraph", async () => {
		const sessionId = await chat(
			"memory-unshown",
			"core-chat-basic",
			everyTurn
		)
		await send(sessionId, "I drink it green, no sugar.", [
			{ name: "Tea", content: "Likes green tea, no sugar." }
		])
		await send(sessionId, "Oolong sometimes, too.", [
			{ name: "Tea", content: "Drinks oolong sometimes." }
		])
		expect(
			says(memoryPrompts()[0]!, "Already kept:"),
			"no line names the note"
		).toBe(false)
		expect(await notesOf(sessionId)).toEqual([
			expect.objectContaining({
				title: "Tea",
				content:
					"Likes green tea, no sugar.\n\nDrinks oolong sometimes."
			})
		])
	}, 240_000)
})
