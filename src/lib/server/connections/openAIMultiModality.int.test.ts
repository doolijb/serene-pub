/**
 * One OpenAI-compatible connection per service: existing `openai-embeddings`
 * rows move onto `openai` IN PLACE (owner ruling 2026-10-05).
 *
 * As in the Ollama suite beside this, the property that matters is not the
 * type string. It is that **the embedding lane still resolves to the same
 * vectors** — so the star is wired onto a real row, the identity every stored
 * vector carries is read before and after through `resolveEmbeddingTarget` (the
 * function the lane itself calls), and the two must be byte-identical. A
 * changed identity would re-embed everything; a lost switch would stop the lane.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

async function connection(values: Record<string, unknown>) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: "fixture",
			baseUrl: "https://api.openai.com/v1",
			extraJson: {},
			capabilities: {},
			...values
		} as any)
		.returning()
	return row
}

async function model(connectionId: number, identifier: string) {
	const [row] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId,
			model: identifier,
			name: identifier,
			enabled: true
		})
		.returning()
	return row
}

async function reload(id: number) {
	const [row] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, id))
		.limit(1)
	return row
}

async function modelsOf(connectionId: number) {
	return db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, connectionId))
}

const resolvedOf = (row: any) =>
	Object.keys((row.capabilities as any)?.resolved ?? {})

/** What boot does, in boot's order: rename, then rebuild every cache. */
async function boot() {
	const { mergeOpenAIEmbeddingsType } = await import("./openAIMultiModality")
	const { refreshConnectionCapabilityCaches } = await import("./resolve")
	const merged = await mergeOpenAIEmbeddingsType(db)
	const cached = await refreshConnectionCapabilityCaches(db)
	return { ...merged, ...cached }
}

