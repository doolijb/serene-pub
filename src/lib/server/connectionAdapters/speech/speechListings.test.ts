/**
 * Lane V2: which listed models are marked `tts` — OpenAI ids, Ollama
 * `capabilities: ['speech']`, and the external KoboldCPP's single speech row
 * (only when the version endpoint says `tts`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	db: { query: { systemSettings: { findFirst: vi.fn(async () => null) } } }
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false, batchEmbed: vi.fn(), embed: vi.fn(), getLoadedModelId: () => null
}))
vi.mock("$lib/server/connections/logitBiasTokens", async (orig) => ({
	...(await orig<typeof import("$lib/server/connections/logitBiasTokens")>()),
	resolveLogitBias: vi.fn()
}))

const modelsListMock = vi.fn()
vi.mock("openai", () => ({
	OpenAI: class {
		models = { list: (...a: any[]) => modelsListMock(...a) }
	}
}))

const kcppStatus = vi.fn()
const kcppImage = vi.fn()
const kcppEmbedding = vi.fn()
vi.mock("$lib/server/koboldcpp/kcppHttp", async (orig) => ({
	...((await orig()) as any),
	fetchCurrentModelStatus: (...a: any[]) => kcppStatus(...a),
	fetchLoadedImageModel: (...a: any[]) => kcppImage(...a),
	fetchLoadedEmbeddingModel: (...a: any[]) => kcppEmbedding(...a)
}))

const openai = (await import("../OpenAIChatAdapter")).default
const kcpp = await import("../KoboldCppAdapter")
const { ollamaModelModality } = await import("../OllamaAdapter")

afterEach(() => vi.unstubAllGlobals())

describe("OpenAI listing marks speech models tts", () => {
	const list = async (ids: string[], baseUrl = "https://api.openai.com/v1") => {
		modelsListMock.mockResolvedValue({ data: ids.map((id) => ({ id })) })
		const r = await openai.listModels({ id: 1, type: "openai", baseUrl, extraJson: { apiKey: "sk" } } as any)
		return Object.fromEntries(r.models.map((m: any) => [m.id, m.modality]))
	}
	test("gpt-4o-mini-tts*, tts-1* are tts; gpt-4o and friends are not", async () => {
		const m = await list([
			"gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-12-15", "tts-1", "tts-1-hd", "tts-1-1106",
			"gpt-4o", "gpt-4o-mini", "gpt-4o-mini-transcribe", "text-embedding-3-small", "whisper-1", "tts"
		])
		expect(m["gpt-4o-mini-tts"]).toBe("tts")
		expect(m["gpt-4o-mini-tts-2025-12-15"]).toBe("tts")
		expect(m["tts-1"]).toBe("tts")
		expect(m["tts-1-hd"]).toBe("tts")
		expect(m["tts-1-1106"]).toBe("tts")
		for (const id of ["gpt-4o", "gpt-4o-mini", "gpt-4o-mini-transcribe", "text-embedding-3-small", "whisper-1", "tts"])
			expect(m[id], id).not.toBe("tts")
	})
})

describe("Ollama models with capabilities: speech list as tts", () => {
	test("speech wins; text and embedding unchanged; silence is undefined", () => {
		expect(ollamaModelModality({ capabilities: ["speech"] })).toBe("tts")
		expect(ollamaModelModality({ capabilities: ["completion", "speech"] })).toBe("tts")
		expect(ollamaModelModality({ capabilities: ["completion"] })).toBe("text-gen")
		expect(ollamaModelModality({ capabilities: ["embedding"] })).toBe("embeddings")
		expect(ollamaModelModality({})).toBeUndefined()
	})
})

describe("external KoboldCPP lists its speech model only when `tts` is set", () => {
	beforeEach(() => {
		kcppStatus.mockResolvedValue({ modelName: "llama-8b", refused: false, determined: true })
		kcppImage.mockResolvedValue({ name: null, determined: true })
		kcppEmbedding.mockResolvedValue({ name: null, determined: true })
	})
	const withVersion = (flags: Record<string, unknown> | null) =>
		vi.stubGlobal("fetch", vi.fn(async () => (flags ? new Response(JSON.stringify({ result: "KoboldCpp", version: "1.119", ...flags })) : new Response("", { status: 500 }))))

	test("tts on: one koboldcpp-speech row of modality tts", async () => {
		withVersion({ tts: true })
		const r = await kcpp.default.listModels({ id: 1, baseUrl: "http://h:5001" } as any)
		const speech = r.models.filter((m: any) => m.modality === "tts")
		expect(speech).toEqual([{ model: kcpp.KCPP_SPEECH_MODEL_ID, name: "Speech model (loaded in KoboldCPP)", modality: "tts" }])
		expect(kcpp.KCPP_SPEECH_MODEL_ID).toBe("koboldcpp-speech")
		expect(r.models.some((m: any) => m.modality === "text-gen")).toBe(true)
	})
	test("tts off: no speech row", async () => {
		withVersion({ tts: false })
		const r = await kcpp.default.listModels({ id: 1, baseUrl: "http://h:5001" } as any)
		expect(r.models.some((m: any) => m.modality === "tts")).toBe(false)
	})
	test("version endpoint unanswered: no speech row, and no error for it", async () => {
		withVersion(null)
		const r = await kcpp.default.listModels({ id: 1, baseUrl: "http://h:5001" } as any)
		expect(r.models.some((m: any) => m.modality === "tts")).toBe(false)
		expect(r.error).toBeUndefined()
	})
})
