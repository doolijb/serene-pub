import type { TranscriptionAdapterExports } from "../transcriptionAdapters/BaseTranscriptionAdapter"
import { ADAPTER_REGISTRY } from "../adapters/registry"

/**
 * 🚧 The transcription-family module for a connection type (O9) — the same
 * shape as `getEmbeddingAdapter`, over the same registry, so the conformance
 * test walks exactly what this loader walks.
 *
 * Null rather than a throw: the transcribe step asks this of whatever pair
 * the Transcription loadout resolves to, and a type that cannot hear is a
 * sentence on the receipt, not a failed reply.
 */
export async function getTranscriptionAdapter(
	connectionType: string
): Promise<TranscriptionAdapterExports | null> {
	const load = ADAPTER_REGISTRY[connectionType]?.transcription
	return load ? await load() : null
}
