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
		id: "Xenova/all-mpnet-base-v2",
		name: "all-mpnet-base-v2",
		tier: "balanced",
		description:
			"Strong semantic understanding of longer prose and character descriptions. Noticeably better at connecting thematically related content. Good default for most setups.",
		dimensions: 768,
		sizeLabel: "~420 MB"
	},
	{
		id: "Xenova/bge-large-en-v1.5",
		name: "bge-large-en-v1.5",
		tier: "best",
		description:
			"Top-tier retrieval quality. Best at understanding nuanced narrative context, character relationships, and thematic similarity across long-form text. Recommended if you have the hardware.",
		dimensions: 1024,
		sizeLabel: "~1.2 GB"
	}
]

export function findModel(id: string): EmbeddingModelDef | undefined {
	return EMBEDDING_MODELS.find((m) => m.id === id)
}
