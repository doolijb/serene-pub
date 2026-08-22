import { describe, expect, test, vi } from "vitest"

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

const anthropicConstructorMock = vi.fn()
const messagesCreateMock = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = {
			create: (...args: any[]) => messagesCreateMock(...args),
			stream: vi.fn()
		}
		constructor(...args: any[]) {
			anthropicConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./AnthropicAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "anthropic",
		baseUrl: "",
		model: "claude-sonnet-4-5",
		promptFormat: "openai",
		extraJson: { apiKey: "sk-ant-test", stream: false },
		...overrides
	}
}

function makeChat(): any {
	return {
		id: 1,
		userId: 1,
		chatType: "chat",
		metadata: { ragIgnored: true },
		chatMessages: [],
		chatCharacters: [],
		chatPersonas: [],
		lorebook: {
			id: 1,
			lorebookBindings: [],
			worldLoreEntries: [],
			characterLoreEntries: [],
			historyEntries: []
		}
	}
}

function makeAdapter(connectionOverrides: Record<string, any> = {}) {
	return new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		sampling: { contextTokensEnabled: false } as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "Test system prompt." } as any,
		chat: makeChat(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("AnthropicAdapter — base URL trailing-slash normalization", () => {
	test("getClient() (used by generate()) omits baseURL when unset (SDK default)", async () => {
		anthropicConstructorMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }]
		})
		const adapter = makeAdapter({ baseUrl: "" })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generate()
		expect(anthropicConstructorMock).toHaveBeenCalledWith(
			expect.not.objectContaining({ baseURL: expect.anything() })
		)
	})

	test("generate() normalizes a custom baseURL with a trailing slash", async () => {
		anthropicConstructorMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }]
		})
		const adapter = makeAdapter({
			baseUrl: "https://my-anthropic-proxy.example.com/"
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generate()
		expect(anthropicConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://my-anthropic-proxy.example.com"
			})
		)
	})
})

describe("AnthropicAdapter.mapSamplingConfig()", () => {
	test("maps known sampling keys, skipping disabled ones", () => {
		const adapter = makeAdapter()
		adapter.sampling = {
			temperature: 0.7,
			temperatureEnabled: true,
			topP: 0.9,
			topPEnabled: false
		} as any
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
	})
})

describe("AnthropicAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})

	test("listModels() returns the known-Claude-models list without a network call", async () => {
		const result = await exportsDefault.listModels(makeConnection())
		expect(result.models.length).toBeGreaterThan(0)
		expect(result.models[0]).toHaveProperty("id")
	})
})
