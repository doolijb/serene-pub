/**
 * Prompt-cache usage, patched onto a reply's receipt the same way stops are.
 *
 * ## Why this needs its own patch
 *
 * `dispatchGeneration` reports `tokensPrompt`/`tokensCached`/`tokensCacheWrite`
 * to the receipt through `ctx.reportCacheUsage?.()`, which only fires because a
 * Provider node actually ran. The reply path halts the executor at the pre-call
 * substrate (`runTurn({ preview: true })`, see `recordGenerateStops`'s own
 * header) and the adapter sends from outside the pipeline, so no node ever calls
 * `reportCacheUsage` for an ordinary reply. `recordGenerateCacheUsage` patches
 * the same generate node afterwards, from the adapter's own result — the same
 * shape `recordGenerateStops` already does for the stop list.
 *
 * ## Off the node, not off `output`
 *
 * `sockets/pipelines.ts`'s `promptCacheFromReceipt` reads `node.tokensPrompt`
 * etc. directly, matching where the SDK executor writes them
 * (`nr.tokensPrompt = usage.prompt`) for every path whose Provider node fires.
 * A patch that put them under `node.output` instead would read as "no cache
 * usage" for every real reply, the same silent gap this file exists to close.
 *
 * Driven through the real `generateResponse()` — a fake adapter and a mocked
 * `$lib/server/db`, everything else real — because the claim under test is
 * about that function's own wiring, the same reasoning
 * `replyReceipt.int.test.ts` gives for testing `generateResponse` rather than a
 * `runTurn` call a test wrote by hand.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let characterId: number

// `generateResponse` imports `db` at module scope, so the handle has to be the
// test's before it is loaded — the same route `replyReceipt.int.test.ts` takes.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "cache-usage-wiring-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

// The background vectorizer, which a finished reply kicks. Not this file's
// subject and it would open a queue nothing here closes.
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

/**
 * What the next `generateText()` call reports, set per test. `undefined`
 * fields must stay absent from the call's return value entirely — a key
 * present with value `undefined` is not the same fixture as a key never
 * reported, and `usage` below is spread rather than assigned so a test can
 * tell the two apart.
 */
let nextUsage: {
	tokensPrompt?: number
	tokensCached?: number
	tokensCacheWrite?: number
} = {}

/** The model, and only the model. Everything else below is the real thing. */
class FakeAdapter {
	injected: any
	currentCharacterId: number | null
	promptBuilder: any = {}
	constructor(args: any) {
		this.currentCharacterId = args?.currentCharacterId ?? null
	}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async preflight() {}
	async generateText() {
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: "The Ashguard ride at dawn.",
			...nextUsage
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

const noopEmit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-cache-usage-wiring-")
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
		.values({ username: "cache-usage-wiring", isAdmin: true })
		.returning()
	userId = user.id

	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Cache Usage Only",
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
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

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
async function generateResponseFor(row: any) {
	const { generateResponse } = await import(
		"$lib/server/utils/generateResponse"
	)
	return await generateResponse({
		socket: fakeSocket(),
		emitToUser: noopEmit,
		sessionId,
		userId,
		generatingMessage: row as any
	})
}

/** The run linked to this message, the same join `replyReceipt.int.test.ts` uses. */
const runFor = (messageId: number) =>
	db
		.select()
		.from(schema.pipelineRuns)
		.innerJoin(
			schema.pipelineRunArtifacts,
			eq(schema.pipelineRunArtifacts.runId, schema.pipelineRuns.id)
		)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.entityId, messageId)
			)
		)
		.then((rows) => rows.map((r: any) => r.pipeline_runs)[0])

const generateNodeOf = (run: any) =>
	(run.receipt as any).nodes.find((n: any) =>
		String(n.typeId).startsWith("core:provider/generate-text")
	)

describe("a reply's prompt-cache usage is patched onto its receipt", () => {
	it("records what the adapter reported", async () => {
		nextUsage = { tokensPrompt: 100, tokensCached: 60 }
		const row = await generatingRow()
		const ok = await generateResponseFor(row)
		expect(ok, "the reply itself did not complete").toBe(true)

		const run = await runFor(row.id)
		expect(
			run,
			"no run is linked to the message the reply wrote"
		).toBeTruthy()
		const generate = generateNodeOf(run)
		expect(
			generate,
			"the reply pipeline recorded no generate node to attach usage to"
		).toBeTruthy()
		expect(generate.tokensPrompt).toBe(100)
		expect(generate.tokensCached).toBe(60)
		expect(generate.tokensCacheWrite).toBeUndefined()
	}, 120_000)

	it("leaves the fields undefined when the adapter reports nothing", async () => {
		nextUsage = {}
		const row = await generatingRow()
		const ok = await generateResponseFor(row)
		expect(ok, "the reply itself did not complete").toBe(true)

		const run = await runFor(row.id)
		expect(
			run,
			"no run is linked to the message the reply wrote"
		).toBeTruthy()
		const generate = generateNodeOf(run)
		expect(
			generate,
			"the reply pipeline recorded no generate node to attach usage to"
		).toBeTruthy()
		expect(generate.tokensPrompt).toBeUndefined()
		expect(generate.tokensCached).toBeUndefined()
		expect(generate.tokensCacheWrite).toBeUndefined()
	}, 120_000)
})
