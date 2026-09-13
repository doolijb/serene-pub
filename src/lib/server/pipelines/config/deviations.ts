/**
 * **A config stores deviations, not values** (ruled 2026-09-10).
 *
 * One rule, stated once, because every place that decides it independently is a
 * place the panel and the run can end up disagreeing about what a person
 * changed. Four callers ask it — `ensureDefaultConfig` and `reconcileConfigs`
 * when they seed, `writeOption` when somebody saves, and `read.ts` when the
 * panel marks a field as changed — and the answer has to be the same one.
 *
 * ## What follows from it
 *
 * A `pipeline_config_values` row exists **only** where the value departs from
 * what the published declaration says. That makes three things true that the
 * old materialize-everything model could not:
 *
 *  - **Provenance is implicit.** The row's existence is the record that
 *    somebody chose the value. There is no provenance column and there is now
 *    nothing for one to say.
 *  - **A moved default is safe.** A config with no row inherits whatever the
 *    current declaration says, which is what makes correcting a shipped number
 *    a code change rather than a hand-written sweep of every install's rows —
 *    `drizzle/0102`, `0110` and `0111` each ended with one of those.
 *  - **"Back to defaults" is a delete.** `clearOption` has deleted since F20;
 *    what kept re-materializing what it deleted was the seeding half.
 *
 * ## The one case that keeps its row
 *
 * A **reference** slot — `prompts`, `template`, `variables`, `connection`,
 * `sampling`, `scripts` — declares no author default at all: `declsForSlot`
 * emits `authorDefault` for `parameters`, for a `wire` slot's format, and for
 * the two synthesized `settings` controls, and for nothing else. So a ref row
 * has nothing to be equal to and nothing to fall back to if it went, and
 * `isDeviation` answers `true` for every one of them. That is not an exemption
 * bolted on: it is the same rule reading a declaration that offers no default.
 */

import type { Decl } from "$lib/server/pipelines/config/panel/types"

/**
 * Structural equality over values that came out of, or are going into, a `json`
 * column.
 *
 * Not `===`, because a `share` control's value is an object and a `string[]`
 * parameter's is an array — comparing those by identity would report every one
 * of them as a deviation and defeat the whole rule for exactly the controls
 * with the most rows. Not `JSON.stringify` either: two objects that differ only
 * in key order are the same stored value, and a key-order difference is
 * precisely what a round-trip through Postgres `json` can introduce.
 *
 * `undefined` is deliberately not equal to anything, including itself, at the
 * top level — see `isDeviation`, which handles "the declaration offers no
 * default" as its own case rather than letting it fall through to a comparison.
 */
export function sameConfiguredValue(a: unknown, b: unknown): boolean {
	if (a === b) return true
	// NaN never equals itself and neither does a null-vs-undefined pair; both
	// are answered by the identity check above or by falling through to false.
	if (a === null || b === null) return false
	if (typeof a !== "object" || typeof b !== "object") return false

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false
		// Order matters here and only here: a scripts chain and a stop-sequence
		// list are ordered values, and treating [a, b] as [b, a] would call a
		// reorder "no change" and refuse to store it.
		return (
			a.length === b.length &&
			a.every((v, i) => sameConfiguredValue(v, b[i]))
		)
	}

	const ka = Object.keys(a as object)
	const kb = Object.keys(b as object)
	if (ka.length !== kb.length) return false
	return ka.every(
		(k) =>
			Object.prototype.hasOwnProperty.call(b, k) &&
			sameConfiguredValue(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k]
			)
	)
}

/**
 * Is this value worth a row?
 *
 * `true` means store it. Two ways to get there, and the second is the one worth
 * saying out loud: a declaration with **no** author default has nothing to
 * inherit, so its value only exists while a row holds it — deleting one would
 * empty a prompt or template pick rather than resetting it.
 */
export function isDeviation(
	decl: Pick<Decl, "authorDefault">,
	value: unknown
): boolean {
	if (decl.authorDefault === undefined) return true
	return !sameConfiguredValue(value, decl.authorDefault)
}
