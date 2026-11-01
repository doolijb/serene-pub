/**
 * 🚧 The boundary between the catalogues' vocabulary (`kokoro`, `qwen3-tts`,
 * `kitten-tts-2`) and the audio family ids (`kokoro_tts`, `qwen3_tts`,
 * `kitten_tts2`). Two vocabularies, reconciled here and nowhere else (R5).
 * Client-safe: pure data lookup (★A11).
 */

import { AUDIO_FAMILIES_SNAPSHOT, matchAudioFamily } from "$lib/shared/audio/audioFamilies"

/** Catalogue `family` -> audio family id. */
export const CATALOGUE_AUDIO_FAMILY = {
	kokoro: "kokoro_tts",
	"qwen3-tts": "qwen3_tts",
	"kitten-tts-2": "kitten_tts2"
} as const

/**
 * The audio family a model id, file name/path, repo id or display name belongs
 * to, or null. The string is offered as both repo and file: two independent
 * signals make the match STRONG, and the caller cannot say which it holds.
 */
export function audioFamilyOfName(modelIdOrFile: string): string | null {
	if (typeof modelIdOrFile !== "string" || !modelIdOrFile) return null
	return (
		matchAudioFamily(AUDIO_FAMILIES_SNAPSHOT, {
			repoId: modelIdOrFile,
			files: [modelIdOrFile]
		})?.family.family ?? null
	)
}
