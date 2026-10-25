/**
 * 🚧 A person's message is saved through the pipeline (owner ruling
 * 2026-10-15). The send handler checks the door and dispatches
 * `core:event/message-offered@1`; the session's preset binds the save —
 * core's `core:spec/save-message` unless the genre binds its own — and the
 * save's `create-message@1` (`role: 'user'`) writes the row, announces it and
 * fires its `message-completed` under the person's cause. A refusal comes
 * back as a sentence, and nothing is written.
 *
 * Also proven elsewhere, unchanged by this road: attachments
 * (`attachments/send.int.test.ts`, `sockets/attachments.int.test.ts`), the
 * channel door (`sessions.sendChannel.int.test.ts`), a Dungeon Crawler round
 * (`sessions.dungeonCrawlerRounds.int.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { sessionEvents } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
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
	// annexViews pushes per-user views through this; a stub keeps that push quiet.
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const REPLY = "The gate was sealed with old iron."
/** Set to make the NEXT model call fail — the placeholder never completes. */
let failNextCall = false
class FakeAdapter {
	constructor(_p: any) {}
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
	async generateText() {
		if (failNextCall) {
			failNextCall = false
			throw new Error("the model fell over")
		}
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(REPLY)
				return { content: REPLY, isAborted: false }
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let otherUserId: number
let characterId: number
let personaId: number
let othersPersonaId: number

const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: true }, io: {} }) as any
const emit = (_event: string, _data: any) => {}

const settle = async () =>
	(await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()

const completedOf = async (sessionId: number) => {
	await settle()
	return (
		await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
			.orderBy(schema.sessionChanges.id)
	).filter((c) => c.event === sessionEvents.messageCompleted)
}

const chatPreset = async () => {
	const [row] = await db
		.select()
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
		.limit(1)
	return row!
}

async function makeSession(tag: string, presetId?: number) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `offer ${tag}`,
			presetId: presetId ?? (await chatPreset()).id
		})
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true
	})
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		userId,
		role: "assistant",
		characterId,
		content: `The gate (${tag}) is old.`,
		metadata: {}
	} as any)
	return session.id
}

const send = async (uid: number, params: Record<string, unknown>) => {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return (await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(uid),
		params as any,
		emit
	)) as any
}

