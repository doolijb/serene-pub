/**
 * The node's `streaming` parameter on the REPLY road.
 *
 * ## Why this road needs its own test
 *
 * A chat reply does not run its provider node. `generateResponse` compiles with
 * `runTurn({ preview: true })`, which halts at the pre-call substrate, and the
 * connection adapter below that halt is what actually sends — so
 * `core:provider/generate-text@1`'s binding, the reader of `params` on every
 * other road, never executes. The value an author set reaches this path off the
 * RECEIPT instead: `resolveInput` resolves the node's config before the halt and
 * the executor records the result as the node's `input`.
 *
 * Two entirely separate readers for one control, then, and a green suite on
 * either alone would say the parameter works while it was inert on the road
 * every chat message takes. `dispatch.int.test.ts` covers the other one.
 *
 * ## Driven through the real entry point
 *
 * `generateResponse` is what a socket handler calls. Everything below the model
 * is real: the shipped `respond` document, the real config chain, the real
 * world projection, the real queue. Only the adapter is a fake, and what it
 * records is the one thing under test — which mode it was handed, and whether it
 * was handed one at all.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import {
	clearConfigValue,
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let characterId: number
let respondSpecRowId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "reply-streaming-secret" }
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

const REPLY = "The Ashguard ride at dawn."

/**
 * What the adapter was handed, per turn.
 *
 * `undefined` and `"auto"` are different findings and are kept apart: a caller
 * that restated the default would still be a caller resolving the per-service
 * default a second time, which is the thing `withStreaming` exists to prevent.
 */
let handedOver: unknown

/** The model, and only the model. Everything else below is the real thing. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	currentCharacterId: number | null
	promptBuilder: any = {}
	constructor(args: any) {
		this.currentCharacterId = args?.currentCharacterId ?? null
	}
	isAborting = false
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withStreaming(mode: any) {
		handedOver = mode
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {
		this.isAborting = true
	}
	async preflight() {}
	async generateText() {
		return {
			completionResult: REPLY,
			compiledPrompt: this.injected,
			isAborted: false
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const fakeSocket = () =>
	({
		user: { id: userId, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-reply-streaming-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "reply-streaming", isAdmin: true })
		.returning()
	userId = user.id

	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Reply Streaming Only",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			model: "irrelevant",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [sampling] = await db.select().from(schema.samplingConfigs).limit(1)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		samplingConfigId: sampling?.id ?? null
	})

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Ash", description: "A rider." })
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer."
		})
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
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

	respondSpecRowId = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0]!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/**
 * The config a run on this session actually resolves to.
 *
 * ⚠ Not the `pipeline-default:` row. `migrateContextTemplates` duplicates the
 * shipped config into a mutable copy and selects that at instance scope, so a
 * fixture writing to the immutable original would change nothing and prove
 * nothing.
 */
const selectedConfigId = async () => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db,
		respondSpecRowId,
		RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(selected, "respond resolves to no configuration").toBeTruthy()
	return selected!.configId
}

/** The address this file tunes: the reply step's own send shape. */
const STREAMING_AT = {
	nodeKey: "generate",
	slot: "params",
	path: "streaming"
} as const

/** The row a trigger creates, in the state it hands to `generateResponse`. */
async function generatingRow() {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			characterId,
			content: "",
			isGenerating: true,
			generationStage: "queued"
		})
		.returning()
	return row
}

/** The real reply path, driven exactly as a socket handler drives it. */
async function reply() {
	handedOver = undefined
	const { generateResponse } = await import(
		"$lib/server/utils/generateResponse"
	)
	const ok = await generateResponse({
		socket: fakeSocket(),
		emitToUser: () => {},
		sessionId,
		userId,
		generatingMessage: (await generatingRow()) as any
	})
	expect(ok, "the turn did not reach the adapter").toBe(true)
	return handedOver
}

describe("the reply road reads the generate node's streaming parameter", () => {
	it("hands nothing over at the shipped default", async () => {
		// `auto` is the declared default, and a config stores deviations only —
		// so an install nobody has touched resolves `auto` here and the adapter
		// keeps the answer its connection already gave. This is the assertion
		// that says the parameter is safe to have shipped at all.
		expect(await reply()).toBeUndefined()
	}, 60_000)

	it("hands `off` over when an author set it", async () => {
		// The assertion neither half of the wiring could pass alone: without
		// the spec naming `params` the receipt carries no value, and without
		// the reader below the halt the adapter is never told.
		const configId = await selectedConfigId()
		await setConfigValue(db, configId, STREAMING_AT, "off")
		try {
			expect(await reply()).toBe("off")
		} finally {
			await clearConfigValue(db, configId, STREAMING_AT)
		}
	}, 60_000)

	it("goes back to handing nothing over when the address is cleared", async () => {
		// Cleared is back to INHERITING, not pinned to today's answer — so this
		// is also the guard that the fixture above cleaned up after itself.
		expect(await reply()).toBeUndefined()
	}, 60_000)
})
