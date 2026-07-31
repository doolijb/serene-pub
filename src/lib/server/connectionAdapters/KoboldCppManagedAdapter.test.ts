import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// KoboldCppManagedAdapter -> KoboldCppAdapter -> BaseConnectionAdapter pulls
// in the full promptBuilder module graph at import time — mock minimally,
// same convention as BaseConnectionAdapter.test.ts. Also mock the
// koboldcpp-manager-specific modules this file imports so importing it never
// touches a real subprocess/DB.
const findFirstMock = vi.fn()
vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) },
			koboldCppSettings: { findFirst: () => findFirstMock() }
		}
	}
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))
const isRunningMock = vi.fn(() => true)
vi.mock("$lib/server/koboldcpp/subprocessManager", () => ({
	start: vi.fn(),
	suspendHealthCheck: vi.fn(),
	resumeHealthCheck: vi.fn(),
	pingActivity: vi.fn(),
	isExternal: vi.fn(() => false),
	isRunning: () => isRunningMock()
}))
const resetTtlMock = vi.fn()
const getLoadedSignatureMock = vi.fn(() => ({ model: "some-model.gguf" }) as any)
vi.mock("$lib/server/koboldcpp/modelManager", () => ({
	ensureModelLoaded: vi.fn(),
	DEFAULT_MANAGED_CONFIG: { gpuLayers: -1, flashAttention: false, batchSize: 512 },
	resetTtl: (...args: any[]) => resetTtlMock(...args),
	getLoadedSignature: () => getLoadedSignatureMock()
}))

const fetchCurrentModelNameMock = vi.fn()
const pingKoboldCPPMock = vi.fn()
vi.mock("$lib/server/koboldcpp/kcppHttp", () => ({
	fetchCurrentModelName: (...args: any[]) => fetchCurrentModelNameMock(...args),
	pingKoboldCPP: (...args: any[]) => pingKoboldCPPMock(...args)
}))

const exportsDefault = (await import("./KoboldCppManagedAdapter")).default
const { ensureModelLoaded } = await import(
	"$lib/server/koboldcpp/modelManager"
)
const subprocessManager = await import(
	"$lib/server/koboldcpp/subprocessManager"
)

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "koboldcpp_managed",
		baseUrl: "",
		model: "some-model.gguf",
		promptFormat: "vicuna",
		extraJson: {},
		...overrides
	}
}

function makeChat(overrides: Record<string, any> = {}) {
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
		},
		...overrides
	} as any
}

function makeAdapter(overrides: Record<string, any> = {}) {
	return new exportsDefault.Adapter({
		connection: makeConnection(),
		sampling: { contextTokensEnabled: false } as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "system" } as any,
		chat: makeChat(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.8,
		...overrides
	}) as InstanceType<typeof exportsDefault.Adapter>
}

const MANAGED_SETTINGS = {
	koboldCppManagerEnabled: true,
	koboldCppManagedMode: "managed" as const,
	koboldCppManagedBinaryDir: "/opt/koboldcpp",
	koboldCppManagerBaseUrl: "http://localhost:5001",
	koboldCppManagerModelsDir: null,
	koboldCppManagedAdminPassword: "pw",
	koboldCppManagedModelTtlSecs: 300
}

describe("KoboldCppManagedAdapter — base URL resolution", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		findFirstMock.mockReset()
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ version: "1.2.3" })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})

	test("testConnection() prefers the manager's configured base URL over the connection's own, trailing slash normalized", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerBaseUrl: "http://manager-host:5001/"
		})
		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "http://connection-host:5001" })
		)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://manager-host:5001/api/extra/version",
			expect.anything()
		)
	})

	test("testConnection() falls back to connection.baseUrl (normalized) when no manager setting exists", async () => {
		findFirstMock.mockResolvedValue({ koboldCppManagerBaseUrl: null })
		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "http://connection-host:5001/" })
		)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://connection-host:5001/api/extra/version",
			expect.anything()
		)
	})

	test("testConnection() falls back to the documented default when nothing is configured", async () => {
		findFirstMock.mockResolvedValue(undefined)
		await exportsDefault.testConnection(makeConnection({ baseUrl: "" }))
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://localhost:5001/api/extra/version",
			expect.anything()
		)
	})

	test("listModels() also prefers the normalized manager base URL", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerBaseUrl: "http://manager-host:5001/"
		})
		fetchCurrentModelNameMock.mockResolvedValue("loaded-model")
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => []
		})
		const result = await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://connection-host:5001" })
		)
		expect(fetchCurrentModelNameMock).toHaveBeenCalledWith(
			"http://manager-host:5001"
		)
		expect(result.models[0].name).toContain("loaded-model")
	})
})

