import type { ImageAdapterExports } from "../imageAdapters/BaseImageAdapter"
import { ADAPTER_REGISTRY } from "../adapters/registry"

/**
 * The image-family module for a connection type — the twin of
 * `getConnectionAdapter`, over the same registry.
 *
 * Which types have an image module, and which pointedly do not, is documented at
 * the registry entries themselves rather than here: those absences are load-
 * bearing (KOBOLDCPP_MANAGED and OPENAI_CHAT each have one), and a comment about
 * an entry belongs beside the entry, where an edit to it cannot miss the reason.
 *
 * Reaching this error is now a bug upstream rather than a user mistake: the
 * manifest can only declare `text->image` for a type with an image module here,
 * so nothing should ever bind an image slot to a type this refuses. It stays a
 * throw because an out-of-tree adapter, or a row carrying a type from a newer
 * version, can still ask.
 */
export async function getImageAdapter(
	connectionType: string
): Promise<ImageAdapterExports> {
	const load = ADAPTER_REGISTRY[connectionType]?.image
	if (!load)
		throw new Error(
			`No image adapter for connection type "${connectionType}".`
		)
	return await load()
}
