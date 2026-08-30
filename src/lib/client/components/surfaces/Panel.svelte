<script lang="ts">
	/**
	 * The panel chrome wrapper (plan 21 §6): one title bar + body for every
	 * panel, whether its body is a native Svelte component, a plugin frame, or
	 * the page-supplied primary conversation. The grid places the *slot* around
	 * this; the wrapper itself is placement-agnostic, so a panel dragged between
	 * grid and drawer never changes parent — the law that keeps frames from
	 * reloading (21 §4).
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import { nativeSurface } from "$lib/client/surfaces/registry"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"

	interface Props {
		instance: PanelInstance
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/** In the drawer overlay? Hides the drawer-pin, adds a close-drawer. */
		inDrawer?: boolean
		/**
		 * Which host owns placement. "grid" (default) shows the pack-era
		 * controls (reorder, send-to-drawer); "zone" hosts (SessionLayout)
		 * own placement themselves, so the title bar keeps only collapse +
		 * close and the drawered flag never suspends a frame.
		 */
		chrome?: "grid" | "zone"
		/** The primary conversation body, supplied by the session page. */
		primaryChildren?: Snippet
		onFrameAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>
		) => void
	}

	let {
		instance,
		manager,
		sessionId,
		session,
		inDrawer = false,
		chrome = "grid",
		primaryChildren,
		onFrameAction
	}: Props = $props()

	// Map the declared icon name to a lucide component, with a sensible floor.
	let IconCmp = $derived(
		(instance.icon && (Icons as any)[instance.icon]) ||
			(instance.role === "primary" ? Icons.MessagesSquare : Icons.LayoutPanelTop)
	)

	let NativeCmp = $derived(
		instance.surface.kind === "native"
			? nativeSurface(instance.surface.component)
			: undefined
	)

	// The primary conversation renders full-bleed — no title bar, no card
	// border — so the chat looks exactly as it does today. Only secondary
	// panels wear chrome (21 §5: primary is the anchor, not a widget).
	let isPrimary = $derived(instance.role === "primary")

	// A frame idles when it's collapsed, or drawered but not the open drawer —
	// suspended, never unmounted, so its state and port survive (21 §7).
	let suspended = $derived(
		instance.collapsed ||
			(chrome === "grid" &&
				instance.drawered &&
				manager.drawerOpenId !== instance.id)
	)
	// What crosses into the frame must be (a) minimal — the frame gets what
	// the host chooses, same posture as the session-view lane — and (b) plain
	// data: the live session is a Svelte state proxy graph, which
	// port.postMessage cannot structured-clone (DataCloneError).
	let frameSession = $derived(
		session
			? {
					id: (session as any).id,
					name: (session as any).name ?? null
				}
			: undefined
	)
	let frameMessages = $derived(
		$state.snapshot((session as any)?.sessionMessages ?? []) as unknown[]
	)
</script>

<section
	class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden {isPrimary
		? ''
		: 'bg-surface-50-950 border-surface-200-800 rounded-lg border shadow-sm'}"
	data-panel-id={instance.id}
	tabindex="-1"
	aria-label={instance.title}
>
	{#if !isPrimary}
	<!-- Title bar (secondary panels only) -->
	<header
		class="preset-tonal-surface border-surface-200-800 flex shrink-0 items-center gap-1.5 border-b px-2 py-1"
	>
		{#if instance.layout.collapsible}
			<button
				class="hover:preset-tonal-primary text-surface-600-400 rounded p-0.5 transition-colors"
				onclick={() => manager.toggleCollapse(instance.id)}
				title={instance.collapsed ? "Expand" : "Collapse"}
				aria-label={instance.collapsed ? "Expand panel" : "Collapse panel"}
			>
				<IconCmp size={14} />
			</button>
		{:else}
			<span class="text-surface-600-400 p-0.5"><IconCmp size={14} /></span>
		{/if}
		<span class="min-w-0 flex-1 truncate text-xs font-semibold">
			{instance.title}
		</span>

		<!-- Controls: reorder / pin-to-drawer / close. Primary shows none. -->
		{#if instance.role !== "primary"}
			{#if chrome === "zone"}
				<!-- zone hosts place panels; no reorder/drawer controls -->
			{:else if inDrawer}
				<button
					class="hover:preset-tonal-primary text-surface-600-400 rounded p-0.5 transition-colors"
					onclick={() => manager.closeDrawer()}
					title="Close drawer"
					aria-label="Close drawer"
				>
					<Icons.PanelRightClose size={14} />
				</button>
			{:else}
				<button
					class="hover:preset-tonal-primary text-surface-600-400 rounded p-0.5 transition-colors"
					onclick={() => manager.reorder(instance.id, -1.5)}
					title="Move earlier"
					aria-label="Move panel earlier"
				>
					<Icons.ChevronUp size={14} />
				</button>
				<button
					class="hover:preset-tonal-primary text-surface-600-400 rounded p-0.5 transition-colors"
					onclick={() => manager.toggleDrawer(instance.id)}
					title="Send to drawer"
					aria-label="Send panel to drawer"
				>
					<Icons.PanelRight size={14} />
				</button>
			{/if}
			{#if instance.layout.closable}
				<button
					class="hover:preset-tonal-error text-surface-600-400 rounded p-0.5 transition-colors"
					onclick={() => manager.close(instance.id)}
					title="Close panel"
					aria-label="Close panel"
				>
					<Icons.X size={14} />
				</button>
			{/if}
		{/if}
	</header>
	{/if}

	<!-- Body: hidden when collapsed (kept mounted — never unmount a frame).
	     The primary manages its own scroll (the log + composer), so it isn't
	     given `overflow-auto` here. -->
	<div
		class="min-h-0 flex-1 {isPrimary ? '' : 'overflow-auto'}"
		class:hidden={!isPrimary && instance.collapsed}
	>
		{#if isPrimary && primaryChildren}
			{@render primaryChildren()}
		{:else if instance.surface.kind === "frame" && instance.src}
			<PluginFrame
				src={instance.src}
				title={instance.title}
				surface="panel"
				session={frameSession}
				channels={instance.channels}
				messages={frameMessages}
				props={{ panelId: instance.id, title: instance.title }}
				{suspended}
				onAction={onFrameAction}
			/>
		{:else if NativeCmp}
			<NativeCmp
				{sessionId}
				{session}
				channels={instance.channels}
			/>
		{:else}
			<!-- Unknown surface: a labeled floor, never a crash (21 §6). -->
			<div
				class="text-surface-500 flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs"
			>
				<Icons.PackageOpen size={20} />
				<span>
					This panel's surface isn't available
					{#if instance.surface.kind === "frame"}(its plugin may be
						disabled){/if}.
				</span>
			</div>
		{/if}
	</div>
</section>
