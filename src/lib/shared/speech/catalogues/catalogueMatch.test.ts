import { describe, expect, it } from "vitest"
import { catalogueFor, speechEngineKey } from "./index"

const K = "kokoro"
const Q = "qwen3-tts"
const T = "kitten-tts-2"

const TABLE: [string, string | null][] = [
	["kokoro_82m_q8_0", K],
	["Kokoro-82M-Q8_0.gguf", K],
	["hexgrad/Kokoro-82M", K],
	["Kokoro", K],
	["qwen3_tts_1_7b_customvoice_q8_0", Q],
	[
		"Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf",
		Q
	],
	["koboldcpp/tts/Qwen3-TTS-0.6B-Base.gguf", Q],
	["Qwen3-TTS CustomVoice", Q],
	["qwen3-tts-tokenizer-12hz.gguf", null],
	["Qwen3-TTS-Tokenizer-12Hz/qwen3-tts-tokenizer-12hz-f16.gguf", null],
	["kitten_tts2_nano_q8_0", T],
	["kitten-tts-2", T],
	["kittentts2", T],
	["KittenTTS 2", T],
	["kitten tts 2 mini", T],
	["kitten_tts2.gguf", T],
	["kitten_tts", null],
	["kitten-tts-mini-0.8", null],
	["KittenML/kitten-tts-mini-0.8", null],
	["kitten_tts_2.5", null],
	["kitten-tts-20", null],
	["parakeet_tdt_0_6b_v3_q8_0", null],
	["qwen3_asr_0_6b_q8_0", null],
	["gpt-4o-mini-tts", null],
	["whisper-1", null],
	["koboldcpp-speech", null],
	["", null]
]

describe("catalogueFor (matches via the audio families data)", () => {
	it.each(TABLE)("%s -> %s", (input, family) => {
		expect(catalogueFor(input)?.family ?? null).toBe(family)
	})

	it("guards non-string input", () => {
		expect(catalogueFor(null as unknown as string)).toBeNull()
		expect(catalogueFor(undefined as unknown as string)).toBeNull()
	})

	it("speechEngineKey falls back to the display name", () => {
		expect(speechEngineKey("koboldcpp-speech", "Kokoro")).toBe("Kokoro")
		expect(speechEngineKey("kokoro_82m_q8_0", "x")).toBe("kokoro_82m_q8_0")
		expect(speechEngineKey("koboldcpp-speech", null)).toBe("koboldcpp-speech")
	})
})
