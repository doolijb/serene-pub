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
	 *   { t: "suspend" } / { t: "resume" }     // off-screen idle, never a reload (21)
	 *
	 * frame → host:
	 *   { t: "ready" }
	 *   { t: "action", fn, messageId?, payload? }  // → the trigger machinery
	 *
	 * A panel that declares `channels` is a *view onto those lanes*: it receives
	 * only their messages (per-channel `channel` posts), never the whole log —
	 * the same scoping the native panels get, enforced host-side. `suspend`
	 * pauses an off-screen frame without unmounting it (the grid never
	 * reparents, so the document — and this port — survive; suspend just tells
	 * it to idle), and `resume` wakes it. This is what caps many-frame cost
	 * without ever paying a reload (21 §7).
	 *
	 * The init post targets `"*"` by necessity — an opaque origin matches no
	 * targetOrigin — which is safe *because* the channel port rides the
	 * message: only the document inside this exact frame receives it.
	 */
	import { onDestroy } from "svelte"

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
		/** Panel surfaces (21): idle the frame off-screen without unmounting. */
		suspended?: boolean
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>
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
		suspended = false,
		onAction,
		class: klass = ""
	}: Props = $props()

	let frame = $state<HTMLIFrameElement | null>(null)
	let port: MessagePort | null = null
	let ready = $state(false)

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
	}

	// Re-feed on data change — the frame renders what the host chose to post,
	// which is the whole privacy story: it can only ever scrape this.
	$effect(() => {
		void session
		void messages
		void channels
		void props
		push()
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

<iframe
	bind:this={frame}
	{src}
	{title}
	sandbox="allow-scripts"
	class="h-full w-full border-0 {klass}"
	onload={handleLoad}
></iframe>
