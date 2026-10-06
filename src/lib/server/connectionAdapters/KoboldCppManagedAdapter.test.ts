import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// KoboldCppManagedAdapter -> KoboldCppAdapter -> BaseConnectionAdapter pulls
// in the full promptBuilder module graph at import time — mock minimally,
// same convention as BaseConnectionAdapter.test.ts. Also mock the
// koboldcpp-manager-specific modules this file imports so importing it never
// touches a real subprocess/DB.
const findFirstMock = vi.fn()
const localModelsMock = vi.fn(async () => [] as any[])
/** The endpoint's own `image-gen` model rows — `listImageModels` keeps them. */
const ownImageRowsMock = vi.fn(async () => [] as { model: string }[])
vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) },
			koboldCppSettings: { findFirst: () => findFirstMock() },
			localModels: { findMany: () => localModelsMock() }
		},
		select: () => ({
			from: () => ({ where: () => ownImageRowsMock() })
		})
	}
}))
const readdirMock = vi.fn()
vi.mock("fs/promises", () => ({
	readdir: (...args: any[]) => readdirMock(...args)
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
const getLoadedSignatureMock = vi.fn(
	() => ({ model: "some-model.gguf" }) as any
)
vi.mock("$lib/server/koboldcpp/modelManager", () => ({
	ensureModelLoaded: vi.fn(),
	DEFAULT_MANAGED_CONFIG: {
		gpuLayers: -1,
		flashAttention: false,
		batchSize: 512
	},
	resetTtl: (...args: any[]) => resetTtlMock(...args),
	getLoadedSignature: () => getLoadedSignatureMock()
}))

const fetchCurrentModelNameMock = vi.fn()
const pingKoboldCPPMock = vi.fn()
vi.mock("$lib/server/koboldcpp/kcppHttp", () => ({
	fetchCurrentModelName: (...args: any[]) =>
		fetchCurrentModelNameMock(...args),
	pingKoboldCPP: (...args: any[]) => pingKoboldCPPMock(...args)
}))

// The header read, observed: `fs/promises` is mocked above without `open`, so
// the real classifier would answer "unknown" for every file.
const classifyMock = vi.fn(async (_path: string) => ({
	kind: "unknown" as Sockets.KoboldCPP.ModelKind,
	reason: ""
}))
/** Which image files are on disk, for `resolveModelPath(..., {mustExist})`. */
let imageFilesOnDisk: string[] = []
vi.mock("$lib/server/koboldcpp/modelsDir", async (orig) => ({
	...((await orig()) as any),
	resolveModelPath: async (kind: string, name: string) => {
		if (kind === "image" && imageFilesOnDisk.includes(name))
			return `/models/image/${name}`
		throw new Error("not on disk")
	}
}))
vi.mock("$lib/server/koboldcpp/modelKind", async (orig) => ({
	...((await orig()) as any),
	classifyModelFile: (p: string) => classifyMock(p)
}))
// The one-time re-read of `detected` text rows has its own tests
// (`rereadDetectedKinds.int.test.ts`); here it would only consume the
// `db.select` answers these cases hand `listImageModels`.
const rereadMock = vi.fn(async () => [] as string[])
vi.mock("$lib/server/koboldcpp/rereadDetectedKinds", () => ({
	rereadDetectedTextModels: () => rereadMock()
}))

const exportsDefault = (await import("./KoboldCppManagedAdapter")).default
const { ensureModelLoaded } = await import("$lib/server/koboldcpp/modelManager")
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

function makeSession(overrides: Record<string, any> = {}) {
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
		},
		...overrides
	} as any
}

function makeAdapter(overrides: Record<string, any> = {}) {
	return new exportsDefault.Adapter({
		connection: makeConnection(),
		// Empty is what "the context budget is switched off" resolves to now:
		sampling: {},
		systemPrompt: "system",
		session: makeSession(),
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

	// The listing that decides `missing_since`. koboldcpp's admin API lists
	// its --admindir (the BINARY directory), which has answered `[]` for every
	// install since the models got their own directory — a successful, empty
	// listing that marked the connection's one model missing and had the
	// resolver refuse every run before preflight. Seen live 2026-09-19.
	describe("listModels() with a models directory configured", () => {
		beforeEach(() => {
			findFirstMock.mockResolvedValue({
				koboldCppManagerBaseUrl: "http://manager-host:5001/",
				koboldCppManagerModelsDir: "/models/llm"
			})
			localModelsMock.mockResolvedValue([])
		})

		test("lists the ggufs in the text models directory and never asks the admin API", async () => {
			readdirMock.mockResolvedValue([
				"b.gguf",
				"a.gguf",
				"notes.txt",
				"sd.safetensors"
			])
			const result = await exportsDefault.listModels(makeConnection({}))
			expect(readdirMock).toHaveBeenCalledWith("/models/llm")
			expect(fetchMock).not.toHaveBeenCalled()
			expect(result.error).toBeUndefined()
			expect(result.models).toEqual([
				{ model: "a.gguf", name: "a.gguf", modality: "text-gen" },
				{ model: "b.gguf", name: "b.gguf", modality: "text-gen" }
			])
		})

		// An embedding GGUF measured before `embeddings` existed is a
		// `detected` text row; the re-read runs BEFORE the registry is read,
		// so this very sync files it as an embedding model.
		test("re-reads detected kinds before reading the registry, and survives a failed re-read", async () => {
			const order: string[] = []
			rereadMock.mockImplementationOnce(async () => {
				order.push("reread")
				return []
			})
			localModelsMock.mockImplementationOnce(async () => {
				order.push("registry")
				return [
					{
						filename: "nomic.gguf",
						kind: "embeddings",
						status: "complete"
					}
				]
			})
			readdirMock.mockResolvedValue(["nomic.gguf"])
			const result = await exportsDefault.listModels(makeConnection({}))
			expect(order).toEqual(["reread", "registry"])
			expect(result.models).toEqual([
				{
					model: "nomic.gguf",
					name: "nomic.gguf",
					modality: "embeddings"
				}
			])

			rereadMock.mockRejectedValueOnce(new Error("disk went away"))
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			const after = await exportsDefault.listModels(makeConnection({}))
			expect(after.error).toBeUndefined()
			expect(warn).toHaveBeenCalled()
			warn.mockRestore()
		})

		test("files a classified image model under IMAGE, and leaves out one still downloading", async () => {
			readdirMock.mockResolvedValue([
				"chat.gguf",
				"sdxl.gguf",
				"half.gguf"
			])
			localModelsMock.mockResolvedValue([
				{ filename: "sdxl.gguf", kind: "image", status: "complete" },
				{ filename: "half.gguf", kind: "text", status: "downloading" },
				{ filename: "chat.gguf", kind: "text", status: "complete" }
			])
			const result = await exportsDefault.listModels(makeConnection({}))
			// One endpoint chats and draws: the image model is listed, as one.
			expect(result.models).toEqual([
				{ model: "chat.gguf", name: "chat.gguf", modality: "text-gen" },
				{ model: "sdxl.gguf", name: "sdxl.gguf", modality: "image-gen" }
			])
		})

		test("keeps an image model a person already chose on this endpoint, whatever its kind says", async () => {
			// `unknown` is deliberately selectable in the managed KoboldCPP; dropping it
			// from the listing would mark that choice missing on the next sync.
			readdirMock.mockResolvedValue(["chat.gguf"])
			localModelsMock.mockResolvedValue([
				{ filename: "chat.gguf", kind: "text", status: "complete" },
				{ filename: "odd.gguf", kind: "unknown", status: "complete" }
			])
			ownImageRowsMock.mockResolvedValueOnce([
				{ model: "odd.gguf" },
				{ model: "gone.gguf" }
			])
			imageFilesOnDisk = ["odd.gguf"]
			const result = await exportsDefault.listModels(makeConnection({}))
			expect(
				result.models.map((m: any) => [m.model, m.modality])
			).toEqual([
				["chat.gguf", "text-gen"],
				// Its file is still there…
				["odd.gguf", "image-gen"]
				// …and `gone.gguf`'s is not, so it is honestly missing.
			])
			imageFilesOnDisk = []
		})

		// Plan 2026-09-24 C5: the sync can run before the managed KoboldCPP's own
		// listing registers a new file. An unregistered image GGUF is read,
		// not assumed to be text; a registered one is never re-read here.
		test("reads an unregistered file's header and leaves out an image model", async () => {
			classifyMock.mockClear()
			readdirMock.mockResolvedValue(["chat.gguf", "sdxs.gguf"])
			localModelsMock.mockResolvedValue([
				{ filename: "chat.gguf", kind: "text", status: "complete" }
			])
			classifyMock.mockImplementation(async (p: string) => ({
				kind: p.endsWith("sdxs.gguf") ? "image" : "text",
				reason: ""
			}))
			const result = await exportsDefault.listModels(makeConnection({}))
			// Left out of the TEXT half. It is not in the image half either
			// until the managed KoboldCPP's own listing registers it as an image model.
			expect(result.models).toEqual([
				{ model: "chat.gguf", name: "chat.gguf", modality: "text-gen" }
			])
			expect(classifyMock).toHaveBeenCalledTimes(1)
			expect(classifyMock).toHaveBeenCalledWith("/models/llm/sdxs.gguf")
			classifyMock.mockReset()
			classifyMock.mockResolvedValue({ kind: "unknown", reason: "" })
		})

		// B1 (2026-10-05): an embedding GGUF sits in the text directory, and
		// listing it as `text-gen` offered it for chat. `modality` is what
		// `capabilityRefusal` gates the chat picker on.
		test("lists an embedding model as EMBEDDINGS, never as a text model", async () => {
			readdirMock.mockResolvedValue(["chat.gguf", "nomic.gguf"])
			localModelsMock.mockResolvedValue([
				{ filename: "chat.gguf", kind: "text", status: "complete" },
				{
					filename: "nomic.gguf",
					kind: "embeddings",
					status: "complete"
				}
			])
			const result = await exportsDefault.listModels(makeConnection({}))
			expect(result.models).toEqual([
				{ model: "chat.gguf", name: "chat.gguf", modality: "text-gen" },
				{
					model: "nomic.gguf",
					name: "nomic.gguf",
					modality: "embeddings"
				}
			])
		})

		test("an unregistered file whose header says embeddings is listed as one", async () => {
			readdirMock.mockResolvedValue(["chat.gguf", "bge.gguf"])
			localModelsMock.mockResolvedValue([
				{ filename: "chat.gguf", kind: "text", status: "complete" }
			])
			classifyMock.mockImplementation(async (p: string) => ({
				kind: p.endsWith("bge.gguf") ? "embeddings" : "text",
				reason: ""
			}))
			const result = await exportsDefault.listModels(makeConnection({}))
			expect(result.models).toEqual([
				{ model: "bge.gguf", name: "bge.gguf", modality: "embeddings" },
				{ model: "chat.gguf", name: "chat.gguf", modality: "text-gen" }
			])
			classifyMock.mockReset()
			classifyMock.mockResolvedValue({ kind: "unknown", reason: "" })
		})

		test("an unreadable directory is an ERROR, never an empty list", async () => {
			readdirMock.mockRejectedValue(new Error("ENOENT"))
			const result = await exportsDefault.listModels(makeConnection({}))
			expect(result.models).toEqual([])
			expect(result.error).toMatch(/could not be read/)
		})
	})

	test("listModels() with no models directory falls back to the admin API, preferring the normalized manager base URL", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerBaseUrl: "http://manager-host:5001/"
		})
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ["a.gguf", "b.gguf"]
		})
		const result = await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://connection-host:5001" })
		)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://manager-host:5001/api/admin/list_options",
			expect.anything()
		)
		// Real identifiers only — no "[current]" sentinel, which a persisted
		// sync would have turned into a row no host lists.
		expect(result.models).toEqual([
			{ model: "a.gguf", name: "a.gguf", modality: "text-gen" },
			{ model: "b.gguf", name: "b.gguf", modality: "text-gen" }
		])
	})

	test("listModels() (admin-API fallback) answers with an ERROR when the admin API is unreachable, never an empty list", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerBaseUrl: "http://manager-host:5001/"
		})
		fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))
		const result = await exportsDefault.listModels(makeConnection({}))
		expect(result.models).toEqual([])
		expect(result.error).toMatch(/could not be reached/)
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
		vi.mocked(subprocessManager.start)
			.mockReset()
			.mockResolvedValue(undefined)
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
		vi.mocked(ensureModelLoaded).mockResolvedValue(true)

		await adapter.preflight()

		expect(ensureModelLoaded).toHaveBeenCalledTimes(1)
	})

	test("retries after a transient failure and succeeds on the second attempt", async () => {
		const adapter = makeAdapter()
		vi.mocked(ensureModelLoaded)
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce(true)

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
			.mockResolvedValueOnce(true)

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

	test("fails fast with no retry when KoboldCPP, run by Serene Pub, is turned off — not a transient condition", async () => {
		findFirstMock.mockResolvedValue({
			...MANAGED_SETTINGS,
			koboldCppManagerEnabled: false
		})
		const adapter = makeAdapter()

		await expect(adapter.preflight()).rejects.toThrow(
			/KoboldCPP, run by Serene Pub, is turned off/
		)
		expect(ensureModelLoaded).not.toHaveBeenCalled()
	})

	test("fails fast with no retry when no model is selected on the connection", async () => {
		const adapter = makeAdapter({
			connection: makeConnection({ model: "" })
		})

		await expect(adapter.preflight()).rejects.toThrow(/No model selected/)
		expect(ensureModelLoaded).not.toHaveBeenCalled()
	})
})

