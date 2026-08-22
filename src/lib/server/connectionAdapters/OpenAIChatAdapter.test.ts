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

const openAIConstructorMock = vi.fn()
const createMock = vi.fn()
const modelsListMock = vi.fn()
vi.mock("openai", () => ({
	OpenAI: class {
		chat = {
			completions: { create: (...args: any[]) => createMock(...args) }
		}
		models = { list: (...args: any[]) => modelsListMock(...args) }
		constructor(...args: any[]) {
			openAIConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./OpenAIChatAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "openai",
		baseUrl: "https://api.example.com/v1",
		model: "gpt-4o",
		promptFormat: "openai",
		extraJson: { apiKey: "sk-test" },
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

describe("OpenAIChatAdapter — base URL trailing-slash normalization", () => {
	test("generate() constructs the OpenAI client with a normalized baseURL", async () => {
		openAIConstructorMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }]
		})
		const adapter = makeAdapter({ baseUrl: "https://api.example.com/v1/" })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generate()
		expect(openAIConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)
	})

	test("listModels() and testConnection() also normalize the base URL", async () => {
		openAIConstructorMock.mockClear()
		modelsListMock.mockResolvedValue({ data: [] })
		await exportsDefault.listModels(
			makeConnection({ baseUrl: "https://api.example.com/v1///" })
		)
		expect(openAIConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "https://api.example.com/v1" })
		)
		expect(openAIConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)
	})

	test("falls back to the connection-type default (normalized) when baseUrl is unset", async () => {
		openAIConstructorMock.mockClear()
		modelsListMock.mockResolvedValue({ data: [] })
		await exportsDefault.listModels(makeConnection({ baseUrl: "" }))
		// The OpenAI Chat connection type's own default baseUrl is "" (empty —
		// meaning "use the real OpenAI API," which the SDK does when baseURL
		// is undefined), so the resolved value should be undefined, not "".
		expect(openAIConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: undefined })
		)
	})
})

describe("OpenAIChatAdapter.mapSamplingConfig()", () => {
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

describe("OpenAIChatAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})
