import { describe, expect, test } from "vitest"
import {
	NOT_SPEECH_REFUSAL,
	SPEECH_REFUSAL,
	TRANSCRIPTION_REFUSAL,
	repoIdFromUrl,
	speechRefusal
} from "./speechRefusal"
import { parseAudioFamiliesYaml, parseAudioYaml } from "$lib/server/audio/audioList"
import audioText from "$lib/server/audio/snapshot/audio.yaml?raw"
import familiesText from "$lib/server/audio/snapshot/audio-families.yaml?raw"

const lists = {
	entries: parseAudioYaml(audioText),
	families: parseAudioFamiliesYaml(familiesText)
}
const hf = (repo: string, file: string) =>
	`https://huggingface.co/${repo}/resolve/main/${file}`
const req = (
	repo: string,
	filename: string,
	kind: "text" | "image" | "speech" = "text"
) => ({ filename, downloadUrl: hf(repo, filename), modelUrl: `https://huggingface.co/${repo}`, kind })

describe("speechRefusal", () => {
	test("repoIdFromUrl", () => {
		expect(repoIdFromUrl(hf("a/b", "c.gguf"))).toBe("a/b")
		expect(repoIdFromUrl("nonsense")).toBeNull()
		expect(repoIdFromUrl(undefined)).toBeNull()
	})

	test.each([
		["audio-cpp/audio.cpp-gguf", "kokoro-82m-q8_0.gguf"],
		["koboldcpp/tts", "Kokoro_no_espeak_Q4.gguf"],
		["koboldcpp/tts", "OuteTTS-0.3-500M-Q4_0.gguf"],
		["koboldcpp/tts", "qwen3-tts-tokenizer-q8_0.gguf"],
		["koboldcpp/tts", "WavTokenizer-Large-75-Q4_0.gguf"]
	])("%s %s is refused as text and as image", (repo, file) => {
		expect(speechRefusal(req(repo, file, "text"), lists)).toBe(SPEECH_REFUSAL)
		expect(speechRefusal(req(repo, file, "image"), lists)).toBe(SPEECH_REFUSAL)
	})

	test("a qwen3-tts model from its own repo is refused", () => {
		expect(
			speechRefusal(req("someone/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF", "Qwen3-TTS-12Hz-1.7B-CustomVoice-Q8_0.gguf"), lists)
		).toBe(SPEECH_REFUSAL)
	})

	test("a transcription model gets the transcription sentence", () => {
		expect(
			speechRefusal(req("audio-cpp/audio.cpp-gguf", "parakeet-tdt-0.6b-v3-q8_0.gguf"), lists)
		).toBe(TRANSCRIPTION_REFUSAL)
		expect(
			speechRefusal(
				{
					filename: "Qwen3-ASR-1.7B-Q8_0.gguf",
					downloadUrl: hf("someone/Qwen3-ASR-1.7B-GGUF", "Qwen3-ASR-1.7B-Q8_0.gguf"),
					kind: "text"
				},
				lists
			)
		).toBe(TRANSCRIPTION_REFUSAL)
	})

	test.each([
		["bartowski/Llama-3.2-3B-Instruct-GGUF", "Llama-3.2-3B-Instruct-Q4_K_M.gguf"],
		["someone/tts-helper-chat-7B-GGUF", "tts-helper-chat-7B-Q4_K_M.gguf"],
		["someone/Mistral-Nemo-GGUF", "Mistral-Nemo-Q4_K_M.gguf"]
	])("chat GGUF %s is not refused", (repo, file) => {
		expect(speechRefusal(req(repo, file, "text"), lists)).toBeNull()
		expect(speechRefusal(req(repo, file, "image"), lists)).toBeNull()
	})

	test('kind "speech" is accepted for speech and codec files', () => {
		expect(speechRefusal(req("koboldcpp/tts", "Kokoro_no_espeak_Q4.gguf", "speech"), lists)).toBeNull()
		expect(speechRefusal(req("koboldcpp/tts", "WavTokenizer-Large-75-Q4_0.gguf", "speech"), lists)).toBeNull()
		expect(speechRefusal(req("koboldcpp/tts", "OuteTTS-0.3-500M-Q4_0.gguf", "speech"), lists)).toBeNull()
	})

	test('kind "speech" is refused for a chat GGUF and for a transcription model', () => {
		expect(
			speechRefusal(req("bartowski/Llama-3.2-3B-Instruct-GGUF", "Llama-3.2-3B-Instruct-Q4_K_M.gguf", "speech"), lists)
		).toBe(NOT_SPEECH_REFUSAL)
		expect(
			speechRefusal(req("audio-cpp/audio.cpp-gguf", "parakeet-tdt-0.6b-v3-q8_0.gguf", "speech"), lists)
		).toBe(TRANSCRIPTION_REFUSAL)
	})
})
