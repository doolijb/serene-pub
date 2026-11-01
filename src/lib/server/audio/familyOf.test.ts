import { describe, expect, test } from "vitest"
import { familyOf } from "./familyOf"
import { parseAudioFamiliesYaml, parseAudioYaml } from "./audioList"
import audioText from "./snapshot/audio.yaml?raw"
import familiesText from "./snapshot/audio-families.yaml?raw"

const lists = {
	entries: parseAudioYaml(audioText),
	families: parseAudioFamiliesYaml(familiesText)
}

describe("familyOf - listed", () => {
	test("a listed id", () => {
		expect(familyOf({ listedId: "kokoro_82m_q8_0" }, lists)).toEqual({
			task: "tts",
			family: "kokoro_tts",
			confidence: "listed"
		})
	})
	test("a listed VoiceDesign id carries variant and vdes", () => {
		expect(familyOf({ listedId: "qwen3_tts_1_7b_voicedesign_q8_0" }, lists)).toEqual({
			task: "vdes",
			family: "qwen3_tts",
			variant: "voicedesign",
			confidence: "listed"
		})
	})
	test("an unknown id is null", () => {
		expect(familyOf({ listedId: "nope" }, lists)).toBeNull()
	})
	test("the listed hf repo with a listed sibling", () => {
		const g = familyOf(
			{
				hf: {
					repoId: "audio-cpp/audio.cpp-gguf",
					siblings: ["Parakeet-TDT-0.6B-v3-GGUF/parakeet-tdt-0.6b-v3-q8_0.gguf"]
				}
			},
			lists
		)
		expect(g).toEqual({ task: "asr", family: "parakeet_tdt", confidence: "listed" })
	})
	test("a file named exactly like a listed file", () => {
		const g = familyOf({ file: { path: "/models/x/kokoro-82m-q8_0.gguf" } }, lists)
		expect(g?.confidence).toBe("listed")
		expect(g?.family).toBe("kokoro_tts")
	})
})

describe("familyOf - hf", () => {
	test("repo regex plus the pipeline tag is matched", () => {
		const g = familyOf(
			{
				hf: {
					repoId: "someone/Qwen3-ASR-1.7B-GGUF",
					pipelineTag: "automatic-speech-recognition"
				}
			},
			lists
		)
		expect(g).toEqual({ task: "asr", family: "qwen3_asr", confidence: "matched" })
	})
	test("repo and a sibling file agree: matched", () => {
		const g = familyOf(
			{ hf: { repoId: "x/kitten-tts2-fork", siblings: ["kitten-tts2-q4.gguf"] } },
			lists
		)
		expect(g?.family).toBe("kitten_tts2")
		expect(g?.confidence).toBe("matched")
	})
	test("repo name alone is guessed", () => {
		const g = familyOf({ hf: { repoId: "someone/kokoro-remix" } }, lists)
		expect(g).toEqual({ task: "tts", family: "kokoro_tts", confidence: "guessed" })
	})
	test("a pipeline tag alone matches nothing", () => {
		expect(
			familyOf({ hf: { repoId: "a/b", pipelineTag: "text-to-speech" } }, lists)
		).toBeNull()
	})
	test("variant and vdes from the repo name", () => {
		const g = familyOf(
			{
				hf: {
					repoId: "x/Qwen3-TTS-12Hz-1.7B-VoiceDesign-fork",
					pipelineTag: "text-to-speech"
				}
			},
			lists
		)
		expect(g).toEqual({
			task: "vdes",
			family: "qwen3_tts",
			variant: "voicedesign",
			confidence: "matched"
		})
	})
	test("customvoice and base variants", () => {
		const cv = familyOf({ hf: { repoId: "x/qwen3-tts-custom-voice", pipelineTag: "text-to-speech" } }, lists)
		expect(cv?.variant).toBe("customvoice")
		const b = familyOf({ hf: { repoId: "x/Qwen3-TTS-0.6B-Base", pipelineTag: "text-to-speech" } }, lists)
		expect(b?.variant).toBe("base")
		expect(b?.task).toBe("tts")
	})
})

describe("familyOf - file", () => {
	test("the GGUF header family is matched, whatever the file is called", () => {
		const g = familyOf(
			{
				file: {
					path: "/m/weird-name.gguf",
					ggufArchitecture: "audiocpp",
					ggufFamily: "parakeet_tdt"
				}
			},
			lists
		)
		expect(g).toEqual({ task: "asr", family: "parakeet_tdt", confidence: "matched" })
	})
	test("architecture audiocpp alone names the runner, not a family", () => {
		expect(
			familyOf({ file: { path: "/m/unknown.gguf", ggufArchitecture: "audiocpp" } }, lists)
		).toBeNull()
	})
	test("file name alone is guessed", () => {
		const g = familyOf({ file: { path: "/m/my-kokoro-copy.gguf" } }, lists)
		expect(g).toEqual({ task: "tts", family: "kokoro_tts", confidence: "guessed" })
	})
	test("header family plus a VoiceDesign file name gives the variant", () => {
		const g = familyOf(
			{
				file: {
					path: "/m/mine-voicedesign.gguf",
					ggufFamily: "qwen3_tts"
				}
			},
			lists
		)
		expect(g).toEqual({
			task: "vdes",
			family: "qwen3_tts",
			variant: "voicedesign",
			confidence: "matched"
		})
	})
	test("nothing matches: null", () => {
		expect(familyOf({ file: { path: "/m/llama-3-8b.gguf", ggufArchitecture: "llama" } }, lists)).toBeNull()
	})
})
