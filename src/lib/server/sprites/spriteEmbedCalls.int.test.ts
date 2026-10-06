/**
 * The sprite picker's embedding request (`core:oracle/pick-sprite@1`, in each
 * reply spec since 2026-10-05).
 *
 * "Choose sprites" off makes no embedding request: the embed lives behind the
 * picker's own call, and the binding returns before it when `enabled` is
 * false — so no host pre-read of the setting is needed, and none exists. (The
 * retired sprite tail embedded in a query BEFORE the picker, so the host had
 * to read the picker's `enabled` ahead of the run.)
 *
 * And the picker embeds the line it is HANDED — the reply text the spec wires
 * to its `text` — never a row the host re-reads (owner, 2026-10-05: "the
 * explicit text or string passed in").
 *
 * Counted on the embedding module's spy, through `runReply` on the shipped
 * `core:spec/chat-respond`, with Search by meaning switched Off so the only embed a
 * turn can make is the picker's.
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
	// Only the sprite picker may embed in these turns.
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

	const { bootstrapPipelines, CHAT_RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
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

describe("the sprite picker's embedding request", () => {
	it("is made once per reply while Choose sprites is on, with the reply's text (the control)", async () => {
		const sessionId = await makeSession()
		await turn(sessionId)
		expect(embedCalls.length).toBe(1)
		// The line it was handed first, then the labels not cached yet.
		expect(embedCalls[0]![0]).toBe("She smiled, full of joy.")
		// …and the step reached the saved line: a face was chosen for it.
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
		// The step still ran, and picked nothing.
		const pick = (outcome.receipt?.nodes ?? []).find(
			(n: any) => n.nodeKey === SPRITE_PICKER_NODE_KEY
		)
		expect(pick).toBeTruthy()
		expect(pick?.output?.main ?? null).toBeNull()
	})
})

/**
 * The binding and the host together, off a run: the picker handed one string
 * while the row it will be recorded on says another. Only the wired string
 * may reach the embedding model.
 */
describe("the picker embeds the text it is wired, never the saved row", () => {
	const node = {
		key: "spritePick",
		definitionId: "core:oracle/pick-sprite",
		definitionVersion: 1
	}

	async function pickWith(
		sessionId: number,
		liveRow: number,
		input: Record<string, unknown>
	) {
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as any, { sessionId, userId })
		const calls: unknown[] = []
		const ctx = {
			call: (payload: unknown) => {
				calls.push(payload)
				return host.call!(payload, node as any, { liveRow } as any)
			},
			log: () => {}
		}
		embedCalls.length = 0
		const result: any = await (coreBindings() as any)[
			"core:oracle/pick-sprite@1"
		](
			{
				scope: { sessionId },
				speaker: `character:${characterId}`,
				params: {},
				...input
			},
			ctx
		)
		return { result, calls }
	}

	it("embeds the wired text, and the choices carry no text of their own", async () => {
		const sessionId = await makeSession()
		const [saved] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				role: "assistant",
				characterId,
				content: "Words the row holds and nobody wired."
			} as any)
			.returning()
		const { result, calls } = await pickWith(sessionId, saved.id, {
			text: "She smiled, full of joy."
		})
		expect(calls).toEqual([
			expect.objectContaining({ text: "She smiled, full of joy." })
		])
		expect(embedCalls.length).toBe(1)
		expect(embedCalls[0]![0]).toBe("She smiled, full of joy.")
		expect(embedCalls.flat()).not.toContain(
			"Words the row holds and nobody wired."
		)
		expect(result.kind).toBe("ok")
		expect(result.value.main).toMatchObject({ set: "default" })
		expect(result.value.choices).toMatchObject({ labels: ["joy", "neutral"] })
		expect(result.value.choices).not.toHaveProperty("text")
	})

	it("makes no call for a speaker who is not a character, or with Choose sprites off", async () => {
		const sessionId = await makeSession()
		for (const input of [
			{ text: "Rain.", speaker: undefined },
			{ text: "Rain.", speaker: "envoy:keeper" },
			{ text: "Hello.", params: { enabled: false } }
		]) {
			const { result, calls } = await pickWith(sessionId, 0, input)
			expect(calls).toEqual([])
			expect(embedCalls).toEqual([])
			expect(result).toEqual({
				kind: "ok",
				value: { main: null, pick: null, choices: null }
			})
		}
	})

	it("answers a failure with no pick, never an error", async () => {
		const sessionId = await makeSession()
		const { result } = await pickWith(sessionId, 0, {
			text: "Hello.",
			// Another session's scope: the host refuses it, the binding
			// swallows the refusal — a face is never worth a failed reply.
			scope: { sessionId: sessionId + 10_000 }
		})
		expect(result).toEqual({
			kind: "ok",
			value: { main: null, pick: null, choices: null }
		})
	})
})
