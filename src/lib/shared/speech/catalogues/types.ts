/**
 * 🚧 A shipped speech catalogue: the voices, controls and notice of one speech
 * ENGINE (Kokoro, Qwen3-TTS, KittenTTS 2), for services that run the engine but
 * cannot list its embedded voices (KoboldCPP's `/v1/audio/voices` returns five
 * placeholder names; audio.cpp's lists configured presets only).
 *
 * The facts a catalogue yields always say `voicesFrom: "catalogue"`.
 */

import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"

export interface SpeechCatalogue {
	/** Stable engine id: `"kokoro"`, `"qwen3-tts"`, `"kitten-tts-2"`. */
	family: string
	/** What a person reads ("Kokoro 82M"). */
	label: string
	/**
	 * True when a model id, file name or audio.cpp family names this engine
	 * (`Kokoro_no_espeak_Q4.gguf`, `qwen3_tts_1_7b_customvoice_q8_0`,
	 * `kitten_tts2`). Case-insensitive; never throws.
	 */
	matches(modelIdOrFile: string): boolean
	/**
	 * The facts for one concrete model of this engine — a function because a
	 * variant can change them (Qwen3 Base takes no preset voice and no
	 * instruction; CustomVoice takes both; VoiceDesign takes instruction only).
	 */
	factsFor(modelIdOrFile: string): SpeechFacts
}
