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
	import {
		type FrameHostMessage,
		type HostFrameMessage,
		type MessageV1,
		type SessionV1
	} from "@serene-pub/sdk"
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
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import { buildEventMessage, buildLayoutMessage } from "./framePlacement"
	import { buildStyleMessage } from "./frameStyle"
	import { frameInvokeVerdict } from "./frameActivation"
	import {
		buildPageMessage,
		buildStateMessage,
		frameStateKey,
		initMessage,
		pageOf,
		savedFrameState,
		type FrameRow
	} from "./framePort"

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
		 * one of core's verbs to `actionDispatch.core`, a contributed one to
		 * `actionDispatch.fire` — the host's own fire, not `onAction`, so a
		 * frame's press is the one the chips make. Undefined on the surfaces
		 * that are not widgets, and nothing is posted for those.
		 */
		actions?: ActionsV1
		/**
		 * The host's own routing for a press (U5c review, W4): its handlers
		 * for core's verbs — what `invoke('continue')` lands on; a frame on a
		 * host that wires none is refused by name (a warning), never fired as
		 * a function — and its fire for a contributed one, which names the run
		 * and takes the bespoke client flows. A host that threads no dispatch
		 * falls back to `onAction`, the thinner fire.
		 */
		actionDispatch?: ActionDispatch
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
		source,
		suspended = false,
		surfaceId,
		onAction,
		class: klass = ""
	}: Props = $props()

	let frame = $state<HTMLIFrameElement | null>(null)
	let port: MessagePort | null = null
	let ready = $state(false)

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

	function handleLoad() {
		// A fresh channel per document load — a reloaded frame must never
		// receive a stale port. A fresh boot, too: the previous document's
		// fatal complaint is not this one's, and `ready` is re-announced.
		ready = false
		fatal = null
		port?.close()
		const channel = new MessageChannel()
		port = channel.port1
		port.onmessage = (e) => {
			// `FrameHostMessage` names what a WELL-BEHAVED frame sends; what
			// arrives is whatever the sandboxed document chose to post, so
			// this stays untyped and every field is tested at runtime before
			// it is used. The union is the contract, not a guarantee about
			// this value.
			const m = e.data
			if (!m || typeof m !== "object") return
			if (m.t === "ready") {
				ready = true
				// Saved state BEFORE the first push: a remount is exactly when
				// a frame has forgotten, and it should be able to restore its
				// open tab or scroll offset before it has any rows to put in
				// it. Nothing is posted when there is none — `state` means
				// "here is what you saved", never "you saved nothing".
				const held = savedFrameState.get(stateKey)
				if (held) post(buildStateMessage(held))
				push()
			} else if (m.t === "error") {
				// A frame that failed to boot has to be able to say so, or a
				// broken surface is indistinguishable from a slow one. Logged
				// against the plugin, and a `fatal` one — the frame saying it
				// has given up, not merely complained — also replaces the blank
				// with a sentence in the chrome below. The sentence is the
				// host's; what the frame says goes to the console, because a
				// sandboxed document must not be able to write the app's own UI.
				const message = String(m.message ?? "frame reported an error")
				console.warn(
					`PluginFrame "${title}" (${src}): ${m.fatal === true ? "FATAL — " : ""}${message}`,
					m.detail
				)
				if (m.fatal === true) fatal = message
			} else if (m.t === "request" && typeof m.requestId === "string") {
				// A request is not a grant: the host answers out of what it
				// already chose to push, or declines with a warning. Declined
				// silently down the port — there is no "no" in the union — but
				// never silently in the console, or an author cannot tell a
				// refusal from a host that dropped the message.
				if (m.what !== "messages") {
					console.warn(
						`PluginFrame "${title}": declined request — '${String(m.what)}' is not something this host answers`
					)
					return
				}
				const page = pageOf(
					{
						messages: (messages ?? []) as FrameRow[],
						channels
					},
					{
						channel:
							typeof m.channel === "string" ? m.channel : undefined,
						cursor:
							typeof m.cursor === "string" ? m.cursor : undefined,
						limit:
							typeof m.limit === "number" ? m.limit : undefined
					}
				)
				if (page.refused) {
					console.warn(
						`PluginFrame "${title}": declined request — ${page.refused}`
					)
					return
				}
				post(buildPageMessage(m.requestId, page))
			} else if (m.t === "save-state") {
				// Not storage. Held for this (session, surface) and returned on
				// the next mount; over the cap it is dropped with a warning
				// rather than quietly becoming a database a surface relies on.
				const outcome = savedFrameState.set(stateKey, m.state)
				if (!outcome.kept)
					console.warn(
						`PluginFrame "${title}": dropped save-state — ${outcome.reason}`
					)
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
						(fn, messageId, payload, action, blockId) =>
							onAction?.(fn, messageId, payload, action, blockId),
						title,
						actionDispatch
					)(m.key, {
						messageId:
							typeof m.messageId === "number" ? m.messageId : undefined,
						payload:
							m.payload && typeof m.payload === "object"
								? m.payload
								: undefined,
						// The form this press answers (U5d), carried across the
						// port exactly as the native lane carries it — so a
						// frame drawing a message's form is held to the block's
						// addressee rather than read as an unaddressed press.
						blockId:
							typeof m.blockId === "string" ? m.blockId : undefined
					})
				} catch (e) {
					console.warn(`PluginFrame: ${(e as Error).message}`)
				}
			}
		}
		// `initMessage`, which carries `FRAME_PROTOCOL` and never a literal: the
		// number a frame reads to know which members of the union it may use
		// has exactly one home, and it is the same package the frame's author
		// compiled against.
		frame?.contentWindow?.postMessage(initMessage(surface), "*", [
			channel.port2
		])
	}

	/**
	 * Post one frame message, surviving uncloneable payloads: callers should
	 * hand plain data, but a stray proxy/function must degrade to a warning,
	 * never an unhandled DataCloneError that kills the rest of the push.
	 *
	 * Typed as the SDK's union, so a message this host invents — or a member
	 * it spells wrong — fails to compile rather than reaching a frame that
	 * cannot recognise it.
	 */
	function post(msg: HostFrameMessage) {
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
		// The rows as the page holds them. Narrowed at this one seam rather
		// than at every call site: what a host has in hand is a wire row, and
		// `MessageV1` is what the contract promises a frame once it crosses.
		const held = (messages ?? []) as MessageV1[]
		if (channels && channels.length) {
			// Panel scoping: only this panel's lanes, one post each. The frame
			// never sees the whole log.
			for (const ch of channels)
				post({
					t: "channel",
					channel: ch,
					messages: held.filter((m) => (m?.channel ?? "main") === ch)
				})
		} else if (messages !== undefined) {
			post({ t: "messages", messages: held })
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
		// The look the app is wearing, as data. A frame is its own document and
		// can see nothing of the top one, so the two attributes the app steers
		// its own stylesheet with are the whole of what it needs to match.
		if (theme) post({ t: "theme", theme: theme.theme, mode: theme.mode })
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
		void theme
		push()
	})

	/* ── the host's theme ──────────────────────────────────────────────────
	 * Read off `<html>` rather than out of the settings context, on the same
	 * reasoning `WidgetHost` reads `data-mode` there: the attributes are what
	 * is true of the DOM whatever wrote them, including the root layout taking
	 * one away for Document View. The mirror is a single `$state`, so the push
	 * above re-runs whenever either attribute moves.
	 *
	 * Values, never tokens: the frame's CSP grants it its OWN files, so a
	 * stylesheet resolving `data-theme` is one the package ships. What crosses
	 * is the id and light-or-dark, which is what a frame needs to pick a side. */
	let theme = $state<{ theme: string; mode: "light" | "dark" } | null>(null)
	$effect(() => {
		const read = () => {
			const el = document.documentElement
			theme = {
				theme: el.getAttribute("data-theme") ?? "",
				mode: el.getAttribute("data-mode") === "dark" ? "dark" : "light"
			}
		}
		read()
		const mo = new MutationObserver(read)
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "data-mode"]
		})
		return () => mo.disconnect()
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
			post({ t: s ? "suspend" : "resume" })
		}
	})

	onDestroy(() => port?.close())
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
