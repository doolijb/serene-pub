<script lang="ts">
	/**
	 * A plugin frame surface (20 §12): an opaque-origin sandbox
	 * (`sandbox="allow-scripts"`, never `allow-same-origin`) whose document
	 * comes from the plugin-ui route under a grant-composed CSP. The frame
	 * has zero ambient anything — no cookies, no DOM reach, no socket — and
	 * everything it knows arrives on the MessageChannel this component owns.
	 *
	 * ## Protocol v1 (host ⇄ frame, over the transferred port)
	 *
	 * host → frame:
	 *   { t: "init",     protocol: 1, surface, payload }   // with the port
	 *   { t: "session",  session }                          // metadata
	 *   { t: "messages", messages }                         // parts-native list
	 *   { t: "message",  message }                          // one update
	 *   { t: "channel",  channel, messages }   // panel surfaces: one lane's msgs (21)
	 *   { t: "props",    props }               // panel surfaces: declared props (21)
	 *   { t: "settings", settings }         // panel surfaces: settings.v1 (25)
	 *   { t: "style",    css, vars }           // panel surfaces: the widget skin (25)
	 *   { t: "layout",   layout }              // panel surfaces: layout.v1 (25)
	 *   { t: "event",    event }               // panel surfaces: one host event (25)
	 *   { t: "actions",  actions }             // panel surfaces: actions.v1 — the venues (R-15, U5c)
	 *   { t: "suspend" } / { t: "resume" }     // off-screen idle, never a reload (21)
	 *
	 * frame → host:
	 *   { t: "ready" }
	 *   { t: "action", fn, messageId?, payload? }  // → the trigger machinery
	 *   { t: "invoke", key, messageId?, payload? } // an action by identity (`<spec>#<key>`), or a key one action carries, off `actions.v1` (U5c)
	 *
	 * A panel that declares `channels` is a *view onto those lanes*: it receives
	 * only their messages (per-channel `channel` posts), never the whole log —
	 * the same scoping the native panels get, enforced host-side. `suspend`
	 * pauses an off-screen frame without unmounting it (the grid never
	 * reparents, so the document — and this port — survive; suspend just tells
	 * it to idle), and `resume` wakes it. This is what caps many-frame cost
	 * without ever paying a reload (21 §7).
	 *
	 * `style` is the widget-skin half of PLAN 25 (ruled 2026-08-30): a frame
	 * widget is treated identically to a native one, host-resolved skin and all
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
	 * The init post targets `"*"` by necessity — an opaque origin matches no
	 * targetOrigin — which is safe *because* the channel port rides the
	 * message: only the document inside this exact frame receives it.
	 */
	import { onDestroy } from "svelte"
	import {
		eventInScope,
		scopeMessages,
		WidgetMessageFeed,
		type PlacementInput,
		type SurfaceMessage,
		findAction,
		makeInvoke,
		projectActions,
		type ActionsV1,
		type WidgetEvent,
		type WidgetEventSource
	} from "$lib/shared/widgets/context"
	import type { CoreVerbHandlers } from "$lib/shared/widgets/invokeAction"
	import { buildEventMessage, buildLayoutMessage } from "./framePlacement"
	import { buildStyleMessage } from "./frameStyle"
	import { frameInvokeVerdict } from "./frameActivation"

	interface Props {
		src: string
		title: string
		surface: "session-view" | "panel" | "page"
		/** Sent in init and re-sent on change. */
		session?: unknown
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
		 * `{ t: "settings" }` — the same `settings.v1` a native widget reads off
		 * its ctx, defaults filled in and the user's deviations over them.
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
		 * `{ t: "layout" }` — the same `layout.v1` a native widget reads off its
		 * ctx. Undefined on the surfaces that are not widgets, and no `layout`
		 * is posted at all for those.
		 */
		placement?: PlacementInput
		/**
		 * Panel surfaces (25): the session-level event source (the
		 * `SurfaceManager`). Its events are filtered to `channels` here, exactly
		 * as `WidgetHost` filters them for a native widget, and forwarded as
		 * `{ t: "event" }`.
		 */
		source?: WidgetEventSource
		/**
		 * Panel surfaces (U5c): the session's action venues, posted as
		 * `{ t: "actions" }` — the same `actions.v1` a native widget reads off
		 * its ctx. A frame invokes one by identity (or a key only one action
		 * carries) with `{ t: "invoke" }`, which the host resolves to the
		 * declaration exactly as the native `invoke` verb does (`makeInvoke`):
		 * one of core's verbs to `coreVerbs`, a contributed one through
		 * `onAction` with its identity. Undefined on the surfaces that are
		 * not widgets, and nothing is posted for those.
		 */
		actions?: ActionsV1
		/**
		 * The host's real handlers for core's verbs, by key (U5c review, W4)
		 * — what `invoke('continue')` lands on. A frame on a host that wires
		 * none is refused by name (a warning), never fired as a function.
		 */
		coreVerbs?: CoreVerbHandlers
		/** Panel surfaces (21): idle the frame off-screen without unmounting. */
		suspended?: boolean
		/**
		 * The audited fire. `action` is the pressed declaration's identity
		 * when the frame named one (`invoke`); a bare `{ t: "action", fn }`
		 * carries none and gets the server's narrowest reading.
		 */
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string
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
		coreVerbs,
		source,
		suspended = false,
		onAction,
		class: klass = ""
	}: Props = $props()

	let frame = $state<HTMLIFrameElement | null>(null)
	let port: MessagePort | null = null
	let ready = $state(false)

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

	function handleLoad() {
		// A fresh channel per document load — a reloaded frame must never
		// receive a stale port.
		port?.close()
		const channel = new MessageChannel()
		port = channel.port1
		port.onmessage = (e) => {
			const m = e.data
			if (!m || typeof m !== "object") return
			if (m.t === "ready") {
				ready = true
				push()
			} else if (m.t === "action" && typeof m.fn === "string") {
				onAction?.(
					m.fn,
					typeof m.messageId === "number" ? m.messageId : undefined,
					m.payload && typeof m.payload === "object"
						? m.payload
						: undefined
				)
			} else if (m.t === "invoke" && typeof m.key === "string") {
				// The frame lane's `invoke`: the same walk the native verb
				// makes, over the same projection this frame was posted —
				// core's verbs to the host's handlers, the rest through
				// `onAction` with the identity. A key nothing lists, or a
				// core verb this host has no handler for, is dropped with a
				// warning — a frame is not lied to, and it is not trusted to
				// name a function either.
				try {
					// A state-changing core verb needs a person behind it
					// (S-C): refused with a warning unless a person is
					// currently in the frame — a mitigation, not the
					// authority; the server re-judges every write against the
					// viewer's own permissions. A verb that spends tokens
					// (`retry`, `continue`) is put to the person first, on the
					// parent's own dialog, which a frame cannot forge.
					// Resolved here the way `makeInvoke` resolves it, so the
					// gate reads the same declaration the dispatch will.
					const resolved = findAction(projectActions(actions), m.key)
					if (resolved) {
						const verdict = frameInvokeVerdict(
							resolved,
							{ lastInteractionAt },
							Date.now(),
							{
								userActivationActive:
									navigator.userActivation?.isActive,
								frameIsActiveElement:
									!!frame && document.activeElement === frame
							}
						)
						if (!verdict.allowed) {
							console.warn(`PluginFrame "${title}": ${verdict.reason}`)
							return
						}
						if (verdict.confirm && !window.confirm(verdict.confirm)) {
							console.warn(
								`PluginFrame "${title}": '${m.key}' declined by the person`
							)
							return
						}
					}
					makeInvoke(
						() => projectActions(actions),
						(fn, messageId, payload, action) =>
							onAction?.(fn, messageId, payload, action),
						title,
						coreVerbs
					)(m.key, {
						messageId:
							typeof m.messageId === "number" ? m.messageId : undefined,
						payload:
							m.payload && typeof m.payload === "object"
								? m.payload
								: undefined
					})
				} catch (e) {
					console.warn(`PluginFrame: ${(e as Error).message}`)
				}
			}
		}
		frame?.contentWindow?.postMessage(
			{ t: "init", protocol: 1, surface },
			"*",
			[channel.port2]
		)
	}

	/**
	 * Post one frame message, surviving uncloneable payloads: callers should
	 * hand plain data, but a stray proxy/function must degrade to a warning,
	 * never an unhandled DataCloneError that kills the rest of the push.
	 */
	function post(msg: Record<string, unknown>) {
		try {
			port?.postMessage(msg)
		} catch (e) {
			console.warn(
				`PluginFrame: dropped uncloneable "${msg.t}" payload`,
				e
			)
		}
	}

	function push() {
		if (!port || !ready) return
		if (session !== undefined) post({ t: "session", session })
		if (channels && channels.length) {
			// Panel scoping: only this panel's lanes, one post each. The frame
			// never sees the whole log.
			const list = (messages ?? []) as Array<{ channel?: string }>
			for (const ch of channels)
				post({
					t: "channel",
					channel: ch,
					messages: list.filter((m) => (m?.channel ?? "main") === ch)
				})
		} else if (messages !== undefined) {
			post({ t: "messages", messages })
		}
		if (props !== undefined) post({ t: "props", props })
		if (settings !== undefined) post({ t: "settings", settings })
		// The venues ride `push()` like the rest: a reloaded frame replays
		// `ready` and gets its actions again without the host being asked.
		if (actions !== undefined)
			post({ t: "actions", actions: projectActions(actions) })
		// Sanitised at the boundary rather than by the caller: this is the one
		// place a skin crosses into a frame, so it is the one place that has to
		// be right. An EMPTY skin is still posted — taking a style off has to
		// reach the frame too, and a host that simply stopped posting would
		// leave the last one applied for ever.
		if (skin !== undefined) post(buildStyleMessage(skin))
		// Placement rides in `push()` for the same reload-safe reason `style`
		// does: a frame that reloads replays `ready`, and everything it needs to
		// draw itself has to arrive again without the host being asked.
		if (placement !== undefined) post(buildLayoutMessage(placement))
	}

	// Re-feed on data change — the frame renders what the host chose to post,
	// which is the whole privacy story: it can only ever scrape this.
	$effect(() => {
		void session
		void messages
		void channels
		void props
		void settings
		void skin
		void placement
		void actions
		push()
	})

	/* ── events (PLAN 25) ──────────────────────────────────────────────────
	 * The frame's half of the `on` verb. `WidgetHost` owns a bus per native
	 * widget and feeds it from the widget's scoped message list, its placement,
	 * and the session source; this does the same three from the same helpers,
	 * and posts each result as `{ t: "event" }`.
	 *
	 * It is a second DELIVERY, not a second implementation — the scoping
	 * (`scopeMessages`/`eventInScope`), the diff (`WidgetMessageFeed`) and the
	 * projection (`buildLayoutMessage`) are the shared ones, which is what keeps
	 * "a frame is a native widget minus the iframe" true rather than aspirational.
	 * It lives here rather than in `Panel` because a frame is not always a panel,
	 * and every frame surface that receives messages should hear about them. */
	function emit(e: WidgetEvent) {
		post(buildEventMessage(e))
	}

	// `message:created`, scoped exactly as the `channel` posts above are, so a
	// frame is never told about a message it was not also sent. The feed seeds
	// silently, so a frame mounted onto a loaded session hears about arrivals
	// from then on and not about its own backlog.
	const feed = new WidgetMessageFeed()
	$effect(() => {
		const list = (messages ?? []) as SurfaceMessage[]
		const scoped = scopeMessages(list, channels ?? [])
		for (const e of feed.take(scoped)) emit(e)
	})

	// `layout:changed` — the notification beside the `{ t: "layout" }` state
	// push, so a frame can react to a move without diffing the pushes itself.
	// The FIRST placement is what it mounted with, not a change.
	let lastLayout: string | null = null
	$effect(() => {
		if (placement === undefined) return
		const msg = buildLayoutMessage(placement)
		const key = JSON.stringify(msg.layout)
		if (key === lastLayout) return
		const first = lastLayout === null
		lastLayout = key
		if (!first) emit({ kind: "layout:changed", layout: msg.layout })
	})

	// The session-level fan-out, narrowed to this frame's declared channels.
	$effect(() => {
		const src = source
		if (!src) return
		const declared = [...(channels ?? [])]
		return src.subscribe((e) => {
			if (eventInScope(e, declared)) emit(e)
		})
	})

	// Suspend/resume: idle an off-screen frame without unmounting it. Tracked
	// so we only post on transitions, and only once the frame is ready.
	let lastSuspended = false
	$effect(() => {
		const s = suspended
		if (!port || !ready) return
		if (s !== lastSuspended) {
			lastSuspended = s
			port.postMessage({ t: s ? "suspend" : "resume" })
		}
	})

	onDestroy(() => port?.close())
</script>

<svelte:window onblur={handleWindowBlur} onfocus={handleWindowFocus} />

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
