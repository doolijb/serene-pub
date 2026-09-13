/**
 * Which layout the lorebook workspace draws, from the width of its own
 * container — never from the panel's fullscreen flag. Fullscreen is one way to
 * become wide; a wide dock is another, and both must land in the same place.
 */

/**
 * The width at which three columns beside each other are each still usable.
 * A stated choice: ~220px of navigation, a list that can hold a title and its
 * keyword chips on one line, and an editor column wide enough to type in.
 */
export const DESK_MIN_PX = 900

export type LoreLayoutMode = "desk" | "compact"

/**
 * An unmeasured container (0, the state every container is in for its first
 * frame) is compact: a compact layout in a wide container is merely roomy,
 * while a desk layout in a narrow one is broken.
 */
export function layoutModeFor(widthPx: number): LoreLayoutMode {
	return widthPx >= DESK_MIN_PX ? "desk" : "compact"
}
