/**
 * Lane V2: the speech adapters' wire dialects against a stubbed `fetch`
 * (REPORT-speech-laneB fixtures 1-7), the partition rules, the error paths and
 * the WAV helpers. No network; the key decrypt and the managed preflight are
 * mocked so importing the profiles never boots the database.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: unknown) => (typeof v === "string" ? v : null)
}))
const ensureManagedReady = vi.fn()
vi.mock("$lib/server/koboldcpp/managedPreflight", () => ({
	ensureManagedReady: (...a: unknown[]) => ensureManagedReady(...a)
}))

import {
	NEVER_SENT,
	partitionSpeechKeys,
	SPEECH_REQUEST_KEYS,
	type SpeechRequest,
	type SpeechRequestKey
} from "./BaseSpeechAdapter"
import { mimeForFormat, wavDurationMs } from "./openAiSpeechDialect"
import { getSpeechAdapter } from "./getSpeechAdapter"

interface Recorded {
	url: string
	method: string
	headers: Record<string, string>
	body: string | undefined
}
let calls: Recorded[]
let responder: (url: string, init: RequestInit) => Response | Promise<Response>

function headersOf(h: unknown): Record<string, string> {
	const out: Record<string, string> = {}
	if (h && typeof h === "object")
		for (const [k, v] of Object.entries(h as Record<string, string>)) out[k] = v
	return out
}

beforeEach(() => {
	calls = []
	responder = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string | URL, init: RequestInit = {}) => {
			calls.push({
				url: String(url),
				method: init.method ?? "GET",
				headers: headersOf(init.headers),
				body: typeof init.body === "string" ? init.body : undefined
			})
			return responder(String(url), init)
		})
	)
})
afterEach(() => {
	vi.unstubAllGlobals()
	ensureManagedReady.mockReset()
})

const audio = (type = "audio/wav", bytes = new Uint8Array([9, 9])) =>
	new Response(bytes, { status: 200, headers: { "content-type": type } })

/** A canonical 16-bit mono WAV; `sizeField` overrides the data chunk's size. */
function wav(opts: { seconds: number; byteRate?: number; sizeField?: number }): Uint8Array<ArrayBuffer> {
	const byteRate = opts.byteRate ?? 48000
	const dataLen = Math.round(opts.seconds * byteRate)
	const out = new Uint8Array(44 + dataLen)
	const dv = new DataView(out.buffer)
	const tag = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)))
	tag(0, "RIFF")
	dv.setUint32(4, opts.sizeField ?? 36 + dataLen, true)
	tag(8, "WAVE")
	tag(12, "fmt ")
	dv.setUint32(16, 16, true)
	dv.setUint16(20, 1, true)
	dv.setUint16(22, 1, true)
	dv.setUint32(24, byteRate / 2, true)
	dv.setUint32(28, byteRate, true)
	dv.setUint16(32, 2, true)
	dv.setUint16(34, 16, true)
	tag(36, "data")
	dv.setUint32(40, opts.sizeField ?? dataLen, true)
	return out
}

const conn = (over: Record<string, unknown> = {}) =>
	({ id: 7, extraJson: {}, ...over }) as any

async function adapterFor(type: string, connection: any) {
	const mod = await getSpeechAdapter(type)
	if (!mod) throw new Error(`no speech module for ${type}`)
	return new mod.Adapter(connection)
}

// ── 1. OpenAI ───────────────────────────────────────────────────────────────

