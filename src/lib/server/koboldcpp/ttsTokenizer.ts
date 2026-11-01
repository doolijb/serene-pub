/**
 * 🚧 Which codec ("wav tokenizer") file a managed speech model launches with.
 *
 * Qwen3-TTS (`--ttswavtokenizer qwen3-tts-tokenizer-*.gguf`) and OuteTTS
 * (`WavTokenizer-Large-75-Q4_0.gguf`) need one; Kokoro and the rest do not.
 * Managed model rows carry no per-model launch options, so the rule is a
 * convention over the models folder (real names in HF `koboldcpp/tts`):
 *
 *   - Qwen3-TTS: a sibling whose name matches /tokenizer/i and /qwen3.?tts/i;
 *     the one with the model's own quantisation (f16 / q8_0) wins, then q8_0,
 *     then the alphabetically first.
 *   - OuteTTS: a sibling matching /wavtokenizer/i, same preference.
 *   - Anything else: none.
 */

import { catalogueFor } from "$lib/shared/speech/catalogues"

/** True for a codec file, which is not a speech model and is never listed as one. */
export function isWavTokenizerFile(name: string): boolean {
	return /tokenizer/i.test(name) && /(qwen3.?tts|wavtokenizer)/i.test(name)
}

function quantOf(name: string): string | null {
	return name.toLowerCase().match(/(f16|q8_0|q4_0|q5_0)/)?.[1] ?? null
}

/** What kind of codec the model needs: a matcher over sibling names, or null. */
export function wavTokenizerNeed(model: string): "qwen3" | "outetts" | null {
	if (catalogueFor(model)?.family === "qwen3-tts") return "qwen3"
	if (/outetts/i.test(model)) return "outetts"
	return null
}

/** The sibling filename to use, or null when none is in `siblings`. */
export function pickWavTokenizer(
	model: string,
	siblings: readonly string[]
): string | null {
	const need = wavTokenizerNeed(model)
	if (!need) return null
	const re = need === "qwen3" ? /qwen3.?tts/i : /wavtokenizer/i
	const found = siblings
		.filter((n) => /tokenizer/i.test(n) && re.test(n) && /\.gguf$/i.test(n))
		.sort((a, b) => a.localeCompare(b))
	if (!found.length) return null
	const q = quantOf(model)
	return (
		(q && found.find((n) => quantOf(n) === q)) ||
		found.find((n) => quantOf(n) === "q8_0") ||
		found[0]
	)
}
