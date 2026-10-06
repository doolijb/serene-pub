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
	 * inside the box; ids are prefixed per box — bar the conversation mounts
	 * the layout names `pageIds`; the widget skin applies to the box
	 * through `WidgetHost`.
	 */
	import { v4 as uuid } from "uuid"
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { SessionV1, WidgetBaseSection, WidgetSectionScope } from "@serene-pub/sdk"
	import type {
		ActionsV1,
		PlacementInput,
		WidgetEventSource
	} from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import {
		createWidgetWire,
		type WireInputs
	} from "$lib/client/components/frames/widgetWire.svelte"
	import { frameInvokeVerdict } from "$lib/client/components/frames/frameActivation"
	import { frameStateKey } from "$lib/client/components/frames/framePort"
	import { createGuardedReceiver, interactionAfter, summarize } from "./receiverPolicy"
	import {
		acquireWorker,
		currentEvent,
		listenForRemoteEvents,
		postToWorker,
		releaseWorker,
		routeMount
	} from "./uiWorkers"
	import { FN } from "@serene-pub/sdk"
	import { componentRuntimeError, type ComponentRuntimeError } from "./runtimeError"
	import { registerVoucher } from "$lib/client/components/hostElements/activation"

	interface Props {
		/** The owning plugin's id — whose worker this runs in. */
		owner: string
		/**
		 * The component module, same-origin: `/plugin-ui/<owner>/<entry>`, or
		 * core's own `/core-ui/<slug>`.
		 */
		src: string
		title: string
		session?: SessionV1
		messages?: unknown[]
		channels?: string[]
		props?: Record<string, unknown>
		settings?: Record<string, unknown>
		placement?: PlacementInput
		actions?: ActionsV1
		actionDispatch?: ActionDispatch
		source?: WidgetEventSource
		suspended?: boolean
		surfaceId?: string
		/**
		 * This mount holds the page's own ids (brief 7b, plan §M.3.8 as
		 * amended): a conversation mount the layout names — its primary log,
		 * and each copy showing channels no earlier one shows (the Lair's
		 * Sanctum) — whose `#message-<id>` the page navigates by (j/k, links,
		 * notifications). Honoured for core's conversation only; every other
		 * mount, a second view of one channel included, takes its box's
		 * prefix, so two copies showing one row never put one id on the page
		 * twice.
		 */
		pageIds?: boolean
		/** The scoped sections this component was granted, by name — posted as `scoped`. */
		scoped?: WireInputs["scoped"]
		/** The base sections it reads (R75) — only those are posted; absent posts all. */
		reads?: readonly WidgetBaseSection[]
		/**
		 * The scopes it was granted, bare — carried on its requests (F9) and
		 * told to the component (`ctx.grants`). Absent, it holds none, and is
		 * told so: the page is the authority on a remote's grants.
		 */
		grants?: readonly WidgetSectionScope[]
		onAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
		class?: string
		/**
		 * The message backing the host draws behind this widget (note 18;
		 * `$lib/shared/widgets/messageBacking`), as `data-sp-backing` on the
		 * box for widgets.css to paint. Absent: no attribute.
		 */
		backing?: "card" | "glass" | "none"
		/**
		 * The component failed or threw at runtime, as its worker reported it
		 * (C6 P5): `failed` — it never mounted (its module did not load, or
		 * its mount function threw) — or `error` — a handler threw after it
		 * mounted, and it is still mounted. `stack`, when the worker sent
		 * frames. The box handles both on its own either way; this only tells.
		 */
		onRuntimeError?: (e: ComponentRuntimeError) => void
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
		placement,
		actions,
		actionDispatch,
		source,
		suspended = false,
		surfaceId,
		pageIds = false,
		scoped,
		reads,
		grants,
		onAction,
		class: klass = "",
		backing,
		onRuntimeError
	}: Props = $props()

	/** Told, never trusted to return: a throwing listener is its own bug, not the box's. */
	function reportRuntimeError(message: unknown) {
		if (!onRuntimeError) return
		try {
			onRuntimeError(componentRuntimeError(message))
		} catch (err) {
			console.warn(`${label()}: onRuntimeError threw — ${(err as Error).message}`)
		}
	}

	let box = $state<HTMLDivElement | null>(null)
	let fatal = $state<string | null>(null)
	/** When the host last forwarded a trusted event from this box. Plain: read at the invoke. */
	let lastInteractionAt: number | null = null
	// A press inside a nested document (`sp-frame`) that its own live check
	// vouched for counts as a press here (hostElements/activation.ts).
	$effect(() => {
		if (box)
			return registerVoucher(box, () => (lastInteractionAt = Date.now()))
	})

	const stateKey = $derived(frameStateKey(session?.id, surfaceId ?? src))
	const label = () => `Remote "${title}" (${owner})`
	/**
	 * Core's own component: core's owner AND core's own module. A manifest
	 * can name a plugin anything the install lets through, but every plugin
	 * component's src is built under `/plugin-ui/` — so an owner string alone
	 * never earns core's trust.
	 */
	const coreTrusted = () => owner === "core" && src.startsWith("/core-ui/")
	/**
	 * Core's own CONVERSATION — the module the page navigates into
	 * (`#message-<id>`, j/k over `[id^="message-"]`), so kept to the paint its
	 * native copy had. Its ids are the page's only in a mount the layout
	 * names `pageIds` (`pageIdsHere`): a layout may place several copies of
	 * it (brief 7b) — it names each copy whose channels no earlier one shows
	 * (`channelClaims` `pageIdsHolders`) — and every other core module is a widget that
	 * may be on screen twice (a rail and its flyout). Those ids are their
	 * box's, as a plugin's are (F8), or two mounts would share element ids
	 * and radio names.
	 */
	const coreConversation = () => coreTrusted() && src === "/core-ui/messages"
	/** This mount keeps the page's ids: the conversation, named `pageIds`. */
	const pageIdsHere = () => pageIds && coreConversation()

	const wire = createWidgetWire({
		inputs: () => ({
			session,
			messages,
			channels,
			props,
			settings,
			placement,
			actions,
			source,
			suspended,
			stateKey,
			widgetId: surfaceId ?? src,
			owner: owner,
			scoped,
			reads,
			grants: grants ?? [],
			actionDispatch,
			onAction
		}),
		label,
		// Core's own component is core's code, as trusted as its native copy —
		// which no gate stands in front of. A plugin's presses are judged.
		gate: (action) =>
			coreTrusted()
				? { allowed: true }
				: frameInvokeVerdict(action, { lastInteractionAt }, Date.now()),
		trusted: coreTrusted,
		onFatal: (message) => (fatal = message)
	})

	let boxes = 0
	onMount(() => {
		if (!box) return
		// `core` names core's worker and core's box privileges: a component
		// claiming it from anywhere but core's own modules is not mounted.
		if (owner === "core" && !coreTrusted()) {
			console.warn(
				`${label()}: '${src}' is not core's own module — not mounted`
			)
			fatal = "this widget claims to be core's and is not"
			return
		}
		listenForRemoteEvents()
		// An sp element's own events bubble (a native page's `onchange` hears
		// them); from a remote's box they stop at the box — the component
		// hears them in its worker, and nothing of the page should.
		const stopAtBox = (e: Event) => {
			if (e instanceof CustomEvent) e.stopPropagation()
		}
		const boxEvents = [
			"change",
			"input",
			"select",
			"open-change",
			"submit",
			"reach-start",
			"action",
			"error",
			"invoke"
		]
		for (const type of boxEvents) box.addEventListener(type, stopAtBox)
		const mountId = uuid()
		// Named by its module, so a worker that has imported too many is
		// recycled (`uiWorkers.ts`, C6 P5); released by the worker it took.
		const worker = acquireWorker(owner, src)
		const { connection, dispose } = createGuardedReceiver(box, {
			owner,
			// A plugin's ids are its box's, so it can neither collide with nor
			// stand in for the page's — and so are every core widget's, every
			// copy of the conversation included. A conversation mount the
			// layout names `pageIds` keeps the ids its native copy had:
			// the page navigates by them (`#message-<id>`, j/k over
			// `[id^="message-"]`). Read once, at mount: the box's ids are its
			// receiver's, made here.
			idPrefix: pageIdsHere() ? "" : `sp-r${++boxes}-${mountId.slice(0, 8)}-`,
			warn: (message) => console.warn(`${label()}: ${message}`),
			fnFor: (handle, event) => () => {
				const e = currentEvent(event)
				lastInteractionAt = interactionAfter(event, e, lastInteractionAt, Date.now())
				postToWorker(worker, {
					k: "fn",
					mountId,
					id: handle[FN],
					detail: summarize(e, event, undefined)
				})
			}
		})
		/**
		 * Take the mount down — once, whichever asks first: a box that refused
		 * a batch shows nothing more (the guarded connection drops every later
		 * one), so its component is unmounted in the worker and the worker
		 * released then, not when the page leaves; the page's own teardown
		 * then has nothing left to do twice.
		 */
		let tornDown = false
		const tearDown = () => {
			if (tornDown) return
			tornDown = true
			unroute()
			dispose()
			wire.detach()
			postToWorker(worker, { k: "unmount", mountId })
			releaseWorker(owner, worker)
		}
		const unroute = routeMount(mountId, (m) => {
			if (m.k === "mutate") {
				try {
					connection.mutate(m.records as never)
				} catch (err) {
					// The rest of that batch is lost, and a box that stops
					// matching the component would lie from here on: stop, and say so.
					console.warn(
						`${label()}: refused a mutation — ${(err as Error).message}`
					)
					fatal = "the widget sent something this page could not show"
					tearDown()
				}
			} else if (m.k === "error") {
				// The component threw handling an event; it is still mounted.
				console.warn(`${label()}: ${m.message}`)
				reportRuntimeError(m.message)
			} else if (m.k === "failed") {
				// It never mounted, and nothing more will come: its worker-side
				// record goes and its worker is released now (unit M), not when
				// the page leaves.
				console.warn(`${label()}: ${m.message}`)
				fatal = m.message
				tearDown()
				reportRuntimeError(m.message)
			} else if (m.k === "wire") {
				// What the component sent on its port, behind the DOM it drew
				// that turn (the ordered outbox): handled as a port message.
				wire.receive(m.msg)
			}
		})
		const channel = new MessageChannel()
		wire.attach(channel.port1)
		postToWorker(
			worker,
			{ k: "mount", mountId, entry: src, port: channel.port2 },
			[channel.port2]
		)
		const boxEl = box
		return () => {
			for (const type of boxEvents)
				boxEl.removeEventListener(type, stopAtBox)
			tearDown()
		}
	})
