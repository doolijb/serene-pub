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
	 *
	 * frame → host:
	 *   { t: "ready" }
	 *   { t: "action", fn, messageId?, payload? }  // → the trigger machinery
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

	function push() {
		if (!port || !ready) return
		if (session !== undefined) port.postMessage({ t: "session", session })
		if (messages !== undefined)
			port.postMessage({ t: "messages", messages })
	}

	// Re-feed on data change — the frame renders what the host chose to post,
	// which is the whole privacy story: it can only ever scrape this.
	$effect(() => {
		void session
		void messages
		push()
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
