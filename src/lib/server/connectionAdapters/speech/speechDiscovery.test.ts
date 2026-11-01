/**
 * Lane V2: discovery (facts probe), model listings of the speech-only types,
 * the shipped catalogues and the facts helpers. Stubbed `fetch`; no network.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: unknown) => (typeof v === "string" ? v : null)
}))
vi.mock("$lib/server/koboldcpp/managedPreflight", () => ({
	ensureManagedReady: vi.fn()
}))

import { getSpeechAdapter } from "./getSpeechAdapter"
import {
	catalogueFor,
	speechEngineKey,
	SPEECH_CATALOGUES,
	KOKORO_VOICE_IDS,
	KOKORO_KCPP_VOICE_IDS,
	QWEN3_PRESET_VOICES,
	QWEN3_LANGUAGES,
	KITTEN2_VOICES,
	KITTEN2_EMOTION_TAGS,
	KITTEN2_NOTICE,
	qwen3Variant
} from "$lib/shared/speech/catalogues"
import {
	readSpeechFacts,
	withSpeechFacts,
	SPEECH_FACTS_KEY,
	type SpeechFacts
} from "$lib/shared/connectionAdapters/speechFacts"
import { voicesFromShow } from "./profiles/ollama"
import { parseVoices } from "./profiles/openai"

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined
let routes: Route[]
let urls: string[]
const json = (v: unknown, status = 200) =>
	new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
	routes = []
	urls = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (u: string | URL, init?: RequestInit) => {
			const url = String(u)
			urls.push(url)
			for (const r of routes) {
				const res = await r(url, init)
				if (res) return res
			}
			return new Response("not found", { status: 404 })
		})
	)
})
afterEach(() => vi.unstubAllGlobals())

const conn = (over: Record<string, unknown> = {}) => ({ id: 3, extraJson: {}, ...over }) as any
const mod = async (type: string) => (await getSpeechAdapter(type))!

// ── audio.cpp (fixture 6) ───────────────────────────────────────────────────

describe("fixture 6: audio.cpp discovery", () => {
	const AC = conn({ type: "audiocpp", baseUrl: "http://a:8080" })

	test("listModels: tts rows with the family read from the id", async () => {
		routes.push((u) =>
			u === "http://a:8080/v1/models"
				? json({ object: "list", data: [{ id: "qwen3_tts_1_7b_customvoice_q8_0", configured: true, device: 0 }, { id: "kitten_tts2_q8" }] })
				: undefined
		)
		const r = await (await mod("audiocpp")).listModels!(AC)
		expect(r.error).toBeUndefined()
		expect(r.models).toEqual([
			{ id: "qwen3_tts_1_7b_customvoice_q8_0", name: "qwen3_tts_1_7b_customvoice_q8_0", modality: "tts", family: "qwen3-tts" },
			{ id: "kitten_tts2_q8", name: "kitten_tts2_q8", modality: "tts", family: "kitten-tts-2" }
		])
	})

	test("listModels: an id the audio families list files as transcription hears (ACPP lane C)", async () => {
		routes.push((u) =>
			u === "http://a:8080/v1/models"
				? json({ data: [{ id: "parakeet_tdt_0_6b_v3_q8_0" }, { id: "kokoro_82m_q8_0" }] })
				: undefined
		)
		const r = await (await mod("audiocpp")).listModels!(AC)
		expect(r.models).toEqual([
			{ id: "parakeet_tdt_0_6b_v3_q8_0", name: "parakeet_tdt_0_6b_v3_q8_0", modality: "asr", reads: ["audio"], writes: ["text"] },
			{ id: "kokoro_82m_q8_0", name: "kokoro_82m_q8_0", modality: "tts", family: "kokoro" }
		])
	})

	test("listModels: an HTTP error and a thrown fetch become `error`, never a throw", async () => {
		const m = await mod("audiocpp")
		expect((await m.listModels!(AC)).error).toMatch(/HTTP 404 to \/v1\/models/)
		vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"))
		expect((await m.listModels!(AC)).error).toBe("ECONNREFUSED")
	})

	test("a trailing /v1 on the base is dropped before the route is appended", async () => {
		routes.push((u) => (u === "http://a:8080/v1/models" ? json({ data: [] }) : undefined))
		const r = await (await mod("audiocpp")).listModels!(conn({ baseUrl: "http://a:8080/v1/" }))
		expect(r.error).toBeUndefined()
	})

	test("testConnection: /health", async () => {
		routes.push((u) => (u.endsWith("/health") ? json({ status: "ok", backend: "cuda", models: 2 }) : undefined))
		const t = await (await mod("audiocpp")).testConnection!(AC)
		expect(t.ok).toBe(true)
		expect(t.extra).toMatchObject({ backend: "cuda", models: 2 })
	})

	test("testConnection: a non-ok status is not ok, with the status in the sentence", async () => {
		routes.push((u) => (u.endsWith("/health") ? json({ status: "loading" }) : undefined))
		const t = await (await mod("audiocpp")).testConnection!(AC)
		expect(t.ok).toBe(false)
		expect(t.error).toMatch(/loading/)
	})

	test("voices: 10 after the catalogue merge (case-insensitive), controls, formats, rate", async () => {
		routes.push((u) =>
			u.startsWith("http://a:8080/v1/audio/voices?model=qwen3_tts_1_7b_customvoice_q8_0")
				? json({ voices: ["Vivian", "Ryan", "my_ref"] })
				: undefined
		)
		const f = (await (await mod("audiocpp")).discoverSpeechFacts!(AC, "qwen3_tts_1_7b_customvoice_q8_0"))!
		expect(f.voicesFrom).toBe("discovered")
		expect(f.voices).toHaveLength(10)
		expect(f.voices.map((v) => v.id).slice(0, 3)).toEqual(["Vivian", "Ryan", "my_ref"])
		expect(f.voices.filter((v) => v.id.toLowerCase() === "vivian")).toHaveLength(1)
		expect(f.controls).toEqual({ instruction: "prose", language: [...QWEN3_LANGUAGES], speed: { min: 0.5, max: 2 } })
		expect(f.formats).toEqual(["wav"])
		expect(f.sampleRate).toBe(24000)
	})

	test("voices route down: the catalogue answers, voicesFrom catalogue", async () => {
		const f = (await (await mod("audiocpp")).discoverSpeechFacts!(AC, "qwen3_tts_1_7b_customvoice_q8_0"))!
		expect(f.voicesFrom).toBe("catalogue")
		expect(f.voices).toHaveLength(9)
	})

	test("Kitten 2: streams false, notice, tags control", async () => {
		const f = (await (await mod("audiocpp")).discoverSpeechFacts!(AC, "kitten_tts2_q8"))!
		expect(f.streams).toBe(false)
		expect(f.notice).toBe(KITTEN2_NOTICE)
		expect(f.controls.tags).toEqual({ syntax: "bracket", vocabulary: KITTEN2_EMOTION_TAGS })
	})

	test("Qwen3 Base: every listed voice is a read-only clone", async () => {
		routes.push((u) => (u.includes("/v1/audio/voices") ? json({ voices: ["ref_a"] }) : undefined))
		const f = (await (await mod("audiocpp")).discoverSpeechFacts!(AC, "qwen3_tts_1_7b_base_q8_0"))!
		expect(f.voices.every((v) => v.kind === "clone")).toBe(true)
		expect(f.notice).toMatch(/Base model/)
	})

	test("an unknown family with no catalogue: empty voices, catalogue source, no instruction", async () => {
		const f = (await (await mod("audiocpp")).discoverSpeechFacts!(AC, "mystery_tts"))!
		expect(f.voices).toEqual([])
		expect(f.controls).toEqual({})
	})

	test("the display-name hint names the engine when the id does not", async () => {
		const f = (await (await mod("audiocpp")).discoverSpeechFacts!(AC, "my-model-1", { name: "Kitten TTS 2" }))!
		expect(f.voices.length).toBe(47)
		expect(urls.some((u) => u.includes("model=my-model-1"))).toBe(true)
	})
})

// ── ElevenLabs (fixture 7) ──────────────────────────────────────────────────

describe("fixture 7: elevenlabs discovery", () => {
	const EL = conn({ type: "elevenlabs", baseUrl: "https://api.elevenlabs.io", extraJson: { apiKey: "xi-k" } })
	const models = [
		{ model_id: "eleven_v3", name: "Eleven v3", can_do_text_to_speech: true, languages: [{ language_id: "en" }, { language_id: "ja" }] },
		{ model_id: "eleven_multilingual_v2", name: "Multi v2", can_do_text_to_speech: true, languages: [{ language_id: "en" }, { language_id: "fr" }] },
		{ model_id: "eleven_english_sts_v2", name: "STS", can_do_text_to_speech: false },
		{ name: "no id", can_do_text_to_speech: true }
	]

	test("listModels keeps can_do_text_to_speech with an id, as tts rows with languages; sends the key", async () => {
		const seen: Array<Record<string, string>> = []
		routes.push((u, init) => {
			if (u !== "https://api.elevenlabs.io/v1/models") return undefined
			seen.push(init!.headers as Record<string, string>)
			return json(models)
		})
		const r = await (await mod("elevenlabs")).listModels!(EL)
		expect(r.models.map((m) => m.id)).toEqual(["eleven_v3", "eleven_multilingual_v2"])
		expect(r.models[0]).toEqual({ id: "eleven_v3", name: "Eleven v3", modality: "tts", languages: ["en", "ja"] })
		expect(seen[0]["xi-api-key"]).toBe("xi-k")
	})

	test("listModels / testConnection with no key report an error, not a throw", async () => {
		const m = await mod("elevenlabs")
		const noKey = conn({ baseUrl: "https://api.elevenlabs.io", extraJson: {} })
		expect((await m.listModels!(noKey)).error).toMatch(/no API key/)
		const t = await m.testConnection!(noKey)
		expect(t.ok).toBe(false)
	})

	test("testConnection surfaces the service's detail on a 401", async () => {
		routes.push(() => json({ detail: { message: "Invalid API key" } }, 401))
		const t = await (await mod("elevenlabs")).testConnection!(EL)
		expect(t).toEqual({ ok: false, error: "Invalid API key" })
	})

	function voicePages() {
		routes.push((u) => {
			if (u === "https://api.elevenlabs.io/v1/models") return json(models)
			if (!u.startsWith("https://api.elevenlabs.io/v2/voices")) return undefined
			const q = new URL(u).searchParams
			expect(q.get("page_size")).toBe("100")
			if (!q.get("next_page_token"))
				return json({
					has_more: true,
					next_page_token: "tok2",
					voices: [
						{ voice_id: "p1", name: "Rachel", category: "premade", preview_url: "https://x/p1.mp3", labels: { gender: "female", accent: "american", age: "young", use_case: "narration", language: "en" } },
						{ voice_id: "c1", name: "Mine", category: "cloned" }
					]
				})
			expect(q.get("next_page_token")).toBe("tok2")
			return json({
				has_more: false,
				next_page_token: null,
				voices: [{ voice_id: "g1", category: "generated" }, { voice_id: "pr1", category: "professional" }, { category: "premade" }]
			})
		})
	}

	test("voices: two pages, category -> kind, labels and preview; id-less entry skipped", async () => {
		voicePages()
		const f = (await (await mod("elevenlabs")).discoverSpeechFacts!(EL, "eleven_v3"))!
		expect(f.voices.map((v) => [v.id, v.kind])).toEqual([
			["p1", "preset"], ["c1", "clone"], ["g1", "designed"], ["pr1", "clone"]
		])
		expect(f.voices[0]).toEqual({
			id: "p1", name: "Rachel", kind: "preset", language: "en", previewUrl: "https://x/p1.mp3",
			labels: { gender: "female", accent: "american", age: "young", useCase: "narration" }
		})
		expect(f.voices[2].name).toBe("g1")
		expect(f.voicesFrom).toBe("discovered")
	})

	test("controls for v3: speed 0.7-1.2, four settings, open bracket tags, model languages", async () => {
		voicePages()
		const f = (await (await mod("elevenlabs")).discoverSpeechFacts!(EL, "eleven_v3"))!
		expect(f.controls).toEqual({
			speed: { min: 0.7, max: 1.2 },
			settings: ["stability", "similarity", "style", "speakerBoost"],
			tags: { syntax: "bracket", vocabulary: "open" },
			language: ["en", "ja"]
		})
		expect(f.formats).toEqual(["mp3_44100_128", "opus_48000_64"])
		expect(f.streams).toBe(true)
	})

	test("controls for multilingual_v2: no tags, no language list", async () => {
		voicePages()
		const f = (await (await mod("elevenlabs")).discoverSpeechFacts!(EL, "eleven_multilingual_v2"))!
		expect(f.controls.tags).toBeUndefined()
		expect(f.controls.language).toBeUndefined()
	})

	test("a failing voices request throws (the store reports it as `error`)", async () => {
		routes.push(() => json({ detail: "boom" }, 500))
		await expect((await mod("elevenlabs")).discoverSpeechFacts!(EL, "eleven_v3")).rejects.toThrow("boom")
	})
})

// ── OpenAI ──────────────────────────────────────────────────────────────────

describe("openai discovery", () => {
	const CLOUD = conn({ type: "openai", baseUrl: "https://api.openai.com/v1", extraJson: { apiKey: "sk" } })
	test("cloud gpt-4o-mini-tts: 13 voices, instruction prose, deprecatedOn, no network", async () => {
		const f = (await (await mod("openai")).discoverSpeechFacts!(CLOUD, "gpt-4o-mini-tts"))!
		expect(f.voices).toHaveLength(13)
		expect(f.voices[0]).toEqual({ id: "alloy", name: "Alloy", kind: "preset" })
		expect(f.controls).toEqual({ speed: { min: 0.25, max: 4 }, instruction: "prose" })
		expect(f.deprecatedOn).toBe("2027-01-06")
		expect(f.voicesFrom).toBe("catalogue")
		expect(f.formats).toEqual(["mp3", "opus", "aac", "flac", "wav", "pcm"])
		expect(urls).toEqual([])
	})
	test.each([
		["gpt-4o-mini-tts-2025-12-15", true, true],
		["tts-1", false, true],
		["tts-1-hd", false, true],
		["tts-1-1106", false, false],
		["some-future-tts", false, false]
	])("cloud %s: instruction=%s deprecated=%s", async (model, instruct, dep) => {
		const f = (await (await mod("openai")).discoverSpeechFacts!(CLOUD, model))!
		expect(!!f.controls.instruction).toBe(instruct)
		expect(!!f.deprecatedOn).toBe(dep)
	})

	test("local host: /audio/voices first", async () => {
		routes.push((u) => (u === "http://x:8880/v1/audio/voices" ? json({ voices: ["af_bella", "af_heart"] }) : undefined))
		const f = (await (await mod("openai")).discoverSpeechFacts!(conn({ baseUrl: "http://x:8880/v1" }), "kokoro"))!
		expect(f.voices.map((v) => v.id)).toEqual(["af_bella", "af_heart"])
		expect(f.voicesFrom).toBe("discovered")
		expect(f.streams).toBe(false)
	})

	test("local host: falls back to /v1/voices at the root", async () => {
		routes.push((u) => (u === "http://x:8880/v1/voices" ? json({ data: [{ id: "a" }, { voice_id: "b", name: "Bee" }] }) : undefined))
		const f = (await (await mod("openai")).discoverSpeechFacts!(conn({ baseUrl: "http://x:8880/v1" }), "kokoro"))!
		expect(f.voices).toEqual([{ id: "a", name: "a", kind: "preset" }, { id: "b", name: "Bee", kind: "preset" }])
		expect(urls).toEqual(["http://x:8880/v1/audio/voices", "http://x:8880/v1/voices"])
	})

	test("local host with no voices route: null (admin types a voice)", async () => {
		expect(await (await mod("openai")).discoverSpeechFacts!(conn({ baseUrl: "http://x:8880/v1" }), "kokoro")).toBeNull()
	})

	test("parseVoices is tolerant of shapes", () => {
		expect(parseVoices(["a", " ", { name: "b" }, 5, null]).map((v) => v.id)).toEqual(["a", "b"])
		expect(parseVoices({ voices: ["x"] })).toHaveLength(1)
		expect(parseVoices({ data: ["x"] })).toHaveLength(1)
		expect(parseVoices("nope")).toEqual([])
	})
})

// ── Ollama ──────────────────────────────────────────────────────────────────

describe("ollama discovery", () => {
	const OL = conn({ type: "ollama", baseUrl: "http://o:11434" })
	const show = (body: unknown, status = 200) =>
		routes.push((u) => (u === "http://o:11434/api/show" ? json(body, status) : undefined))

	test("a model with capabilities: speech yields discovered voices, wav/pcm, 24 kHz", async () => {
		show({ capabilities: ["speech"], voices: ["alba", { id: "coral", name: "Coral" }] })
		const f = (await (await mod("ollama")).discoverSpeechFacts!(OL, "phonon"))!
		expect(f.voices.map((v) => v.id)).toEqual(["alba", "coral"])
		expect(f.voicesFrom).toBe("discovered")
		expect(f.formats).toEqual(["wav", "pcm"])
		expect(f.sampleRate).toBe(24000)
		expect(f.controls).toEqual({})
	})
	test("a text model (no speech capability), an HTTP error and a thrown fetch give null", async () => {
		show({ capabilities: ["completion"] })
		const m = await mod("ollama")
		expect(await m.discoverSpeechFacts!(OL, "llama3")).toBeNull()
		routes.length = 0
		show({}, 500)
		expect(await m.discoverSpeechFacts!(OL, "x")).toBeNull()
		vi.mocked(fetch).mockRejectedValueOnce(new Error("down"))
		expect(await m.discoverSpeechFacts!(OL, "x")).toBeNull()
	})
	test("voicesFromShow reads top-level, details and model_info keys", () => {
		expect(voicesFromShow({ voices: ["a"] }).map((v) => v.id)).toEqual(["a"])
		expect(voicesFromShow({ details: { voices: ["b"] } }).map((v) => v.id)).toEqual(["b"])
		expect(voicesFromShow({ model_info: { "phonon.voices": ["c"] } }).map((v) => v.id)).toEqual(["c"])
		expect(voicesFromShow({ model_info: { "phonon.voice_count": 3 } })).toEqual([])
		expect(voicesFromShow({})).toEqual([])
	})
})

// ── KoboldCPP (fixture 8 + placeholders) ────────────────────────────────────

describe("koboldcpp discovery", () => {
	test("Kokoro by catalogue: 28 voices, speed removed, wav+mp3, no streaming (fixture 8)", async () => {
		const f = (await (await mod("koboldcpp")).discoverSpeechFacts!(conn({ baseUrl: "http://h:5001" }), "Kokoro_no_espeak_Q4.gguf"))!
		expect(f.voices).toHaveLength(28)
		expect(f.voices[0]).toEqual({ id: "af_heart", name: "Heart", language: "en-US", kind: "preset", labels: { gender: "female" } })
		expect(f.voices.at(-1)!.id.startsWith("bm_")).toBe(true)
		expect(f.voices.at(-1)!.language).toBe("en-GB")
		expect(f.voicesFrom).toBe("catalogue")
		expect(f.controls.speed).toBeUndefined()
		expect(f.formats).toEqual(["wav", "mp3"])
		expect(f.sampleRate).toBe(24000)
		expect(f.streams).toBe(false)
		expect(urls).toEqual([])
	})
	test("the managed type answers the same from the catalogue", async () => {
		const f = (await (await mod("koboldcpp_managed")).discoverSpeechFacts!(conn({}), "Kokoro_no_espeak_Q4.gguf"))!
		expect(f.voices).toHaveLength(28)
	})
	test("Qwen3 CustomVoice: instruction + language kept, 9 presets", async () => {
		const f = (await (await mod("koboldcpp")).discoverSpeechFacts!(conn({}), "qwen3_tts_1_7b_customvoice_q8_0.gguf"))!
		expect(f.voices).toHaveLength(9)
		expect(f.controls.instruction).toBe("prose")
		expect(f.controls.language).toHaveLength(10)
	})
	test("an unnamed speaker on an external instance: the five placeholders plus a notice", async () => {
		routes.push((u) => (u === "http://h:5001/v1/audio/voices" ? json({ voices: ["kobo", "cheery", "sleepy", "shouty", "chatty"] }) : undefined))
		const f = (await (await mod("koboldcpp")).discoverSpeechFacts!(conn({ baseUrl: "http://h:5001/v1/" }), "koboldcpp-speech"))!
		expect(f.voices).toHaveLength(5)
		expect(f.notice).toMatch(/five placeholder voices/)
		expect(f.voicesFrom).toBe("discovered")
	})
	test("the same name hint turns the placeholder row into Kokoro", async () => {
		const f = (await (await mod("koboldcpp")).discoverSpeechFacts!(conn({}), "koboldcpp-speech", { name: "Kokoro" }))!
		expect(f.voices).toHaveLength(28)
	})
	test("managed with an unrecognised file: null, and the process is never asked", async () => {
		expect(await (await mod("koboldcpp_managed")).discoverSpeechFacts!(conn({}), "mystery.gguf")).toBeNull()
		expect(urls).toEqual([])
	})
	test("external placeholder probe failing gives null", async () => {
		expect(await (await mod("koboldcpp")).discoverSpeechFacts!(conn({}), "koboldcpp-speech")).toBeNull()
	})
})

// ── Catalogues ──────────────────────────────────────────────────────────────

describe("catalogueFor / speechEngineKey", () => {
	test("Kitten 2 matches, 0.8 does not", () => {
		for (const id of ["kitten_tts2", "kitten-tts-2", "kittentts2", "kitten_tts2_q8", "KittenTTS2"])
			expect(catalogueFor(id)?.family, id).toBe("kitten-tts-2")
		for (const id of ["kitten_tts", "kitten-tts-mini-0.8", "kitten_tts_nano_0.8", "kittentts"])
			expect(catalogueFor(id), id).toBeNull()
	})
	test("Qwen3 matches; the tokenizer file is not a speech model", () => {
		expect(catalogueFor("qwen3_tts_1_7b_customvoice_q8_0")?.family).toBe("qwen3-tts")
		expect(catalogueFor("Qwen3-TTS-0.6B-Base.gguf")?.family).toBe("qwen3-tts")
		expect(catalogueFor("qwen3-tts-tokenizer-f16.gguf")).toBeNull()
		expect(catalogueFor("qwen3-tts-tokenizer-q8_0.gguf")).toBeNull()
	})
	test("Kokoro matches case-insensitively", () => {
		expect(catalogueFor("Kokoro_no_espeak_Q4.gguf")?.family).toBe("kokoro")
		expect(catalogueFor("kokoro-82m")?.family).toBe("kokoro")
	})
	test("empty / unknown / non-string give null", () => {
		expect(catalogueFor("")).toBeNull()
		expect(catalogueFor("llama-3-8b")).toBeNull()
		expect(catalogueFor(undefined as any)).toBeNull()
		expect(catalogueFor(null as any)).toBeNull()
	})
	test("the catalogue list is the three engines", () => {
		expect(SPEECH_CATALOGUES.map((c) => c.family)).toEqual(["kokoro", "qwen3-tts", "kitten-tts-2"])
	})
	test("speechEngineKey: the id wins when it names an engine, else the display name, else the id", () => {
		expect(speechEngineKey("kokoro-82m", "Qwen3-TTS")).toBe("kokoro-82m")
		expect(speechEngineKey("koboldcpp-speech", "Kokoro")).toBe("Kokoro")
		expect(speechEngineKey("koboldcpp-speech", "Speech model")).toBe("koboldcpp-speech")
		expect(speechEngineKey("koboldcpp-speech")).toBe("koboldcpp-speech")
		expect(speechEngineKey("koboldcpp-speech", null)).toBe("koboldcpp-speech")
	})
	test("three Qwen3 variants", () => {
		expect(qwen3Variant("qwen3_tts_1_7b_customvoice_q8_0")).toBe("customvoice")
		expect(qwen3Variant("qwen3_tts_1_7b_voicedesign_q8_0")).toBe("voicedesign")
		expect(qwen3Variant("qwen3_tts_1_7b_base_q8_0")).toBe("base")
		expect(qwen3Variant("Qwen3-TTS-12Hz-0.6B-Base")).toBe("base")
		expect(qwen3Variant("Qwen3-TTS-12Hz-1.7B-VoiceDesign")).toBe("voicedesign")
		const cv = catalogueFor("qwen3_tts_1_7b_customvoice_q8_0")!.factsFor("qwen3_tts_1_7b_customvoice_q8_0")
		const vd = catalogueFor("qwen3_tts_1_7b_voicedesign_q8_0")!.factsFor("qwen3_tts_1_7b_voicedesign_q8_0")
		const base = catalogueFor("qwen3_tts_1_7b_base_q8_0")!.factsFor("qwen3_tts_1_7b_base_q8_0")
		expect([cv.voices.length, vd.voices.length, base.voices.length]).toEqual([9, 0, 0])
		expect(cv.controls.instruction).toBe("prose")
		expect(vd.controls.instruction).toBe("prose")
		expect(vd.notice).toMatch(/Voice Design/)
		expect(base.controls.instruction).toBeUndefined()
		expect(base.notice).toMatch(/Base model/)
	})
})

describe("catalogue contents", () => {
	test("Kokoro: 54 unique ids, 28 permitted by KoboldCPP (all a*/b*)", () => {
		expect(KOKORO_VOICE_IDS).toHaveLength(54)
		expect(new Set(KOKORO_VOICE_IDS).size).toBe(54)
		expect(KOKORO_KCPP_VOICE_IDS).toHaveLength(28)
		expect(KOKORO_KCPP_VOICE_IDS.every((id) => /^[ab][fm]_/.test(id))).toBe(true)
		expect(KOKORO_VOICE_IDS.every((id) => /^[a-z][fm]_[a-z_]+$/.test(id))).toBe(true)
	})
	test("Kokoro facts: speed 0.5-2, wav, 24 kHz, no streaming", () => {
		const f = catalogueFor("kokoro")!.factsFor("kokoro")
		expect(f.controls).toEqual({ speed: { min: 0.5, max: 2 } })
		expect(f.formats).toEqual(["wav"])
		expect(f.sampleRate).toBe(24000)
		expect(f.streams).toBe(false)
		expect(f.voicesFrom).toBe("catalogue")
	})
	test("Qwen3: 9 lowercase presets, 10 languages", () => {
		expect(QWEN3_PRESET_VOICES).toHaveLength(9)
		expect(QWEN3_PRESET_VOICES.every((v) => v.id === v.id.toLowerCase())).toBe(true)
		expect(QWEN3_PRESET_VOICES.find((v) => v.id === "uncle_fu")!.name).toBe("Uncle Fu")
		expect(QWEN3_LANGUAGES).toHaveLength(10)
	})
	test("Kitten 2: 47 voices, 10 tags, notice; factsFor returns copies", () => {
		expect(KITTEN2_VOICES).toHaveLength(47)
		expect(new Set(KITTEN2_VOICES.map((v) => v.id)).size).toBe(47)
		expect(KITTEN2_EMOTION_TAGS).toHaveLength(10)
		const f = catalogueFor("kitten_tts2")!.factsFor("kitten_tts2")
		expect(f.notice).toBe("Powered by KittenML")
		f.voices[0].name = "MUTATED"
		expect(KITTEN2_VOICES[0].name).not.toBe("MUTATED")
	})
})

