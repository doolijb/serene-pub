/**
 * What a provider node's Connection slot STORES, now that a choice is a pair.
 *
 * ## Why the SHAPE moved, and what is left here
 *
 * The shape itself is `ConnectionSlotValue` in `@serene-pub/sdk`'s `config.ts`,
 * beside `SLOT_VALUE` — the constant that names the address it is stored at.
 * It had to: the fourth reader of this value is the **executor**, which lives in
 * the SDK and cannot import from this app, and it was reading a bare id. It
 * compared the whole stored object against a connection id, stringified it to
 * `[object Object]`, matched nothing, and fell back to the instance default —
 * so a connection picked in the panel silently ran against a different server,
 * and the model half never reached a request at all.
 *
 * What stays here is this app's ROW-ID POLICY, which is not the SDK's business:
 * a Serene Pub connection id is a **number**, while the SDK keeps ids exactly as
 * the host stored them because its own `ConnectionRecord.id` is a string. That
 * is a boundary to translate at, not a difference to merge (NOMENCLATURE R5), so
 * these two readers are one-line narrowings over the shared ones and keep their
 * names, their signatures and their callers.
 *
 * ## The shape, and why it is BACKWARD COMPATIBLE by construction
 *
 * Every value ever written before 0114 is one of `12`, `"12"`, `{ref: 12}`,
 * `{id: 12}`, and all four still mean "connection 12, no model named". A pair
 * that names a model is `{ref: 12, modelId: 3}` — the same object form the
 * readers already accepted, with one more key. So no stored config needs
 * migrating, no reader needs a version check, and a config authored by an older
 * build keeps resolving to exactly what it always did.
 *
 * ⚠ Naming no model is not naming a *default* model: an endpoint has none
 * (ruled 2026-09-15). A half-named pair is **incomplete**, and what happens to
 * it is each caller's own ruling — `resolveCapabilityTarget` refuses it,
 * `resolveStepConfigs` degrades to the endpoint alone because it has no channel
 * to refuse through.
 *
 * ⚠ `modelId` is dropped, not defaulted, when the connection is cleared.
 * `connectionSlotValue(null, 7)` is `null`: a model without its endpoint is not
 * a partial selection, it is an unresolvable one — see `CapabilityCandidate`.
 */

import {
	slotConnectionId as slotEndpointHalf,
	slotConnectionModelId as slotModelHalf,
	type ConnectionSlotValue
} from "@serene-pub/sdk"

/**
 * One half of a slot value as a Serene Pub row id.
 *
 * A numeric string counts, because `pipeline_config_values` is JSON a person
 * may have hand-edited and `"12"` has always been read as 12 at the top level.
 * It is read that way inside the object form too: a narrowing that demanded a
 * literal number there would make `{ref: "12"}` resolve to nothing while a
 * bare `"12"` resolved fine. One rule, not two.
 */
const rowId = (half: string | number | null): number | null => {
	if (typeof half === "number") return Number.isFinite(half) ? half : null
	if (typeof half === "string" && /^\d+$/.test(half)) return Number(half)
	return null
}

/** The connection id in a slot value, or null. Accepts every legacy spelling. */
export function slotConnectionId(value: unknown): number | null {
	return rowId(slotEndpointHalf(value))
}

/**
 * The model id in a slot value, or null when it names no model.
 *
 * Null for every legacy spelling, which is the whole compatibility story: a
 * config that predates the split names no model.
 *
 * ⚠ Also reads the model half off a **resolved** connection slot — the
 * executor's `{id, kind, metadata, modelId}` descriptor carries the same key by
 * the same name, deliberately. `connectionDescriptorModelId` in `host.ts` is the
 * reader for that side; this one is for the stored value.
 */
export function slotModelId(value: unknown): number | null {
	return rowId(slotModelHalf(value))
}

/**
 * Build the slot value for a pair — the ONE writer, used by every picker.
 *
 * A bare number when no model is named, so choosing a connection and nothing
 * else writes byte-for-byte what it wrote before 0114 and a diff of a config
 * stays readable. The object form appears only when it carries something.
 *
 * The return type is narrower than `ConnectionSlotValue` on purpose: that type
 * is what every reader must ACCEPT, and this is the one spelling anything in
 * this app should ever WRITE.
 */
export function connectionSlotValue(
	connectionId: number | null | undefined,
	modelId?: number | null
):
	| Extract<ConnectionSlotValue, number>
	| { ref: number; modelId: number }
	| null {
	if (connectionId == null) return null
	return modelId == null ? connectionId : { ref: connectionId, modelId }
}
