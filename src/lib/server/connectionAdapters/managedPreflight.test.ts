import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import * as fsPromises from "fs/promises"
import * as os from "os"
import * as path from "path"

/**
 * Getting a managed koboldcpp ready WITHOUT a generation attached.
 *
 * This file exists because of a bug it would have caught and did not, since
 * nothing constructed the real class: `dispatchImage` called
 * `new managed.Adapter({ connection }).preflight(signal)`, and that constructor
 * is the GENERATION constructor — it dereferences `sampling.contextTokens` to
 * compute `tokenLimit`. It threw a TypeError before `preflight()` ran, so every
 * image render on a managed KoboldCPP failed, and the only test covering the
 * path had replaced the whole class with `class { constructor(_p: any) {} }`.
 *
 * So the rule this file enforces, and the reason it still exists now that the
 * trap has been designed out rather than fixed: the image path is exercised
 * against the REAL code. A stub that cannot fail the way production fails is not
 * a test of production. `ensureManagedReady` is called here exactly as
 * `dispatchImage` calls it — with a model name and nothing else.
 *
 * The models directory is a real temp directory with real files in it, because
 * "the load resolves the right file, and says so by name when it can't" is a
 * filesystem question and a mock would answer it however it was told to.
 */

let modelsRoot: string
let textDir: string
let imageDir: string

const settings: Record<string, any> = {
	koboldCppManagerEnabled: true,
	koboldCppManagerBaseUrl: "http://localhost:5001",
	koboldCppManagedBinaryDir: "/opt/kcpp",
	koboldCppManagedMode: "managed",
	koboldCppManagedModelTtlSecs: 300,
	koboldCppManagerModelsDir: null as string | null,
	koboldCppImageModelsDir: null as string | null,
	koboldCppManagedAdminPassword: ""
}

vi.mock("$lib/server/db", () => ({
	db: { query: { koboldCppSettings: { findFirst: async () => settings } } }
}))

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))

/** What `ensureModelLoaded` was asked to load. */
let loadOpts: any = null
let loadError: Error | null = null

vi.mock("$lib/server/koboldcpp/modelManager", () => ({
	ensureModelLoaded: async (opts: any) => {
		loadOpts = opts
		if (loadError) throw loadError
	},
	resetTtl: () => {},
	getLoadedSignature: () => null,
	DEFAULT_MANAGED_CONFIG: {
		gpuLayers: -1,
		flashAttention: false,
		batchSize: 512
	}
}))

vi.mock("$lib/server/koboldcpp/kcppHttp", () => ({
	pingKoboldCPP: async () => true,
	fetchCurrentModelName: async () => "llama-3.gguf"
}))

vi.mock("$lib/server/koboldcpp/subprocessManager", () => ({
	start: async () => {},
	isRunning: () => true,
	isExternal: () => false,
	suspendHealthCheck: () => {},
	resumeHealthCheck: () => {},
	pingActivity: () => {}
}))

beforeAll(async () => {
	modelsRoot = await fsPromises.mkdtemp(
		path.join(os.tmpdir(), "sp-managed-preflight-")
	)
	textDir = path.join(modelsRoot, "llm")
	imageDir = path.join(modelsRoot, "image")
	await fsPromises.mkdir(textDir)
	await fsPromises.mkdir(imageDir)
	await fsPromises.writeFile(path.join(textDir, "llama-3.gguf"), "x")
	await fsPromises.writeFile(path.join(imageDir, "sdxl.safetensors"), "x")
	// An image model downloaded before there were two directories.
	await fsPromises.writeFile(path.join(textDir, "legacy-sd.gguf"), "x")
})

afterAll(async () => {
	await fsPromises.rm(modelsRoot, { recursive: true, force: true })
})

beforeEach(() => {
	loadOpts = null
	loadError = null
	settings.koboldCppManagerEnabled = true
	settings.koboldCppManagedMode = "managed"
	settings.koboldCppManagerModelsDir = textDir
	settings.koboldCppImageModelsDir = imageDir
	vi.resetModules()
})

