/**
 * The one way a stored sampling config becomes something an adapter can use.
 *
 * A row is `{shape, values, enabled}` (0171). What an adapter wants is a flat
 * object of the parameters actually in play, with defaults already applied — so
 * that its key map can be a plain lookup and it never has to ask whether a value
 * is switched on. `resolveSamplingValues` in the SDK is that filter; this wraps it
 * for the one thing every caller here has in common, which is that the row is
 * usually optional.
 *
 * `sampling?.temperature` used to be how a consumer read a value. It cannot be
 * any more, and that is the point: reading a parameter off the row now gives
 * `undefined`, which is a compile error at most call sites and a visibly missing
 * parameter at the rest — where reading it off the row and ignoring `enabled`
 * silently sent a switched-off sampler for years.
 *
 * The row's own identity (`id`, `name`, `shape`) is deliberately NOT folded in.
 * Adapters spread this object into request payloads; a config's database id has
 * no business travelling to a backend, and a key called `name` sitting beside the
 * samplers is one collision away from being sent as one.
 */

import { resolveSamplingValues, type ResolvedSampling } from "@serene-pub/sdk"

export type { ResolvedSampling }

/**
 * Row → parameters. A missing row resolves to `{}`, which means "send nothing and
 * let the backend use its own defaults" — the same thing the seeded "Disabled"
 * config expresses, and the only safe reading of "no config was chosen".
 */
export function resolveSampling(
	row?: {
		shape?: string | null
		values?: Record<string, unknown> | null
		enabled?: string[] | null
	} | null
): ResolvedSampling {
	if (!row) return {}
	return resolveSamplingValues(row)
}