const userRows = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
	).filter((m) => m.role === "user")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-offer-message-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "offer-owner")).id
	otherUserId = (await createTestUser(db, "offer-other")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId, name: "Bram", description: "", isPersona: true, aliases: [] } as any)
		.returning()
	personaId = persona.id
	const [others] = await db
		.insert(schema.characters)
		.values({ userId: otherUserId, name: "Cass", description: "", isPersona: true, aliases: [] } as any)
		.returning()
	othersPersonaId = others.id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn.id, "default-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.5 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("a person's message, saved through the pipeline", () => {
	it("every preset shows the save, and core's is published", async () => {
		const { SAVE_MESSAGE_SPEC_ID } = await import("@serene-pub/sdk")
		const presets = await db.select().from(schema.sessionPresets)
		expect(presets.length).toBeGreaterThan(0)
		for (const p of presets)
			expect((p.bindings as any)?.[sessionEvents.messageOffered]).toEqual({
				spec: SAVE_MESSAGE_SPEC_ID
			})
		const { resolveSessionEventSpec } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		// A session on no preset falls to the same default.
		const [bare] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, name: "bare" })
			.returning()
		expect(
			await resolveSessionEventSpec(db, "core:genre/story", sessionEvents.messageOffered, {
				sessionId: bare.id
			})
		).toBe(SAVE_MESSAGE_SPEC_ID)
	})

	it("the row lands, written by the save run, under the person's cause — one message-completed, and the reply still follows", async () => {
		const sessionId = await makeSession("send")
		const res = await send(userId, { sessionId, personaId: null, content: "Who goes there?" })
		expect(res.refused).toBeUndefined()
		expect(res.accepted).toBe(true)
		expect(typeof res.runId).toBe("string")
		const row = res.sessionMessage
		expect(row.role).toBe("user")
		expect(row.content).toBe("Who goes there?")
		expect(row.userId).toBe(userId)
		expect(row.personaId).toBeNull()

		// The row's run is the save, and the save is core's.
		const { runForMessage } = await import("$lib/server/pipelines/runtime/receipts")
		const run: any = await runForMessage(db, row.id)
		expect(run?.run.runId).toBe(res.runId)
		const [runRow] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, res.runId))
		expect(JSON.stringify(runRow)).toContain("core:spec/save-message")

		const completed = await completedOf(sessionId)
		const byUser = completed.filter((c) => (c.payload as any).cause?.kind === "user")
		expect(byUser).toHaveLength(1)
		expect(byUser[0]!.messageId).toBe(row.id)
		expect((byUser[0]!.payload as any).cause).toEqual({ kind: "user", userId, runId: res.runId })

		// Auto-advance answered the send as it always did: the reply landed.
		const replies = (
			await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, sessionId))
		).filter((m) => m.role === "assistant" && m.content === REPLY)
		expect(replies).toHaveLength(1)
	})

	it("a persona the person owns is the row's persona; another person's is refused, and nothing is written", async () => {
		const sessionId = await makeSession("persona")
		const ok = await send(userId, { sessionId, personaId, content: "As Bram." })
		expect(ok.accepted).toBe(true)
		expect(ok.sessionMessage.personaId).toBe(personaId)
		expect(ok.sessionMessage.characterId).toBeNull()
		expect((ok.sessionMessage.metadata as any)?.speaker).toBeUndefined()
		await settle()

		const before = (await userRows(sessionId)).length
		const refused = await send(userId, { sessionId, personaId: othersPersonaId, content: "As Cass." })
		expect(refused.accepted).toBeUndefined()
		expect(refused.refused).toMatch(/personas you own/)
		expect(await userRows(sessionId)).toHaveLength(before)
	})

	it("a genre's own save wins — and when it refuses, the person reads the sentence and nothing is written", async () => {
		const { compile, spec } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { storyGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		// A save that writes as somebody else: the host refuses a person's
		// message spoken as anyone but the person — a refusal a genre's save meets.
		const doc = compile(
			spec("test:spec/chat-refusing-save", { version: "1.0.0" })
				.inlet("input", C.messageOffered.v1(), {
					genre: storyGenre,
					event: sessionEvents.messageOffered
				})
				.outlet("save", ($: any) =>
					C.createMessage.v1({
						text: $.input.text,
						channel: $.input.channel,
						role: "user",
						speaker: "user:999999" as any
					})
				)
				.build()
		)
		await saveDocument(db as never, doc as never, { name: "Refusing save", publish: true })
		const base = await chatPreset()
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({
				name: "Refusing",
				genreId: "core:genre/story",
				bindings: {
					...(base.bindings as object),
					[sessionEvents.messageOffered]: { spec: "test:spec/chat-refusing-save" }
				}
			} as any)
			.returning()
		// 🚧 The preset's binding as the registration it is now (PLAN-layering D7).
		const { writeLegacyPresetChanges } = await import(
			"$lib/server/pipelines/registrations/presetRows"
		)
		await writeLegacyPresetChanges(db as any, { id: preset.id, genreId: "core:genre/story" }, {
			bindings: { [sessionEvents.messageOffered]: { spec: "test:spec/chat-refusing-save" } }
		})
		const sessionId = await makeSession("refusing", preset.id)

		const res = await send(userId, { sessionId, personaId: null, content: "Keep me." })
		expect(res.accepted).toBeUndefined()
		expect(res.refused).toMatch(/as the person who sent it/)
		expect(typeof res.runId).toBe("string")
		expect(await userRows(sessionId)).toHaveLength(0)
		expect(
			(await completedOf(sessionId)).filter((c) => (c.payload as any).cause?.kind === "user")
		).toHaveLength(0)
	})

	it("a save that never answers is stopped and refused — or, if its row landed after all, accepted", async () => {
		const sessionId = await makeSession("slow")
		const { offerMessage } = await import("$lib/server/sessions/offerMessage")
		const quick = await offerMessage(db as never, {
			sessionId,
			userId,
			speaker: null,
			channel: "main",
			text: "In time.",
			trayItemIds: []
		})
		expect("accepted" in quick && quick.messageId).toBeTruthy()
		const slow = await offerMessage(db as never, {
			sessionId,
			userId,
			speaker: null,
			channel: "main",
			text: "Too late?",
			trayItemIds: [],
			timeoutMs: 0
		})
		// Either answer is honest; what may never happen is a refusal with a row.
		const rows = (await userRows(sessionId)).filter((m) => m.content === "Too late?")
		if ("refused" in slow) expect(rows).toHaveLength(0)
		else expect(rows).toHaveLength(1)
		await settle()
	})
})