describe("KoboldCppManagedAdapter.generateText() — TTL reset after completion", () => {
	const originalFetch = global.fetch

	beforeEach(() => {
		findFirstMock.mockResolvedValue(MANAGED_SETTINGS)
		resetTtlMock.mockClear()
		getLoadedSignatureMock.mockReturnValue({
			model: "some-model.gguf"
		} as any)
		isRunningMock.mockReturnValue(true)
	})

	afterEach(() => {
		global.fetch = originalFetch
	})

	function makeNonStreamingAdapter() {
		const adapter = makeAdapter({
			connection: makeConnection({
				baseUrl: "http://localhost:5001",
				wireMode: "chat",
				extraJson: { stream: false }
			})
		})
		adapter.withCompiledPrompt({
			messages: [{ role: "user", content: "hi" }]
		} as any)
		return adapter
	}

	test("resets the TTL after a successful generation", async () => {
		global.fetch = vi.fn(async () => ({
			ok: true,
			json: async () =>
				({
					choices: [
						{ message: { content: "hello" }, finish_reason: "stop" }
					]
				}) as any
		})) as any

		const adapter = makeNonStreamingAdapter()
		const result = await adapter.generateText()

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
		await expect(adapter.generateText()).rejects.toThrow()

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
		await expect(adapter.generateText()).rejects.toThrow()

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
		await adapter.generateText()

		expect(resetTtlMock).not.toHaveBeenCalled()
	})
})
