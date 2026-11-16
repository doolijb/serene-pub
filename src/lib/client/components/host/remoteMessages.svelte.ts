/**
 * The log as a remote widget is handed it (`RemoteWidget`): each row
 * projected (`projectMessageRow`, less the host's bookkeeping) and deep-cloned,
 * once per change to that row rather than once per row per frame.
 *
 * A cell row (`sessionStore`) answers `sourceOf` with the latest plain object
 * it was patched from, a new object on every frame that touched the row, so
 * that object is the cache key: a row no frame touched is the same key and
 * costs nothing. A plain row (a pending reply, a fixture) is its own source and
 * may be changed in place, which an identity key could not see: it is projected
 * and cloned afresh each time, as it always was. The cache is a plain `WeakMap` that no reader tracks, so it is no state:
 * the reactive reads are the array's and each `sourceOf`'s one cell.
 */
import { projectMessageRow } from "@serene-pub/sdk"
import { sourceOf } from "$lib/client/sessions/store/sessionStore.svelte"

export function createRemoteMessages(): (
	rows: readonly unknown[]
) => unknown[] {
	const cache = new WeakMap<object, unknown>()
	return (rows) =>
		rows.map((row) => {
			// A non-object row has nothing to key on or clone; projected as it is.
			if (!row || typeof row !== "object") return projectMessageRow(row)
			const source = sourceOf(row)
			if (source === row) {
				return $state.snapshot(projectMessageRow(row))
			}
			if (cache.has(source)) return cache.get(source)
			const held = $state.snapshot(projectMessageRow(source))
			cache.set(source, held)
			return held
		})
}
