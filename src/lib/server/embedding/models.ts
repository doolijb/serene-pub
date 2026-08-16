import type { DataType } from "@huggingface/transformers"

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

export function findModel(id: string): EmbeddingModelDef | undefined {
	return EMBEDDING_MODELS.find((m) => m.id === id)
}
