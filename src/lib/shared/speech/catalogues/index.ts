/** 🚧 The shipped speech catalogues and the lookup from a model id or file name. */

import { kitten2Catalogue } from "./kitten2"
import { kokoroCatalogue } from "./kokoro"
import { qwen3Catalogue } from "./qwen3"
import type { SpeechCatalogue } from "./types"

export type { SpeechCatalogue } from "./types"
export { kokoroCatalogue, kokoroFacts, KOKORO_VOICE_IDS, KOKORO_KCPP_VOICE_IDS } from "./kokoro"
export { qwen3Catalogue, qwen3Variant, QWEN3_PRESET_VOICES, QWEN3_LANGUAGES } from "./qwen3"
export { kitten2Catalogue, KITTEN2_VOICES, KITTEN2_NOTICE, KITTEN2_EMOTION_TAGS } from "./kitten2"

export const SPEECH_CATALOGUES: readonly SpeechCatalogue[] = [
	kokoroCatalogue,
	qwen3Catalogue,
	kitten2Catalogue
]

export function catalogueFor(modelIdOrFile: string): SpeechCatalogue | null {
	if (typeof modelIdOrFile !== "string" || !modelIdOrFile) return null
	return SPEECH_CATALOGUES.find((c) => c.matches(modelIdOrFile)) ?? null
}

/**
 * The string a catalogue is looked up by: the model id when it names an
 * engine, else the model row's display name. A service that cannot say which
 * engine it holds (external KoboldCPP lists its speaker as `koboldcpp-speech`;
 * an audio.cpp id is whatever `server.json` called it) is identified by the
 * admin NAMING the row after its engine ("Kokoro", "Qwen3-TTS CustomVoice").
 */
export function speechEngineKey(model: string, name?: string | null): string {
	if (catalogueFor(model)) return model
	if (name && catalogueFor(name)) return name
	return model
}
