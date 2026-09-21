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
 * is the bridge, exactly as layoutEditor.svelte.ts already bridges the same
 * two components for the header's "Layout" button.
 *
 * SessionLayout is the ONLY writer of `narrow` / `left` / `right`: it owns the
 * one matchMedia for the 1024 threshold (its `isDesktop`), so there is no second
 * breakpoint source to drift. The header only reads those and calls `toggle`.
 */

export type MobileSide = "left" | "right"

/**
 * One entry in the panels menu (ruled 2026-09-10). The two per-side buttons
 * under the nav bar are gone: there is ONE menu button beside the navigation
 * menu's own, and it opens a sheet listing the session's side groups. A list of
 * what is there scales with more widgets in a way two edge buttons never did —
 * and it can say which side a group is on, and which are pinned, rather than
 * making you open both to find out.
 *
 * `icon` is a Lucide NAME, not a component: this module is the bridge between
 * two subtrees, and a component reference is a thing to draw with, not a thing
 * to publish. Whoever renders the sheet resolves it, exactly as `iconOf` does.
 */
export interface MobileGroup {
	side: MobileSide
	/** The render unit's key — a group id, or a lone widget's id. */
	key: string
	title: string
	icon: string
	pinned: boolean
}

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

/** Does the header show the panels button at all? Nothing populated, no button. */
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

	/** The side groups, published by SessionLayout for the panels menu. */
	groups = $state<MobileGroup[]>([])
	/** The panels menu — the sheet listing those groups — is showing. */
	menuOpen = $state(false)
	/**
	 * The group the menu just asked for. SessionLayout takes it, opens that
	 * group and scrolls to it; a value here is a request, never a state.
	 */
	pending = $state<{ side: MobileSide; key: string } | null>(null)

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

	/** The header's panels button. */
	toggleMenu(opener?: HTMLElement | null) {
		if (this.menuOpen) {
			this.closeMenu()
			return
		}
		this.#opener =
			opener ??
			(globalThis.document?.activeElement as HTMLElement | null) ??
			null
		this.menuOpen = true
	}

	closeMenu() {
		if (!this.menuOpen) return
		this.menuOpen = false
		this.restoreFocus()
	}

	/** A group was tapped in the menu: its side's sheet opens, showing it. */
	openGroup(side: MobileSide, key: string) {
		this.menuOpen = false
		this.pending = { side, key }
		this.open = side
	}

	/** SessionLayout, acting on the request exactly once. */
	takePending(): { side: MobileSide; key: string } | null {
		const p = this.pending
		this.pending = null
		return p
	}

	/** SessionLayout publishes what the menu lists. */
	setGroups(groups: MobileGroup[]) {
		this.groups = groups
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