describe("fixture 1: openai", () => {
	test("cloud gpt-4o-mini-tts: exact body, headers, applied/ignored, mime", async () => {
		responder = () => audio("audio/mpeg")
		const a = await adapterFor(
			"openai",
			conn({
				type: "openai",
				baseUrl: "https://api.openai.com/v1",
				model: "gpt-4o-mini-tts",
				extraJson: { apiKey: "sk-test" }
			})
		)
		const r = await a.synthesizeSpeech({
			text: "Hello",
			voice: "coral",
			speed: 9,
			direction: "hushed",
			pitch: 1.2,
			volume: 0.5,
			format: "mp3"
		})
		expect(calls).toHaveLength(1)
		expect(calls[0].url).toBe("https://api.openai.com/v1/audio/speech")
		expect(calls[0].method).toBe("POST")
		expect(calls[0].headers.Authorization).toBe("Bearer sk-test")
		expect(calls[0].headers["Content-Type"]).toBe("application/json")
		expect(calls[0].body).toBe(
			'{"model":"gpt-4o-mini-tts","input":"Hello","voice":"coral","response_format":"mp3","speed":4,"instructions":"hushed"}'
		)
		expect(r.applied).toEqual(["voice", "format", "speed", "direction"])
		expect(r.ignored).toEqual(["pitch", "volume", "speed"])
		expect(r.media[0].mime).toBe("audio/mpeg")
		expect(r.media[0].kind).toBe("audio")
		expect(r.isAborted).toBe(false)
		expect(r.spokenAs).toEqual({ voice: "coral", model: "gpt-4o-mini-tts", connection: 7 })
	})

	test("cloud: tts-1 does not take `instructions`; direction is ignored and not sent", async () => {
		responder = () => audio("audio/mpeg")
		const a = await adapterFor(
			"openai",
			conn({ baseUrl: "https://api.openai.com/v1", model: "tts-1", extraJson: { apiKey: "k" } })
		)
		const r = await a.synthesizeSpeech({ text: "Hi", voice: "alloy", direction: "x" })
		expect(JSON.parse(calls[0].body!)).toEqual({
			model: "tts-1",
			input: "Hi",
			voice: "alloy",
			response_format: "mp3"
		})
		expect(r.ignored).toContain("direction")
	})

	test("local host: kokoro, wav default, direction ignored, no Authorization without a key", async () => {
		responder = () => audio("audio/wav", wav({ seconds: 1 }))
		const a = await adapterFor(
			"openai",
			conn({ baseUrl: "http://x:8880/v1", model: "kokoro" })
		)
		const r = await a.synthesizeSpeech({ text: "hi", direction: "x" })
		expect(calls[0].url).toBe("http://x:8880/v1/audio/speech")
		expect(calls[0].body).toBe('{"model":"kokoro","input":"hi","response_format":"wav"}')
		expect(calls[0].headers.Authorization).toBeUndefined()
		expect(r.applied).toEqual([])
		expect(r.ignored).toEqual(["direction"])
		expect(r.media[0].durationMs).toBe(1000)
	})

	test("a format outside the list is replaced by the default and reported ignored", async () => {
		const a = await adapterFor("openai", conn({ baseUrl: "http://x:8880/v1", model: "kokoro" }))
		const r = await a.synthesizeSpeech({ text: "hi", format: "ogg" })
		expect(JSON.parse(calls[0].body!).response_format).toBe("wav")
		expect(r.ignored).toContain("format")
		expect(r.applied).not.toContain("format")
	})
})

// ── 2. Ollama ───────────────────────────────────────────────────────────────

describe("fixture 2: ollama", () => {
	const mk = () => adapterFor("ollama", conn({ type: "ollama", baseUrl: "http://o:11434", model: "phonon" }))

	test("exact body, applied/ignored, and a streamed WAV header (0xffffffff) still gets durationMs", async () => {
		responder = () => audio("audio/wav", wav({ seconds: 2, sizeField: 0xffffffff }))
		const r = await (await mk()).synthesizeSpeech({
			text: "Hello",
			voice: "coral",
			format: "wav",
			speed: 1.5,
			direction: "d",
			pitch: 1,
			volume: 1
		})
		expect(calls[0].url).toBe("http://o:11434/v1/audio/speech")
		expect(calls[0].body).toBe(
			'{"model":"phonon","input":"Hello","voice":"coral","response_format":"wav"}'
		)
		expect(r.applied).toEqual(["voice", "format"])
		expect(r.ignored).toEqual(["speed", "direction", "pitch", "volume"])
		expect(r.media[0].durationMs).toBe(2000)
		expect(r.media[0].mime).toBe("audio/wav")
	})

	test("a 5000-character input throws before any request", async () => {
		await expect((await mk()).synthesizeSpeech({ text: "a".repeat(5000) })).rejects.toThrow(/at most 4096/)
		expect(calls).toHaveLength(0)
	})

	test("exactly 4096 characters is allowed", async () => {
		await (await mk()).synthesizeSpeech({ text: "a".repeat(4096) })
		expect(calls).toHaveLength(1)
	})

	test("language, seed and tags are never sent", async () => {
		await (await mk()).synthesizeSpeech({ text: "x", language: "en", seed: 3, tags: ["[a]"] })
		expect(Object.keys(JSON.parse(calls[0].body!)).sort()).toEqual(["input", "model", "response_format"])
	})
})

// ── 3. KoboldCPP Kokoro ─────────────────────────────────────────────────────

