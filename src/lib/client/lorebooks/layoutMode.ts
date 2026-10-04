/**
 * Which layout the lorebook workspace draws, from the width of its own
 * container — never from the panel's fullscreen flag. Fullscreen is one way to
 * become wide; a wide dock is another, and both must land in the same place.
 *
 * The rule itself now lives in `$lib/client/shell/viewMode.svelte`, which every
 * view shares. This module is the lorebook workspace's name for it: the floor
 * is stated once for the whole app, so a second view cannot quietly pick a
 * different idea of "wide enough" and leave two panels in the same sidebar
 * disagreeing about it.
 */
import {
	DESK_MIN_PX,
	modeForWidth,
	type ViewMode
} from "$lib/client/shell/viewMode.svelte"

export { DESK_MIN_PX }

export type LoreLayoutMode = ViewMode

/**
 * An unmeasured container (0, the state every container is in for its first
 * frame) is compact: a compact layout in a wide container is merely roomy,
 * while a desk layout in a narrow one is broken.
 */
export function layoutModeFor(widthPx: number): LoreLayoutMode {
	return modeForWidth(widthPx)
}

/**
 * Where the desk's list-beside-editor share is remembered on this device —
 * ONE key for Entries, Time and Cast, so changing lens never moves the
 * divider (`ResizableSplit`).
 */
export const LORE_SPLIT_KEY = "serene-pub:loreSplit"
