import { describe, expect, test, vi } from "vitest"
import axios from "axios"

vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) }
		}
	}
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))
vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		CancelToken: { source: () => ({ token: "token", cancel: vi.fn() }) },
		isCancel: () => false
	}
}))

const exportsDefault = (await import("./LlamaCppAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "llamacpp_completion",
		baseUrl: "http://localhost:8080",
		model: "",
		promptFormat: "vicuna",
		extraJson: {},
		...overrides
	}
}

describe("LlamaCppAdapter — base URL trailing-slash normalization", () => {
	test("testConnection() hits the same URL whether baseUrl has a trailing slash or not", async () => {
		vi.mocked(axios.get).mockResolvedValue({ data: { status: "ok" } })

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "http://localhost:8080" })
		)
		expect(axios.get).toHaveBeenLastCalledWith(
			"http://localhost:8080/health"
		)

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "http://localhost:8080/" })
		)
		expect(axios.get).toHaveBeenLastCalledWith(
			"http://localhost:8080/health"
		)
	})

	test("testConnection() falls back to the documented default when baseUrl is unset", async () => {
		vi.mocked(axios.get).mockResolvedValue({ data: { status: "ok" } })
		await exportsDefault.testConnection(makeConnection({ baseUrl: "" }))
		expect(axios.get).toHaveBeenLastCalledWith(
			"http://localhost:8080/health"
		)
	})

	test("testConnection() reports a network error", async () => {
		vi.mocked(axios.get).mockRejectedValue(
			new Error("connect ECONNREFUSED")
		)
		const result = await exportsDefault.testConnection(makeConnection())
		expect(result.ok).toBe(false)
		expect(result.error).toContain("ECONNREFUSED")
	})

	test("listModels() hits the normalized URL and reports the loaded model", async () => {
		vi.mocked(axios.get).mockResolvedValue({
			data: { model: "some-model.gguf" }
		})
		const result = await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://localhost:8080///" })
		)
		expect(axios.get).toHaveBeenLastCalledWith("http://localhost:8080/show")
		expect(result.models[0].model).toBe("some-model.gguf")
	})
})

describe("LlamaCppAdapter.mapSamplingConfig()", () => {
	// `sampling` arrives already resolved, so a switched-off sampler reaches the
	// adapter as an absent key — omission is the only "off" there is.
	test("maps known sampling keys, skipping omitted ones", async () => {
		// LlamaCppAdapter isn't a named export — build an adapter via the
		// exported class on the AdapterExports object instead.
		const adapter = new exportsDefault.Adapter({
			connection: makeConnection(),
			sampling: { temperature: 0.7 } as any,
			contextConfig: {} as any,
			promptConfig: { systemPrompt: "Test" } as any,
			session: {
				id: 1,
				userId: 1,
				sessionType: "session",
				metadata: { ragIgnored: true },
				sessionMessages: [],
				sessionCharacters: [],
				sessionPersonas: [],
				lorebook: {
					id: 1,
					lorebookBindings: [],
					worldLoreEntries: [],
					characterLoreEntries: [],
					historyEntries: []
				}
			} as any,
			currentCharacterId: null,
			tokenCounter: { countTokens: async () => 1 } as any,
			tokenLimit: 4096,
			contextThresholdPercent: 0.9
		}) as any

		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_k).toBeUndefined()
	})
})

describe("LlamaCppAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})
