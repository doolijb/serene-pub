/**
 * The one desk/compact switch every sidebar view shares.
 *
 * The shell gives a view one of two widths: the 400px sidebar, or everything
 * right of the rail when it is shown full page (~1376px). The owner's rule is
 * that those are the SAME view given different room — so a view decides its
 * own shape from the width it was handed, never from "am I full page?". A wide
 * dock and a full page must land in the same place, and a narrow full page
 * (a phone) must land in the compact one.
 *
 * Lorebooks got here first (`$lib/client/lorebooks/layoutMode`) and its floor
 * is re-exported from here so the number is stated once for the whole app.
 */
import type { Action } from "svelte/action"

/**
 * The width at which a two-pane view — a list beside what the list opens — is
 * still usable in both panes. A stated choice, not a device: ~220–300px of
 * list that can hold a title and its chips on one line, and a detail column
 * wide enough to type in. Below it, a view shows one pane at a time.
 */
export const DESK_MIN_PX = 900

export type ViewMode = "compact" | "desk"

/**
 * An unmeasured container (0 — the state every container is in for its first
 * frame) is compact: a compact layout in a wide container is merely roomy,
 * while a desk layout in a narrow one is broken.
 */
export function modeForWidth(widthPx: number): ViewMode {
	return widthPx >= DESK_MIN_PX ? "desk" : "compact"
}

/**
 * Measures one element and answers `desk` / `compact` for it.
 *
 * ```svelte
 * const view = new ViewModeTracker()
 * <div use:view.observe class="flex min-h-0 flex-1">
 *   {#if view.mode === "desk"} …two panes… {:else} …one pane… {/if}
 * </div>
 * ```
 *
 * A `ResizeObserver` and not `bind:clientWidth`: Svelte implements that
 * binding by reading `clientWidth` back out of the DOM, which forces a layout
 * flush on every frame the element could have changed size — with a dozen
 * views mounted at once (they all stay mounted as tabs) that is a dozen
 * synchronous layouts per resize frame. A ResizeObserver is delivered by the
 * browser after layout has already happened and costs nothing to keep open.
 *
 * ⚠ Nothing here is a substitute for the CSS container on the view wrapper
 * (see Layout.svelte). Prefer `@lg/view:` utilities for anything CSS can say
 * on its own; reach for this tracker only when the SHAPE of the markup has to
 * change — different components, a different snippet, a pane that must not be
 * mounted at all in compact.
 */
export class ViewModeTracker {
	#mode = $state<ViewMode>("compact")
	#width = $state(0)

	/** `"compact"` until the element has been measured at a non-zero width. */
	get mode(): ViewMode {
		return this.#mode
	}

	/**
	 * The last non-zero measured content width, in px. 0 before the first
	 * measurement.
	 */
	get width(): number {
		return this.#width
	}

	/**
	 * ⚠ A zero measurement is discarded rather than believed.
	 *
	 * Every open view in this shell stays mounted and is hidden with the
	 * `hidden` attribute (`display: none`), and a non-rendered element reports
	 * a 0×0 box to its ResizeObserver. Believed, that would flip every
	 * backgrounded view to compact and then flip it back one frame after it is
	 * shown again — a visible re-layout on every tab switch, and any state a
	 * compact layout drops (a selected pane, a scroll position) lost with it.
	 * So "I have no width" is treated as no information at all: the last
	 * mode and width measured while visible stand until the next real one.
	 */
	#measure = (widthPx: number) => {
		if (!(widthPx > 0)) return
		this.#width = widthPx
		this.#mode = modeForWidth(widthPx)
	}

	/**
	 * `use:tracker.observe` on the element whose width decides the layout —
	 * normally the view's own outermost box, which the shell has already sized
	 * to the sidebar or the full page.
	 */
	observe: Action<HTMLElement> = (node) => {
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// `contentRect` is what a `container-type: inline-size` query
				// measures too, so `@lg/view:` and `mode === "desk"` cannot
				// disagree about the same element by a padding's width.
				this.#measure(entry.contentRect.width)
			}
		})
		observer.observe(node)
		return {
			destroy: () => observer.disconnect()
		}
	}
}
