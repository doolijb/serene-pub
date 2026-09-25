<script lang="ts">
	/**
	 * A remote component's box (§3.5, C2): a plugin's component, running in
	 * its owner's UI worker, mirrored here through the host-element
	 * allowlist (`receiverPolicy.ts`).
	 *
	 * The data it is fed is the widget wire — the same relay a frame speaks
	 * (`widgetWire.svelte.ts`), over this mount's own port. What is this
	 * boundary's own is the gate: a person is behind a state-changing invoke
	 * when the host itself forwarded a TRUSTED event from this box within the
	 * activation window — stronger than a frame's focus, because the host
	 * sees the real event.
	 *
	 * `contain: paint` keeps a remote's `class` (a `fixed inset-0`, say)
	 * inside the box; ids are prefixed per box; the widget skin applies to
	 * the box as it does to a native widget.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { SessionV1 } from "@serene-pub/sdk"
	import type { ActionsV1, PlacementInput, WidgetEventSource } from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import { createWidgetWire, type WireInputs } from "$lib/client/components/frames/widgetWire.svelte"
	import { frameInvokeVerdict } from "$lib/client/components/frames/frameActivation"
	import { frameStateKey } from "$lib/client/components/frames/framePort"
	import { createGuardedReceiver, summarize } from "./receiverPolicy"
	import {
		acquireWorker,
		currentEvent,
		listenForRemoteEvents,
		postToWorker,
		releaseWorker,
		routeMount
	} from "./uiWorkers"
	import { FN } from "@serene-pub/sdk"
	import { registerVoucher } from "$lib/client/components/hostElements/activation"

	interface Props {
		/** The owning plugin's id — whose worker this runs in. */
		owner: string
		/** The component module, same-origin: `/plugin-ui/<owner>/<entry>`. */
		src: string
		title: string
		session?: SessionV1
		messages?: unknown[]
		channels?: string[]
		props?: Record<string, unknown>
		settings?: Record<string, unknown>
		skin?: { css: string; vars: Record<string, string> }
		placement?: PlacementInput
		actions?: ActionsV1
		actionDispatch?: ActionDispatch
		source?: WidgetEventSource
		suspended?: boolean
		surfaceId?: string
		/** The scoped sections this component was granted, by name — posted as `scoped`. */
		scoped?: WireInputs["scoped"]
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
		owner,
		src,
		title,
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
		scoped,
		onAction,
		class: klass = ""
	}: Props = $props()

	let box = $state<HTMLDivElement | null>(null)
	let fatal = $state<string | null>(null)
	/** When the host last forwarded a trusted event from this box. Plain: read at the invoke. */
	let lastInteractionAt: number | null = null
	// A press inside a nested document (`sp-frame`) that its own live check
	// vouched for counts as a press here (hostElements/activation.ts).
	$effect(() => {
		if (box) return registerVoucher(box, () => (lastInteractionAt = Date.now()))
	})

	const stateKey = $derived(frameStateKey(session?.id, surfaceId ?? src))
	const label = () => `Remote "${title}" (${owner})`

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
			owner: owner,
			scoped,
			actionDispatch,
			onAction
		}),
		label,
		gate: (action) => frameInvokeVerdict(action, { lastInteractionAt }, Date.now()),
		onFatal: (message) => (fatal = message)
	})

	let boxes = 0
	onMount(() => {
		if (!box) return
		listenForRemoteEvents()
		// An sp element's own events bubble (a native page's `onchange` hears
		// them); from a remote's box they stop at the box — the component
		// hears them in its worker, and nothing of the page should.
		const stopAtBox = (e: Event) => {
			if (e instanceof CustomEvent) e.stopPropagation()
		}
		const boxEvents = ["change", "input", "select", "open-change", "submit", "reach-start", "action", "error", "invoke"]
		for (const type of boxEvents) box.addEventListener(type, stopAtBox)
		const mountId = crypto.randomUUID()
		const worker = acquireWorker(owner)
		const { connection, dispose } = createGuardedReceiver(box, {
			owner,
			idPrefix: `sp-r${++boxes}-${mountId.slice(0, 8)}-`,
			warn: (message) => console.warn(`${label()}: ${message}`),
			fnFor: (handle, event) => () => {
				const e = currentEvent(event)
				if (e?.isTrusted) lastInteractionAt = Date.now()
				postToWorker(worker, {
					k: "fn",
					mountId,
					id: handle[FN],
					detail: summarize(e, event, undefined)
				})
			}
		})
		const unroute = routeMount(mountId, (m) => {
			if (m.k === "mutate") {
				try {
					connection.mutate(m.records as never)
				} catch (err) {
					// The rest of that batch is lost, and a box that stops
					// matching the component would lie from here on: stop, and say so.
					console.warn(`${label()}: refused a mutation — ${(err as Error).message}`)
					fatal = "the widget sent something this page could not show"
				}
			} else if (m.k === "error") {
				// The component threw handling an event; it is still mounted.
				console.warn(`${label()}: ${m.message}`)
			} else if (m.k === "failed") {
				console.warn(`${label()}: ${m.message}`)
				fatal = m.message
			}
		})
		const channel = new MessageChannel()
		wire.attach(channel.port1)
		postToWorker(worker, { k: "mount", mountId, entry: src, port: channel.port2 }, [channel.port2])
		const boxEl = box
		return () => {
			for (const type of boxEvents) boxEl.removeEventListener(type, stopAtBox)
			postToWorker(worker, { k: "unmount", mountId })
			unroute()
			dispose()
			wire.detach()
			releaseWorker(owner)
		}
	})
</script>

<div class="relative h-full w-full">
	<div
		bind:this={box}
		class="sp-remote-box h-full w-full overflow-auto {klass}"
		data-sp-owner={owner}
		style:contain="paint"
		aria-label={title}
		role="region"
	></div>
	{#if fatal}
		<div
			class="bg-surface-50-950 absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center"
			role="alert"
		>
			<Icons.TriangleAlert size={20} class="text-error-500" />
			<p class="text-surface-600-400 max-w-xs text-xs">
				This widget stopped and can't show anything. Reload the page to try it again — the
				extension's own message is in the browser console.
			</p>
		</div>
	{/if}
</div>