describe("fixture 3: koboldcpp (external) Kokoro", () => {
	test("exact body; speed/direction/pitch ignored", async () => {
		responder = () => audio("audio/wav", wav({ seconds: 0.5 }))
		const a = await adapterFor(
			"koboldcpp",
			conn({ type: "koboldcpp", baseUrl: "http://h:5001/v1/", model: "Kokoro_no_espeak_Q4.gguf" })
		)
		const r = await a.synthesizeSpeech({
			text: "Hi",
			voice: "af_bella",
			format: "wav",
			speed: 1.4,
			direction: "soft",
			pitch: 2
		})
		expect(calls[0].url).toBe("http://h:5001/v1/audio/speech")
		expect(calls[0].body).toBe(
			'{"model":"Kokoro_no_espeak_Q4.gguf","input":"Hi","voice":"af_bella","response_format":"wav"}'
		)
		expect(r.applied).toEqual(["voice", "format"])
		expect(r.ignored).toEqual(["speed", "direction", "pitch"])
	})

	test.each([
		["http://h:5001", "http://h:5001/v1/audio/speech"],
		["http://h:5001/", "http://h:5001/v1/audio/speech"],
		["http://h:5001/v1", "http://h:5001/v1/audio/speech"],
		["http://h:5001/v1/", "http://h:5001/v1/audio/speech"],
		["", "http://localhost:5001/v1/audio/speech"],
		[null, "http://localhost:5001/v1/audio/speech"]
	])("externalRoot %j -> %s", async (baseUrl, expected) => {
		const a = await adapterFor("koboldcpp", conn({ baseUrl, model: "Kokoro.gguf" }))
		await a.synthesizeSpeech({ text: "x" })
		expect(calls[0].url).toBe(expected)
	})
})

// ── 4. KoboldCPP Qwen3 CustomVoice ──────────────────────────────────────────

describe("fixture 4: koboldcpp Qwen3 CustomVoice", () => {
	const CV = "qwen3_tts_1_7b_customvoice_q8_0.gguf"
	test("direction + folded tags in `instruction`, language, seed", async () => {
		const a = await adapterFor("koboldcpp", conn({ baseUrl: "http://h:5001", model: CV }))
		const r = await a.synthesizeSpeech({
			text: "Hello",
			voice: "aiden",
			direction: "hushed",
			language: "en",
			tags: ["[whispers]"],
			pitch: 2,
			seed: 3
		})
		expect(calls[0].body).toBe(
			'{"model":"qwen3_tts_1_7b_customvoice_q8_0.gguf","input":"Hello","voice":"aiden","response_format":"wav","instruction":"whispers. hushed","language":"en","seed":3}'
		)
		expect(r.applied).toEqual(["voice", "direction", "language", "seed", "tags"])
		expect(r.ignored).toEqual(["pitch"])
	})

	test("tags with no direction: instruction is the tags alone; `direction` not reported applied", async () => {
		const a = await adapterFor("koboldcpp", conn({ baseUrl: "http://h:5001", model: CV }))
		const r = await a.synthesizeSpeech({ text: "Hello", voice: "aiden", tags: ["[whispers]", "[slow]"] })
		expect(JSON.parse(calls[0].body!).instruction).toBe("whispers, slow")
		expect(r.applied).toContain("tags")
		expect(r.applied).not.toContain("direction")
	})

	test("Qwen3 Base is not steerable: instruction and language are not sent", async () => {
		const a = await adapterFor(
			"koboldcpp",
			conn({ baseUrl: "http://h:5001", model: "qwen3_tts_1_7b_base_q8_0.gguf" })
		)
		const r = await a.synthesizeSpeech({ text: "Hello", direction: "hushed", language: "en", tags: ["[x]"] })
		const body = JSON.parse(calls[0].body!)
		expect(body.instruction).toBeUndefined()
		expect(body.language).toBeUndefined()
		expect(r.ignored).toEqual(expect.arrayContaining(["direction", "language", "tags"]))
	})

	test("an engine named by the row's display name steers when the model id does not say", async () => {
		const a = await adapterFor(
			"koboldcpp",
			conn({
				baseUrl: "http://h:5001",
				model: "koboldcpp-speech",
				connectionModelName: "Qwen3-TTS CustomVoice"
			})
		)
		await a.synthesizeSpeech({ text: "x", direction: "calm" })
		expect(JSON.parse(calls[0].body!).instruction).toBe("calm")
	})
})

