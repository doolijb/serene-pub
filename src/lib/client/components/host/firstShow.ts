/**
 * Mount on first show (unit M): a remote widget in a collapsed rail, a closed
 * drawer or flyout, an inactive tab or an unseen mobile side is not mounted —
 * no box, no worker, no module load — until it is first drawn. Every layout
 * path hides a widget the same way (`display: none` on something around the
 * mount, never an unmount: SessionLayout's stowed sides and `.wtab-hidden` panes, Panel's collapsed body), so "shown"
 * is one question for all of them: does the element have a box?
 *
 * The answer latches: once shown, a widget stays mounted however often it is
 * hidden again — hiding is never a remount.
 */

/** Whether `el` is drawn: connected, and no ancestor is `display: none`. */
export function isDrawn(el: Element): boolean {
	if (!el.isConnected) return false
	if (typeof el.checkVisibility === "function") return el.checkVisibility()
	return el.getClientRects().length > 0
}

/**
 * Calls `onShown` once, the first time `el` is drawn — now, if it already
 * is. A hidden element is watched by its size: going from `display: none` to
 * drawn gives it a box, and a box is a resize. Where nothing can watch (no
 * `ResizeObserver`), it is taken as shown: a widget is never hidden for
 * good because the page cannot tell. Returns the stop.
 */
export function whenFirstShown(el: Element, onShown: () => void): () => void {
	if (isDrawn(el) || typeof ResizeObserver === "undefined") {
		onShown()
		return () => {}
	}
	let done = false
	const observer = new ResizeObserver(() => {
		if (done || !isDrawn(el)) return
		done = true
		observer.disconnect()
		onShown()
	})
	observer.observe(el)
	return () => {
		done = true
		observer.disconnect()
	}
}
