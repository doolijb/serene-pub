<script lang="ts">
	/**
	 * A plugin frame surface (20 §12): an opaque-origin sandbox
	 * (`sandbox="allow-scripts"`, never `allow-same-origin`) whose document
	 * comes from the plugin-ui route under a grant-composed CSP. The frame
	 * has zero ambient anything — no cookies, no DOM reach, no socket — and
	 * everything it knows arrives on the MessageChannel this component owns.
	 *
	 * ## The protocol (host ⇄ frame, over the transferred port)
	 *
	 * Declared ONCE, in the SDK: `HostFrameMessage` and `FrameHostMessage` are
	 * imported below and every post is checked against them, so what this host
	 * sends is what a plugin compiled against `@serene-pub/sdk` was told to
	 * expect. `init` carries `FRAME_PROTOCOL` — the SDK's number, never a
	 * literal — which is what tells the frame which members it may use.
	 *
	 * Read the unions for the wire itself; what follows is only this host's
	 * side of it. Surfaces differ: a page or session-view frame is not a
	 * widget, so it receives no `settings`, `style`, `layout`, `event` or
	 * `actions` at all.
	 *
	 * A panel that declares `channels` is a *view onto those lanes*: it receives
	 * only their messages (per-channel `channel` posts), never the whole log —
	 * the same scoping a remote widget gets, enforced host-side. `suspend`
	 * pauses an off-screen frame without unmounting it (the grid never
	 * reparents, so the document — and this port — survive; suspend just tells
	 * it to idle), and `resume` wakes it. This is what caps many-frame cost
	 * without ever paying a reload (21 §7).
	 *
	 * `style` is the widget-skin half of PLAN 25 (ruled 2026-08-30): a frame
	 * widget is treated identically to a remote one, host-resolved skin and all
	 * — the only difference being that its CSS is injected into the frame's OWN
	 * document rather than a scoped `<style>` out here. The frame is expected to
	 * keep one `<style id="sp-widget-style">`, replaced in place, and to set
	 * `vars` on its `document.documentElement`.
	 *
	 * It is PUSHED, never negotiated: a frame that has never heard of it — an old
	 * sample, a third-party plugin — falls through its own switch and ignores it,
	 * which is the whole of the compatibility story. Nothing here waits for an
	 * ack, so an unstyled frame costs one dropped message and no error. See
	 * `frameStyle.ts` for the sanitiser boundary this crosses.
	 *
	 * ## What this host answers (protocol 2)
	 *
	 * Beyond `ready` and the presses, a frame may `error`, `request` and
	 * `save-state`. A v2 host may decline any of the three and still be a v2
	 * host — a request is not a grant — but declining them *silently* is what
	 * made them useless: an author could not tell a host that ignored them
	 * from a frame that never sent them. So:
	 *
	 *   · **`error`** is logged against the plugin, and a `fatal` one puts a
	 *     sentence in this frame's own chrome — a surface that has given up
	 *     should say so rather than sit blank, and it must say it OUT HERE:
	 *     a sandboxed document cannot raise the app's error surface.
	 *   · **`request messages`** is answered with `page`, cut from the very
	 *     rows this host already pushed and scoped by the same matcher, so a
	 *     frame can page a long channel without the host guessing a slice —
	 *     and cannot page its way to a lane it never declared.
	 *   · **`save-state`** is held per (session, surface) and returned as
	 *     `state` on the next mount, capped: see `framePort.ts`, which owns
	 *     all three decisions and is the twin of the preview harness's file
	 *     of the same name.
	 *
	 * The init post targets `"*"` by necessity — an opaque origin matches no
	 * targetOrigin — which is safe *because* the channel port rides the
	 * message: only the document inside this exact frame receives it.
	 */
	import { onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { SessionV1, WidgetBaseSection } from "@serene-pub/sdk"
	import type {
		PlacementInput,
		ActionsV1,
		WidgetEventSource
	} from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import { frameInvokeVerdict, hasRecentActivation } from "./frameActivation"
	import { frameOwnerOf } from "./frameOwner"
	import { frameStateKey, initMessage } from "./framePort"
	import { createWidgetWire, type WireInputs } from "./widgetWire.svelte"

	interface Props {
		src: string
		title: string
		surface: "session-view" | "panel" | "page"
		/** Sent in init and re-sent on change. */
		session?: SessionV1
		/** Parts-native messages; re-sent wholesale on change. */
		messages?: unknown[]
		/**
		 * Panel surfaces (21): the lanes this panel views. When set, the frame
		 * receives only these channels' messages (per-channel posts), never the
		 * whole log — the scoping is enforced here, host-side.
		 */
		channels?: string[]
		/** Panel surfaces (21): declared props posted as `{ t: "props" }`. */
		props?: Record<string, unknown>
		/**
		 * Panel surfaces (25): this instance's effective settings, posted as
		 * `{ t: "settings" }` — the same `settings.v1` a remote widget is posted,
		 * defaults filled in and the user's deviations over them.
		 * Undefined on the surfaces that are not widgets, and nothing is posted
		 * for those.
		 */
		settings?: Record<string, unknown>
		/**
		 * Panel surfaces (25): the widget skin this frame should wear, already
		 * resolved by the host (`effectiveWidgetSkin`, so an unsaved draft shows
		 * while it is being typed). Undefined on the surfaces that are not
		 * widgets — a page or session-view frame — and no `style` is posted at all
		 * for those.
		 */
		skin?: { css: string; vars: Record<string, string> }
		/**
		 * Panel surfaces (25): this widget's measured cell geometry, pushed as
		 * `{ t: "layout" }` — the same `layout.v1` a remote widget is posted.
		 * Undefined on the surfaces that are not widgets, and no `layout`
		 * is posted at all for those.
		 */
		placement?: PlacementInput
		/**
		 * Panel surfaces (25): the session-level event source (the
		 * `SurfaceManager`). Its events are filtered to `channels` here, exactly
		 * as the wire filters them for a remote widget, and forwarded as
		 * `{ t: "event" }`.
		 */
		source?: WidgetEventSource
		/**
		 * Panel surfaces (U5c): the session's action venues, posted as
		 * `{ t: "actions" }` — the same `actions.v1` a remote widget is posted.
		 * A frame invokes one by identity (or a key only one action
		 * carries) with `{ t: "invoke" }`, which the host resolves to the
		 * declaration exactly as the native `invoke` verb does (`makeInvoke`):
		 * one of core's verbs to `actionDispatch.core`, a contributed one to
		 * `actionDispatch.fire` — the host's own fire, not `onAction`, so a
		 * frame's press is the one the chips make. Undefined on the surfaces
		 * that are not widgets, and nothing is posted for those.
		 */
		actions?: ActionsV1
		/**
		 * The host's own routing for a press (U5c review, W4): its handlers
		 * for core's verbs — what `invoke('extend')` lands on; a frame on a
		 * host that wires none is refused by name (a warning), never fired as
		 * a function — and its fire for a contributed one, which names the run
		 * and takes the bespoke client flows. A host that threads no dispatch
		 * falls back to `onAction`, the thinner fire.
		 */
		actionDispatch?: ActionDispatch
		/** Nested in a component (`sp-frame`): raise the document's invoke unresolved (`WireInputs.onInvoke`). */
		onInvoke?: WireInputs["onInvoke"]
		/**
		 * Panel surfaces (R75): the base sections this widget reads — only
		 * those are posted. Absent posts all, as every non-widget surface does.
		 */
		reads?: readonly WidgetBaseSection[]
		/** Panel surfaces (21): idle the frame off-screen without unmounting. */
		suspended?: boolean
		/**
		 * What this surface's saved view state is keyed on, beside the session
		 * (`save-state` → `state`). A panel passes its instance id — the string
		 * a saved layout row already names — and anything else falls back to the
		 * document's own path, which is stable for a page or session-view frame.
		 */
		surfaceId?: string
		/**
		 * The audited fire. `action` is the pressed declaration's identity
		 * when the frame named one (`invoke`); a bare `{ t: "action", fn }`
		 * carries none and gets the server's narrowest reading.
		 */
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
		class?: string
	}

	let {
		src,
		title,
		surface,
		session,
		messages,
		channels,
		props,
		settings,
		skin,
		placement,
		actions,
		actionDispatch,
		onInvoke,
		reads,
		source,
		suspended = false,
		surfaceId,
		onAction,
		class: klass = ""
	}: Props = $props()

	let frame = $state<HTMLIFrameElement | null>(null)
	/** Whose document this is — the plugin id its `/plugin-ui/<id>/…` address names, never `core`. */
	const frameOwner = $derived(frameOwnerOf(src))

	/**
	 * What a `fatal` error said, once one has been reported — the flag the
	 * chrome below reads. The frame's own words are NOT rendered (they go to
	 * the console; a sandboxed document must not write copy into the app's
	 * UI), they are kept because a host that has to explain itself later
	 * should not have to ask the frame again. Cleared on every document load:
	 * a reloaded frame is a fresh boot, and the last document's complaint must
	 * not outlive it.
	 */
	let fatal = $state<string | null>(null)

	/**
	 * Where this surface's saved state is filed. Derived rather than captured,
	 * so a panel moved between sessions files under the session it is now in.
	 */
	let stateKey = $derived(frameStateKey(session?.id, surfaceId ?? src))

	/**
	 * When focus last entered this frame, as the host can see it (S-C; W3) —
	 * kept as the fallback for a browser with no `navigator.userActivation`
	 * (Firefox, as of writing; W4). A pointer or key inside an opaque-origin
	 * iframe never reaches the parent document; what it leaves behind is
	 * **focus moving into the frame** — the element's `focus`, or `window`
	 * blurring while `document.activeElement` is the frame — so that is what
	 * is recorded, and it is **cleared when focus leaves** — the element's
	 * `blur`, or `window` regaining focus with the frame not the active
	 * element — so a stale entry never vouches for a later invoke. Plain,
	 * not `$state`: read at the invoke, never rendered.
	 *
	 * Where `userActivation` exists, `frameActivation.ts`'s live check wins
	 * instead: `navigator.userActivation.isActive` *and*
	 * `document.activeElement === frame`, read fresh at the invoke rather
	 * than tracked here — both, so a click elsewhere on the page (which sets
	 * `userActivation` alone) still vouches for nothing (W3's complaint,
	 * still honoured under W4).
	 */
	let lastInteractionAt: number | null = null
	const touched = () => (lastInteractionAt = Date.now())
	const left = () => (lastInteractionAt = null)
	// `window` blurs when focus moves into the frame — and also when the tab
	// itself loses focus while the frame holds it; only the first is an
	// entry, so an entry already recorded is not refreshed.
	const handleWindowBlur = () => {
		if (frame && document.activeElement === frame && lastInteractionAt === null)
			touched()
	}
	const handleWindowFocus = () => {
		if (frame && document.activeElement !== frame) left()
	}

	/**
	 * The protocol itself — sections, paging, saved state, events, the invoke
	 * walk — is the shared relay (`widgetWire.svelte.ts`), the one a remote
	 * component speaks too. What is this frame's own is the gate: a person is
	 * behind an invoke when focus is in THIS iframe (`frameActivation.ts`).
	 */
	const wire = createWidgetWire({
		inputs: () => ({
			session,
			messages,
			channels,
			props,
			settings,
			skin,
			placement,
			actions,
			source,
			suspended,
			stateKey,
			widgetId: surfaceId ?? src,
			owner: frameOwner,
			reads,
			actionDispatch,
			onInvoke,
			onAction
		}),
		label: () => `PluginFrame "${title}" (${src})`,
		gate: (action) =>
			frameInvokeVerdict(action, { lastInteractionAt }, Date.now(), {
				userActivationActive: navigator.userActivation?.isActive,
				frameIsActiveElement: !!frame && document.activeElement === frame
			}),
		personBehind: () =>
			hasRecentActivation({ lastInteractionAt }, Date.now(), {
				userActivationActive: navigator.userActivation?.isActive,
				frameIsActiveElement: !!frame && document.activeElement === frame
			}),
		onFatal: (message) => (fatal = message)
	})

	function handleLoad() {
		// A fresh channel per document load — a reloaded frame must never
		// receive a stale port. A fresh boot, too: the previous document's
		// fatal complaint is not this one's.
		fatal = null
		const channel = new MessageChannel()
		wire.attach(channel.port1)
		// `initMessage`, which carries `FRAME_PROTOCOL` and never a literal.
		// The post targets `"*"` by necessity — an opaque origin matches no
		// targetOrigin — safe because the port rides the message.
		frame?.contentWindow?.postMessage(initMessage(surface), "*", [channel.port2])
	}

	onDestroy(() => wire.detach())
</script>

<svelte:window onblur={handleWindowBlur} onfocus={handleWindowFocus} />

<!-- `relative` is the fatal notice's containing block, and the only reason this
     wrapper exists: a frame that has given up must show a sentence WITHOUT being
     unmounted — unmounting it would reload the document on the next render, and a
     surface that crash-loops is worse than one that says so once. -->
<div class="relative h-full w-full">
	<iframe
		bind:this={frame}
		{src}
		{title}
		sandbox="allow-scripts"
		class="h-full w-full border-0 {klass}"
		onload={handleLoad}
		onfocus={touched}
		onblur={left}
	></iframe>

	<!-- The frame said `fatal`. The sentence is the host's; what the frame
	     actually said went to the console, because a sandboxed document must
	     not be able to write copy into the app's own UI. -->
	{#if fatal}
		<div
			class="bg-surface-50-950 absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center"
			role="alert"
		>
			<Icons.TriangleAlert size={20} class="text-error-500" />
			<p class="text-surface-600-400 max-w-xs text-xs">
				This surface stopped and can't show anything. Reload the page to
				try it again — the extension's own message is in the browser
				console.
			</p>
		</div>
	{/if}
</div>
