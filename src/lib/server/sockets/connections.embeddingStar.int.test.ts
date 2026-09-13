/**
 * Moving the embedding star re-indexes; moving any other star does not.
 *
 * The star for `text->embedding` is an ordinary `connections:setDefault` — there
 * is no `vectorization:setModel` verb any more, and that is the point: one way
 * to choose a connection, whatever the modality. But the embedding star carries
 * a consequence the others do not, because every stored vector was produced by
 * the model it used to name. So the handler asks the same question the old verb
 * asked ("did the model IDENTITY change?") and, when it did, does what that verb
 * did: stop the queue, unload the backend, drop the stale vectors, forget the
 * failure/cooldown state, and start again from the beginning.
 *
 * ⚠ The identity, not the connection id. Starring a DIFFERENT row that names the
 * same endpoint and model produces byte-identical vectors, so re-indexing there
 * would be hours of work for no change — and starring the same row twice (the
 * button is pressable twice) must be a no-op.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	// `...actual` and not `{ db }` alone: `connections.ts` reaches
	// `tokenCrypto` → `getCryptoSecretKey`, and an auth module reads it at
	// module scope, so a mock that returns only `db` crashes the import graph
	// before a single assertion runs.
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/**
 * The queue, observed rather than run.
 *
 * What is under test is the DECISION — whether the consequence fires — and
 * running a real indexing lane here would need an embedding backend. Each verb
 * is recorded so the order can be asserted: stopping before clearing matters,
 * because a running queue would write vectors back in behind the delete.
 */
const queueCalls: string[] = []
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	stopVectorization: () => queueCalls.push("stop"),
	startVectorizationQueue: async (opts?: any) =>
		queueCalls.push(
			`start:${opts?.startFromBeginning ? "beginning" : "resume"}`
		),
	clearVectorizationFailureTracking: () => queueCalls.push("clearFailures"),
	clearInlineEmbedCooldown: () => queueCalls.push("clearCooldown")
}))

const unloads: string[] = []
vi.mock("$lib/server/embedding/index", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		unloadEmbeddingModel: (reason?: string) =>
			unloads.push(reason ?? "(no reason)")
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-embedding-star-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// The handler broadcasts `systemSettings:get` at the end, which refuses
	// outright without the singleton row. `createTestDb` applies migrations but
	// runs none of the boot-time seeding.
	await testDb.insert(schema.systemSettings).values({ id: 1 } as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socket = { user: { id: 1, isAdmin: true } } as any
const noop = () => {}

async function makeEmbeddingConnection(
	name: string,
	over: Record<string, any> = {}
) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name,
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: "http://localhost:1234/v1",
			model: "text-embedding-3-small",
			extraJson: {},
			capabilities: { resolved: { "text->embedding": 1 } },
			...over
		} as any)
		.returning()
	await testDb.insert(schema.connectionModels).values({
		connectionId: conn.id,
		model: over.model ?? "text-embedding-3-small",
		name: "m",
		isDefault: true
	})
	return conn
}

async function seedVector(model: string) {
	await testDb.insert(schema.characters).values({
		userId: 1,
		name: `c-${Math.random()}`,
		description: "d",
		embedding: [1, 2, 3],
		embeddingModel: model,
		vectorizedAt: new Date()
	} as any)
}

async function setDefault(capability: string, id: number | null) {
	const { connectionsSetDefault } = await import("./connections")
	return connectionsSetDefault.handler(
		socket,
		{ capability, id } as any,
		noop
	)
}

beforeEach(async () => {
	queueCalls.length = 0
	unloads.length = 0
	await testDb.delete(schema.connectionDefaults)
	await testDb.delete(schema.characters)
	await testDb.delete(schema.connections)
})

describe("the embedding star", () => {
	it("clears every vector and restarts from the beginning when the model changes", async () => {
		const first = await makeEmbeddingConnection("Small")
		await setDefault("text->embedding", first.id)
		// The FIRST star is itself a change (null → an identity), so it stops,
		// unloads and starts too. Only the second one is under test here.
		queueCalls.length = 0
		unloads.length = 0
		await seedVector(
			"api::http://localhost:1234/v1::text-embedding-3-small"
		)

		const second = await makeEmbeddingConnection("Large", {
			model: "text-embedding-3-large"
		})
		await setDefault("text->embedding", second.id)

		// Stop BEFORE clear, or a running pass writes vectors back in behind
		// the delete; restart from the beginning, not a resume.
		expect(queueCalls).toEqual([
			"stop",
			"clearFailures",
			"clearCooldown",
			"start:beginning"
		])
		expect(unloads.length).toBe(1)
		const rows = await testDb.select().from(schema.characters)
		expect(rows).toHaveLength(1)
		expect(rows[0].embedding).toBeNull()
		expect(rows[0].embeddingModel).toBeNull()
	}, 60_000)

	it("does nothing when the same connection is starred twice", async () => {
		const conn = await makeEmbeddingConnection("Small")
		await setDefault("text->embedding", conn.id)
		await seedVector(
			"api::http://localhost:1234/v1::text-embedding-3-small"
		)
		queueCalls.length = 0
		unloads.length = 0

		await setDefault("text->embedding", conn.id)

		expect(queueCalls).toEqual([])
		expect(unloads).toEqual([])
		const [row] = await testDb.select().from(schema.characters)
		expect(row.embedding).not.toBeNull()
	}, 60_000)

	it("does nothing when a DIFFERENT row names the same endpoint and model", async () => {
		// Identical vectors would come back out, so re-indexing would be hours
		// of work to arrive exactly where it started.
		const a = await makeEmbeddingConnection("Copy A")
		await setDefault("text->embedding", a.id)
		await seedVector(
			"api::http://localhost:1234/v1::text-embedding-3-small"
		)
		queueCalls.length = 0

		const b = await makeEmbeddingConnection("Copy B")
		await setDefault("text->embedding", b.id)

		expect(queueCalls).toEqual([])
		const [row] = await testDb.select().from(schema.characters)
		expect(row.embedding).not.toBeNull()
	}, 60_000)

	it("stops the queue on UNSTAR but keeps the vectors", async () => {
		// Turning embeddings off is not a decision to destroy an index. The old
		// disable switch promised exactly this ("existing embeddings aren't
		// deleted, just unused"), and unstarring is that switch now.
		const conn = await makeEmbeddingConnection("Small")
		await setDefault("text->embedding", conn.id)
		await seedVector(
			"api::http://localhost:1234/v1::text-embedding-3-small"
		)
		queueCalls.length = 0

		await setDefault("text->embedding", null)

		expect(queueCalls).toEqual(["stop"])
		const [row] = await testDb.select().from(schema.characters)
		expect(row.embedding).not.toBeNull()
	}, 60_000)
})

describe("every other star", () => {
	it("leaves the embedding queue and the vectors alone", async () => {
		const [text] = await testDb
			.insert(schema.connections)
			.values({
				name: "Chat",
				type: CONNECTION_TYPE.OPENAI,
				modality: "text-gen",
				baseUrl: "http://localhost:1234/v1",
				model: "gpt-4o",
				extraJson: {},
				capabilities: { resolved: { "text->text": 1 } }
			} as any)
			.returning()
		await testDb.insert(schema.connectionModels).values({
			connectionId: text.id,
			model: "gpt-4o",
			name: "m",
			isDefault: true
		})
		await seedVector("whatever")

		await setDefault("text->text", text.id)

		expect(queueCalls).toEqual([])
		expect(unloads).toEqual([])
		const [row] = await testDb.select().from(schema.characters)
		expect(row.embedding).not.toBeNull()
	}, 60_000)
})