describe("koboldcpp managed", () => {
	test("makes the process ready for the chosen file, then posts to the address it answered", async () => {
		ensureManagedReady.mockResolvedValue({ baseUrl: "http://127.0.0.1:5999" })
		const a = await adapterFor(
			"koboldcpp_managed",
			conn({ id: 11, type: "koboldcpp_managed", model: "Kokoro_no_espeak_Q4.gguf" })
		)
		await a.synthesizeSpeech({ text: "x", voice: "af_bella" })
		expect(ensureManagedReady).toHaveBeenCalledWith(
			{ kind: "audio", file: "Kokoro_no_espeak_Q4.gguf" },
			expect.objectContaining({ connectionId: 11 })
		)
		expect(calls[0].url).toBe("http://127.0.0.1:5999/v1/audio/speech")
	})

	test("no speech model chosen: a sentence, and nothing started", async () => {
		const a = await adapterFor("koboldcpp_managed", conn({ model: "" }))
		await expect(a.synthesizeSpeech({ text: "x" })).rejects.toThrow(/No speech model is chosen/)
		expect(ensureManagedReady).not.toHaveBeenCalled()
		expect(calls).toHaveLength(0)
	})
})

// ── 6. audio.cpp (speech request) ───────────────────────────────────────────

describe("fixture 6: audio.cpp speech request", () => {
	test("exact body (no response_format), applied/ignored", async () => {
		responder = () => audio("audio/wav", wav({ seconds: 1 }))
		const a = await adapterFor(
			"audiocpp",
			conn({ type: "audiocpp", baseUrl: "http://127.0.0.1:8080", model: "qwen3_tts_1_7b_customvoice_q8_0" })
		)
		const r = await a.synthesizeSpeech({
			text: "Hello.",
			voice: "Vivian",
			direction: "warm, slow",
			speed: 1.2,
			pitch: 3,
			language: "en"
		})
		expect(calls[0].url).toBe("http://127.0.0.1:8080/v1/audio/speech")
		expect(calls[0].body).toBe(
			'{"model":"qwen3_tts_1_7b_customvoice_q8_0","input":"Hello.","voice":"Vivian","speed":1.2,"instructions":"warm, slow","language":"en"}'
		)
		expect(r.applied).toEqual(["voice", "speed", "direction", "language"])
		expect(r.ignored).toEqual(["pitch"])
	})

	test("Kitten 2: inline tags ahead of the text, no instruction field", async () => {
		const a = await adapterFor("audiocpp", conn({ baseUrl: "http://a:8080", model: "kitten_tts2_q8" }))
		const r = await a.synthesizeSpeech({ text: "Hello.", voice: "Bella", tags: ["[joyful]"], direction: "d" })
		const body = JSON.parse(calls[0].body!)
		expect(body.input).toBe("[joyful] Hello.")
		expect(body.instructions).toBeUndefined()
		expect(r.applied).toContain("tags")
		expect(r.ignored).toContain("direction")
	})

	test("Qwen3 VoiceDesign drops the voice key from the honoured set", async () => {
		const a = await adapterFor(
			"audiocpp",
			conn({ baseUrl: "http://a:8080", model: "qwen3_tts_1_7b_voicedesign_q8_0" })
		)
		const r = await a.synthesizeSpeech({ text: "Hello.", voice: "x", direction: "deep" })
		expect(r.ignored).toContain("voice")
		expect(JSON.parse(calls[0].body!).instructions).toBe("deep")
	})

	test("speed outside 0.5..2 is clamped and listed in both applied and ignored", async () => {
		const a = await adapterFor("audiocpp", conn({ baseUrl: "http://a:8080", model: "qwen3_tts_1_7b_customvoice_q8_0" }))
		const r = await a.synthesizeSpeech({ text: "x", speed: 5 })
		expect(JSON.parse(calls[0].body!).speed).toBe(2)
		expect(r.applied).toContain("speed")
		expect(r.ignored).toContain("speed")
	})
})

// ── 7. ElevenLabs (speech request) ──────────────────────────────────────────