</script>

<div class="relative h-full w-full">
	<!-- The box is the widget's whole cell, both ways (`h-full w-full` of a
	     cell that gives its child 100%), and it is a size QUERY container
	     named `sp-widget` (inline axis): a widget's stylesheet can answer the
	     width its layout gave it with `@container sp-widget (min-width: …)`
	     and size parts in `cqi`, rather than the viewport's width, which says
	     nothing about a rail or a strip. Inline-size only: a cell whose height
	     is its content's (a `fixed`-height strip) would measure a size
	     container as zero tall. A root that wants the full height sets
	     `block-size: 100%` — the box's height is definite.
	     A widget's markup paints inside its box and nowhere else — a plugin's
	     and core's alike. Core's own conversation is not held to that, as its
	     native copy was not: paint containment also hides a scrolled-off row's
	     backdrop from the page (axe cannot judge the contrast of those rows
	     through it).
	     `data-sp-card` is whether the host is drawing its card around this
	     widget (ruled 2026-09-27; `sessionLayout/hostCard`) — the same fact as
	     `layout.v1.chrome.card`, for a stylesheet to key off.
	     `data-sp-backing` is the message backing the host draws behind core's
	     conversation (card | glass | none; note 18) — widgets.css paints it. -->
	<div
		bind:this={box}
		class="sp-remote-box h-full w-full overflow-auto {klass}"
		data-sp-owner={owner}
		data-sp-widget-box=""
		data-sp-card={placement?.chrome?.card ? "on" : "off"}
		data-sp-backing={backing}
		style:contain={coreConversation() ? undefined : "paint"}
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
				This widget stopped and can't show anything. Reload the page to
				try it again — the extension's own message is in the browser
				console.
			</p>
		</div>
	{/if}
</div>

<style>
	/* See the box's comment. `container-type: inline-size` applies style and
	   inline-size containment only — not layout containment — so a `fixed`
	   modal inside the conversation still escapes to the viewport. */
	.sp-remote-box {
		container: sp-widget / inline-size;
	}
</style>
