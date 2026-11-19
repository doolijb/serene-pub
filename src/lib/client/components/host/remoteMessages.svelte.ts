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

/** The story-clock stamp a row was written with (`storyClock*`). */
const STORY_STAMP_KEYS = [
	"storyClockYear",
	"storyClockMonth",
	"storyClockDay",
	"storyClockHour",
	"storyClockMinute"
] as const

/**
 * The row without its story-clock stamp: with no timeline a line reads real
 * time, and nothing is deleted (the stored stamp is untouched and returns when
 * a timeline is kept again).
 */
export function withoutStoryStamp(row: unknown): unknown {
	if (!row || typeof row !== "object") return row
	const r = row as Record<string, unknown>
	if (!STORY_STAMP_KEYS.some((k) => r[k] != null)) return row
	const out = { ...r }
	for (const k of STORY_STAMP_KEYS) if (k in out) out[k] = null
	return out
}

/**
 * `storyDates: false` (the session's book keeps no timeline) hands the rows
 * over without their story-clock stamp. The cache holds one flag's rows, so a
 * flag that changes needs a new instance.
 */
export function createRemoteMessages(opts: { storyDates?: boolean } = {}): (
	rows: readonly unknown[]
) => unknown[] {
	const cache = new WeakMap<object, unknown>()
	const project = (row: unknown) =>
		opts.storyDates === false
			? withoutStoryStamp(projectMessageRow(row))
			: projectMessageRow(row)
	return (rows) =>
		rows.map((row) => {
			// A non-object row has nothing to key on or clone; projected as it is.
			if (!row || typeof row !== "object") return project(row)
			const source = sourceOf(row)
			if (source === row) {
				return $state.snapshot(project(row))
			}
			if (cache.has(source)) return cache.get(source)
			const held = $state.snapshot(project(source))
			cache.set(source, held)
			return held
		})
}
