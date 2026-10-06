import type { DataType } from "@huggingface/transformers"
import { recommendedNerSnapshot } from "$lib/server/localModels/onnxList"

/**
 * The entity models this build ships in its picker.
 *
 * Two, not ten. A catalogue is the answer to "I have configured nothing and want
 * this to work", so it names one small English model and one multilingual one
 * and stops; anything else a person downloads reaches the picker through
 * `local_models` (modality `ner`), the same way the embedding catalogue works.
 *
 * ⚠ **Every id here was verified against the Hub** (`config.json` and
 * `onnx/model_quantized.onnx` both fetchable) on 2026-09-12, and the label sets
 * below were read out of those configs rather than assumed. A catalogue entry
 * that 404s is a download that fails minutes in with a transformers.js stack
 * trace, so an id nobody checked must be marked unverified in a comment rather
 * than quietly listed.
 *
 * ## Labels are the backend's, and are never translated here
 *
 * `PER`, `LOC`, `ORG`, `MISC`, `DATE` — whatever the model's `id2label` says,
 * carried through to the annotation row. Mapping them onto this app's own
 * `EntityRef` kinds would be a guess (`ORG` is as likely to be a lorebook entry
 * as a character), and the merge in `ranking/entities.ts` resolves a span
 * against the gazetteer by NAME instead, which is an answer rather than a guess.
 */
export interface NerModelDef {
	/** HuggingFace model ID used for download/load. */
	id: string
	/** Display name shown in the picker. */
	name: string
	/** Short description for the picker. */
	description: string
	/** Approximate download size, quantized weights. */
	sizeLabel: string
	/** The labels this checkpoint emits, from its own `id2label`. */
	labels: string[]
	/**
	 * ONNX weight precision to request (see @huggingface/transformers' DataType).
	 * `q8` for both: their fp32 weights are 3-4x the size for an entity decision
	 * that is a label per token rather than a vector anything is compared on.
	 */
	dtype?: DataType

	/* ── What the PUBLISHED list adds ────────────────────────────────────
	 * Optional so one shape serves both the compiled fallback above and an
	 * entry fetched from the recommended list
	 * (`$lib/server/localModels/onnxList`) — the same arrangement, field for
	 * field, as `EmbeddingModelDef`. They ride onto the wire as
	 * `LocalModelState.catalog`.
	 */

	/** Tier label for the picker, where the list publishes one. */
	tier?: "fast" | "balanced" | "best"
	/** Megabytes the list says the download is, for the dtype named above. */
	sizeMb?: number
	/** Tokens per pass; longer text is truncated by the pipeline. */
	maxInputTokens?: number
	/** The list's own filter vocabulary: `multilingual`, `cased`, … */
	tags?: string[]
	/** SPDX id, or the vendor's licence name. */
	license?: string
	/** `YYYY-MM` or `YYYY`. */
	released?: string
	/** Prose, e.g. "Ten high-resource languages". */
	languages?: string
	/** Prose, e.g. "108M". */
	parameterSize?: string
}

export const NER_MODELS: NerModelDef[] = [
	{
		id: "Xenova/bert-base-NER",
		name: "bert-base-NER",
		description:
			"English. The standard CoNLL-2003 model: people, places, organisations and a catch-all for everything else. The right first choice for an English game.",
		sizeLabel: "~109 MB",
		labels: ["PER", "LOC", "ORG", "MISC"],
		dtype: "q8"
	},
	{
		id: "Xenova/distilbert-base-multilingual-cased-ner-hrl",
		name: "distilbert-multilingual-NER",
		description:
			"Ten languages, distilled so it stays small. Pick this if your sessions are not in English, or not only in English.",
		sizeLabel: "~135 MB",
		labels: ["PER", "LOC", "ORG", "DATE"],
		dtype: "q8"
	}
]

/**
 * The definition for an id, from the recommended list first and the built-in
 * catalogue second. The mirror of `findModel`, and synchronous for the same
 * reason — see that function's note.
 */
export function findNerModel(id: string): NerModelDef | undefined {
	return (
		recommendedNerSnapshot().find((m) => m.id === id) ??
		NER_MODELS.find((m) => m.id === id)
	)
}
