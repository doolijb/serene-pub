import { untrack } from "svelte"

type Json = Record<string, unknown>

interface ExtraJsonSyncOptions<F> {
	/** The bound connection draft — read through a getter so a parent
	 *  replacing the whole object is seen. */
	connection: () => { extraJson?: unknown } | null | undefined
	/** The form's local field state (read tracked). */
	fields: () => F | undefined
	/** Rebuild the local field state from the row's `extraJson`. Called
	 *  untracked, whenever `extraJson` changes identity from outside. */
	seed: (extraJson: Json | null | undefined) => void
	/** Project the fields to the `extraJson` keys THIS form owns. Every field
	 *  value must be read here — that is what subscribes the write-back. */
	project: (fields: F) => object
	/** How the projection lands on the current `extraJson`. Defaults to a
	 *  shallow merge, so keys another form or the server owns (`profile`,
	 *  legacy keys) survive an edit here; a projected `undefined` removes
	 *  the key. */
	merge?: (current: Json, projected: Json) => Json
}

/**
 * Keeps a connection form's local field state and `connection.extraJson` in
 * step, in both directions, without ever dirtying the draft on its own.
 *
 * - **Seed**: on mount, and whenever `connection.extraJson` changes identity
 *   for a reason other than this form's own write (the parent replaced the
 *   draft after an external save, or Reset), the fields are rebuilt from it.
 * - **Write-back**: a field edit merges the projection over the current
 *   `extraJson` (never replaces it).
 * - The write-back run that follows a seed is skipped: defaults materialised
 *   into the fields are not an edit, and writing them back made the panel
 *   report unsaved changes the instant it opened.
 */
export function useExtraJsonSync<F>(opts: ExtraJsonSyncOptions<F>): {
	/** Rebuild the fields from the current row now (e.g. defaults arrived
	 *  late), without that counting as an edit. */
	reseed: () => void
} {
	const merge = opts.merge ?? mergeExtraJson
	let seededFrom: unknown = Symbol("unseeded")
	let skipNextWrite = false

	$effect(() => {
		const extraJson = opts.connection()?.extraJson
		if (extraJson === seededFrom) return
		seededFrom = extraJson
		skipNextWrite = true
		untrack(() => opts.seed((extraJson as Json | null | undefined) ?? null))
	})

	$effect(() => {
		const fields = opts.fields()
		if (!fields) return
		// Projected on EVERY run, before the skip check: an effect subscribes
		// only to what it reads, so returning first would never subscribe to
		// the field values. Skip the write, never the read.
		const projected = opts.project(fields) as Json
		if (skipNextWrite) {
			skipNextWrite = false
			return
		}
		untrack(() => {
			const connection = opts.connection()
			if (!connection) return
			const current = (connection.extraJson as Json | null | undefined) ?? {}
			connection.extraJson = merge({ ...current }, projected)
			// Read back: a $state parent stores (and returns) its own proxy.
			seededFrom = connection.extraJson
		})
	})

	return {
		reseed() {
			untrack(() => {
				skipNextWrite = true
				opts.seed(
					(opts.connection()?.extraJson as Json | null | undefined) ?? null
				)
			})
		}
	}
}

/**
 * Shallow-merges a form's projection over the stored `extraJson`: keys the
 * form doesn't own survive, and a key projected as `undefined` is removed
 * (an emptied optional field), so the server's default applies again.
 */
export function mergeExtraJson(current: Json, projected: Json): Json {
	const next: Json = { ...current, ...projected }
	for (const [key, value] of Object.entries(projected))
		if (value === undefined) delete next[key]
	return next
}
