<script lang="ts">
	/**
	 * One session widget, remote (R79): its component running in its owner's
	 * UI worker (`ComponentMount`), inside the widget's skin scope and style
	 * controls (`WidgetHost`). Every session widget mounts through here —
	 * core's conversation and core's side widgets as much as a plugin's — so
	 * there is one way a widget is fed: the page's own inputs, narrowed by the
	 * widget wire to what the widget declared it reads (R75).
	 *
	 * The session is handed through whatever the widget reads: it names whose
	 * widget this is (the saved-state key), so a widget that does not read
	 * `session` is still filed under its own session. A mount no zone placed
	 * (a pop-over flyout) is told `UNPLACED` — one widget, one cell, touching
	 * every edge — never nothing.
	 *
	 * Mounted on first show (unit M, `whenFirstShown`): a widget hidden where
	 * it sits — a collapsed rail, a closed flyout, an inactive tab, an unseen
	 * mobile side — holds a bare placeholder, and starts no box, no worker and
	 * no module until it is first drawn; from then on it stays mounted. The
	 * conversation is `eager`: mounted at once, shown or not.
	 *
	 * Live reload (C6, P5): a new `src` — an authored component saved, so a
	 * new artifact URL — unmounts the component and mounts the new module in
	 * the SAME worker (`{#key src}`). Its saved view state survives: that is
	 * filed under the widget's id, not its module. No `src` (the component was
	 * switched off, deleted, or its compile failed) draws the widget as
	 * missing, as a disabled plugin's is.
	 */
	import * as Icons from "@lucide/svelte"
	import ComponentMount from "./ComponentMount.svelte"
	import { whenFirstShown } from "./firstShow"
	import WidgetHost from "$lib/client/sessionLayout/WidgetHost.svelte"
	import type { ComponentProps } from "svelte"
	import { projectMessageRow, type WidgetBaseSection, type WidgetSectionScope } from "@serene-pub/sdk"
	import {
		UNPLACED,
		type ActionsV1,
		type PlacementInput,
		type WidgetEventSource
	} from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import type { WireInputs } from "$lib/client/components/frames/widgetWire.svelte"

	interface Props {
		/** The widget's id (its skin and settings key) and its title. */
		widget: { id: string; title: string }
		/** The owning plugin's id, or `core`. */
		owner: string
		/**
		 * The component module: `/core-ui/<slug>`, `/plugin-ui/<owner>/<entry>`
		 * or `/authored-ui/<owner>/<artifact hash>.js`. None: drawn as missing.
		 */
		src: string | null | undefined
		/** The page's session — narrowed here to what every widget may see (`SessionV1`). */
		session?: { id: number; name?: string | null; sessionMessages?: unknown[] } | null
		channels?: string[]
		props?: Record<string, unknown>
		settings?: Record<string, unknown>
		/** The base sections it reads (R75); absent reads all. */
		reads?: readonly WidgetBaseSection[]
		grants?: readonly WidgetSectionScope[]
		scoped?: WireInputs["scoped"]
		placement?: PlacementInput
		source?: WidgetEventSource
		actions?: ActionsV1
		actionDispatch?: ActionDispatch
		suspended?: boolean
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
		 * `$lib/shared/widgets/messageBacking`) — core's conversation only.
		 */
		backing?: "card" | "glass" | "none"
		/** Mount at once, shown or not — the conversation. Otherwise on first show. */
		eager?: boolean
		/**
		 * This mount holds the page's own ids — a conversation mount the
		 * layout names (`ComponentMount`'s `pageIds`, brief 7b): one per
		 * set of channels, so no id is on the page twice.
		 */
		pageIds?: boolean
		/** The component failed or threw at runtime (`ComponentMount`). */
		onRuntimeError?: ComponentProps<typeof ComponentMount>["onRuntimeError"]
	}

	let {
		widget,
		owner,
		src,
		session,
		channels,
		props,
		settings,
		reads,
		grants,
		scoped,
		placement,
		source,
		actions,
		actionDispatch,
		suspended = false,
		onAction,
		class: klass,
		backing,
		eager = false,
		pageIds = false,
		onRuntimeError
	}: Props = $props()

	/** Drawn at least once (or `eager`): mounted from then on, never again unmounted by hiding. */
	// svelte-ignore state_referenced_locally
	let shown = $state(eager)
	let placeholder = $state<HTMLDivElement | null>(null)
	$effect(() => {
		if (shown || eager) {
			shown = true
			return
		}
		if (placeholder) return whenFirstShown(placeholder, () => (shown = true))
	})

	const sessionV1 = $derived(session ? { id: session.id, name: session.name ?? null } : undefined)
	/**
	 * The log, only to a widget that reads it (R75): one that does not never
	 * touches the array, so a token does not so much as wake it. A snapshot,
	 * because a snapshot reads every row: a streaming token changes a row in
	 * place, and only a deep read re-posts it. Each row is projected first
	 * (`projectMessageRow`, less `MESSAGE_HOST_FIELDS`), so the per-token clone
	 * never reads — let alone copies — an `embedding` vector or a `debugMeta`
	 * prompt; the wire's own projection then finds nothing left to strip.
	 */
	const readsMessages = $derived(!reads || reads.includes("messages"))
	const messages = $derived(
		readsMessages
			? ($state.snapshot((session?.sessionMessages ?? []).map(projectMessageRow)) as unknown[])
			: undefined
	)
</script>

<WidgetHost {widget}>
	{#if !src}
		<div
			class="text-surface-500 flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs"
			data-sp-missing=""
		>
			<Icons.PackageOpen size={20} />
			<span>This widget isn't available (it may be switched off).</span>
		</div>
	{:else if shown}
		<!-- A new module is a new mount, in the same worker (C6 P5). So is a
		     change of which conversation copy holds the page's ids (brief 7b):
		     a box's ids are fixed when it mounts, and the copy that gave the
		     ids up must take its prefix, or one id would be on the page twice. -->
		{#key pageIds ? `${src} page-ids` : src}
			<ComponentMount
				{owner}
				{src}
				title={widget.title}
				session={sessionV1}
				{messages}
				{channels}
				{props}
				{settings}
				{reads}
				{grants}
				{scoped}
				placement={placement ?? UNPLACED}
				{source}
				{actions}
				{actionDispatch}
				{suspended}
				surfaceId={widget.id}
				{pageIds}
				{onAction}
				{onRuntimeError}
				{backing}
				class={klass}
			/>
		{/key}
	{:else}
		<!-- Not yet drawn: nothing but a box to be drawn in. At least a pixel
		     each way, so being drawn is a resize its watcher hears. -->
		<div
			bind:this={placeholder}
			class="h-full w-full"
			style="min-inline-size:1px;min-block-size:1px"
			data-sp-unshown=""
		></div>
	{/if}
</WidgetHost>
