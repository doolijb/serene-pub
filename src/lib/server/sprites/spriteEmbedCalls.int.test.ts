/**
 * "Choose sprites" off makes no embedding request.
 *
 * The sprite tail embeds the line and the speaker's sprite labels inside
 * `sprites-for`, a query that sits BEFORE the picker whose `enabled` is the
 * switch — so with the switch off the picker picked nothing but the embed was
 * still made: a provider call per reply, with an embedding service starred,
 * that bought nothing. The host now reads the picker's resolved `enabled` for
 * the run and skips the embed when it is off.
 *
 * Counted on the embedding module's spy, through `runReply` on the shipped
 * `core:spec/respond`, with Search by meaning switched Off so the only embed a
 * turn can make is the sprite tail's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const embedCalls: string[][] = []
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => true,
	getLoadedModelId: () => "test-embed-model",
	embed: async (text: string) => {
		embedCalls.push([text])
		return [1, 0]
	},
	batchEmbed: async (texts: string[]) => {
		embedCalls.push([...texts])
		return texts.map((t, i) => [1, i / 10])
	}
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	promoteScopedVectors: async () => ({ promoted: 0 })
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	// annexViews pushes per-user views through this; a stub keeps that push quiet.
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

class FakeAdapter {
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
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("She smiled, full of joy.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let characterId: number
let respondSpecId: number

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

const chatPresetId = async () =>
	(
		await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-chat-default"))
			.limit(1)
	)[0]?.id ?? null

async function sessionOverride(
	sessionId: number,
	nodeKey: string,
	pathKey: string,
	value: unknown
) {
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: respondSpecId,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey,
		slot: "params",
		path: pathKey,
		value: value as any
	})
}

async function makeSession() {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, presetId: await chatPresetId() })
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true
	})
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		userId,
		role: "user",
		content: "How are you today?"
	} as any)
	// Only the sprite tail may embed in these turns.
	await sessionOverride(
		session.id,
		"semantic.arm.queries",
		"searchByMeaning",
		"off"
	)
	return session.id
}

async function turn(sessionId: number) {
	embedCalls.length = 0
	const { runReply } = await import("$lib/server/utils/runReply")
	const outcome = await runReply({
		socket: { user: { id: userId }, io: {} } as any,
		emitToUser: () => {},
		sessionId,
		userId,
		turn: { kind: "respond", characterId }
	})
	expect(outcome.error, outcome.error).toBeUndefined()
	expect(outcome.ok).toBe(true)
	return outcome
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sprite-embed-calls-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines, RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	respondSpecId = spec!.id

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "sprite-embed-calls")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Verity", description: "" })
		.returning()
	characterId = character.id
	const { importSprites } = await import("$lib/server/sprites")
	await importSprites(
		db as any,
		userId,
		characterId,
		[
			{ label: "joy", bytes: png(11) },
			{ label: "neutral", bytes: png(12) }
		],
		"upload"
	)

	const [conn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = (await ensureConnectionModel(db, conn.id, "default-7b"))!
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Sprite embed calls",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200 },
			enabled: ["contextTokens", "responseTokens"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: sampling.id
	})
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the sprite tail's embedding request", () => {
	it("is made once per reply while Choose sprites is on (the control)", async () => {
		const sessionId = await makeSession()
		await turn(sessionId)
		expect(embedCalls.length).toBe(1)
		// …and the tail reached the saved line: a face was chosen for it.
		const [reply] = await db
			.select({ metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
			.orderBy(schema.sessionMessages.id)
			.offset(1)
		expect((reply?.metadata as any)?.sprite?.label).toBeTruthy()
	})

	it("is not made at all with Choose sprites off", async () => {
		const sessionId = await makeSession()
		const { SPRITE_PICKER_NODE_KEY } = await import(
			"@serene-pub/core-catalog"
		)
		await sessionOverride(sessionId, SPRITE_PICKER_NODE_KEY, "enabled", false)
		const outcome: any = await turn(sessionId)
		expect(embedCalls).toEqual([])
		// The tail still ran, and picked nothing.
		const pick = (outcome.receipt?.nodes ?? []).find(
			(n: any) => n.nodeKey === SPRITE_PICKER_NODE_KEY
		)
		expect(pick?.output?.main ?? null).toBeNull()
	})
})