const loadReady = async () =>
	(await import("$lib/server/koboldcpp/managedPreflight")).ensureManagedReady

const imageSpec = (over: Record<string, any> = {}) => ({
	kind: "image" as const,
	file: "sdxl.safetensors",
	...over
})

const textSpec = (over: Record<string, any> = {}) => ({
	kind: "text" as const,
	file: "llama-3.gguf",
	gpuLayers: -1,
	flashAttention: false,
	batchSize: 512,
	contextSize: 4096,
	...over
})

describe("ensureManagedReady — the image path", () => {
	it("runs on a model name alone, where the generation constructor would throw", async () => {
		// The regression itself, now structural rather than handled: there is no
		// adapter to construct, so there is no `sampling.contextTokens` to
		// dereference and no `session.sessionType` to derive a mode from.
		const ensureManagedReady = await loadReady()

		await expect(
			ensureManagedReady(imageSpec(), { connectionId: 7 })
		).resolves.toEqual({ baseUrl: "http://localhost:5001" })
		expect(loadOpts.request.kind).toBe("image")
		expect(loadOpts.request.file).toBe("sdxl.safetensors")
	})

	it("carries no context size at all, so it cannot disagree with the next text load", async () => {
		// The other trap, also removed rather than handled. The old entry point
		// BORROWED whatever contextSize was loaded, because a value of its own
		// choosing would have forced a full reload of the text model on every
		// alternation between a message and an image. An image request has no
		// such field to get wrong, and an image-only .kcpps writes no
		// `contextsize` key.
		const ensureManagedReady = await loadReady()

		await ensureManagedReady(imageSpec(), { connectionId: 7 })

		expect("contextSize" in loadOpts.request).toBe(false)
	})

	it("resolves the image model against the IMAGE directory", async () => {
		const ensureManagedReady = await loadReady()

		await ensureManagedReady(imageSpec(), { connectionId: 7 })

		expect(loadOpts.request.path).toBe(
			path.join(imageDir, "sdxl.safetensors")
		)
	})

	it("still finds an image model left behind in the legacy flat directory", async () => {
		// Nothing moves on disk, ever — so the read has to look in the other
		// directory rather than the upgrade having to relocate gigabytes.
		const ensureManagedReady = await loadReady()

		await ensureManagedReady(imageSpec({ file: "legacy-sd.gguf" }), {
			connectionId: 7
		})

		expect(loadOpts.request.path).toBe(path.join(textDir, "legacy-sd.gguf"))
	})

	it("fails loudly, naming the file, when the image model is gone", async () => {
		// The old behaviour dropped a missing image model and loaded the text
		// one anyway — correct when images were an add-on to a chat connection,
		// and inverted now: the image model is the entire content of the
		// request, so dropping it would leave a load that means nothing.
		const ensureManagedReady = await loadReady()

		await expect(
			ensureManagedReady(imageSpec({ file: "deleted.safetensors" }), {
				connectionId: 7
			})
		).rejects.toThrow(/deleted\.safetensors/)
		expect(loadOpts).toBeNull()
	})

	it("names the image model when the load itself fails", async () => {
		// A text and an image model never share a .kcpps now, so a failed load
		// has exactly one candidate — and saying which is the difference
		// between a file the user can go and look at and "it stopped working".
		// No models directory, so nothing in the retry window is waiting on real
		// disk I/O that fake timers cannot advance.
		settings.koboldCppManagerModelsDir = null
		settings.koboldCppImageModelsDir = null
		vi.useFakeTimers()
		try {
			const ensureManagedReady = await loadReady()
			loadError = new Error("reload_config rejected the request")

			const promise = ensureManagedReady(imageSpec(), { connectionId: 7 })
			promise.catch(() => {})
			// Walk the retry backoff so the final attempt's error is thrown.
			await vi.advanceTimersByTimeAsync(2000)
			await vi.advanceTimersByTimeAsync(4000)

			await expect(promise).rejects.toThrow(
				/^The image model "sdxl\.safetensors" failed to load/
			)
		} finally {
			vi.useRealTimers()
		}
	})

	it("propagates a refusal rather than swallowing it", async () => {
		settings.koboldCppManagerEnabled = false
		const ensureManagedReady = await loadReady()

		await expect(
			ensureManagedReady(imageSpec(), { connectionId: 7 })
		).rejects.toThrow(/Manager is disabled/)
	})
})

