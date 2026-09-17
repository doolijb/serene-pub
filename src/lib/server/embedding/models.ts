import type { DataType } from "@huggingface/transformers"
import { recommendedEmbeddingSnapshot } from "$lib/server/localModels/onnxList"

/**
 * Supported embedding models — three tiers covering speed, balance, and quality.
 * All are ONNX-compatible and run fully locally via @huggingface/transformers.
 */
export interface EmbeddingModelDef {
	/** HuggingFace model ID used for download/load */
	id: string
	/** Display name shown in the admin UI */
	name: string
	/** Short description for the admin UI */
	description: string
	/** Output embedding dimensions */
	dimensions: number
	/** Approximate model size on disk */
	sizeLabel: string
	/** Tier label for the admin UI */
	tier: "fast" | "balanced" | "best"
	/**
	 * ONNX weight precision to request (see @huggingface/transformers' DataType).
	 * Omitted = fp32, the runtime default on Node's "cpu" device. Balanced/Best
	 * use "q8" (int8-quantized weights) — their fp32 weights are ~1.2GB/~2.3GB,
	 * versus ~300MB/~568MB quantized, for negligible retrieval-quality loss.
	 */
	dtype?: DataType

	/* ── What the PUBLISHED list adds ────────────────────────────────────
	 * Every field below is optional so that one shape serves both the
	 * compiled fallback above and an entry fetched from the recommended list
	 * (`$lib/server/localModels/onnxList`). A built-in entry simply publishes
	 * fewer of them, and an absent key is the honest answer rather than a
	 * default nothing measured. They ride onto the wire as
	 * `LocalModelState.catalog`.
	 */

	/** Megabytes the list says the download is, for the dtype named above. */
	sizeMb?: number
	/** Tokens the checkpoint was trained to embed; longer input is truncated. */
	maxInputTokens?: number
	/**
	 * How token states become one vector.
	 *
	 * ⚠ Descriptive, not a setting: `embedding/index.ts` pools with the mean and
	 * cannot be switched per model without invalidating every stored vector. The
	 * list excludes `last_token` entries for exactly that reason — see
	 * `onnxList.ts`.
	 */
	pooling?: "mean" | "cls" | "last_token"
	/** Text the model expects prepended before embedding, where it wants any. */
	prefixes?: { query?: string; document?: string }
	/** The list's own filter vocabulary: `english`, `long-input`, … */
	tags?: string[]
	/** SPDX id, or the vendor's licence name. */
	license?: string
	/** `YYYY-MM` or `YYYY`. */
	released?: string
	/** Prose, e.g. "Over 100 languages". */
	languages?: string
	/** Prose, e.g. "308M". */
	parameterSize?: string
}

export const EMBEDDING_MODELS: EmbeddingModelDef[] = [
	{
		id: "Xenova/all-MiniLM-L6-v2",
		name: "all-MiniLM-L6-v2",
		tier: "fast",
		description:
			"Quick and lightweight. Works well for shorter lorebook entries and fact-style lore. Best choice if you have limited RAM or want to get started immediately.",
		dimensions: 384,
		sizeLabel: "~80 MB"
	},
	{
		id: "onnx-community/embeddinggemma-300m-ONNX",
		name: "EmbeddingGemma-300M",
		tier: "balanced",
		description:
			"Google's current-generation embedding model, built from Gemma 3. Multilingual, with strong semantic understanding of longer prose and character descriptions. Good default for most setups.",
		dimensions: 768,
		sizeLabel: "~300 MB",
		dtype: "q8"
	},
	{
		id: "onnx-community/bge-m3-ONNX",
		name: "bge-m3",
		tier: "best",
		description:
			"Top-tier, multilingual retrieval quality with an 8192-token context window — 16x the reach of the previous best-tier model, useful for long character and lorebook entries. Recommended if you have the hardware.",
		dimensions: 1024,
		sizeLabel: "~570 MB",
		dtype: "q8"
	}
]

/**
 * The definition for an id, from the recommended list first and the built-in
 * catalogue second.
 *
 * ⚠ Synchronous, and it stays synchronous: it is called from the LOAD path
 * (`loadEmbeddingModel`) to read a `dtype`, where a network fetch has no
 * business. `recommendedEmbeddingSnapshot()` is whatever the async list last
 * resolved to in this process — empty before anything warmed it, which is when
 * the built-in catalogue answers exactly as it did before the list existed.
 *
 * The list wins on a shared id because it is the richer entry: it publishes the
 * `dtype`, the pooling and the input window that the compiled catalogue never
 * carried.
 */
export function findModel(id: string): EmbeddingModelDef | undefined {
	return (
		recommendedEmbeddingSnapshot().find((m) => m.id === id) ??
		EMBEDDING_MODELS.find((m) => m.id === id)
	)
}

/**
 * Does the LOCAL MODEL REGISTRY know this id?
 *
 * The catalogue above is three curated models; `local_models` is whatever the
 * user actually downloaded, and its `modality` column is the one place that says
 * an `.onnx` file is an embedding model rather than a generator (`kind` cannot —
 * the GGUF header sniff files a BERT as `text`, which is why the two columns
 * exist separately).
 *
 * Its own function rather than folded into `findModel`, for two reasons.
 * `findModel` is synchronous and called from `EmbeddingModelDef`-shaped code
 * that wants a `dtype`; a registry row has no tier, no dimensions and no dtype,
 * so it cannot answer as one without inventing three fields. And this reads the
 * database, so the caller decides when to pay for it — `loadEmbeddingModel`
 * consults it only when the catalogue misses.
 *
 * Answers false rather than throwing when the database is unreachable: the
 * caller's next step is a refusal naming the model, which is a better sentence
 * than a database error in a path about loading a model.
 */
export async function isRegisteredLocalEmbeddingModel(
	id: string
): Promise<boolean> {
	if (!id) return false
	try {
		const { db } = await import("$lib/server/db")
		const schema = await import("$lib/server/db/schema")
		const { and, eq, or } = await import("drizzle-orm")
		const [row] = await db
			.select({ id: schema.localModels.id })
			.from(schema.localModels)
			.where(
				and(
					eq(schema.localModels.modality, "embeddings"),
					or(
						eq(schema.localModels.modelName, id),
						eq(schema.localModels.filename, id)
					)
				)
			)
			.limit(1)
		return !!row
	} catch {
		return false
	}
}
