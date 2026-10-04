/**
 * The way to **Duplicate** a placed widget from inside it (brief 7b; QD, the
 * plan's recommended default — `./widgetInstances`).
 *
 * The layout editor's Settings tab puts an overlay on every widget
 * (`WidgetStyleOverlay`, mounted inside a `WidgetHost`, several layers below
 * anything the layout hands down), and Duplicate sits beside its Settings
 * button. `SessionLayout` is the one component that can mint and place a copy,
 * so it registers its `duplicateWidget` here while the editor is open — the
 * same module-state seam the style pins and the settings modal use — and
 * clears it on close (and never registers one under QD's "tray only"), so no
 * overlay offers a Duplicate the page cannot do.
 */

interface Duplicator {
	/** Duplicate one placed widget instance; the copy's id, or null when refused. */
	duplicate: (widgetId: string) => string | null
	/** Why this instance's widget cannot take another copy (its cap), else null. */
	refusal: (widgetId: string) => string | null
}

let duplicator = $state<Duplicator | null>(null)

/** Register (or drop, with `null`) what duplicates a placed widget. */
export function setWidgetDuplicator(next: Duplicator | null): void {
	duplicator = next
}

/** Reactive view: whether Duplicate is offered, why not for one widget, and the way to do it. */
export function widgetDuplicator() {
	return {
		get available() {
			return duplicator !== null
		},
		/**
		 * The reason a widget at its cap shows in place of Duplicate — the
		 * same words its card and the Add menu say — else null. Read in the
		 * overlay's markup, so it follows the layout as copies come and go.
		 */
		refusal(widgetId: string): string | null {
			return duplicator ? duplicator.refusal(widgetId) : null
		},
		/** Duplicate one placed widget instance; the copy's id, or null when refused. */
		duplicate(widgetId: string): string | null {
			return duplicator ? duplicator.duplicate(widgetId) : null
		}
	}
}