describe("fixture 7: elevenlabs speech request", () => {
	const eleven = (over: Record<string, unknown> = {}) =>
		adapterFor(
			"elevenlabs",
			conn({ type: "elevenlabs", baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "xi-secret" }, ...over })
		)

	test("exact URL, header, body, applied/ignored, mime", async () => {
		responder = () => audio("audio/ogg")
		const r = await (await eleven()).synthesizeSpeech({
			text: "Hello.",
			voice: "v1",
			model: "eleven_v3",
			tags: ["[whispers]"],
			speed: 1.1,
			direction: "hushed",
			pitch: 2,
			language: "en-US",
			format: "opus"
		})
		expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=opus_48000_64")
		expect(calls[0].method).toBe("POST")
		expect(calls[0].headers["xi-api-key"]).toBe("xi-secret")
		expect(calls[0].body).toBe(
			'{"model_id":"eleven_v3","text":"[whispers] Hello.","voice_settings":{"speed":1.1},"language_code":"en"}'
		)
		expect(r.applied).toEqual(["model", "voice", "format", "speed", "tags", "language"])
		expect(r.ignored).toEqual(["direction", "pitch"])
		expect(r.media[0].mime).toBe("audio/ogg")
	})

	test("language dropped on multilingual_v2; tags dropped on a model without them", async () => {
		const r = await (await eleven({ model: "eleven_multilingual_v2" })).synthesizeSpeech({
			text: "Hi",
			voice: "v1",
			language: "fr",
			tags: ["[sighs]"]
		})
		const body = JSON.parse(calls[0].body!)
		expect(body.language_code).toBeUndefined()
		expect(body.text).toBe("Hi")
		expect(r.ignored).toEqual(expect.arrayContaining(["language", "tags"]))
	})

	test("seed bounds 0..2^32-1", async () => {
		const a = await eleven()
		for (const [seed, sent] of [[0, true], [4294967295, true], [4294967296, false], [-1, false], [1.5, false]] as const) {
			calls.length = 0
			const r = await a.synthesizeSpeech({ text: "x", voice: "v", seed })
			expect(JSON.parse(calls[0].body!).seed === seed).toBe(sent)
			expect(r.applied.includes("seed")).toBe(sent)
			expect(r.ignored.includes("seed")).toBe(!sent)
		}
	})

	test("speed outside 0.7..1.2 is reported ignored and NOT sent (not clamped)", async () => {
		const r = await (await eleven()).synthesizeSpeech({ text: "x", voice: "v", speed: 2 })
		expect(JSON.parse(calls[0].body!).voice_settings).toBeUndefined()
		expect(r.ignored).toContain("speed")
	})

	test("mp3 is the default; the default model is eleven_flash_v2_5 when none is given", async () => {
		const a = await adapterFor("elevenlabs", conn({ baseUrl: "https://api.elevenlabs.io", extraJson: { apiKey: "k" } }))
		const r = await a.synthesizeSpeech({ text: "x", voice: "v" })
		expect(calls[0].url).toContain("output_format=mp3_44100_128")
		expect(JSON.parse(calls[0].body!).model_id).toBe("eleven_flash_v2_5")
		expect(r.media[0].mime).toBe("audio/mpeg")
	})

	test("a voice is required; a key is required", async () => {
		await expect((await eleven()).synthesizeSpeech({ text: "x" })).rejects.toThrow(/needs a voice/)
		const noKey = await eleven({ extraJson: {} })
		await expect(noKey.synthesizeSpeech({ text: "x", voice: "v" })).rejects.toThrow(/no API key/)
		expect(calls).toHaveLength(0)
	})
})

// ── Errors and abort ────────────────────────────────────────────────────────

