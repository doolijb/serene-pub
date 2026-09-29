<script lang="ts" module>
	/**
	 * One key per MOUNT, not per widget id: the same widget can be on screen
	 * twice (a rail and its flyout, or a margin rail rendered alongside the
	 * inline one), and two mounts sharing a scope attribute would share one
	 * style element whose lifetime neither of them owns.
	 */
	let nextInstance = 0
</script>

<script lang="ts">
	/**
	 * A widget's skin scope and style controls (PLAN 25, ruled 2026-08-30):
	 * the wrapper a remote session widget (`RemoteWidget`) renders inside. It
	 * projects nothing: what a widget is fed is its wire's (R79 — no widget
	 * is mounted in the page's own tree). A plugin frame takes the same skin
	 * through its own document and the same controls beside it (`Panel`).
	 */
	import type { Snippet } from "svelte"
	import {
		effectiveWidgetSkin,
		scopeWidgetCss,
		varsToStyle,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"
	import WidgetStyleOverlay from "./WidgetStyleOverlay.svelte"

	interface Props {
		/** The widget's id (whose skin) and its title (the controls' label). */
		widget: { id: string; title: string }
		children: Snippet
	}

	let { widget, children }: Props = $props()

	/* ── the skin (PLAN 25) ────────────────────────────────────────────────
	 * The layout pins a style per widget (`layoutSettings.widgetStyles`); the
	 * store resolves that pin against the rows this user may use and degrades
	 * to the widget's default when it no longer reconciles. What lands in the
	 * DOM is two things and only two:
	 *
	 *   • `vars` as custom properties on this wrapper — they inherit into the
	 *     widget's subtree and nowhere else;
	 *   • `css`, every selector re-written to sit under this wrapper's
	 *     `data-widget-instance`, in a style element of our own in the
	 *     document head.
	 *
	 * The wrapper is `display: contents`, so it adds NO box and cannot shift a
	 * thing: the earlier style-bleed bug is why the skin gets a container of
	 * its own at all, and a container that changes the layout would trade one
	 * bug for another. The cost is that a rule targeting the container itself
	 * paints nothing (it has no box) — token overrides still inherit, which is
	 * what a skin's `:root {}` and `vars` actually want.
	 *
	 * That style element lives in the document head rather than inside the
	 * wrapper on purpose: an extra element among the widget's own children
	 * would shift every `:nth-child` the widget (or its skin) relies on. */
	// Called for the subscription, not the value: the first host on the page
	// starts the one fetch, and `effectiveWidgetSkin` reads the same module
	// state, so the derived below re-runs when the rows or the pins land.
	widgetStylesStore()
	const instanceKey = `ws${++nextInstance}`
	// `effectiveWidgetSkin`, not the pinned row: while this widget's style is
	// being written the store hands back the UNSAVED draft instead, so the
	// author sees their CSS as they type it. It is the same two values either
	// way, and they go through the same sanitiser below — live-apply is a
	// different SOURCE, never a second injection path.
	let skin = $derived(effectiveWidgetSkin(widget.id))
	let skinVars = $derived(varsToStyle(skin.vars))
	let skinCss = $derived(
		skin.css ? scopeWidgetCss(skin.css, instanceKey) : ""
	)

	/* The app's light/dark switch is `data-mode` on `<html>` (Layout.svelte
	   writes it from the user's `darkMode` setting; the root layout strips it
	   for Document View). A skin's selectors are all re-written to sit UNDER
	   this wrapper, so an ancestor's attribute is unreachable from inside one —
	   which left a dark-only rule with nowhere to go, and is why the shipped
	   message styles publish every mode-dependent value as a custom property
	   instead.
	   Mirroring the attribute here gives a skin the ordinary spelling back:
	   `[data-mode="dark"] .card {…}` is folded onto the scope by
	   `scopeWidgetCss`, so it matches when — and only when — the app is dark.
	   An observer rather than the settings context: the attribute is the one
	   thing that is true of the DOM whatever wrote it, and this mirrors it
	   including when the root layout takes it away. */
	let mode = $state<string | null>(null)
	$effect(() => {
		const read = () => {
			mode = document.documentElement.getAttribute("data-mode")
		}
		read()
		const mo = new MutationObserver(read)
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-mode"]
		})
		return () => mo.disconnect()
	})

	$effect(() => {
		const css = skinCss
		if (!css) return
		const el = document.createElement("style")
		el.dataset.widgetStyle = instanceKey
		// textContent, never innerHTML: the text cannot terminate its own
		// element, whatever the sanitiser did or did not catch.
		el.textContent = css
		document.head.appendChild(el)
		return () => el.remove()
	})
</script>

<div
	class="widget-style-scope"
	data-widget-instance={instanceKey}
	data-mode={mode}
	style={skinVars}
>
	{@render children()}
</div>
<!-- The style controls for THIS widget, and only while the editor's Style tab
     is open — the component renders nothing at all otherwise.

     Deliberately a SIBLING of the scope wrapper, not a child: inside it the
     widget's own skin would paint the controls (a real `[data-widget-instance]
     div { outline: … }` skin did exactly that), and a skin that can restyle —
     or hide — the buttons you would use to take it off is a skin nobody can
     get rid of. `display: contents` on the wrapper means both land in the same
     parent box regardless, so the overlay still positions against the panel
     card exactly as it did. -->
<WidgetStyleOverlay widgetId={widget.id} label={widget.title} />

<style>
	/* No box, no layout effect — purely a scope + a place to hang tokens. */
	.widget-style-scope {
		display: contents;
	}
	/* …and the price of having no box: a zone sizes the widget it holds with a
	   CHILD rule (`.widget > *`, `.chat-arranged-cell > *`, `.wtab-pane > *`,
	   `.live-side-cell > *` — each `flex: 1; min-block-size: 0`), and selectors
	   match the DOM tree, not the layout tree. So that rule lands on this
	   wrapper, which has no box to size, and never reaches the widget. The two
	   properties are restated one level down, where the widget's real box is.

	   Scoped to this wrapper, so nothing outside a widget is touched; inert
	   wherever the wrapper's parent is not a flex container (a panel's body),
	   because `flex` on a non-flex-item does nothing and `min-block-size: 0` is
	   already a block box's default. */
	.widget-style-scope > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
</style>