describe("KoboldCppManagedAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})

describe("KoboldCppManagedAdapter.preflight() — retry loop", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		findFirstMock.mockReset()
		pingKoboldCPPMock.mockReset()
		vi.mocked(ensureModelLoaded).mockReset()
		vi.mocked(subprocessManager.start).mockReset().mockResolvedValue(undefined)
		findFirstMock.mockResolvedValue({ ...MANAGED_SETTINGS })
		// Already responding by default — most of these tests are about
		// ensureModelLoaded()'s own outcome, not the spawn path (that's
		// subprocessManager's own test file's job).
		pingKoboldCPPMock.mockResolvedValue(true)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("resolves on the first attempt when ensureModelLoaded succeeds immediately", async () => {
		const adapter = makeAdapter()
		vi.mocked(ensureModelLoaded).mockResolvedValue(undefined)

		await adapter.preflight()

		expect(ensureModelLoaded).toHaveBeenCalledTimes(1)
	})

	test("retries after a transient failure and succeeds on the second attempt", async () => {
		const adapter = makeAdapter()
		vi.mocked(ensureModelLoaded)
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce(undefined)

		const promise = adapter.preflight()
		await vi.advanceTimersByTimeAsync(2000) // first retry delay
		await promise

		expect(ensureModelLoaded).toHaveBeenCalledTimes(2)
	})

	test("retries through multiple failures and succeeds on the last configured attempt", async () => {
		const adapter = makeAdapter()
		vi.mocked(ensureModelLoaded)
			.mockRejectedValueOnce(new Error("transient 1"))
			.mockRejectedValueOnce(new Error("transient 2"))
			.mockResolvedValueOnce(undefined)

		const promise = adapter.preflight()
		await vi.advanceTimersByTimeAsync(2000) // 1 -> 2
		await vi.advanceTimersByTimeAsync(4000) // 2 -> 3
		await promise

		expect(ensureModelLoaded).toHaveBeenCalledTimes(3)
	})

	test("gives up and rejects with the final error once every attempt has failed", async () => {
		const adapter = makeAdapter()
		vi.mocked(ensureModelLoaded)
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockRejectedValueOnce(new Error("fail 3 — final"))

		const promise = adapter.preflight()
		promise.catch(() => {})
		await vi.advanceTimersByTimeAsync(2000)
		await vi.advanceTimersByTimeAsync(4000)

		await expect(promise).rejects.toThrow(/fail 3 — final/)
		expect(ensureModelLoaded).toHaveBeenCalledTimes(3)
	})

	test("does not retry at all once the abort signal fires", async () => {
		const adapter = makeAdapter()
		const controller = new AbortController()
		vi.mocked(ensureModelLoaded).mockImplementation(async () => {
			controller.abort()
			throw new Error("failed right as we were cancelled")
		})

		const promise = adapter.preflight(controller.signal)
		promise.catch(() => {})
		await vi.advanceTimersByTimeAsync(0)

		await expect(promise).rejects.toThrow(
			/failed right as we were cancelled/
		)
		expect(ensureModelLoaded).toHaveBeenCalledTimes(1)
	})

	test("fails fast with no retry when the Manager is disabled — not a transient condition", async () => {
		findFirstMock.mockResolvedValue({
			...MANAGED_SETTINGS,
			koboldCppManagerEnabled: false
		})
		const adapter = makeAdapter()

		await expect(adapter.preflight()).rejects.toThrow(
			/KoboldCPP Manager is disabled/
		)
		expect(ensureModelLoaded).not.toHaveBeenCalled()
	})

	test("fails fast with no retry when no model is selected on the connection", async () => {
		const adapter = makeAdapter({
			connection: makeConnection({ model: "" })
		})

		await expect(adapter.preflight()).rejects.toThrow(
			/No model selected/
		)
		expect(ensureModelLoaded).not.toHaveBeenCalled()
	})
})

describe("KoboldCppManagedAdapter.generate() — TTL reset after completion", () => {
	const originalFetch = global.fetch

	beforeEach(() => {
		findFirstMock.mockResolvedValue(MANAGED_SETTINGS)
		resetTtlMock.mockClear()
		getLoadedSignatureMock.mockReturnValue({ model: "some-model.gguf" } as any)
		isRunningMock.mockReturnValue(true)
	})

	afterEach(() => {
		global.fetch = originalFetch
	})

	function makeNonStreamingAdapter() {
		const adapter = makeAdapter({
			connection: makeConnection({
				baseUrl: "http://localhost:5001",
				extraJson: { stream: false, useChat: true }
			})
		})
		vi.spyOn(adapter.promptBuilder, "compilePrompt").mockResolvedValue({
			messages: [{ role: "user", content: "hi" }]
		} as any)
		return adapter
	}

	test("resets the TTL after a successful generation", async () => {
		global.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{ message: { content: "hello" }, finish_reason: "stop" }
				]
			})
		})) as any

		const adapter = makeNonStreamingAdapter()
		const result = await adapter.generate()

		expect(result.completionResult).toBe("hello")
		expect(resetTtlMock).toHaveBeenCalledTimes(1)
		expect(resetTtlMock).toHaveBeenCalledWith(
			"http://localhost:5001",
			MANAGED_SETTINGS.koboldCppManagedAdminPassword,
			MANAGED_SETTINGS.koboldCppManagedModelTtlSecs
		)
	})

	test("does not reset the TTL after a failure when the subprocess is confirmed dead", async () => {
		global.fetch = vi.fn(async () => ({
			ok: false,
			status: 500,
			text: async () => "koboldcpp crashed"
		})) as any
		isRunningMock.mockReturnValue(false)

		const adapter = makeNonStreamingAdapter()
		await expect(adapter.generate()).rejects.toThrow()

		expect(resetTtlMock).not.toHaveBeenCalled()
	})

	test("still resets the TTL after a failure when the subprocess is confirmed alive (e.g. a bad request, not a crash)", async () => {
		global.fetch = vi.fn(async () => ({
			ok: false,
			status: 400,
			text: async () => "bad request"
		})) as any
		isRunningMock.mockReturnValue(true)

		const adapter = makeNonStreamingAdapter()
		await expect(adapter.generate()).rejects.toThrow()

		expect(resetTtlMock).toHaveBeenCalledTimes(1)
	})

	test("does not reset the TTL when getLoadedSignature() already reports nothing loaded", async () => {
		global.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{ message: { content: "hello" }, finish_reason: "stop" }
				]
			})
		})) as any
		getLoadedSignatureMock.mockReturnValue(null)

		const adapter = makeNonStreamingAdapter()
		await adapter.generate()

		expect(resetTtlMock).not.toHaveBeenCalled()
	})
})
