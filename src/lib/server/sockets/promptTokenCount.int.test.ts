/**
 * `sessions:promptTokenCount`, the live draft preview.
 *
 * It used to construct an adapter and call `compilePrompt`, which ran the legacy
 * infill engines — so the number on screen came from a code path that no longer
 * generated any replies. It was the last live consumer of that path and the
 * reason it could not be deleted. It now compiles through
 * `runTurn({ preview: true })`, the same recipe `generateResponse` uses, so the
 * count reflects the compilation the next turn will actually perform.
 *
 * That rewrite shipped on the strength of "it reuses a recipe proven elsewhere",
 * which is inference rather than coverage. This is the coverage: the handler
 * runs, returns a prompt, and returns the metadata the debug panel reads —
 * including `meta.retrieval`, which replaced the legacy `meta.rag`.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "prompt-token-count-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const fakeSocket = (id: number) =>
	({
		user: { id, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-ptc-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "ptc-user", isAdmin: true })
		.returning()
	userId = user.id

	// No model is reached — the handler previews and halts before the provider —
	// but a connection has to resolve or it refuses before ever getting there.
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Preview Only",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			model: "irrelevant",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [sampling] = await db.select().from(schema.samplingConfigs).limit(1)
	// The instance default: a `connection_defaults` row keyed by capability since
	// 0181, where it used to be two `system_settings` columns. The preview
	// resolves its connection through the same chain a real turn does, so
	// without this registration it refuses rather than quietly using the only
	// connection in the table.
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db as any, "text->text", {
		connectionId: connection.id,
		samplingConfigId: sampling?.id ?? null
	})

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Ash",
			description: "A rider who patrols the ash wastes."
		})
		.returning()
	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer."
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "PTC Lore", userId })
		.returning()
	await db.insert(schema.worldLoreEntries).values({
		lorebookId: lorebook.id,
		retrievalStrategy: "keyword",
		name: "The Ashguard",
		keys: "ashguard",
		content: "Riders who patrol the ash wastes."
	})

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: character.id,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Have you seen the ashguard?",
		personaId: persona.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const count = async (content = "Have you seen the ashguard?") => {
	const { promptTokenCountHandler } = await import("./sessions")
	return (await promptTokenCountHandler.handler(
		fakeSocket(userId),
		{ sessionId, content } as any,
		noopEmit
	)) as any
}

describe("sessions:promptTokenCount compiles through the pipeline", () => {
	test("returns a prompt rather than an error", async () => {
		const res = await count()
		expect(res.error).toBeUndefined()
		expect(typeof res.prompt).toBe("string")
		expect(res.prompt.length).toBeGreaterThan(0)
	})

	test("the prompt is the pipeline's, laid out by the layout rows", async () => {
		// The heading comes from a `pipeline_variable_templates` row, not from
		// the context template — so finding it proves the config layer resolved,
		// which is the half a preview could otherwise skip.
		const res = await count()
		expect(res.prompt).toContain("Assistant Characters (AI-controlled):")
		expect(res.prompt).toContain("Ash")
	})

	test("counts tokens against a real budget", async () => {
		const res = await count()
		expect(res.meta.tokenCounts.total).toBeGreaterThan(0)
		expect(res.meta.tokenCounts.limit).toBeGreaterThan(0)
	})

	test("carries the retrieval trail the panel renders", async () => {
		// `meta.rag` is gone with the engines; this is what replaced it. An
		// absent `retrieval` renders the panel's section blank with no error,
		// which is precisely how the old one would have failed unnoticed.
		const res = await count()
		expect(Array.isArray(res.meta.retrieval?.blocks)).toBe(true)
		expect(res.meta.retrieval.budget).toBeTruthy()
	})

	test("includes the draft the user is still typing", async () => {
		// The whole point of the handler: it fires on a debounce mid-keystroke,
		// so the count has to reflect text that is not a row yet.
		const res = await count("tell me about the ashguard's brand")
		expect(res.prompt).toContain("ashguard's brand")
	})

	test("writes nothing — it is a preview", async () => {
		const before = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		await count()
		const after = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(after.length).toBe(before.length)
	})
})
