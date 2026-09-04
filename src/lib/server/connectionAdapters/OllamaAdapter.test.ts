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

const ollamaConstructorMock = vi.fn()
const listMock = vi.fn()
vi.mock("ollama", () => ({
	Ollama: class {
		list = (...args: any[]) => listMock(...args)
		session = vi.fn()
		generate = vi.fn()
		abort = vi.fn()
		constructor(...args: any[]) {
			ollamaConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./OllamaAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "ollama",
		baseUrl: "http://localhost:11434",
		model: "llama3",
		promptFormat: "vicuna",
		extraJson: { useSession: true, stream: false },
		...overrides
	}
}

function makeSession(): any {
	return {
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
	}
}

function makeAdapter(connectionOverrides: Record<string, any> = {}) {
	return new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		// Empty is what "the context budget is switched off" resolves to now:
		sampling: {},
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "Test system prompt." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("OllamaAdapter — base URL trailing-slash normalization", () => {
	test("getClient() (used by generateText()) constructs Ollama with a normalized host", async () => {
		ollamaConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "http://localhost:11434/" })
		adapter.getClient()
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: "http://localhost:11434" })
		)
	})

	test("getClient() collapses multiple trailing slashes", async () => {
		ollamaConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "http://localhost:11434///" })
		adapter.getClient()
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: "http://localhost:11434" })
		)
	})

	test("getClient() passes host: undefined (not empty string) when baseUrl is unset", async () => {
		ollamaConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "" })
		adapter.getClient()
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: undefined })
		)
	})

	test("listModels() also normalizes the host", async () => {
		ollamaConstructorMock.mockClear()
		listMock.mockResolvedValue({ models: [] })
		await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://localhost:11434/" })
		)
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: "http://localhost:11434" })
		)
	})
})

describe("OllamaAdapter.mapSamplingConfig()", () => {
	test("maps the keys the resolved config contains, and never the 'streaming' key", () => {
		const adapter = makeAdapter()
		// `sampling` arrives resolved: topP is absent rather than disabled,
		// because absence is the only way "switched off" is expressed now.
		adapter.sampling = {
			temperature: 0.7,
			streaming: true
		}
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
		expect(result.streaming).toBeUndefined()
	})
})

describe("OllamaAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})
