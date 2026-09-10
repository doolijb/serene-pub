/**
 * Mobile side panels — the ruled (2026-08-30, P6) narrow-screen presentation of
 * a session's side zones.
 *
 * Below the app's 1024px breakpoint the side zones take NO layout space: the
 * centre gets the full width, and a populated side is reachable only as an
 * overlay slid in from that edge. The button that opens it lives in the app
 * header, one row under the nav bar; the overlay itself is rendered by
 * SessionLayout. Those are two different subtrees under <main> — Header is a
 * sibling of the routed page, not a descendant of it — so nothing the session
 * page could `setContext` would ever reach the header. A module-level singleton
 * is the bridge, exactly as navHover.svelte.ts already bridges the same two
 * components for the "Layout" pull-tab.
 *
 * SessionLayout is the ONLY writer of `narrow` / `left` / `right`: it owns the
 * one matchMedia for the 1024 threshold (its `isDesktop`), so there is no second
 * breakpoint source to drift. The header only reads those and calls `toggle`.
 */

export type MobileSide = "left" | "right"

export interface MobileSidesSnapshot {
	/** Below the app's 1024px breakpoint. */
	narrow: boolean
	/** How many widgets the left / right side zones would actually render. */
	left: number
	right: number
	/** Which side's overlay is showing. */
	open: MobileSide | null
}

/**
 * One overlay at a time: tapping the side that is already open closes it,
 * tapping the other side swaps to it.
 */
export function nextOpen(
	current: MobileSide | null,
	tapped: MobileSide
): MobileSide | null {
	return current === tapped ? null : tapped
}

/**
 * The side that may legitimately be open right now. Everything that can make an
 * open overlay invalid — crossing back above the breakpoint (a rotate or a
 * window resize), or the open side losing its last widget — collapses to null
 * here, so no combination leaves a stuck overlay hanging over the session.
 */
export function resolveOpen(s: MobileSidesSnapshot): MobileSide | null {
	if (!s.narrow || !s.open) return null
	return (s.open === "left" ? s.left : s.right) > 0 ? s.open : null
}

/** Does the header show the L/R group at all? Nothing populated, no buttons. */
export function showsToggles(
	s: Pick<MobileSidesSnapshot, "narrow" | "left" | "right">
): boolean {
	return s.narrow && (s.left > 0 || s.right > 0)
}

class MobileSidePanels {
	narrow = $state(false)
	left = $state(0)
	right = $state(0)
	open = $state<MobileSide | null>(null)

	/**
	 * The control the overlay was opened from; focus returns here on close.
	 * Deliberately not reactive — nothing renders from it, and it holds a DOM
	 * node that has no business in a reactive graph.
	 */
	#opener: HTMLElement | null = null

	/** A header button was tapped. `opener` is that button, for focus return. */
	toggle(side: MobileSide, opener?: HTMLElement | null) {
		const next = nextOpen(this.open, side)
		if (next) {
			this.#opener =
				opener ??
				(globalThis.document?.activeElement as HTMLElement | null) ??
				null
			this.open = next
		} else {
			this.open = null
			this.restoreFocus()
		}
	}

	/** Esc, the backdrop, or the overlay's own close button. */
	close() {
		if (!this.open) return
		this.open = null
		this.restoreFocus()
	}

	/**
	 * SessionLayout publishes the breakpoint and how many widgets each side
	 * holds. Reconciling here closes an overlay that has become invalid, and
	 * deliberately does NOT move focus: a resize or a widget being deactivated
	 * is not the user asking to go back to a button.
	 */
	setSides(narrow: boolean, left: number, right: number) {
		this.narrow = narrow
		this.left = left
		this.right = right
		const next = resolveOpen(this)
		if (next !== this.open) {
			this.open = next
			this.#opener = null
		}
	}

	restoreFocus() {
		const el = this.#opener
		this.#opener = null
		// A remount (or crossing the breakpoint) can retire the opener; focusing
		// a detached node silently drops focus to <body>.
		if (el?.isConnected) el.focus()
	}
}

export const mobileSidePanels = new MobileSidePanels()
