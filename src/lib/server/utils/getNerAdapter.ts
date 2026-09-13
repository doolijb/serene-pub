import type { NerAdapterExports } from "../nerAdapters/BaseNerAdapter"
import { ADAPTER_REGISTRY } from "../adapters/registry"

/**
 * The NER-family module for a connection type — the fourth of the same shape as
 * `getConnectionAdapter`, `getImageAdapter` and `getEmbeddingAdapter`, over the
 * same registry.
 *
 * The registry is the one map all four read, which is what lets the conformance
 * test walk exactly what the loaders walk. A `switch` here would be a fifth
 * spelling of the mapping and the first to be able to disagree with the
 * manifest.
 *
 * Reaching this error is a bug upstream rather than a user mistake: the manifest
 * can only declare `text->entities` for a type with a NER module here
 * (CI-enforced), so nothing should bind an entity star to a type this refuses.
 * It stays a throw because a row carrying a type from a newer build, or an
 * out-of-tree adapter, can still ask.
 */
export async function getNerAdapter(
	connectionType: string
): Promise<NerAdapterExports> {
	const load = ADAPTER_REGISTRY[connectionType]?.ner
	if (!load)
		throw new Error(
			`No NER adapter for connection type "${connectionType}".`
		)
	return await load()
}
