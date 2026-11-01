/**
 * Lane V2: the managed KoboldCPP's listing marks a speech GGUF `tts`, and
 * never lists a wav-tokenizer codec file as a model. Same harness as
 * `KoboldCppManagedAdapter.test.ts`.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const findFirstMock = vi.fn()
const localModelsMock = vi.fn(async () => [] as any[])
vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) },
			koboldCppSettings: { findFirst: () => findFirstMock() },
			localModels: { findMany: () => localModelsMock() }
		},
		select: () => ({ from: () => ({ where: async () => [] }) })
	}
}))
const readdirMock = vi.fn()
vi.mock("fs/promises", () => ({ readdir: (...a: any[]) => readdirMock(...a) }))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false, batchEmbed: vi.fn(), embed: vi.fn(), getLoadedModelId: () => null
}))
vi.mock("$lib/server/koboldcpp/subprocessManager", () => ({
	start: vi.fn(), suspendHealthCheck: vi.fn(), resumeHealthCheck: vi.fn(),
	pingActivity: vi.fn(), isExternal: vi.fn(() => false), isRunning: () => true
}))
vi.mock("$lib/server/koboldcpp/modelManager", () => ({
	ensureModelLoaded: vi.fn(),
	DEFAULT_MANAGED_CONFIG: { gpuLayers: -1, flashAttention: false, batchSize: 512 },
	resetTtl: vi.fn(),
	getLoadedSignature: () => null
}))
vi.mock("$lib/server/koboldcpp/kcppHttp", () => ({
	fetchCurrentModelName: vi.fn(),
	pingKoboldCPP: vi.fn()
}))
vi.mock("$lib/server/koboldcpp/modelKind", async (orig) => ({
	...((await orig()) as any),
	classifyModelFile: async () => ({ kind: "unknown", reason: "" })
}))
vi.mock("$lib/server/koboldcpp/rereadDetectedKinds", () => ({
	rereadDetectedTextModels: async () => []
}))

const exportsDefault = (await import("../KoboldCppManagedAdapter")).default

beforeEach(() => {
	findFirstMock.mockResolvedValue({
		koboldCppManagerBaseUrl: "http://manager-host:5001/",
		koboldCppManagerModelsDir: "/models/llm"
	})
	localModelsMock.mockResolvedValue([])
})

describe("managed KoboldCPP listing and speech", () => {
	test("Kokoro / Qwen3 / Kitten 2 files list as tts; a text model stays text-gen; the codec files are not listed", async () => {
		readdirMock.mockResolvedValue([
			"Kokoro_no_espeak_Q4.gguf",
			"qwen3_tts_1_7b_customvoice_q8_0.gguf",
			"qwen3-tts-tokenizer-q8_0.gguf",
			"WavTokenizer-Large-75-Q4_0.gguf",
			"kitten_tts2_q8.gguf",
			"llama-3-8b-q8_0.gguf"
		])
		const r = await exportsDefault.listModels({ id: 1, type: "koboldcpp_managed", baseUrl: "", extraJson: {} } as any)
		expect(r.error).toBeUndefined()
		const by = Object.fromEntries(r.models.map((m: any) => [m.model, m.modality]))
		expect(by).toEqual({
			"Kokoro_no_espeak_Q4.gguf": "tts",
			"qwen3_tts_1_7b_customvoice_q8_0.gguf": "tts",
			"kitten_tts2_q8.gguf": "tts",
			"llama-3-8b-q8_0.gguf": "text-gen"
		})
	})

	test("an embeddings-registered file stays embeddings even when its name matches a catalogue", async () => {
		localModelsMock.mockResolvedValue([{ filename: "Kokoro_no_espeak_Q4.gguf", kind: "embeddings", status: "complete" }])
		readdirMock.mockResolvedValue(["Kokoro_no_espeak_Q4.gguf"])
		const r = await exportsDefault.listModels({ id: 1, type: "koboldcpp_managed", baseUrl: "", extraJson: {} } as any)
		expect(r.models[0].modality).toBe("embeddings")
	})
})
