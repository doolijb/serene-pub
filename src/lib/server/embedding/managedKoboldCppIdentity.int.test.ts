/**
 * The managed KoboldCPP's vector identity: the model, and no address.
 *
 * Every other endpoint stamps its vectors `api::<baseUrl>::<model>`. The managed
 * row's `baseUrl` is display only — the process is wherever
 * `koboldCppManagerBaseUrl` says, and nothing keeps the two in step — so an
 * identity carrying it could change while the very same model went on making
 * the vectors, and the star's consequence would throw a whole index away to
 * rebuild it identically. These pin the spelling (`koboldcpp_managed::<model>`,
 * no `.gguf`), that the address never enters it, and that the re-index cost
 * and the star's consequence read it the way they read every other identity —
 * plus the one thing the consequence adds for this endpoint: a star that
 * leaves it releases koboldcpp's embeddings slot.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"

// The consequence stops the queue and unloads the lane; neither is under test.
vi.mock("./vectorizationQueue", () => ({
	stopVectorization: () => {},
	startVectorizationQueue: async () => {},
	clearVectorizationFailureTracking: () => {},
	clearInlineEmbedCooldown: () => {}
}))
vi.mock("./index", () => ({ unloadEmbeddingModel: () => {} }))

const standing = vi.hoisted(() => ({ cleared: 0 }))
vi.mock("$lib/server/koboldcpp/modelManager", async (orig) => ({
	...((await orig()) as any),
	setEmbeddingModel: (model: unknown) => {
		if (model === null) standing.cleared++
	}
}))

const {
	buildManagedKoboldCppModelId,
	isManagedKoboldCppModelId,
	resolveEmbeddingPair,
	resolveEmbeddingTarget,
	EMBEDDING_CAPABILITY
} = await import("./target")
const { applyEmbeddingStarChange, embeddingReindexCost } = await import(
	"./reindex"
)

let db: TestDb
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	userId = (await createTestUser(db, "managed-kcpp-identity")).id
}, 120_000)

beforeEach(async () => {
	await db.delete(schema.connectionDefaults)
	await db.delete(schema.characters)
	await db.delete(schema.connections)
	standing.cleared = 0
})

const NOMIC = "nomic-embed-text-v1.5.Q4_K_M.gguf"
const NOMIC_ID = "koboldcpp_managed::nomic-embed-text-v1.5.Q4_K_M"

/** The managed endpoint with embedding model rows, as the listing makes them. */
async function managed(baseUrl: string | null, ...models: string[]) {
	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "KoboldCPP",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			modality: "text-gen",
			baseUrl,
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	const ids: number[] = []
	for (const model of models) {
		const [row] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: conn.id,
				model,
				name: model,
				modality: "embeddings"
			})
			.returning()
		ids.push(row.id)
	}
	return { conn, ids }
}

async function openAI() {
	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "Hosted",
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: "http://localhost:1234/v1",
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	const [row] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: conn.id, model: "small", name: "small" })
		.returning()
	return { conn, id: row.id }
}

async function star(
	connectionId: number | null,
	connectionModelId: number | null
) {
	await db.delete(schema.connectionDefaults)
	if (connectionId == null) return
	await setCapabilityDefault(db as any, EMBEDDING_CAPABILITY, {
		connectionId,
		connectionModelId
	})
}

async function embedded(model: string, count = 1) {
	for (let i = 0; i < count; i++)
		await db.insert(schema.characters).values({
			userId,
			name: `c-${model}-${i}`,
			description: "d",
			embedding: [1, 2, 3],
			embeddingModel: model,
			vectorizedAt: new Date()
		} as any)
}

