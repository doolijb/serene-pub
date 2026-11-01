/**
 * Lane V2: KoboldCPP speech residency (S10) — `planResidency` with the speech
 * slot, `buildConfigContent` (fixture 5), the wav-tokenizer picker on real
 * Hugging Face names, and `ensureModelLoaded` for an `audio` request. Kept
 * apart from `modelManager.test.ts`, whose `kcppHttp` mock has no speech probe.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { writeFile } from "fs/promises"

const fetchCurrentModelStatusMock = vi.fn()
const fetchModelStatusForPollMock = vi.fn()
const fetchImageModelStatusMock = vi.fn()
const fetchLoadedEmbeddingModelMock = vi.fn()
const fetchSpeechModelStatusMock = vi.fn()
vi.mock("./kcppHttp", () => ({
	fetchCurrentModelStatus: (...a: any[]) => fetchCurrentModelStatusMock(...a),
	fetchModelStatusForPoll: (...a: any[]) => fetchModelStatusForPollMock(...a),
	fetchImageModelStatus: (...a: any[]) => fetchImageModelStatusMock(...a),
	fetchLoadedEmbeddingModel: (...a: any[]) => fetchLoadedEmbeddingModelMock(...a),
	fetchSpeechModelStatus: (...a: any[]) => fetchSpeechModelStatusMock(...a)
}))
vi.mock("fs/promises", () => ({
	writeFile: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockResolvedValue(undefined)
}))

import {
	isWavTokenizerFile,
	pickWavTokenizer,
	wavTokenizerNeed
} from "./ttsTokenizer"

const TEXT_PATH = "/models/llm/some-model.gguf"
const text = (over: Record<string, any> = {}) => ({
	kind: "text" as const, file: "some-model.gguf", path: TEXT_PATH,
	gpuLayers: -1, flashAttention: false, batchSize: 512, contextSize: 4096, ...over
})
const audio = (over: Record<string, any> = {}) => ({
	kind: "audio" as const, file: "Kokoro_no_espeak_Q4.gguf",
	path: "/models/llm/Kokoro_no_espeak_Q4.gguf", ...over
})
const QWEN = {
	kind: "audio" as const,
	file: "qwen3_tts_1_7b_customvoice_q8_0.gguf",
	path: "/models/llm/qwen3_tts_1_7b_customvoice_q8_0.gguf",
	wavTokenizerFile: "qwen3-tts-tokenizer-q8_0.gguf",
	wavTokenizerPath: "/models/llm/qwen3-tts-tokenizer-q8_0.gguf",
	gpu: true
}
const KOKORO_SLOT = { ttsFile: "Kokoro_no_espeak_Q4.gguf", ttsModelPath: "/models/llm/Kokoro_no_espeak_Q4.gguf" }
const QWEN_SLOT = {
	ttsFile: QWEN.file, ttsModelPath: QWEN.path,
	ttsWavTokenizerPath: QWEN.wavTokenizerPath, ttsGpu: true
}

async function freshImport() {
	vi.resetModules()
	return await import("./modelManager")
}

// ── planResidency matrix ────────────────────────────────────────────────────

describe("planResidency with the speech slot", () => {
	test("audio while a text model is resident: both", async () => {
		const { planResidency } = await freshImport()
		const { kind: _k, ...t } = text()
		const plan = planResidency(audio(), { text: t })
		expect(plan.text).toEqual(t)
		expect(plan.audio).toEqual(KOKORO_SLOT)
		expect(plan.image).toBeUndefined()
	})

	test("audio alone: only the speech slot", async () => {
		const { planResidency } = await freshImport()
		expect(planResidency(audio(), {})).toEqual({ audio: KOKORO_SLOT })
	})

	test("text while audio is the standing speech model: both (the speech model rides along)", async () => {
		const { planResidency } = await freshImport()
		const plan = planResidency(text(), { audio: KOKORO_SLOT }, null, KOKORO_SLOT)
		expect(plan.text?.file).toBe("some-model.gguf")
		expect(plan.audio).toEqual(KOKORO_SLOT)
	})

	test("text with NO standing speech model drops a resident one (the caller owns 'standing')", async () => {
		const { planResidency } = await freshImport()
		expect(planResidency(text(), { audio: KOKORO_SLOT }).audio).toBeUndefined()
	})

	test("a new audio request swaps the speech slot and keeps the text model", async () => {
		const { planResidency } = await freshImport()
		const { kind: _k, ...t } = text()
		const plan = planResidency(QWEN, { text: t, audio: KOKORO_SLOT })
		expect(plan.audio).toEqual(QWEN_SLOT)
		expect(plan.text).toEqual(t)
	})

	test("a new text request swaps the text model and carries the standing speech model", async () => {
		const { planResidency } = await freshImport()
		const { kind: _k, ...old } = text({ file: "old.gguf", path: "/models/llm/old.gguf" })
		const plan = planResidency(text(), { text: old, audio: QWEN_SLOT }, null, QWEN_SLOT)
		expect(plan.text?.file).toBe("some-model.gguf")
		expect(plan.audio).toEqual(QWEN_SLOT)
	})

	test("embeddings keep the resident speech model, else the standing one", async () => {
		const { planResidency } = await freshImport()
		const emb = { kind: "embeddings" as const, file: "e.gguf", path: "/models/e.gguf" }
		expect(planResidency(emb, { audio: KOKORO_SLOT }).audio).toEqual(KOKORO_SLOT)
		expect(planResidency(emb, {}, null, QWEN_SLOT).audio).toEqual(QWEN_SLOT)
		expect(planResidency(emb, {}).audio).toBeUndefined()
	})

	test("audio keeps the standing embedding model", async () => {
		const { planResidency } = await freshImport()
		const e = { file: "e.gguf", path: "/models/e.gguf" }
		expect(planResidency(audio(), {}, e).embeddings).toEqual(e)
	})

	test("an image request keeps the standing speech model", async () => {
		const { planResidency } = await freshImport()
		const plan = planResidency({ kind: "image", file: "sd.gguf", path: "/m/sd.gguf" }, {}, null, KOKORO_SLOT)
		expect(plan.image?.file).toBe("sd.gguf")
		expect(plan.audio).toEqual(KOKORO_SLOT)
	})

	test("ttsGpu only when asked; the tokenizer path only when given", async () => {
		const { planResidency } = await freshImport()
		expect(planResidency(audio({ gpu: false }), {}).audio).toEqual(KOKORO_SLOT)
		expect(planResidency(audio({ wavTokenizerPath: "/t.gguf" }), {}).audio?.ttsWavTokenizerPath).toBe("/t.gguf")
	})
})

// ── buildConfigContent (fixture 5) ──────────────────────────────────────────

describe("buildConfigContent with the speech slot (fixture 5)", () => {
	test("audio while text is resident", async () => {
		const { buildConfigContent, planResidency } = await freshImport()
		const { kind: _k, ...t } = text()
		const cfg = buildConfigContent(planResidency(QWEN, { text: t }))
		expect(cfg).toEqual({
			model: [TEXT_PATH],
			gpulayers: -1,
			contextsize: 4096,
			flashattention: false,
			batchsize: 512,
			jinja: true,
			ttsmodel: QWEN.path,
			ttswavtokenizer: QWEN.wavTokenizerPath,
			ttsgpu: true
		})
	})

	test("text while audio is resident carries every tts key", async () => {
		const { buildConfigContent, planResidency } = await freshImport()
		const cfg = buildConfigContent(planResidency(text(), {}, null, QWEN_SLOT))
		expect(cfg.model).toEqual([TEXT_PATH])
		expect(cfg).toMatchObject({ ttsmodel: QWEN.path, ttswavtokenizer: QWEN.wavTokenizerPath, ttsgpu: true })
	})

	test("audio alone: nomodel + the tts keys (and no text knobs)", async () => {
		const { buildConfigContent, planResidency } = await freshImport()
		const cfg = buildConfigContent(planResidency(QWEN, {}))
		expect(cfg).toEqual({
			nomodel: true, jinja: true,
			ttsmodel: QWEN.path, ttswavtokenizer: QWEN.wavTokenizerPath, ttsgpu: true
		})
		for (const k of ["model", "gpulayers", "contextsize", "flashattention", "batchsize"]) expect(k in cfg).toBe(false)
	})

	test("Kokoro (no tokenizer, no gpu): only ttsmodel", async () => {
		const { buildConfigContent, planResidency } = await freshImport()
		const cfg = buildConfigContent(planResidency(audio(), {}))
		expect(cfg.ttsmodel).toBe("/models/llm/Kokoro_no_espeak_Q4.gguf")
		expect("ttswavtokenizer" in cfg).toBe(false)
		expect("ttsgpu" in cfg).toBe(false)
	})

	test("tts keys are plain strings / booleans, not lists (argparse default '')", async () => {
		const { buildConfigContent, planResidency } = await freshImport()
		const cfg = buildConfigContent(planResidency(QWEN, {}))
		expect(typeof cfg.ttsmodel).toBe("string")
		expect(typeof cfg.ttswavtokenizer).toBe("string")
	})

	test("a plan with no speech has no tts keys at all", async () => {
		const { buildConfigContent, planResidency } = await freshImport()
		const cfg = buildConfigContent(planResidency(text(), {}))
		expect(Object.keys(cfg).filter((k) => k.startsWith("tts"))).toEqual([])
	})
})

// ── pickWavTokenizer ────────────────────────────────────────────────────────

describe("pickWavTokenizer on real Hugging Face names", () => {
	const SIBLINGS = [
		"WavTokenizer-Large-75-Q4_0.gguf",
		"wavtokenizer-large-75-ttscpp-f16.gguf",
		"qwen3-tts-tokenizer-f16.gguf",
		"qwen3-tts-tokenizer-q8_0.gguf",
		"qwen3_tts_1_7b_customvoice_q8_0.gguf",
		"Kokoro_no_espeak_Q4.gguf",
		"README.md"
	]
	test("Qwen3 takes the tokenizer with its own quantisation", () => {
		expect(pickWavTokenizer("qwen3_tts_1_7b_customvoice_q8_0.gguf", SIBLINGS)).toBe("qwen3-tts-tokenizer-q8_0.gguf")
		expect(pickWavTokenizer("qwen3_tts_1_7b_customvoice_f16.gguf", SIBLINGS)).toBe("qwen3-tts-tokenizer-f16.gguf")
	})
	test("Qwen3 with an unmatched quantisation prefers q8_0", () => {
		expect(pickWavTokenizer("qwen3_tts_1_7b_voicedesign_q5_k.gguf", SIBLINGS)).toBe("qwen3-tts-tokenizer-q8_0.gguf")
	})
	test("Qwen3 never picks a WavTokenizer file, nor the reverse", () => {
		expect(pickWavTokenizer("qwen3_tts_1_7b_customvoice_q8_0.gguf", ["WavTokenizer-Large-75-Q4_0.gguf"])).toBeNull()
		expect(pickWavTokenizer("OuteTTS-0.2-500M-Q4_0.gguf", ["qwen3-tts-tokenizer-q8_0.gguf"])).toBeNull()
	})
	test("OuteTTS takes WavTokenizer, by quantisation", () => {
		expect(pickWavTokenizer("OuteTTS-0.2-500M-Q4_0.gguf", SIBLINGS)).toBe("WavTokenizer-Large-75-Q4_0.gguf")
		expect(pickWavTokenizer("OuteTTS-0.2-500M-f16.gguf", SIBLINGS)).toBe("wavtokenizer-large-75-ttscpp-f16.gguf")
	})
	test("Kokoro, a text model and a codec file need none", () => {
		expect(pickWavTokenizer("Kokoro_no_espeak_Q4.gguf", SIBLINGS)).toBeNull()
		expect(pickWavTokenizer("llama-3-8b-q8_0.gguf", SIBLINGS)).toBeNull()
		expect(pickWavTokenizer("qwen3-tts-tokenizer-q8_0.gguf", SIBLINGS)).toBeNull()
	})
	test("no sibling, or non-gguf siblings: null", () => {
		expect(pickWavTokenizer("qwen3_tts_1_7b_customvoice_q8_0.gguf", [])).toBeNull()
		expect(pickWavTokenizer("qwen3_tts_1_7b_customvoice_q8_0.gguf", ["qwen3-tts-tokenizer-q8_0.bin"])).toBeNull()
	})
	test("the pick is independent of the order the folder lists in", () => {
		const a = pickWavTokenizer("qwen3_tts_0_6b_customvoice.gguf", ["qwen3-tts-tokenizer-q8_0.gguf", "qwen3-tts-tokenizer-f16.gguf"])
		const b = pickWavTokenizer("qwen3_tts_0_6b_customvoice.gguf", ["qwen3-tts-tokenizer-f16.gguf", "qwen3-tts-tokenizer-q8_0.gguf"])
		expect(a).toBe(b)
	})
	test("wavTokenizerNeed and isWavTokenizerFile", () => {
		expect(wavTokenizerNeed("qwen3_tts_1_7b_customvoice_q8_0.gguf")).toBe("qwen3")
		expect(wavTokenizerNeed("OuteTTS-0.2-500M-Q4_0.gguf")).toBe("outetts")
		expect(wavTokenizerNeed("Kokoro.gguf")).toBeNull()
		expect(wavTokenizerNeed("qwen3-tts-tokenizer-f16.gguf")).toBeNull()
		expect(isWavTokenizerFile("qwen3-tts-tokenizer-f16.gguf")).toBe(true)
		expect(isWavTokenizerFile("WavTokenizer-Large-75-Q4_0.gguf")).toBe(true)
		expect(isWavTokenizerFile("qwen3_tts_1_7b_customvoice_q8_0.gguf")).toBe(false)
		expect(isWavTokenizerFile("some-tokenizer.gguf")).toBe(false)
	})
})

// ── ensureModelLoaded for speech ────────────────────────────────────────────

const ST_OFF = { present: false, refused: false, determined: true }
const ST_ON = { present: true, refused: false, determined: true }

function opts(request: any) {
	return {
		connectionId: 1, request, baseUrl: "http://localhost:5001",
		adminDir: "/tmp/admin", adminPassword: "pw", ttlSecs: 0
	}
}
async function settle<T>(p: Promise<T>): Promise<T> {
	let done = false
	p.then(() => (done = true), () => (done = true))
	while (!done) await vi.advanceTimersByTimeAsync(500)
	return p
}
const configs = () => vi.mocked(writeFile).mock.calls.map((c) => JSON.parse(c[1] as string))

describe("ensureModelLoaded for speech", () => {
	let fetchMock: ReturnType<typeof vi.fn>
	beforeEach(() => {
		vi.useFakeTimers()
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.mocked(writeFile).mockClear()
		for (const m of [fetchCurrentModelStatusMock, fetchModelStatusForPollMock, fetchImageModelStatusMock, fetchLoadedEmbeddingModelMock, fetchSpeechModelStatusMock]) m.mockReset()
		fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	test("an audio request with nothing resident writes the speech-only config and reloads once", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchSpeechModelStatusMock.mockResolvedValueOnce(ST_OFF).mockResolvedValueOnce(ST_OFF).mockResolvedValue(ST_ON)
		expect(await settle(ensureModelLoaded(opts(QWEN)))).toBe(true)
		expect(configs()).toHaveLength(1)
		expect(configs()[0]).toEqual({
			nomodel: true, jinja: true,
			ttsmodel: QWEN.path, ttswavtokenizer: QWEN.wavTokenizerPath, ttsgpu: true
		})
		expect(String(vi.mocked(writeFile).mock.calls[0][0])).toBe("/tmp/admin/serene_audio_qwen3_tts_1_7b_customvoice_q8_0.kcpps")
		expect(fetchMock).toHaveBeenCalledWith("http://localhost:5001/api/admin/reload_config", expect.objectContaining({ method: "POST" }))
		// Text is never asked about for an audio-only request.
		expect(fetchCurrentModelStatusMock).not.toHaveBeenCalled()
	})

	test("speak -> chat -> speak: the chat load carries the speech model; the second speak reloads nothing", async () => {
		const { ensureModelLoaded } = await freshImport()
		// Speech: off, then on after the reload; stays on from here.
		fetchSpeechModelStatusMock.mockResolvedValueOnce(ST_OFF).mockResolvedValueOnce(ST_OFF).mockResolvedValue(ST_ON)
		expect(await settle(ensureModelLoaded(opts(audio())))).toBe(true)

		fetchCurrentModelStatusMock.mockResolvedValue({ modelName: null, refused: false, determined: true })
		fetchModelStatusForPollMock
			.mockResolvedValueOnce({ modelName: null, refused: true })
			.mockResolvedValue({ modelName: "some-model", refused: false })
		expect(await settle(ensureModelLoaded(opts(text())))).toBe(true)
		const chat = configs()[1]
		expect(chat.model).toEqual([TEXT_PATH])
		expect(chat.ttsmodel).toBe("/models/llm/Kokoro_no_espeak_Q4.gguf")

		fetchCurrentModelStatusMock.mockResolvedValue({ modelName: "some-model", refused: false, determined: true })
		const before = vi.mocked(writeFile).mock.calls.length
		expect(await settle(ensureModelLoaded(opts(audio())))).toBe(false)
		expect(vi.mocked(writeFile).mock.calls.length).toBe(before)
	})

	test("a different speech file reloads, and keeps the resident text model", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchSpeechModelStatusMock.mockResolvedValue(ST_ON)
		fetchCurrentModelStatusMock.mockResolvedValue({ modelName: null, refused: false, determined: true })
		fetchModelStatusForPollMock.mockResolvedValue({ modelName: "some-model", refused: false })
		await settle(ensureModelLoaded(opts(text())))
		expect(await settle(ensureModelLoaded(opts(QWEN)))).toBe(true)
		const last = configs().at(-1)!
		expect(last.model).toEqual([TEXT_PATH])
		expect(last.ttsmodel).toBe(QWEN.path)
	})

	test("koboldcpp coming back with no speech model fails with SpeechModelMissingError's sentence, and the speech model stops being standing", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchSpeechModelStatusMock.mockResolvedValue(ST_OFF)
		const p = ensureModelLoaded(opts(audio()))
		const caught = p.then(() => null, (e: Error) => e)
		let e: Error | null | undefined
		let done = false
		caught.then((x) => { e = x; done = true })
		while (!done) await vi.advanceTimersByTimeAsync(1000)
		expect(e?.message).toMatch(/speech model ".*Kokoro_no_espeak_Q4\.gguf" did not load/)

		// The next chat load must not carry the speech model that could not load.
		fetchCurrentModelStatusMock.mockResolvedValue({ modelName: null, refused: false, determined: true })
		fetchModelStatusForPollMock.mockResolvedValue({ modelName: "some-model", refused: false })
		await settle(ensureModelLoaded(opts(text())))
		expect("ttsmodel" in configs().at(-1)!).toBe(false)
	})

	test("a speech file that vanished from disk is dropped from the standing slot (access fails)", async () => {
		const fsp = await import("fs/promises")
		const { ensureModelLoaded } = await freshImport()
		fetchSpeechModelStatusMock.mockResolvedValueOnce(ST_OFF).mockResolvedValueOnce(ST_OFF).mockResolvedValue(ST_ON)
		await settle(ensureModelLoaded(opts(audio())))
		vi.mocked(fsp.access).mockRejectedValueOnce(new Error("ENOENT"))
		fetchCurrentModelStatusMock.mockResolvedValue({ modelName: null, refused: false, determined: true })
		fetchModelStatusForPollMock.mockResolvedValue({ modelName: "some-model", refused: false })
		await settle(ensureModelLoaded(opts(text())))
		expect("ttsmodel" in configs().at(-1)!).toBe(false)
	})
})
