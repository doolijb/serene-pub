/**
 * `sessions:promptTokenCount` when the preview compiled no prompt: only an
 * administrator reads the halt's reason and node; everyone else reads plain
 * words and is pointed at an administrator.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let guestId: number
let sessionId: number

const REASON =
	"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded"
const NODE = "respond.render"
const PLAIN =
	"The prompt could not be compiled. An administrator can see the details."

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

vi.mock("$lib/server/pipelines/runtime/runTurn", async (importOriginal) => ({
	...(await importOriginal<any>()),
	runTurn: vi.fn(async () => ({
		outcome: "halt",
		haltNodeKey: "respond.render",
		haltReason:
			"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded",
		nodes: []
	}))
}))

const fakeSocket = (id: number, isAdmin: boolean) =>
	({
		user: { id, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-ptc-halt-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "ptch-user", isAdmin: true })
		.returning()
	userId = user.id
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
	const [model] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: connection.id, model: "irrelevant", name: "irrelevant" })
		.returning()
	const [sampling] = await db.select().from(schema.samplingConfigs).limit(1)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		connectionModelId: model.id,
		samplingConfigId: sampling?.id ?? null
	})
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Ash", description: "A rider." })
		.returning()
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId, isPersona: true, name: "Rell", description: "A cartographer." })
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "PTCH Lore", userId })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id
	const [guest] = await db
		.insert(schema.users)
		.values({ username: "ptch-guest", isAdmin: false })
		.returning()
	guestId = guest.id
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: character.id, isActive: true })
	await db.insert(schema.sessionPersonas).values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Hello.",
		personaId: persona.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const countAs = async (socket: any) => {
	const { promptTokenCountHandler } = await import("./sessions")
	return (await promptTokenCountHandler.handler(
		socket,
		{ sessionId, content: "Hello." } as any,
		() => {}
	)) as any
}

describe("sessions:promptTokenCount — a preview that compiled nothing", () => {
	// DG2: a non-administrator is answered before anything compiles, so
	// there is no halt for them to read about and no error either.
	test("a non-administrator owner is answered with nothing", async () => {
		await db.update(schema.users).set({ isAdmin: false }).where(eq(schema.users.id, userId))
		try {
			expect(await countAs(fakeSocket(userId, false))).toEqual({})
		} finally {
			await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, userId))
		}
	}, 60_000)

	test("a guest is answered with nothing", async () => {
		expect(await countAs(fakeSocket(guestId, false))).toEqual({})
	}, 60_000)

	test("an administrator reads the outcome, the node and the reason", async () => {
		const res = await countAs(fakeSocket(userId, true))
		expect(res.error).toBe(
			`The prompt could not be compiled: halt at '${NODE}' — ${REASON}`
		)
	}, 60_000)
})
