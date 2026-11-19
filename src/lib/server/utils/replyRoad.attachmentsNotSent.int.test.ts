/**
 * DG5 (owner, 2026-11-17: "Tell the sender in plain words that attachments
 * can't be sent here"), end to end: a reply whose request carries a file the
 * connection's adapter has no code to send. The sender's line, with its
 * attachment, is already saved; the reply row fails with the sentence for
 * people, naming no adapter, connection or model. An administrator reads the
 * composed words in the row's detail.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { ATTACHMENTS_NOT_SENT_SENTENCE } from "$lib/server/pipelines/runtime/dispatch"

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
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

/** An adapter with no code that sends files (`consumesAttachments` is absent). */
class TextOnlyAdapter {
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText(): Promise<never> {
		throw new Error("a request with files must be refused before it reaches the adapter")
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: TextOnlyAdapter })
}))

let characterId: number

const frames: any[] = []
const emit = (event: string, data: any) => {
	if (event === "pipelines:progress") frames.push(data)
}

async function turn(isAdmin: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `dg5-${isAdmin ? "admin" : "member"}`)
	const [minimal] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, presetId: minimal!.id })
		.returning()
	await db.insert(schema.sessionCharacters).values({ sessionId: session.id, characterId, isActive: true })
	const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
	const line = await insertLegacy(db as any, {
		sessionId: session.id,
		userId: user.id,
		role: "user",
		content: "Look at this.",
		isGenerating: false
	} as any)
	const img = new PNG({ width: 3, height: 3 })
	for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 7) % 256
	const { createMedia } = await import("$lib/server/media")
	const { mediaPartFor } = await import("$lib/server/attachments/partData")
	const created = await createMedia(db as any, {
		userId: user.id,
		sessionId: session.id,
		bytes: PNG.sync.write(img),
		filename: "gate.png"
	})
	await appendParts(db as any, line.id, [mediaPartFor(created.file, { alt: null })])
	frames.length = 0
	const { runReply } = await import("$lib/server/utils/runReply")
	const outcome: any = await runReply({
		socket: { user: { id: user.id, isAdmin }, io: {} },
		emitToUser: emit,
		sessionId: session.id,
		userId: user.id,
		turn: { kind: "respond", characterId }
	} as any)
	const rows = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, session.id))
		.orderBy(schema.sessionMessages.id)
	const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id))
	return { outcome, rows, line, notes, terminal: frames.find((f) => f.done), user }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-dg5-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, "dg5-cards")
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Alice", description: "A knight." })
		.returning()
	characterId = character.id
	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "Secret Lab Kobold",
			type: "koboldcpp",
			baseUrl: "http://10.0.0.5:5001",
			capabilities: { overrides: { "text+image->text": "good" } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = (await ensureConnectionModel(db, conn.id, "mistral-7b.Q4_K_M.gguf"))!
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "dg5",
			isImmutable: false,
			values: { contextTokens: 32768, responseTokens: 200, temperature: 0.5 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: sampling.id
	})
	await setCapabilityDefault(db, "text+image->text", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: sampling.id
	})
}, 120_000)

afterAll(async () => {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	await fs.rm(dataDir, { recursive: true, force: true })
})

const LEAKS = /koboldcpp|Secret Lab|10\.0\.0\.5|mistral|gguf|adapter/i

describe("attachments the connection cannot send", () => {
	it("a member reads the sentence on the failed row, the refusal, the card and the notification; their line stays", async () => {
		const { outcome, rows, line, notes, terminal } = await turn(false)
		expect(outcome.ok).toBe(false)
		expect(outcome.error).toBe(ATTACHMENTS_NOT_SENT_SENTENCE)
		expect(terminal.error).toBe(ATTACHMENTS_NOT_SENT_SENTENCE)
		const failed = rows.at(-1)!
		expect(failed.role).toBe("assistant")
		expect((failed.error as any).message).toBe(ATTACHMENTS_NOT_SENT_SENTENCE)
		expect(notes.map((n) => JSON.stringify(n.vars)).join()).toContain("can't send attached files")
		// The sender's own line, with its attachment, is still in the conversation.
		expect(rows.some((r) => r.id === line.id)).toBe(true)
		expect(JSON.stringify([outcome.error, terminal])).not.toMatch(LEAKS)
		expect(JSON.stringify(notes.map((n) => n.vars))).not.toMatch(LEAKS)
	})

	it("an administrator reads the same sentence, and the composed words in the row's detail", async () => {
		const { outcome, rows } = await turn(true)
		expect(outcome.ok).toBe(false)
		const failed = rows.at(-1)!
		expect((failed.error as any).message).toBe(ATTACHMENTS_NOT_SENT_SENTENCE)
		expect((failed.error as any).connection.detail).toMatch(/no code that sends them/)
	})
})
