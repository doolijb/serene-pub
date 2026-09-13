/**
 * What a provider node's Connection slot STORES, now that a choice is a pair.
 *
 * ## Why this is shared, and why it is three functions rather than a convention
 *
 * The value in a `pipeline_node_overrides` row is written by a picker in the
 * browser and read by `host.ts`, `stepConfig.ts` and `dispatchImage` on the
 * server. Before 0114 it was a bare id, so "the convention" was small enough to
 * survive being spelled four times. A pair is not: the moment the writer says
 * `{ref, modelId}` and one reader looks for `{connection, model}`, the model is
 * silently dropped and the run uses the endpoint's default — a failure that
 * produces no error, no log line, and output that looks plausible because it
 * came from the right endpoint.
 *
 * ## The shape, and why it is BACKWARD COMPATIBLE by construction
 *
 * Every value ever written before 0114 is one of `12`, `"12"`, `{ref: 12}`,
 * `{id: 12}`, and all four still mean "connection 12, its default model". A pair
 * that names a model is `{ref: 12, modelId: 3}` — the same object form the
 * readers already accepted, with one more key. So no stored config needs
 * migrating, no reader needs a version check, and a config authored by an older
 * build keeps resolving to exactly what it always did.
 *
 * ⚠ `modelId` is dropped, not defaulted, when the connection is cleared.
 * `connectionSlotValue(null, 7)` is `null`: a model without its endpoint is not
 * a partial selection, it is an unresolvable one — see `CapabilityCandidate`.
 */

/** The connection id in a slot value, or null. Accepts every legacy spelling. */
export function slotConnectionId(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null
	if (typeof value === "string" && /^\d+$/.test(value)) return Number(value)
	if (value && typeof value === "object") {
		const inner = (value as any).ref ?? (value as any).id
		return typeof inner === "number" ? inner : null
	}
	return null
}

/**
 * The model id in a slot value, or null for "the connection's default model".
 *
 * Null for every legacy spelling, which is the whole compatibility story: a
 * config that predates the split names no model, and naming no model is what
 * "use the default" has meant since the 0114 backfill wrote one.
 */
export function slotModelId(value: unknown): number | null {
	if (!value || typeof value !== "object") return null
	const inner = (value as any).modelId
	return typeof inner === "number" && Number.isFinite(inner) ? inner : null
}

/**
 * Build the slot value for a pair — the ONE writer, used by every picker.
 *
 * A bare number when no model is named, so choosing a connection and nothing
 * else writes byte-for-byte what it wrote before 0114 and a diff of a config
 * stays readable. The object form appears only when it carries something.
 */
export function connectionSlotValue(
	connectionId: number | null | undefined,
	modelId?: number | null
): number | { ref: number; modelId: number } | null {
	if (connectionId == null) return null
	return modelId == null ? connectionId : { ref: connectionId, modelId }
}