describe("openai-embeddings merges into openai", () => {
	it("renames the starred row in place, and the vector identity is byte-identical", async () => {
		const { setCapabilityDefault } = await import("./capabilityDefaults")
		const { resolveEmbeddingTarget } = await import(
			"$lib/server/embedding/target"
		)

		const embed = await connection({
			name: "OpenAI embeddings",
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			// A legacy plaintext key, which the crypto path passes through.
			extraJson: { apiKey: "sk-test", embeddingModelTtlMinutes: 7 },
			capabilities: { resolved: { "text->embedding": 1 } }
		})
		const small = await model(embed.id, "text-embedding-3-small")
		await setCapabilityDefault(db, "text->embedding", {
			connectionId: embed.id,
			connectionModelId: small.id
		})
		const before = await resolveEmbeddingTarget(db as any)
		expect(before?.modelId).toBeTruthy()

		await boot()

		const after = await reload(embed.id)
		expect(after.id).toBe(embed.id)
		expect(after.type).toBe(CONNECTION_TYPE.OPENAI)
		expect(after.modality).toBe("text-gen")
		// Its own address, key and extras, untouched.
		expect(after.baseUrl).toBe("https://api.openai.com/v1")
		expect(after.extraJson).toEqual({
			apiKey: "sk-test",
			embeddingModelTtlMinutes: 7
		})

		// The lane, read the way the lane reads it: the same pair, the same
		// identity, character for character, and still an API target.
		const target = await resolveEmbeddingTarget(db as any)
		expect(target?.connectionId).toBe(embed.id)
		expect(target?.type).toBe(CONNECTION_TYPE.OPENAI)
		expect(target?.mode).toBe("api")
		expect(target?.modelId).toBe(before!.modelId)
		expect(target?.apiModel).toBe("text-embedding-3-small")
		expect(target?.apiKey).toBe("sk-test")
		expect(target?.ttlMinutes).toBe(7)

		// And the lane's adapter is the module the row embedded through before.
		const { getEmbeddingAdapter } = await import(
			"$lib/server/utils/getEmbeddingAdapter"
		)
		expect(await getEmbeddingAdapter(CONNECTION_TYPE.OPENAI)).toBe(
			await getEmbeddingAdapter(CONNECTION_TYPE.OPENAI_EMBEDDINGS)
		)
	}, 60_000)

	it("keeps embeddings switched on, and files every model it owns as an embedding model", async () => {
		const row = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			capabilities: { resolved: { "text->embedding": 1 } }
		})
		await model(row.id, "text-embedding-3-large")
		await model(row.id, "text-embedding-ada-002")

		await boot()

		const after = await reload(row.id)
		// The person's layer, so they can switch it off like any other.
		expect((after.capabilities as any)?.overrides).toEqual({
			"text->embedding": 1
		})
		// Both halves resolve now: the `openai` defaults, and embeddings by the
		// override — `openai` alone does not default it.
		const keys = resolvedOf(after)
		expect(keys).toContain("text->embedding")
		expect(keys).toContain("text->text")
		for (const m of await modelsOf(row.id))
			expect(m.modality, m.model).toBe("embeddings")
	}, 60_000)

	it("never switches embeddings on for an openai row that was always openai", async () => {
		const chat = await connection({
			type: CONNECTION_TYPE.OPENAI,
			capabilities: { resolved: { "text->text": 1 } }
		})
		await model(chat.id, "gpt-4o")

		await boot()

		const after = await reload(chat.id)
		expect(after.type).toBe(CONNECTION_TYPE.OPENAI)
		expect(resolvedOf(after)).not.toContain("text->embedding")
		expect((await modelsOf(chat.id))[0].modality).toBeNull()
	}, 60_000)

	it("keeps a person's own switch, even an off one", async () => {
		const row = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			capabilities: {
				resolved: {},
				overrides: { "text->embedding": false }
			}
		})

		await boot()

		const after = await reload(row.id)
		expect(after.type).toBe(CONNECTION_TYPE.OPENAI)
		expect((after.capabilities as any)?.overrides).toEqual({
			"text->embedding": false
		})
		expect(resolvedOf(after)).not.toContain("text->embedding")
	}, 60_000)

	it("renames a row whose 0.5.3 key is still quarantined, and the key conversion still finds it", async () => {
		// The 0.5.3 upgrade's API embedding row: renamed in the boot that
		// restores it, BEFORE `migrateEmbeddingConnection` runs. Found by
		// `modality = 'embeddings'` alone, its key would stay quarantined.
		const { encryptToken, decryptApiKeyField, VECTORIZATION_API_KEY_INFO } =
			await import("$lib/server/utils/tokenCrypto")
		const row = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			extraJson: {
				__legacyVectorizationApiKey: encryptToken(
					"sk-from-0.5.3",
					VECTORIZATION_API_KEY_INFO
				)
			}
		})

		const { renamed } = await boot()
		expect(renamed).toBe(1)
		const moved = await reload(row.id)
		expect(moved.type).toBe(CONNECTION_TYPE.OPENAI)
		expect(moved.modality).toBe("text-gen")
		expect(
			(moved.extraJson as any).__legacyVectorizationApiKey
		).toBeTruthy()

		const { migrateEmbeddingConnection } = await import(
			"$lib/server/embedding/migrateEmbeddingConnection"
		)
		expect((await migrateEmbeddingConnection(db)).keysConverted).toBe(1)
		const converted = (await reload(row.id)).extraJson as any
		expect(converted.__legacyVectorizationApiKey).toBeUndefined()
		expect(decryptApiKeyField(converted.apiKey)).toBe("sk-from-0.5.3")
		// Consumed: the next pass finds nothing to convert.
		expect((await migrateEmbeddingConnection(db)).keysConverted).toBe(0)
	}, 60_000)

	it("is idempotent: a settled install renames nothing and writes nothing", async () => {
		await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings"
		})
		await boot()

		expect(await boot()).toEqual({ renamed: 0, refreshed: 0 })
	}, 60_000)

	it("never renames a connection of any other type", async () => {
		const ollama = await connection({
			type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: "http://localhost:11434"
		})
		const { mergeOpenAIEmbeddingsType } = await import(
			"./openAIMultiModality"
		)
		await mergeOpenAIEmbeddingsType(db)
		expect((await reload(ollama.id)).type).toBe(
			CONNECTION_TYPE.OLLAMA_EMBEDDINGS
		)
	}, 60_000)
})
