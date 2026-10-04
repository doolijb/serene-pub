/**
 * `sessions:promptTokenCount`, the live draft preview.
 *
 * It used to construct an adapter and call `compilePrompt`, which ran the legacy
 * 0.5 retrieval paths — so the number on screen came from a code path that no longer
 * generated any replies. It was the last live consumer of that path and the
 * reason it could not be deleted. It now compiles through
 * `runTurn({ preview: true })` — the same document the next turn runs, halted
 * at the pre-call substrate and dry (09-B B4: a preview performs no writes, so
 * the spec's placeholder outlet commits nothing) — so the count reflects the
 * compilation the next turn will actually perform.
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
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

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
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "ptc-user", isAdmin: true })
		.returning()
	userId = user.id

	// No model is reached — the handler previews and halts before the provider —
	// but a pair has to resolve or it refuses before ever getting there.
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Preview Only",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [previewModel] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId: connection.id,
			model: "irrelevant",
			name: "irrelevant"
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
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		connectionModelId: previewModel.id,
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
		.insert(schema.characters)
		.values({
			userId,
			isPersona: true,
			name: "Rell",
			description: "A cartographer."
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "PTC Lore", userId })
		.returning()
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "Riders who patrol the ash wastes."
			}
		])
	)

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: character.id,
		isActive: true,
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

/**
 * The payload's text, whichever wire shape it came back in.
 *
 * ⚠ The fixture connection is a plain Ollama row with nothing switched, which
 * resolves to CHAT wire mode — the default, and what a real user gets. So the
 * handler answers with `messages`, not with `prompt`, and the response contract
 * has always carried both (`Sockets.Sessions.PromptTokenCount.Response`) because
 * the session page renders either.
 *
 * These cases are about what the preview CONTAINS — the draft mid-keystroke, a
 * heading from a `pipeline_variable_templates` row — and that is the same fact
 * in both shapes. Pinning the fixture to completion mode to keep reading a
 * string would have tested the shape a default connection does not use.
 */
const promptText = (res: any): string =>
	typeof res.prompt === "string"
		? res.prompt
		: (res.messages ?? [])
				.map((m: { content: string }) => m.content)
				.join("\n")

describe("sessions:promptTokenCount compiles through the pipeline", () => {
	test("returns a compiled payload rather than an error", async () => {
		const res = await count()
		expect(res.error).toBeUndefined()
		// Chat wire mode, which is what this connection resolves to and what the
		// session page's preview renders as a list of turns.
		expect(Array.isArray(res.messages)).toBe(true)
		expect(res.messages.length).toBeGreaterThan(0)
		expect(promptText(res).length).toBeGreaterThan(0)
	})

	test("the prompt is the pipeline's, laid out by the layout rows", async () => {
		// The heading comes from a `pipeline_variable_templates` row, not from
		// the context template — so finding it proves the config layer resolved,
		// which is the half a preview could otherwise skip.
		const res = await count()
		expect(promptText(res)).toContain(
			"Assistant Characters (AI-controlled):"
		)
		expect(promptText(res)).toContain("Ash")
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
		expect(promptText(res)).toContain("ashguard's brand")
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

/**
 * Owner note 16 (2026-10-02): review switched on for respond's create-message
 * node (`placeholder`, step 2) gave several review prompts per turn. The
 * placeholder sits BEFORE the preview halt, and this handler previews on every
 * keystroke's debounce — so each count parked a card the person never asked
 * for. A preview is dry: it must pass the gate without parking.
 */
describe("a preview never parks on a review gate", () => {
	test(
		"review on for the placeholder: the count returns and nothing waits",
		async () => {
			const { pendingReviewsFor } = await import(
				"$lib/server/pipelines/runtime/reviewGate"
			)
			const [respond] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
			const configs = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, respond.id))
			expect(configs.length).toBeGreaterThan(0)
			for (const c of configs)
				await db
					.insert(schema.pipelineConfigValues)
					.values({
						configId: c.id,
						nodeKey: "placeholder",
						slot: "settings",
						path: "review",
						value: "on"
					})
					.onConflictDoNothing()

			// Raced: before the fix the preview parked forever on the gate.
			const res = await Promise.race([
				count(),
				new Promise((r) => setTimeout(() => r("parked"), 30_000))
			])
			expect(res).not.toBe("parked")
			expect((res as any).error).toBeUndefined()
			expect(pendingReviewsFor(userId)).toEqual([])
		},
		60_000
	)
})