// ── facts helpers ───────────────────────────────────────────────────────────

describe("readSpeechFacts / withSpeechFacts", () => {
	const facts: SpeechFacts = {
		voices: [{ id: "a", name: "A", kind: "preset", language: "en", previewUrl: "https://x", labels: { gender: "female", useCase: "n" } }],
		voicesFrom: "discovered",
		controls: {
			speed: { min: 0.5, max: 2 },
			instruction: "prose",
			tags: { syntax: "bracket", vocabulary: ["a", "b"] },
			settings: ["stability", "style"],
			language: ["en"],
			multiSpeaker: true
		},
		streams: true,
		formats: ["wav", "mp3"],
		sampleRate: 24000,
		deprecatedOn: "2027-01-06",
		notice: "hello"
	}
	test("round trip through JSON", () => {
		const bag = JSON.parse(JSON.stringify(withSpeechFacts({}, facts)))
		expect(readSpeechFacts(bag)).toEqual(facts)
	})
	test("open tag vocabulary round-trips", () => {
		const f: SpeechFacts = { ...facts, controls: { tags: { syntax: "bracket", vocabulary: "open" } } }
		expect(readSpeechFacts(withSpeechFacts(null, f))!.controls.tags).toEqual({ syntax: "bracket", vocabulary: "open" })
	})
	test("other facts keys are untouched, and the input object is not mutated", () => {
		const orig = { contextWindow: 8192, price: { in: 1 } }
		const out = withSpeechFacts(orig, facts)
		expect(out.contextWindow).toBe(8192)
		expect(out.price).toEqual({ in: 1 })
		expect(out[SPEECH_FACTS_KEY]).toBe(facts)
		expect(SPEECH_FACTS_KEY in orig).toBe(false)
	})
	test("withSpeechFacts(facts, null) removes only the speech key", () => {
		const out = withSpeechFacts({ contextWindow: 1, speech: facts }, null)
		expect(out).toEqual({ contextWindow: 1 })
	})
	test("null / array / primitive facts become a fresh bag", () => {
		expect(withSpeechFacts(null, null)).toEqual({})
		expect(withSpeechFacts([1, 2], facts)).toEqual({ speech: facts })
		expect(withSpeechFacts("x", null)).toEqual({})
	})
	test("garbage reads as null, never throws", () => {
		for (const bad of [null, undefined, 1, "s", [], {}, { speech: null }, { speech: [] }, { speech: "x" }, { speech: { voicesFrom: "bogus" } }])
			expect(readSpeechFacts(bad)).toBeNull()
	})
	test("a sloppy stored record is repaired field by field", () => {
		const r = readSpeechFacts({
			speech: {
				voicesFrom: "typed",
				voices: [{ id: "ok", kind: "weird" }, { id: " " }, null, { name: "no id" }],
				controls: { speed: { min: 3, max: 1 }, settings: ["stability", "nope"], tags: { syntax: "angle" }, language: [] },
				streams: "yes",
				formats: ["wav", 5, ""],
				sampleRate: -1
			}
		})!
		expect(r.voices).toEqual([{ id: "ok", name: "ok", kind: "preset" }])
		expect(r.controls).toEqual({ settings: ["stability"] })
		expect(r.streams).toBe(false)
		expect(r.formats).toEqual(["wav"])
		expect(r.sampleRate).toBeUndefined()
	})
})
