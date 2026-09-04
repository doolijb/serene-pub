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
import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import {
	capabilityLabel,
	isTransformId,
	satisfies,
	type CapabilityId,
	type CapabilitySet,
	type Grade
} from "@serene-pub/sdk"

/**
 * The effective set the row carries, INTERSECTED with what its adapter can still
 * express.
 *
 * `capabilities.resolved` is a cache of the four resolution layers (schema.ts),
 * and reading the cache is what keeps this off the adapter modules — they are
 * lazily imported because one of them cannot be loaded on Android at all.
 *
 * ## Why the intersection, rather than reading the cache straight
 *
 * A cache outlives the thing it caches. Dropping a key from the manifest stops
 * resolution from GRANTING it, but does nothing about what was already granted
 * and written to a row: an OpenAI connection that resolved
 * `text->image: "native"` under the old declaration keeps clearing this guard
 * until something happens to re-resolve it, and then fails minutes later with
 * `No image adapter for connection type` out of a loader. Intersecting on READ
 * makes the manifest authoritative at the point of use, which is exactly what
 * its header already claims for it ("a gate, not a default"). No migration, no
 * revision stamp, no boot sweep — and it stays correct for every future key that
 * is ever withdrawn, which a one-time fix would not.
 *
 * ⚠ The `declared` guard is not optional, and skipping it is a live regression
 * rather than a theoretical one. `resolveConnectionCapabilities` returns `{}`
 * for a type no manifest entry declares, and `openai-embeddings` and
 * `local-onnx` are exactly that: 0175 backfilled `text->embedding` for those
 * rows from the old modality column, and no entry describes their
 * types. Intersecting an undeclared type down to `{}` would make the emptiness
 * test below read "not determined yet" and fall through to `modalityAllows`,
 * quietly making an embeddings connection acceptable for chat. `persistCapabilities`
 * guards the same hazard with the same `declares` test; the comment there
 * explains the other half of it.
 */
export function storedCapabilities(connection: {
	type: string
	capabilities?: unknown
}): CapabilitySet {
	const resolved = (connection?.capabilities as { resolved?: unknown })
		?.resolved
	const cached =
		resolved && typeof resolved === "object"
			? (resolved as CapabilitySet)
			: {}

	const declared = adapterCapabilities(connection?.type)
	if (!declared) return cached

	// Only TRANSFORM ids are stripped.
	//
	// `resolveCapabilities` ends in `closure()`, which deliberately GROWS keys
	// that are not in `supports` — native `grammar` yields `json_schema:
	// emulated`, `strict_schema` implies `json_object`. Intersecting on
	// `supports` alone would delete those on every read, so a connection that
	// genuinely does structured output would be refused for it, and the cause
	// would look like the closure table rather than this line.
	//
	// A transform is different: it is either in the API's key space or it is not,
	// and nothing derives one from another (transforms appear in neither IMPLIES
	// nor EMULATABLE_VIA). So a cached transform the manifest no longer declares
	// is stale and must go.
	const out: CapabilitySet = {}
	for (const [id, grade] of Object.entries(cached)) {
		const key = id as CapabilityId
		if (isTransformId(key) && declared.supports[key] === undefined) continue
		out[key] = grade as Grade
	}
	return out
}

/**
 * What the old modality column would have said, for a row whose capabilities
 * nobody has determined yet.
 *
 * ⚠ **This JUDGES a connection somebody chose. It must never SELECT one.**
 *
 * The distinction is the whole of the no-implicit-pickup ruling and this
 * function is the most promotable thing in the codebase against it: it is a
 * cheap predicate over a type string that answers "would this do?" for any row
 * you hand it, so a `connections.find(c => modalityAllows(c.type, cap))` reads
 * like an obvious convenience and would quietly restore the behaviour eleven
 * separate call sites were deleted to remove — a connection running because it
 * exists and happens to fit. Which connection runs is decided in
 * `connections/capabilityTarget.ts`, from what somebody actually set, and
 * nowhere else.
 *
 * It also cannot bear that weight even if it were allowed to: it is transitional
 * (see `capabilityRefusal` below) and permissive by design, so on an
 * undetermined row it answers yes to every non-image capability, `text->audio`
 * and `text->embedding` included.
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
	// An explicit override is an ANSWER, and outranks the emptiness fallback.
	//
	// Emptiness means "nobody has determined this yet" only when nobody has
	// spoken. On a connection type whose adapter declares ONE capability — an
	// image-only type is exactly that — switching that capability off resolves to
	// `{}`, which is indistinguishable from undetermined by count alone. The
	// fallback then answered from the modality column and the Off switch did
	// nothing, which is the same shape of bug `persistCapabilities` already
	// guards against on the WRITE path with its `declares` check. This is the
	// read half of it.
	const override = ((
		connection?.capabilities as { overrides?: Record<string, unknown> }
	)?.overrides ?? {})[capability]
	// Grade 0 is an off as much as `false` is. Nothing writes one today — the
	// setCapability handler refuses anything but a band name or `false` — but the
	// stored half is a loose JSON column that predates that gate, and reading a
	// zero as "on" is the one direction that fails open.
	const ok =
		override !== undefined
			? override !== false && override !== 0
			: Object.keys(have).length
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
