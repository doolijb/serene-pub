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
 *    a code change rather than a hand-written sweep of every install's rows.
 *  - **"Back to defaults" is a delete.** `clearOption` has deleted since F20;
 *    what kept re-materializing what it deleted was the seeding half.
 *
 * ## The one case that keeps its row
 *
 * A **reference** slot — `prompts`, `template`, `variables`, `connection`,
 * `sampling`, `scripts` — declares no author default at all: `declsForSlot`
 * emits `authorDefault` for `parameters`, for a `wire` slot's format, and for
 * the substrate's `settings` slot (R-9: `enabled` from `optional`, `review`
 * from the definition's `reviewDefault`), and for nothing else. So a ref row
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
 * `undefined` equals nothing, not even itself, at the top level — see `isDeviation`, which handles "the declaration offers no
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

/**
 * Whether a config holds a row for `value`, given what it would otherwise
 * inherit at that address.
 *
 * `inherited` is the shipped config's value there — what the boot reconcile
 * back-fills into a config that has no row. A run never reads the shipped
 * config through a user's copy; it reads the declaration. So a row is needed
 * in two cases, and only these:
 *
 *  - the value departs from the declaration, which is what a run would read
 *    without it (`isDeviation`);
 *  - the value IS the declaration but the shipped config says something
 *    else. Without the row the next reconcile back-fills the shipped value
 *    over it, and "set back to the declared value" would quietly become
 *    "never set". The respond preset's post-history trigger (3000 shipped,
 *    0 declared) is the case this exists for.
 *
 * `undefined` means nothing is inherited beyond the declaration — the shipped
 * config itself, or an address the shipped config holds no row for — and the
 * answer is `isDeviation`'s alone.
 */
export function holdsRow(
	decl: Pick<Decl, "authorDefault">,
	value: unknown,
	inherited: unknown
): boolean {
	if (isDeviation(decl, value)) return true
	return inherited !== undefined && isDeviation(decl, inherited)
}

/** One value at one address: an author preset's, or a config row's. */
export interface AddressedValue {
	nodeKey: string
	slot: string
	/** `''` or absent for a whole-slot value. */
	path?: string | null
	value: unknown
}

/**
 * Which rows of a pipeline's **shipped Default** config stop holding when its
 * default author preset changes across a version (owner ruling 2026-10-11).
 *
 * A row is dropped when it still holds exactly what the OLD default preset set
 * at its address, and the NEW default preset does not set that same value
 * there: it either sets something else or nothing at all. Such a row is the
 * old preset speaking, not a decision anybody made, so it follows the new one.
 * Every other row is kept: one that differs from the old preset is somebody's
 * change, one at an address the old preset never set was never the preset's,
 * and one the new preset still sets to the same value is still right.
 *
 * `core:spec/chat-generate-image` 1.0.0 → 1.1.0 is the case it was written
 * for: 1.0.0's default preset set `render|settings|review` to `on`; 1.1.0
 * ships no default preset, so the shipped row is dropped and the step inherits
 * its declared `off`.
 *
 * Pure, over plain arrays: the caller reads the rows and acts on the answer.
 * Equality is `sameConfiguredValue`'s, so key order inside an object never
 * reads as a change. An address listed twice in one preset takes its last
 * value, the way a `Map` built from the same rows would.
 */
export function rowsToDropOnPresetChange<R extends AddressedValue>(
	oldPresetValues: readonly AddressedValue[],
	newPresetValues: readonly AddressedValue[],
	configRows: readonly R[]
): R[] {
	const key = (v: AddressedValue) =>
		`${v.nodeKey}\u0000${v.slot}\u0000${v.path ?? ""}`
	const before = new Map(oldPresetValues.map((v) => [key(v), v.value]))
	const after = new Map(newPresetValues.map((v) => [key(v), v.value]))
	return configRows.filter((row) => {
		const at = key(row)
		if (!before.has(at)) return false
		if (!sameConfiguredValue(row.value, before.get(at))) return false
		return !(after.has(at) && sameConfiguredValue(row.value, after.get(at)))
	})
}
