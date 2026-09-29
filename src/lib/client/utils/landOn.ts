/**
 * Landing: bringing the reader to the one element an address named — a
 * `?message=` link from a notification, an admin `#field`. The element is
 * scrolled to the middle of its scroll region, ringed once (`.sp-landed`,
 * `app.css`), and told to anything that scrolls it (`LANDED_EVENT`).
 */

/**
 * Raised (bubbling) on the element just landed on, after it was scrolled
 * into view. A region that keeps itself at an end (`sp-scroll` with
 * `stick`) hears it and lets go of that end — holding the landed element
 * where it was put — before any row that lands next could pull the view
 * back. Raised only after an INSTANT scroll: the region reads where the
 * element sits the moment it hears it.
 */
export const LANDED_EVENT = "sp-landed"

/** How long the ring stays on (its animation is 1.6s; reduced motion 2.4s). */
const RING_MS = 2600

/**
 * Land on `el`: centre it, tell its scroll region, ring it once, and give
 * `focus` the keyboard (without scrolling again) when one is named.
 */
export function landOn(el: HTMLElement, opts: { focus?: HTMLElement | null } = {}): void {
	el.scrollIntoView({ block: "center", behavior: "auto" })
	el.dispatchEvent(new CustomEvent(LANDED_EVENT, { bubbles: true }))
	el.classList.remove("sp-landed")
	// A reflow between, so a second landing on the same element rings again.
	void el.offsetWidth
	el.classList.add("sp-landed")
	setTimeout(() => el.classList.remove("sp-landed"), RING_MS)
	opts.focus?.focus({ preventScroll: true })
}
