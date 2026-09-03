/**
 * Can the connection a dispatcher was handed do what the call needs?
 *
 * All three dispatchers asked this as a modality question — `isImage` on the
 * connection type for images, and nothing at all on the text side — and one
 * scalar cannot answer it. KoboldCPP writes replies and draws pictures from the
 * same process, so `isImage` calls it a text connection and an image node bound
 * to it is refused for being what it is not. What a connection can do is a set,
 * resolved once and stored on the row (0175); this reads that set.
 *
 * Shared by the three rather than written out three times, because the part
 * worth getting right is not the lookup — it is the undetermined case below, and
 * three copies of that would drift.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	capabilityLabel,
	satisfies,
	type CapabilityId,
	type CapabilitySet
} from "@serene-pub/sdk"

/**
 * The effective set the row carries.
 *
 * `capabilities.resolved` is a cache of the four resolution layers (schema.ts),
 * and reading the cache is what keeps this off the adapter modules — they are
 * lazily imported because one of them cannot be loaded on Android at all.
 */
export function storedCapabilities(connection: {
	capabilities?: unknown
}): CapabilitySet {
	const resolved = (connection?.capabilities as { resolved?: unknown })
		?.resolved
	return resolved && typeof resolved === "object"
		? (resolved as CapabilitySet)
		: {}
}

/**
 * What the old modality column would have said, for a row whose capabilities
 * nobody has determined yet.
 */
const modalityAllows = (type: string, capability: CapabilityId): boolean =>
	capability === "text->image"
		? CONNECTION_TYPE.isImage(type)
		: !CONNECTION_TYPE.isImage(type)

/**
 * The refusal sentence, or null when the connection can do it.
 *
 * A sentence rather than a throw because each dispatcher's failures carry its
 * own error class and callers key on those.
 */
export function capabilityRefusal(
	connection: { name?: string | null; type: string; capabilities?: unknown },
	capability: CapabilityId
): string | null {
	const have = storedCapabilities(connection)

	// Transitional, and keyed on "capabilities not yet determined" rather than on
	// modality: 0175 backfilled an empty set for every row it could not resolve —
	// an unknown type, or one nobody has ever tested. Refusing those outright
	// would break working setups on upgrade until every connection had been
	// re-tested, so a row with nothing determined is judged the way it was before
	// the column existed. It stops being empty the first time it is resolved.
	const ok = Object.keys(have).length
		? satisfies({ requires: [capability] }, have).ok
		: modalityAllows(connection.type, capability)
	if (ok) return null

	// The capability in the words the connection screen showed, never its id:
	// somebody who switched "Image generation" off has no way to connect
	// `text->image` back to the toggle they touched.
	return (
		`"${connection.name}" cannot do ${capabilityLabel(capability)}. ` +
		`Enable it on the connection, or choose one that can.`
	)
}
