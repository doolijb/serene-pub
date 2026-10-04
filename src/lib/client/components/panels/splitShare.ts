/**
 * The arithmetic behind a resizable split: how much of the room the FIRST
 * pane (the list) holds, as a share between 0 and 1.
 *
 * A share and not a pixel width: the same view is a 900px dock one minute and
 * a 3000px Focus the next, and a list dragged to 400px in the dock would be a
 * sliver there. The pixel floors are the grid's (`minmax`), so a share can
 * never squeeze either pane below what it needs.
 *
 * Kept pure so the clamp, the keyboard steps and the storage fallback are
 * testable without a browser.
 */

/** The least and most of the room the list may hold. */
export const SPLIT_SHARE_MIN = 0.2
export const SPLIT_SHARE_MAX = 0.8

/** What an arrow key moves the divider by; Shift moves five times as far. */
export const SPLIT_STEP = 0.02
export const SPLIT_STEP_LARGE = 0.1

export function clampShare(share: number): number {
	if (!Number.isFinite(share)) return 0.5
	return Math.min(SPLIT_SHARE_MAX, Math.max(SPLIT_SHARE_MIN, share))
}

/**
 * The share after one key on the divider, or null when the key is not one
 * the divider answers (so the caller lets it through).
 *
 * The divider sits between two columns, so Left/Right move it; Up/Down do the
 * same, as the WAI-ARIA window splitter pattern allows. Home and End go to
 * the ends.
 */
export function shareAfterKey(
	share: number,
	key: string,
	large = false
): number | null {
	const step = large ? SPLIT_STEP_LARGE : SPLIT_STEP
	switch (key) {
		case "ArrowLeft":
		case "ArrowUp":
			return clampShare(share - step)
		case "ArrowRight":
		case "ArrowDown":
			return clampShare(share + step)
		case "Home":
			return SPLIT_SHARE_MIN
		case "End":
			return SPLIT_SHARE_MAX
		default:
			return null
	}
}

/**
 * The share a pointer at `x` asks for, over a split whose box starts at
 * `left` and is `width` wide with a divider `gutter` px across.
 */
export function shareFromPointer(
	x: number,
	left: number,
	width: number,
	gutter = 0
): number {
	const room = width - gutter
	if (room <= 0) return 0.5
	return clampShare((x - left - gutter / 2) / room)
}

/**
 * The remembered share, or `fallback`. Storage can be missing or refuse
 * (private windows, blocked site data), so every read is guarded and a bad
 * value is no value.
 */
export function loadShare(key: string, fallback: number): number {
	try {
		const raw = globalThis.localStorage?.getItem(key)
		if (raw == null) return fallback
		const value = Number(raw)
		return Number.isFinite(value) ? clampShare(value) : fallback
	} catch {
		return fallback
	}
}

/** Remembers a share on this device; null forgets it. Never throws. */
export function saveShare(key: string, share: number | null): void {
	try {
		if (share === null) globalThis.localStorage?.removeItem(key)
		else globalThis.localStorage?.setItem(key, String(clampShare(share)))
	} catch {
		// Storage refused: the split still works, it just won't be remembered.
	}
}