describe("errors", () => {
	test("Ollama 400 with a voice list: the service's own message is in the thrown text", async () => {
		responder = () =>
			new Response(JSON.stringify({ error: { message: 'unknown voice "zz"; available voices: alba, coral' } }), { status: 400 })
		const a = await adapterFor("ollama", conn({ baseUrl: "http://o:11434", model: "phonon" }))
		await expect(a.synthesizeSpeech({ text: "x", voice: "zz" })).rejects.toThrow(
			/HTTP 400.*available voices: alba, coral/
		)
	})

	test("Ollama 400 with a plain-string `error`", async () => {
		responder = () => new Response(JSON.stringify({ error: "bad voice; voices: a, b" }), { status: 400 })
		const a = await adapterFor("ollama", conn({ baseUrl: "http://o:11434", model: "phonon" }))
		await expect(a.synthesizeSpeech({ text: "x" })).rejects.toThrow(/voices: a, b/)
	})

	test("OpenAI-dialect 401 names the status", async () => {
		responder = () => new Response("nope", { status: 401, statusText: "Unauthorized" })
		const a = await adapterFor("openai", conn({ baseUrl: "https://api.openai.com/v1", model: "tts-1", extraJson: { apiKey: "k" } }))
		await expect(a.synthesizeSpeech({ text: "x", voice: "alloy" })).rejects.toThrow(/HTTP 401.*nope/)
	})

	test("a long error body is trimmed to 300 characters plus an ellipsis", async () => {
		responder = () => new Response("e".repeat(1000), { status: 500 })
		const a = await adapterFor("openai", conn({ baseUrl: "http://x/v1", model: "m" }))
		const err = await a.synthesizeSpeech({ text: "x" }).catch((e: unknown) => e as Error) as Error
		expect(err.message.endsWith("…")).toBe(true)
		expect(err.message.length).toBeLessThan(400)
	})

	test("ElevenLabs `detail` string", async () => {
		responder = () => new Response(JSON.stringify({ detail: "Voice not found" }), { status: 404 })
		const a = await adapterFor("elevenlabs", conn({ baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "xi-secret" } }))
		await expect(a.synthesizeSpeech({ text: "x", voice: "v" })).rejects.toThrow("Voice not found")
	})

	test("ElevenLabs 422 array detail: messages are joined", async () => {
		responder = () =>
			new Response(JSON.stringify({ detail: [{ msg: "field required" }, { msg: "bad seed" }] }), { status: 422 })
		const a = await adapterFor("elevenlabs", conn({ baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "k" } }))
		await expect(a.synthesizeSpeech({ text: "x", voice: "v" })).rejects.toThrow("field required; bad seed")
	})

	test("ElevenLabs `detail.message` object", async () => {
		responder = () => new Response(JSON.stringify({ detail: { status: "x", message: "quota exceeded" } }), { status: 401 })
		const a = await adapterFor("elevenlabs", conn({ baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "k" } }))
		await expect(a.synthesizeSpeech({ text: "x", voice: "v" })).rejects.toThrow("quota exceeded")
	})

	test("ElevenLabs 401 without a body: the key sentence, and the key itself is never echoed", async () => {
		responder = () => new Response("", { status: 401 })
		const a = await adapterFor("elevenlabs", conn({ baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "xi-SECRET-123" } }))
		const err = await a.synthesizeSpeech({ text: "x", voice: "v" }).catch((e: unknown) => e as Error) as Error
		expect(err.message).toMatch(/rejected the API key \(HTTP 401\)/)
		expect(err.message).not.toContain("xi-SECRET-123")
	})

	test("a network failure is wrapped; an abort is a result, not a throw", async () => {
		const a = await adapterFor("openai", conn({ baseUrl: "http://x/v1", model: "m" }))
		vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"))
		await expect(a.synthesizeSpeech({ text: "x" })).rejects.toThrow(/did not reach the service: ECONNREFUSED/)

		const ac = new AbortController()
		vi.mocked(fetch).mockImplementationOnce(async () => {
			ac.abort()
			throw Object.assign(new Error("aborted"), { name: "AbortError" })
		})
		const r = await a.synthesizeSpeech({ text: "x", voice: "v" }, { signal: ac.signal })
		expect(r.isAborted).toBe(true)
		expect(r.media).toEqual([])
		expect(r.spokenAs.voice).toBe("v")
	})

	test("ElevenLabs abort (by AbortError, signal or not) is a result with isAborted", async () => {
		const a = await adapterFor("elevenlabs", conn({ baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "k" } }))
		const ac = new AbortController()
		vi.mocked(fetch).mockImplementationOnce(async () => {
			ac.abort()
			throw Object.assign(new Error("aborted"), { name: "AbortError" })
		})
		const r = await a.synthesizeSpeech({ text: "x", voice: "v" }, { signal: ac.signal })
		expect(r.isAborted).toBe(true)
		expect(r.media).toEqual([])
	})

	test("a body read cut short by an abort is also a result", async () => {
		const ac = new AbortController()
		responder = () => {
			const res = new Response("x")
			vi.spyOn(res, "arrayBuffer").mockImplementation(async () => {
				ac.abort()
				throw new Error("terminated")
			})
			return res
		}
		const a = await adapterFor("openai", conn({ baseUrl: "http://x/v1", model: "m" }))
		const r = await a.synthesizeSpeech({ text: "x" }, { signal: ac.signal })
		expect(r.isAborted).toBe(true)
	})
})

// ── partitionSpeechKeys ─────────────────────────────────────────────────────