describe("ensureManagedReady — the text path", () => {
	it("passes the resolved context size through as part of the request", async () => {
		const ensureManagedReady = await loadReady()

		await ensureManagedReady(textSpec({ contextSize: 16384 }), {
			connectionId: 3
		})

		expect(loadOpts.request.contextSize).toBe(16384)
	})

	it("resolves the text model against the TEXT directory", async () => {
		const ensureManagedReady = await loadReady()

		await ensureManagedReady(textSpec(), { connectionId: 3 })

		expect(loadOpts.request.path).toBe(path.join(textDir, "llama-3.gguf"))
	})

	it("keeps working with no models directory configured at all", async () => {
		// The legacy shape: the bare filename goes into the .kcpps and koboldcpp
		// resolves it against its own working directory, as it did before there
		// was a models directory setting.
		settings.koboldCppManagerModelsDir = null
		settings.koboldCppImageModelsDir = null
		const ensureManagedReady = await loadReady()

		await ensureManagedReady(textSpec(), { connectionId: 3 })

		expect(loadOpts.request.path).toBe("llama-3.gguf")
	})

	it("refuses an empty model name before doing anything else", async () => {
		const ensureManagedReady = await loadReady()

		await expect(
			ensureManagedReady(textSpec({ file: "" }), { connectionId: 3 })
		).rejects.toThrow(/No model selected/)
		expect(loadOpts).toBeNull()
	})
})

describe("KoboldCppManagedAdapter.preflight — Ruling 1 at the adapter", () => {
	const connection = {
		id: 3,
		type: "koboldcpp_managed",
		name: "Managed Kobold",
		model: "llama-3.gguf",
		baseUrl: "",
		promptFormat: "vicuna",
		tokenCounter: "estimate",
		extraJson: {}
	} as any

	function makeAdapter(Adapter: any, extraJson: Record<string, any>) {
		return new Adapter({
			connection: { ...connection, extraJson },
			sampling: { contextTokens: 8192 },
			contextConfig: {} as any,
			promptConfig: { systemPrompt: "system" } as any,
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
			tokenLimit: 8192,
			contextThresholdPercent: 0.8
		})
	}

	it("a stray sdModelFile left on a row by an older build never reaches the plan", async () => {
		// One connection row names ONE model. A `sdModelFile` in a text row's
		// managedConfig is the previous design's Ruling-1 violation sitting in
		// real databases right now — it must be inert, not merely unused.
		const { default: exportsDefault } = await import(
			"./KoboldCppManagedAdapter"
		)
		const adapter = makeAdapter(exportsDefault.Adapter, {
			managedConfig: {
				gpuLayers: 10,
				flashAttention: true,
				batchSize: 256,
				sdModelFile: "stale-row-value.gguf"
			}
		})

		await adapter.preflight()

		expect(loadOpts.request).toEqual({
			kind: "text",
			file: "llama-3.gguf",
			path: path.join(textDir, "llama-3.gguf"),
			gpuLayers: 10,
			flashAttention: true,
			batchSize: 256,
			contextSize: 8192
		})
	})

	it("points the connection at the Manager's base URL, not the row's own", async () => {
		const { default: exportsDefault } = await import(
			"./KoboldCppManagedAdapter"
		)
		const adapter = makeAdapter(exportsDefault.Adapter, {})

		await adapter.preflight()

		expect(adapter.connection.baseUrl).toBe("http://localhost:5001")
	})
})
