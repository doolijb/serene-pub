/**
 * 🚧 Qwen3-TTS catalogue (Apache-2.0, 10 languages, 24 kHz).
 *
 * The nine packaged CustomVoice speakers (Qwen model card; audio.cpp
 * model_specs/qwen3_tts.json). Wire spelling: KoboldCPP's koboldcpp.py
 * lower-cases the requested voice and matches `aiden serena ono_anna ryan
 * sohee eric dylan vivian uncle_fu`, so `id` is the lowercase form (verified in
 * koboldcpp.py `q3tts_voicemap`); audio.cpp takes the preset name as configured
 * (`Aiden`, `Uncle_Fu`...). `name` keeps the display spelling. A profile that
 * needs the cased form can map `name`.
 *
 * Variants: CustomVoice = presets + prose instruction; VoiceDesign = no voices,
 * the instruction IS the voice; Base = clone-only (we never clone) so no voices
 * and a notice. Unknown variant is treated as CustomVoice.
 */

import type { SpeechFacts, SpeechVoice } from "$lib/shared/connectionAdapters/speechFacts"
import { CATALOGUE_AUDIO_FAMILY, audioFamilyOfName } from "./audioFamily"
import type { SpeechCatalogue } from "./types"

export const QWEN3_LANGUAGES = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"] as const

const PRESETS: readonly [name: string, language: string, gender: string][] = [
	["Vivian", "zh", "female"],
	["Serena", "zh", "female"],
	["Uncle_Fu", "zh", "male"],
	["Dylan", "zh", "male"],
	["Eric", "zh", "male"],
	["Ryan", "en", "male"],
	["Aiden", "en", "male"],
	["Ono_Anna", "ja", "female"],
	["Sohee", "ko", "female"]
]

export const QWEN3_PRESET_VOICES: readonly SpeechVoice[] = PRESETS.map(
	([name, language, gender]) => ({
		id: name.toLowerCase(),
		name: name.replace("_", " "),
		language,
		labels: { gender },
		kind: "preset" as const
	})
)

export type Qwen3Variant = "customvoice" | "voicedesign" | "base"

export function qwen3Variant(id: string): Qwen3Variant {
	const s = (id ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
	if (s.includes("voicedesign")) return "voicedesign"
	if (/(^|[^a-z])base/i.test(id ?? "") || s.includes("base")) return "base"
	return "customvoice"
}

export const qwen3Catalogue: SpeechCatalogue = {
	family: "qwen3-tts",
	label: "Qwen3-TTS",
	// The codec file (`qwen3-tts-tokenizer-*.gguf`) is not a speech model.
	matches: (id) =>
		audioFamilyOfName(id) === CATALOGUE_AUDIO_FAMILY["qwen3-tts"] && !/tokenizer/i.test(id),
	factsFor(id): SpeechFacts {
		const variant = qwen3Variant(id)
		const base: SpeechFacts = {
			voices: [],
			voicesFrom: "catalogue",
			controls: { language: QWEN3_LANGUAGES },
			streams: true,
			formats: ["wav"],
			sampleRate: 24000
		}
		if (variant === "voicedesign") {
			base.controls = { ...base.controls, instruction: "prose", designsVoice: true }
			base.notice = "Voice Design: describe the voice in the instruction; there are no preset voices. The same description keeps the same voice; set a Seed on the voicebank entry to pick a different one."
		} else if (variant === "base") {
			base.notice = "This is the Base model: it speaks only by cloning a reference recording, which Serene Pub does not do. Use a CustomVoice or Voice Design model."
		} else {
			base.voices = QWEN3_PRESET_VOICES.map((v) => ({ ...v }))
			base.controls = { instruction: "prose", language: QWEN3_LANGUAGES, speed: { min: 0.5, max: 2 } }
		}
		return base
	}
}
