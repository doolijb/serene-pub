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
	 * The per-widget context provider (PLAN 25, ruled 2026-08-30). Svelte
	 * `setContext` must run at component init, so per-widget ctx needs a wrapper:
	 * this component projects the widget's data + verbs once via
	 * `buildNativeContext` and puts a reactive handle in context, then renders the
	 * widget inside. The widget reads it with `useWidgetContext()`.
	 *
	 * ONE projection, live-reactive: `ctx` is a `$derived`, so any change to the
	 * session/messages/placement re-projects and every consumer updates — the
	 * native analog of the frame's push. The SAME `projectWidgetData` core feeds
	 * a frame over the port; the only difference here is the boundary.
	 *
	 * `placement` is the widget's REAL cell geometry, threaded in by whichever
	 * zone drew it (see `UNPLACED` for the one case that has none).
	 *
	 * The `on` verb is real too: this component owns one event bus per widget
	 * and feeds it from three places — the widget's own (already channel-scoped)
	 * message list, its placement, and the session-level `source`. A frame gets
	 * the identical events over its port; the bus is the in-document analog.
	 */
	import type { Snippet } from "svelte"
	import { setContext } from "svelte"
	import {
		buildNativeContext,
		createWidgetEventBus,
		eventInScope,
		WIDGET_CONTEXT_KEY,
		WidgetMessageFeed,
		type Payload,
		type PlacementInput,
		type ProjectInput,
		type SurfaceMessage,
		type WidgetContext,
		type WidgetContextRef,
		type WidgetEventSource
	} from "$lib/shared/widgets/context"
	import type { WidgetScope } from "$lib/shared/widgets/types"
	import {
		effectiveWidgetSkin,
		scopeWidgetCss,
		varsToStyle,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"
	import WidgetStyleOverlay from "./WidgetStyleOverlay.svelte"

	interface Props {
		widget: WidgetContext["widget"]
		session: { id: number; name?: string | null } & Record<string, unknown>
		/** Live message list (native gets the reactive array, not a snapshot). */
		messages?: SurfaceMessage[]
		channels?: string[]
		props?: Payload
		/** This instance's effective settings — the `settings.v1` section. */
		settings?: Payload
		grants?: WidgetScope[]
		scoped?: ProjectInput["scoped"]
		/** This widget's measured cell geometry in its zone. */
		placement?: PlacementInput
		/**
		 * The session-level event source (the `SurfaceManager`) this widget's
		 * bus fans out from. Its events are filtered to `channels` here, so a
		 * widget only ever hears about the channels it declared.
		 */
		source?: WidgetEventSource
		/** Routes to the audited trigger path (same as a frame's action). */
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>
		) => void
		children: Snippet
	}

	let {
		widget,
		session,
		messages = [],
		channels = [],
		props,
		settings,
		grants,
		scoped,
		placement,
		source,
		onAction,
		children
	}: Props = $props()

	/**
	 * The placement of a widget NOBODY placed.
	 *
	 * Every zone that draws widgets now measures and threads real geometry, so
	 * this is not the old interim default standing in for the grid — it is the
	 * honest answer for a mount with no grid behind it at all: a widget in a
	 * pop-over flyout, or a host wiring one up outside a zone. One widget, one
	 * cell, touching every edge of a zone of one; `chrome` then derives to
	 * "the widget owns its own backdrop", which is the correct no-op.
	 *
	 * `tier` is the one field with nothing behind it — there is no box to
	 * measure — so it stays the middling default it has always been rather than
	 * claiming a width. A placed widget's tier comes from `placementOf`, off the
	 * real measurement.
	 */
	const UNPLACED: PlacementInput = {
		zone: { columns: 1, column: 1, rows: 1, row: 1 },
		box: {
			cols: 1,
			rows: null,
			edges: { top: true, right: true, bottom: true, left: true }
		},
		tier: "cozy",
		pinned: false,
		collapsed: false,
		drawered: false
	}

	/* This widget's event bus — the `on` verb (PLAN 25). One per MOUNT, like
	   the style scope above and for the same reason: two mounts of the same
	   widget id are two widgets on screen, and a listener belongs to the one
	   that registered it. Created outside the derived so it survives every
	   re-projection — a subscription taken at mount must not be swept away by
	   the next message that lands. */
	const bus = createWidgetEventBus()

	// request/menu are not wired to a real host yet — a native widget that
	// reaches for them gets a clean, explicit failure rather than a silent no-op
	// that looks like it worked. `action` and `on` ARE real: action rides the
	// same audited trigger path a frame's action does, and `on` is the bus.
	let ctx = $derived<WidgetContext>(
		buildNativeContext(
			{
				session,
				messages,
				channels,
				props,
				settings,
				placement: placement ?? UNPLACED,
				grants,
				scoped
			},
			widget,
			{
				action: (fn, messageId, payload) => {
					// Loud, on the same rule `request` follows below: a host
					// with no trigger path behind it has NOT run the action, and
					// a silent `?.()` would tell the widget it had. A widget that
					// wants to degrade can try/catch; one that cannot must not be
					// lied to. (The prop stays optional because every link in the
					// chain above it is — the page's `onFrameAction` included —
					// so a type alone could not make this unreachable.)
					if (!onAction)
						throw new Error(
							`widget "${widget.id}" called action("${fn}") on a host with no trigger path wired`
						)
					onAction(fn, messageId, payload)
				},
				request: async (kind) => {
					throw new Error(
						`widget.request("${kind}") is not available yet`
					)
				},
				menu: async () => null,
				on: (kind, cb) => bus.on(kind, cb)
			}
		)
	)

	/* ── what the bus carries ──────────────────────────────────────────────
	 * Three feeds, and the reason they are separate is that they answer to
	 * different truths: the message list, this widget's own geometry, and the
	 * session. All three are read off the SAME projection the widget reads, so
	 * an event can never describe something `ctx` does not also show. */

	// `message:created`. Fed from the PROJECTED list, which `scopeMessages` has
	// already narrowed to this widget's declared channels — so "on a channel the
	// widget subscribes to" needs no second filter, and a widget can always find
	// in `messages.v1` the message it was just told about. The feed seeds
	// silently on the first run, so mounting onto a loaded session is not a
	// thousand arrivals.
	const feed = new WidgetMessageFeed()
	$effect(() => {
		for (const e of feed.take(ctx.messages.v1)) bus.emit(e)
	})

	// `layout:changed`. Native consumers can simply read `ctx.layout.v1` (it is
	// reactive), so this exists for parity with the frame lane — where a push is
	// the only reactivity there is — and to give a widget that must DO something
	// on a move (re-measure a canvas, re-fit a map) somewhere to hang it.
	// Compared by value: a re-projection with identical geometry is not a move.
	let lastLayout: string | null = null
	$effect(() => {
		const layout = ctx.layout.v1
		const key = JSON.stringify(layout)
		if (key === lastLayout) return
		const first = lastLayout === null
		lastLayout = key
		// The initial placement is not a CHANGE — it is what the widget mounted
		// with, and `ctx.layout.v1` already says so.
		if (!first) bus.emit({ kind: "layout:changed", layout })
	})

	// The session-level fan-out (`channel:activated`, and anything the manager
	// grows later), narrowed to this widget's channels. `untrack`-free by
	// construction: `source` and `channels` are the only reads, so the
	// subscription is re-taken exactly when one of them changes.
	$effect(() => {
		const src = source
		if (!src) return
		const declared = [...channels]
		return src.subscribe((e) => {
			if (eventInScope(e, declared)) bus.emit(e)
		})
	})

	// A stable handle whose getter returns the live derived ctx — consumers stay
	// reactive across re-projections (see WidgetContextRef).
	const ref: WidgetContextRef = {
		get current() {
			return ctx
		}
	}
	setContext(WIDGET_CONTEXT_KEY, ref)

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
