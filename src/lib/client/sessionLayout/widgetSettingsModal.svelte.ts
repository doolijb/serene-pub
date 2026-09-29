/**
 * Which widget's settings modal is open (owner ruling 2026-09-27).
 *
 * A widget's settings — its title, lane, declared fields and style — open in
 * ONE app-level modal, portalled to the body, rather than in a card drawn
 * inside the widget's own box, where a small cell or a side column clipped it.
 * Every entry point (the gear a widget wears on the editor's Settings tab, the
 * phone editor's row button) calls `openWidgetSettings`; `WidgetSettingsModal`,
 * mounted once by `SessionLayout`, is the only thing that draws it.
 *
 * Module state rather than props for the same reason the style pins are: the
 * gear is mounted inside a `WidgetHost`, several layers below anything the
 * layout hands down, and the modal is mounted once, far from all of them.
 *
 * The control that opened the modal is remembered so closing it — Escape, the
 * close button, the backdrop — puts focus back where it came from.
 */

/** The widget a settings modal is about. */
export interface WidgetSettingsTarget {
	/** The widget's `WidgetDecl` id — also its `widget_styles.widgetSlug`. */
	widgetId: string
	/** What the widget is called on screen (its own title). */
	label: string
	/**
	 * Which kind of widget it is. Only the style editor's sentence about what
	 * CSS can reach differs: a frame's CSS lands in its own document.
	 */
	mount?: "remote" | "frame"
}

let current = $state<WidgetSettingsTarget | null>(null)
let returnTo: HTMLElement | null = null

/** The modal's heading: "Conversation settings". */
export function widgetSettingsTitle(label: string): string {
	const name = label.trim() || "Widget"
	return `${name} settings`
}

/**
 * Open the settings modal for one widget. `from` is the control pressed, and
 * gets focus back when the modal closes. Opening another widget's settings
 * replaces the first — there is one modal.
 */
export function openWidgetSettings(
	target: WidgetSettingsTarget,
	from?: HTMLElement | null
): void {
	returnTo = from ?? null
	current = { mount: "remote", ...target }
}

/**
 * Close the modal. Returns the control focus should go back to, or `null` when
 * that control has gone. It is kept until the next open, because the dialog
 * asks for it (`finalFocusEl`) after its open state has already flipped.
 */
export function closeWidgetSettings(): HTMLElement | null {
	current = null
	return widgetSettingsReturnTarget()
}

/** The control that last opened the modal, while it is still on the page. */
export function widgetSettingsReturnTarget(): HTMLElement | null {
	return returnTo && returnTo.isConnected ? returnTo : null
}

/** Reactive view of the open modal, for components. */
export function widgetSettingsModal() {
	return {
		get current() {
			return current
		},
		/** Is this widget's modal the one open? */
		isOpenFor(widgetId: string): boolean {
			return current?.widgetId === widgetId
		}
	}
}
