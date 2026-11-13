import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { insertCastMember } from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let memberId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		getCryptoSecretKey: () => "prompt-token-count-cardless-secret"
	}
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-ptc-cardless-")
	)
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
		.values({ username: "ptc-cardless-user", isAdmin: true })
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

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "PTC Cardless Lore", userId })
		.returning()
	const { member } = await insertCastMember(db, {
		lorebookId: lorebook.id,
		binding: "{{char:ptc}}",
		characterId: null,
		name: "Wren",
		ownName: "Wren"
	} as never)
	memberId = member!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id
	// The only seat: a card-less character seat.
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: null,
		castMemberId: memberId,
		isActive: true
	})
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Have you seen the ashguard?"
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("sessions:promptTokenCount for a card-less seat", () => {
	test("compiles for the card-less seat instead of answering 'No character available'", async () => {
		const { promptTokenCountHandler } = await import("./sessions")
		const res = (await promptTokenCountHandler.handler(
			fakeSocket(userId),
			{ sessionId, content: "Have you seen the ashguard?" } as any,
			noopEmit
		)) as any
		expect(res.error).toBeUndefined()
		// Compiled for the card-less seat: its member's name is in the prompt.
		const text = (res.messages ?? [])
			.map((m: { content: string }) => m.content)
			.join("\n")
		expect(text).toContain("Wren")
	})
})
