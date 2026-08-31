import type { ImageAdapterExports } from "../imageAdapters/BaseImageAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/**
 * Resolve an image-generation connection type to its adapter (the image-modality
 * twin of `getConnectionAdapter`). Dynamic imports for the same reason: an
 * adapter module is parsed only when a connection of that type is first used,
 * keeping unused backends out of the startup module graph.
 */
export async function getImageAdapter(
	connectionType: string
): Promise<ImageAdapterExports> {
	switch (connectionType) {
		case CONNECTION_TYPE.IMAGE_FOOOCUS:
			return (await import("../imageAdapters/FooocusAdapter")).default
		default:
			throw new Error(`Unsupported image connection type: ${connectionType}`)
	}
}