describe("partitionSpeechKeys", () => {
	const all: readonly SpeechRequestKey[] = SPEECH_REQUEST_KEYS

	test("absent, null, empty-array and blank-string keys are in neither list", () => {
		const r = partitionSpeechKeys(
			{ text: "x", voice: "  ", direction: "", tags: [], language: undefined, seed: null as any, format: undefined },
			all
		)
		expect(r).toEqual({ applied: [], ignored: [] })
	})

	test("zero is present (speed 0, seed 0)", () => {
		expect(partitionSpeechKeys({ text: "x", speed: 0, seed: 0 }, all).applied).toEqual(["speed", "seed"])
	})

	test("pitch and volume are ignored even when 'honoured'", () => {
		const r = partitionSpeechKeys({ text: "x", pitch: 1, volume: 1 }, all)
		expect(r).toEqual({ applied: [], ignored: ["pitch", "volume"] })
		expect([...NEVER_SENT]).toEqual(["pitch", "volume"])
	})

	test("keys come out in the fixed SPEECH_REQUEST_KEYS order whatever the object's order", () => {
		const r = partitionSpeechKeys({ seed: 1, text: "x", voice: "v", model: "m" } as SpeechRequest, ["model", "voice"])
		expect(r.applied).toEqual(["model", "voice"])
		expect(r.ignored).toEqual(["seed"])
	})
})

// ── property: nothing ignored is ever on the wire ───────────────────────────

