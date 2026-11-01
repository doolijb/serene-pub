/**
 * Whether a KoboldCPP model download must be refused because the file is a
 * speech or transcription model (or a speech codec file) filed under the text
 * or image tab. Pure: the caller hands in the audio lists.
 *
 * Only a REAL match refuses - a listed/matched family, the codec-file name, or
 * a KoboldCPP speech catalogue/OuteTTS file name. A `guessed` family (one weak
 * signal such as a repo that merely mentions "tts") never does, so a chat GGUF
 * is not turned away on a hunch.
 */

import { familyOf, type FamilyLists } from "$lib/server/audio/familyOf"
import { isWavTokenizerFile } from "./ttsTokenizer"
import { catalogueFor } from "$lib/shared/speech/catalogues"

export const SPEECH_REFUSAL = "That is a speech model; get it under Speech."
export const TRANSCRIPTION_REFUSAL =
	"That is a transcription model; get it under Transcription."
export const NOT_SPEECH_REFUSAL = "That is not a speech model."

/** The `kind` a download request may carry: the finder tabs plus speech. */
export type DownloadKindRequest = "text" | "image" | "speech"

export interface SpeechRefusalInput {
	filename: string
	downloadUrl?: string
	modelUrl?: string
	kind: DownloadKindRequest
}

/** owner/name from a huggingface.co URL (resolve/blob/tree or the bare repo page). */
export function repoIdFromUrl(url: string | undefined): string | null {
	if (!url) return null
	try {
		const parts = new URL(url).pathname.split("/").filter(Boolean)
		if (parts.length < 2) return null
		// api paths and the like are not repos
		if (["api", "models", "datasets", "spaces"].includes(parts[0])) return null
		return `${parts[0]}/${parts[1]}`
	} catch {
		return null
	}
}

type Verdict = "speech" | "transcription" | null

function detect(input: SpeechRefusalInput, lists: FamilyLists): Verdict {
	const { filename } = input
	if (isWavTokenizerFile(filename)) return "speech"
	if (catalogueFor(filename)) return "speech"
	if (/outetts/i.test(filename)) return "speech"

	const sure = (g: ReturnType<typeof familyOf>) =>
		g && (g.confidence === "listed" || g.confidence === "matched") ? g : null
	const guesses = [
		familyOf({ file: { path: filename } }, lists),
		...[repoIdFromUrl(input.downloadUrl), repoIdFromUrl(input.modelUrl)]
			.filter((r): r is string => !!r)
			.map((repoId) => familyOf({ hf: { repoId, siblings: [filename] } }, lists))
	]
	for (const g of guesses) {
		const s = sure(g)
		if (!s) continue
		return s.task === "asr" ? "transcription" : "speech"
	}
	return null
}

/**
 * The sentence to refuse with, or null to let the download go ahead.
 * `kind: "speech"` is the legitimate speech path: refused only when the file
 * is NOT seen as speech/codec.
 */
export function speechRefusal(
	input: SpeechRefusalInput,
	lists: FamilyLists
): string | null {
	const verdict = detect(input, lists)
	if (input.kind === "speech") {
		return verdict === "speech" ? null : verdict === "transcription"
			? TRANSCRIPTION_REFUSAL
			: NOT_SPEECH_REFUSAL
	}
	if (verdict === "speech") return SPEECH_REFUSAL
	if (verdict === "transcription") return TRANSCRIPTION_REFUSAL
	return null
}
