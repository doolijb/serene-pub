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
		// One adapter, four backends — KoboldCPP, AUTOMATIC1111, Forge and
		// SD.Next all speak the same `/sdapi/v1` surface.
		//
		// Plain KOBOLDCPP is here because an external instance the user started
		// with `--sdmodel` genuinely is one process doing both, and this app
		// neither started it nor manages what it holds: its own type tag says
		// text, its probe says it can draw, and the probe is the honest
		// authority. Nothing here has to be started or loaded first.
		case CONNECTION_TYPE.A1111:
		case CONNECTION_TYPE.KOBOLDCPP:
			return (await import("../imageAdapters/A1111Adapter")).default
		// The MANAGED image type renders through that same A1111 wire — its
		// module re-exports the adapter class unchanged — but it is not the same
		// module, because two things around the render differ: its base URL
		// lives in the Manager's settings rather than on the row, and its model
		// is a file on disk the Manager loads on demand rather than a checkpoint
		// the server already holds. Testing and listing have to ask those
		// questions instead of `/sdapi/v1/sd-models`, which 404s whenever the
		// process is holding a text model — i.e. most of the time.
		//
		// KOBOLDCPP_MANAGED is deliberately absent: it names a text model and
		// cannot draw, whatever the process happens to be holding.
		case CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE:
			return (
				await import("../imageAdapters/KoboldCppManagedImageAdapter")
			).default
		default:
			throw new Error(
				`No image adapter for connection type "${connectionType}".`
			)
	}
}