describe("no ignored key is ever in the request body", () => {
	const FULL: SpeechRequest = {
		text: "Well met.",
		voice: "v1",
		model: undefined,
		format: "wav",
		speed: 9,
		direction: "DIRECTION-SENTINEL",
		tags: ["[TAG-SENTINEL]"],
		language: "en",
		seed: 12,
		pitch: 1.5,
		volume: 0.2
	}
	const BODY_FIELDS: Record<SpeechRequestKey, string[]> = {
		model: ["model", "model_id"],
		voice: ["voice"],
		format: ["response_format", "output_format"],
		speed: ["speed", "voice_settings"],
		direction: ["instructions", "instruction"],
		tags: [],
		language: ["language", "language_code"],
		seed: ["seed"],
		pitch: ["pitch"],
		volume: ["volume"]
	}
	const cases: [string, string, Record<string, unknown>, string?][] = [
		["openai cloud gpt-4o-mini-tts", "openai", { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", extraJson: { apiKey: "k" } }],
		["openai cloud tts-1", "openai", { baseUrl: "https://api.openai.com/v1", model: "tts-1", extraJson: { apiKey: "k" } }],
		["openai local", "openai", { baseUrl: "http://x:8880/v1", model: "kokoro" }],
		["ollama", "ollama", { baseUrl: "http://o:11434", model: "phonon" }],
		["koboldcpp kokoro", "koboldcpp", { baseUrl: "http://h:5001", model: "Kokoro_no_espeak_Q4.gguf" }],
		["koboldcpp qwen3 cv", "koboldcpp", { baseUrl: "http://h:5001", model: "qwen3_tts_1_7b_customvoice_q8_0.gguf" }],
		["koboldcpp qwen3 base", "koboldcpp", { baseUrl: "http://h:5001", model: "qwen3_tts_1_7b_base_q8_0.gguf" }],
		["audiocpp qwen3 cv", "audiocpp", { baseUrl: "http://a:8080", model: "qwen3_tts_1_7b_customvoice_q8_0" }],
		["audiocpp qwen3 vd", "audiocpp", { baseUrl: "http://a:8080", model: "qwen3_tts_1_7b_voicedesign_q8_0" }],
		["audiocpp kitten2", "audiocpp", { baseUrl: "http://a:8080", model: "kitten_tts2_q8" }],
		["audiocpp kokoro", "audiocpp", { baseUrl: "http://a:8080", model: "kokoro_q8" }],
		["elevenlabs v3", "elevenlabs", { baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "k" } }],
		["elevenlabs multilingual_v2", "elevenlabs", { baseUrl: "https://api.elevenlabs.io", model: "eleven_multilingual_v2", extraJson: { apiKey: "k" } }]
	]
	test.each(cases)("%s", async (_name, type, c) => {
		ensureManagedReady.mockResolvedValue({ baseUrl: "http://m:1" })
		const a = await adapterFor(type, conn(c))
		const r = await a.synthesizeSpeech({ ...FULL })
		const raw = calls[0].body!
		const body = JSON.parse(raw)
		// pitch / volume: never, anywhere.
		expect(raw).not.toMatch(/pitch|volume/)
		expect(r.ignored).toEqual(expect.arrayContaining(["pitch", "volume"]))
		// A key reported `ignored` and NOT `applied` leaves nothing on the wire.
		for (const key of r.ignored) {
			if (r.applied.includes(key)) continue // clamped speed
			for (const field of BODY_FIELDS[key as SpeechRequestKey] ?? []) {
				// `model` / `voice` are always sent when they resolve (dialect policy), so skip those two.
				if (key === "model" || key === "voice") continue
				if (field === "response_format" || field === "output_format") continue // a default format still goes out
				expect(field in body).toBe(false)
			}
		}
		if (r.ignored.includes("direction")) expect(raw).not.toContain("DIRECTION-SENTINEL")
		if (!r.applied.includes("tags")) expect(raw).not.toContain("TAG-SENTINEL")
		// Everything applied is accounted for: `applied` and `ignored` only name request keys.
		for (const k of [...r.applied, ...r.ignored]) expect(SPEECH_REQUEST_KEYS).toContain(k)
	})
})

// ── WAV and mime helpers ────────────────────────────────────────────────────

describe("wavDurationMs", () => {
	test("a normal WAV", () => expect(wavDurationMs(wav({ seconds: 1.5 }))).toBe(1500))
	test("a streaming header (0xffffffff sizes) is measured from the actual bytes", () =>
		expect(wavDurationMs(wav({ seconds: 2, sizeField: 0xffffffff }))).toBe(2000))
	test("a header whose data size overshoots the bytes uses the bytes", () => {
		const b = wav({ seconds: 1 })
		new DataView(b.buffer).setUint32(40, 10_000_000, true)
		expect(wavDurationMs(b)).toBe(1000)
	})
	test("a data size smaller than the bytes is honoured (trailing chunk)", () => {
		const b = wav({ seconds: 1 })
		new DataView(b.buffer).setUint32(40, 24000, true)
		expect(wavDurationMs(b)).toBe(500)
	})
	test("not a WAV, too short, and a zero byteRate give undefined", () => {
		expect(wavDurationMs(new Uint8Array(100))).toBeUndefined()
		expect(wavDurationMs(new Uint8Array(10))).toBeUndefined()
		expect(wavDurationMs(new TextEncoder().encode("ID3" + "x".repeat(60)))).toBeUndefined()
		const z = wav({ seconds: 1 })
		new DataView(z.buffer).setUint32(28, 0, true)
		expect(wavDurationMs(z)).toBeUndefined()
	})
	test("an extra chunk before `data` is skipped", () => {
		const base = wav({ seconds: 1 })
		const list = new Uint8Array(8 + 4)
		list.set([...("LIST")].map((c) => c.charCodeAt(0)), 0)
		new DataView(list.buffer).setUint32(4, 4, true)
		const out = new Uint8Array(base.length + list.length)
		out.set(base.subarray(0, 36), 0)
		out.set(list, 36)
		out.set(base.subarray(36), 36 + list.length)
		expect(wavDurationMs(out)).toBe(1000)
	})
	test("works on a Uint8Array view with a byteOffset", () => {
		const b = wav({ seconds: 1 })
		const padded = new Uint8Array(b.length + 7)
		padded.set(b, 7)
		expect(wavDurationMs(padded.subarray(7))).toBe(1000)
	})
})

describe("mimeForFormat", () => {
	test.each([
		["mp3", "audio/mpeg"], ["opus", "audio/ogg"], ["aac", "audio/aac"], ["flac", "audio/flac"],
		["wav", "audio/wav"], ["pcm", "audio/pcm"], ["WAV", "audio/wav"], ["ogg", "application/octet-stream"]
	])("%s -> %s", (f, m) => expect(mimeForFormat(f)).toBe(m))
})

describe("response mime", () => {
	test("a non-audio content-type falls back to the requested format's mime", async () => {
		responder = () => new Response(new Uint8Array([1]), { headers: { "content-type": "application/octet-stream" } })
		const a = await adapterFor("openai", conn({ baseUrl: "http://x/v1", model: "m" }))
		const r = await a.synthesizeSpeech({ text: "x", format: "flac" })
		expect(r.media[0].mime).toBe("audio/flac")
	})
	test("an audio content-type with parameters is trimmed", async () => {
		responder = () => audio("audio/wav; charset=binary", wav({ seconds: 1 }))
		const a = await adapterFor("openai", conn({ baseUrl: "http://x/v1", model: "m" }))
		const r = await a.synthesizeSpeech({ text: "x" })
		expect(r.media[0].mime).toBe("audio/wav")
	})
})
