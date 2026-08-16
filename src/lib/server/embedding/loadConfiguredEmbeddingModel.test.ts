/**
 * loadConfiguredEmbeddingModel() is the mode-aware "bring the configured
 * backend up from cold" helper, extracted so it has exactly one correct
 * implementation shared by loadSockets.server.ts's boot trigger (now just
 * startPeriodicVectorizationScan(), see vectorizationQueue.ts),
 * vectorizationQueue.ts's runQueue() on-demand load, and
 * loadConfiguredEmbeddingModelOpportunistically() below — previously
 * duplicated, and the copy inside runQueue() was mode-unaware (always
 * called loadEmbeddingModel() regardless of vectorizationConfigs.mode,
 * silently breaking API-backend setups the moment nothing else loaded the
 * correct backend first).
 *
 * loadConfiguredEmbeddingModel/loadConfiguredEmbeddingModelOpportunistically
 * call activateApiEmbedding()/loadEmbeddingModel() as same-module direct
 * function references, not through a re-import — vi.mock("./index", ...)
 * from an EXTERNAL test file cannot intercept that internal call the way it
 * can for a different module importing these functions (see
 * vectorization.apiKeyEncryption.int.test.ts for that pattern, which works
 * precisely because vectorization.ts is a different module). So these tests
 * exercise the real functions end-to-end, mocking only genuinely external
 * dependencies (openai's client) or using observable proxies (a DB-read
 * call count) rather than trying to mock same-module internals.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-crypto-secret-key"
}))

const testEmbedCreate = vi.fn(async () => ({
	data: [{ embedding: Array(384).fill(0.1) }]
}))

vi.mock("openai", () => ({
	OpenAI: class {
		embeddings = { create: testEmbedCreate }
	}
}))

// eq(schema.systemSettings.id, 1) is constructed for real (drizzle-orm
// itself isn't mocked) but never actually sent anywhere — every findFirst
// below is a vi.fn() that ignores its `where` argument and returns a
// canned row — so the stub only needs `.id` to exist, not a real column.
// `db` and `schema` are BOTH top-level named exports of "$lib/server/db"
// (`const { db } = await import(...)`, separately `const { schema } =
// await import(...)`) — schema is not a property of db.
const fakeSchema = {
	systemSettings: { id: "system_settings_id" },
	vectorizationConfigs: { id: "vectorization_configs_id" }
}

/** Full "$lib/server/db" module mock shape for a given pair of canned rows. */
function dbModuleMock(rows: {
	systemSettings?: any
	vectorizationConfigs?: any
}) {
	return {
		schema: fakeSchema,
		db: {
			query: {
				systemSettings: {
					findFirst: vi.fn(async () => rows.systemSettings)
				},
				vectorizationConfigs: {
					findFirst: vi.fn(async () => rows.vectorizationConfigs)
				}
			}
		}
	}
}

async function freshImport() {
	vi.resetModules()
	return await import("./index")
}

describe("loadConfiguredEmbeddingModel", () => {
	beforeEach(() => {
		testEmbedCreate.mockClear()
	})

	test("no-ops when vectorization is disabled — neither backend is touched", async () => {
		vi.doMock("$lib/server/db", () =>
			dbModuleMock({ systemSettings: { vectorizationEnabled: false } })
		)
		const mod = await freshImport()

		await mod.loadConfiguredEmbeddingModel()

		expect(mod.getLoadedModelId()).toBeNull()
		expect(mod.isModelReady()).toBe(false)
		expect(testEmbedCreate).not.toHaveBeenCalled()
	})

	test('mode: "api" activates the API backend, not the local pipeline', async () => {
		vi.doMock("$lib/server/db", () =>
			dbModuleMock({
				systemSettings: {
					vectorizationEnabled: true,
					embeddingModelName:
						"api::https://api.example.com::text-embedding-3-small"
				},
				vectorizationConfigs: {
					embeddingModelTtlMinutes: 5,
					mode: "api",
					apiBaseUrl: "https://api.example.com",
					apiKey: null,
					apiKeyIv: null,
					apiKeyAuthTag: null,
					apiModel: "text-embedding-3-small"
				}
			})
		)
		const mod = await freshImport()

		await mod.loadConfiguredEmbeddingModel()

		expect(testEmbedCreate).toHaveBeenCalledTimes(1)
		expect(mod.isModelReady()).toBe(true)
		expect(mod.getLoadedModelId()).toBe(
			mod.buildApiModelId(
				"https://api.example.com",
				"text-embedding-3-small"
			)
		)
	})

	test("mode unset (local/default) takes the loadEmbeddingModel() path, not activateApiEmbedding() — proven by the local-path-specific error, not the API one", async () => {
		vi.doMock("$lib/server/db", () =>
			dbModuleMock({
				systemSettings: {
					vectorizationEnabled: true,
					// A name no local model definition recognizes —
					// loadEmbeddingModel()'s findModel() lookup rejects this
					// with an error distinct from anything activateApiEmbedding()
					// would ever throw, so which branch ran is unambiguous.
					embeddingModelName: "not-a-real-local-model-id"
				},
				vectorizationConfigs: {
					embeddingModelTtlMinutes: 5,
					mode: "local",
					apiBaseUrl: null,
					apiKey: null,
					apiKeyIv: null,
					apiKeyAuthTag: null,
					apiModel: null
				}
			})
		)
		const mod = await freshImport()

		await expect(mod.loadConfiguredEmbeddingModel()).rejects.toThrow(
			/Unknown embedding model/
		)
		expect(testEmbedCreate).not.toHaveBeenCalled()
	})
})

describe("loadConfiguredEmbeddingModelOpportunistically", () => {
	afterEach(() => {
		testEmbedCreate.mockClear()
	})

	test("a second call within ttlMinutes of the first is suppressed (cooldown)", async () => {
		const mockModule = dbModuleMock({
			systemSettings: { vectorizationEnabled: false }
		})
		vi.doMock("$lib/server/db", () => mockModule)
		const mod = await freshImport()

		await mod.loadConfiguredEmbeddingModelOpportunistically()
		await mod.loadConfiguredEmbeddingModelOpportunistically()

		// The DB read is the observable proxy for "an attempt happened" —
		// loadConfiguredEmbeddingModel() always starts with it, so a
		// suppressed second call means it's never invoked at all.
		expect(
			mockModule.db.query.systemSettings.findFirst
		).toHaveBeenCalledTimes(1)
	})

	test("isModelReady() short-circuits — no load attempted once the backend is already warm", async () => {
		vi.doMock("$lib/server/db", () =>
			dbModuleMock({
				systemSettings: {
					vectorizationEnabled: true,
					embeddingModelName: "api::https://api.example.com::m"
				},
				vectorizationConfigs: {
					embeddingModelTtlMinutes: 5,
					mode: "api",
					apiBaseUrl: "https://api.example.com",
					apiKey: null,
					apiKeyIv: null,
					apiKeyAuthTag: null,
					apiModel: "m"
				}
			})
		)
		const mod = await freshImport()

		// Bring the backend up for real first (a genuine, non-opportunistic load).
		await mod.loadConfiguredEmbeddingModel()
		expect(mod.isModelReady()).toBe(true)
		testEmbedCreate.mockClear()

		await mod.loadConfiguredEmbeddingModelOpportunistically()

		expect(testEmbedCreate).not.toHaveBeenCalled()
	})
})
