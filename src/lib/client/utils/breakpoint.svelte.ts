/**
 * The one place the app shell asks "are we at desktop width?".
 *
 * Before this module every caller inferred it from `window.innerWidth < 1024`
 * and had to remember two things at once: the number, and that it must match
 * Tailwind's `lg` — the breakpoint the stylesheet actually switches the shell
 * at. A site that reached for `md` (768) instead left a dead zone from
 * 768-1023px where the state said "desktop" and the stylesheet still said
 * "mobile", so nothing visibly opened. One `matchMedia`, one answer, and it
 * tracks a resize rather than only being right at the moment something happened
 * to ask.
 *
 * `64rem` is Tailwind v4's `lg`, written the way Tailwind writes it so the two
 * cannot drift through a change of root font size.
 */

const LG = "(min-width: 64rem)"

const supported =
	typeof window !== "undefined" && typeof window.matchMedia === "function"

/**
 * Resolved and subscribed at import, not on first read.
 *
 * A lazy `start()` inside the getter would be writing state during a read — and
 * the readers here are `$derived` expressions and templates, where Svelte
 * rightly refuses that (`state_unsafe_mutation`). There is nothing to tear
 * down: the shell outlives every component that reads this, and a media-query
 * listener with no subscribers costs one boolean write per resize across the
 * breakpoint.
 */
const state = $state({ matches: supported ? window.matchMedia(LG).matches : true })

if (supported) {
	window.matchMedia(LG).addEventListener("change", (event) => {
		state.matches = event.matches
	})
}

export const desktop = {
	/**
	 * True at Tailwind's `lg` (1024px) and above.
	 *
	 * Reads reactively: a component or `$derived` that reads this re-runs when
	 * the window crosses the breakpoint. Server-side — and anywhere without
	 * `matchMedia` — it answers `true`, which is safe because nothing rendered
	 * from it reaches SSR (the shell is behind an auth gate fed over the
	 * socket).
	 */
	get matches(): boolean {
		return state.matches
	}
}
