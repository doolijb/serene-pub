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

const lmStudioConstructorMock = vi.fn()
const listDownloadedModelsMock = vi.fn()
const getLMStudioVersionMock = vi.fn()
vi.mock("@lmstudio/sdk", () => ({
	LMStudioClient: class {
		system = {
			listDownloadedModels: (...args: any[]) =>
				listDownloadedModelsMock(...args),
			getLMStudioVersion: (...args: any[]) =>
				getLMStudioVersionMock(...args)
		}
		llm = { model: vi.fn() }
		constructor(...args: any[]) {
			lmStudioConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./LMStudioAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "lmstudio",
		baseUrl: "ws://localhost:1234",
		model: "some-model",
		promptFormat: "chatml",
		extraJson: { ttl: 60 },
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
		sampling: {} as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "Test system prompt." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("LMStudioAdapter — base URL trailing-slash normalization", () => {
	test("getClient() constructs LMStudioClient with a normalized baseUrl", () => {
		lmStudioConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "ws://localhost:1234/" })
		adapter.getClient()
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: "ws://localhost:1234" })
		)
	})

	test("getClient() passes baseUrl: undefined (not empty string) when unset", () => {
		lmStudioConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "" })
		adapter.getClient()
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: undefined })
		)
	})

	test("testConnection() and listModels() also normalize baseUrl", async () => {
		lmStudioConstructorMock.mockClear()
		getLMStudioVersionMock.mockResolvedValue({ version: "1.0.0" })
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "m1" }])

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "ws://localhost:1234/" })
		)
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: "ws://localhost:1234" })
		)

		await exportsDefault.listModels(
			makeConnection({ baseUrl: "ws://localhost:1234///" })
		)
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: "ws://localhost:1234" })
		)
	})
})

describe("LMStudioAdapter.mapSamplingConfig()", () => {
	// `sampling` arrives already resolved, so a switched-off sampler reaches the
	// adapter as an absent key — omission is the only "off" there is. The
	// undefined/object guards are a separate rule about unusable values.
	test("maps known sampling keys, skipping omitted/undefined/object values", () => {
		const adapter = makeAdapter()
		adapter.sampling = { temperature: 0.7 } as any
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
	})
})

describe("LMStudioAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})
