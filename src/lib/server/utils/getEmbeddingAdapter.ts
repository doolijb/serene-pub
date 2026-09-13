import type { EmbeddingAdapterExports } from "../embeddingAdapters/BaseEmbeddingAdapter"
import { ADAPTER_REGISTRY } from "../adapters/registry"

/**
 * The embedding-family module for a connection type — the third of the same
 * shape as `getConnectionAdapter` and `getImageAdapter`, over the same registry.
 *
 * The registry is the one map all three read, which is what lets the conformance
 * test walk exactly what the loaders walk. A `switch` here would be a fourth
 * spelling of the mapping and the first to be able to disagree with the
 * manifest.
 *
 * Reaching this error is a bug upstream rather than a user mistake: the manifest
 * can only declare `text->embedding` for a type with an embedding module here
 * (CI-enforced), so nothing should bind an embedding star to a type this
 * refuses. It stays a throw because a row carrying a type from a newer build, or
 * an out-of-tree adapter, can still ask.
 */
export async function getEmbeddingAdapter(
	connectionType: string
): Promise<EmbeddingAdapterExports> {
	const load = ADAPTER_REGISTRY[connectionType]?.embedding
	if (!load)
		throw new Error(
			`No embedding adapter for connection type "${connectionType}".`
		)
	return await load()
}