describe("the managed KoboldCPP's identity", () => {
	it("is the bare model name under the type, with no address in it", async () => {
		expect(buildManagedKoboldCppModelId(NOMIC)).toBe(NOMIC_ID)
		// However the model is spelled, one model is one identity.
		expect(
			buildManagedKoboldCppModelId("nomic-embed-text-v1.5.Q4_K_M")
		).toBe(NOMIC_ID)
		expect(isManagedKoboldCppModelId(NOMIC_ID)).toBe(true)
		expect(isManagedKoboldCppModelId("api::http://h::m")).toBe(false)
		expect(isManagedKoboldCppModelId(null)).toBe(false)
	})

	it("is what the starred pair resolves to, whatever the row's display address says", async () => {
		const { conn, ids } = await managed("http://localhost:5001", NOMIC)
		await star(conn.id, ids[0])
		const target = await resolveEmbeddingTarget(db as any)
		expect(target).toMatchObject({
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			mode: "api",
			modelId: NOMIC_ID,
			apiModel: NOMIC
		})
		expect(target!.modelId).not.toContain("5001")
		// The adapter is built from the pair, which names the FILE to load.
		expect((target!.connection as AdapterConnection).model).toBe(NOMIC)

		// The row's address moving (or never having been set) moves nothing.
		await db
			.update(schema.connections)
			.set({ baseUrl: "http://127.0.0.1:5099" })
			.where(eq(schema.connections.id, conn.id))
		expect((await resolveEmbeddingTarget(db as any))!.modelId).toBe(
			NOMIC_ID
		)
		await db
			.update(schema.connections)
			.set({ baseUrl: null })
			.where(eq(schema.connections.id, conn.id))
		expect((await resolveEmbeddingTarget(db as any))!.modelId).toBe(
			NOMIC_ID
		)
	}, 60_000)

	it("is unchanged by an unsaved address edit", async () => {
		const { conn, ids } = await managed("http://localhost:5001", NOMIC)
		const pair = await resolveEmbeddingPair(
			db as any,
			{ connectionId: conn.id, connectionModelId: ids[0] },
			{ baseUrl: "http://elsewhere:7000" }
		)
		expect(pair!.modelId).toBe(NOMIC_ID)
	}, 60_000)
})

describe("the re-index cost, priced against it", () => {
	it("is zero for an address edit of the starred managed pair — the vectors stay", async () => {
		const { conn, ids } = await managed("http://localhost:5001", NOMIC)
		await star(conn.id, ids[0])
		await embedded(NOMIC_ID, 3)
		const cost = await embeddingReindexCost(db as any, {
			connectionId: conn.id,
			edit: { baseUrl: "http://127.0.0.1:5099" }
		})
		expect(cost.rows).toBe(0)
	}, 60_000)

	it("counts every vector when the star would move to another managed model", async () => {
		const { conn, ids } = await managed(
			"http://localhost:5001",
			NOMIC,
			"bge-m3-Q8_0.gguf"
		)
		await star(conn.id, ids[0])
		await embedded(NOMIC_ID, 2)
		const cost = await embeddingReindexCost(db as any, {
			connectionId: conn.id,
			modelId: ids[1]
		})
		expect(cost.rows).toBe(2)
		// …and none for a second press on the model that made them.
		const again = await embeddingReindexCost(db as any, {
			connectionId: conn.id,
			modelId: ids[0]
		})
		expect(again.rows).toBe(0)
	}, 60_000)
})

describe("the star's consequence", () => {
	it("keeps the vectors when the same managed model is starred again", async () => {
		const { conn, ids } = await managed("http://localhost:5001", NOMIC)
		await embedded(NOMIC_ID, 2)
		await star(conn.id, ids[0])
		const change = await applyEmbeddingStarChange(db as any, null)
		expect(change).toMatchObject({
			reindexed: false,
			cleared: 0,
			modelId: NOMIC_ID
		})
		expect(standing.cleared).toBe(0)
	}, 60_000)

	it("releases koboldcpp's embeddings slot when the star leaves the managed endpoint", async () => {
		const { conn, ids } = await managed("http://localhost:5001", NOMIC)
		const hosted = await openAI()
		await star(conn.id, ids[0])
		await embedded(NOMIC_ID, 2)

		await star(hosted.conn.id, hosted.id)
		const change = await applyEmbeddingStarChange(db as any, NOMIC_ID)
		expect(change.cleared).toBe(2)
		expect(standing.cleared).toBe(1)
	}, 60_000)

	it("releases it on an unstar too, and NOT on a move between its own models", async () => {
		const { conn, ids } = await managed(
			"http://localhost:5001",
			NOMIC,
			"bge-m3-Q8_0.gguf"
		)
		// Between two of its models: the new one's first embed swaps the slot.
		await star(conn.id, ids[1])
		await applyEmbeddingStarChange(db as any, NOMIC_ID)
		expect(standing.cleared).toBe(0)

		// Arriving from elsewhere releases nothing either.
		await applyEmbeddingStarChange(db as any, "api::http://h/v1::small")
		expect(standing.cleared).toBe(0)

		await star(null, null)
		await applyEmbeddingStarChange(
			db as any,
			buildManagedKoboldCppModelId("bge-m3-Q8_0.gguf")
		)
		expect(standing.cleared).toBe(1)
	}, 60_000)
})
