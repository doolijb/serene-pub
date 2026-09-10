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
	import WidgetHost from "$lib/client/sessionLayout/WidgetHost.svelte"
	import WidgetStyleOverlay from "$lib/client/sessionLayout/WidgetStyleOverlay.svelte"
	import {
		effectiveWidgetSkin,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"
	import { nativeSurface } from "$lib/client/surfaces/registry"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { PlacementInput } from "$lib/shared/widgets/context"

	interface Props {
		instance: PanelInstance
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * This panel's measured cell geometry, threaded in by the zone that drew
		 * it (PLAN 25). Handed to whichever body this panel has: a native widget
		 * reads it off its ctx, a frame is pushed it. Absent only where no zone
		 * placed it (a pop-over flyout) — see `WidgetHost`'s `UNPLACED`.
		 */
		placement?: PlacementInput
		/** In the drawer overlay? Hides the drawer-pin, adds a close-drawer. */
		inDrawer?: boolean
		/**
		 * Which host owns placement. "grid" (default) shows the pack-era
		 * controls (reorder, send-to-drawer); "zone" hosts (SessionLayout)
		 * own placement themselves, so the title bar keeps only collapse +
		 * close and the drawered flag never suspends a frame.
		 */
		chrome?: "grid" | "zone"
		/**
		 * Suppress the panel's own title bar. Used when the panel sits inside a
		 * live tab group, where the tab already supplies the title (avoids the
		 * tab-label + panel-header double chrome).
		 */
		hideHeader?: boolean
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
		placement,
		inDrawer = false,
		chrome = "grid",
		hideHeader = false,
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

	/* ── the frame's skin (PLAN 25, ruled 2026-08-30) ────────────────────
	 * A frame widget is treated identically to a native one minus the iframe,
	 * so it resolves its skin through the SAME store `WidgetHost` uses — the
	 * pinned row, or the unsaved draft while its editor is open. Only the
	 * injection differs: `PluginFrame` posts it into the frame's own document
	 * as `{ t: "style" }` instead of writing a scoped `<style>` out here.
	 *
	 * Resolved HERE rather than inside `PluginFrame` because a frame surface is
	 * not always a widget: the page and session-view frames have no widget id to
	 * resolve against, and they pass no skin at all. */
	// Called for the subscription, not the value — the same reason WidgetHost
	// calls it: it is what starts the one fetch, and `effectiveWidgetSkin` reads
	// the same module state, so the derived below re-runs when the rows or the
	// pins land. Idempotent, so a panel that is not a frame pays nothing for it
	// beyond the call.
	widgetStylesStore()
	let frameSkin = $derived(
		instance.surface.kind === "frame"
			? effectiveWidgetSkin(instance.id)
			: undefined
	)
</script>

<!-- `relative` is the widget-style overlay's containing block (PLAN 25): the
     overlay is rendered by WidgetHost, whose own wrapper is `display: contents`
     and so has no box to position against. It changes nothing on its own — the
     panel card is the box a person points at, which is what the overlay covers. -->
<section
	class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden {isPrimary
		? ''
		: 'bg-surface-50-950 border-surface-200-800 rounded-lg border shadow-sm'}"
	data-panel-id={instance.id}
	tabindex="-1"
	aria-label={instance.title}
>
	{#if !isPrimary && !hideHeader}
	<!-- Title bar (secondary panels only; suppressed inside a tab group) -->
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
				skin={frameSkin}
				{placement}
				source={manager}
				{suspended}
				onAction={onFrameAction}
			/>
			<!-- The style controls for the frame, on the SAME terms a native
			     widget gets them (PLAN 25). Outside the iframe by construction,
			     which is the happy accident here: the skin being edited lands
			     inside the frame's document and so cannot restyle — or hide — the
			     controls you would use to take it back off. Renders nothing at all
			     outside Style mode. -->
			<WidgetStyleOverlay
				widgetId={instance.id}
				label={instance.title}
				mount="frame"
			/>
		{:else if NativeCmp}
			<!-- Provide the unified widget ctx around the native surface (PLAN
			     25). Additive: NativeCmp still gets its legacy props, and a
			     migrated one reads ctx via useWidgetContext(). Native passes the
			     LIVE message array (not the frame's snapshot) so ctx stays
			     reactive, the zone's measured `placement`, and the manager as
			     the session event source — the same three the frame branch above
			     posts over its port. A session-less panel (sessionId null) has
			     nothing to project, so it renders bare. -->
			{#if session}
				<WidgetHost
					widget={{
						id: instance.id,
						instanceId: instance.id,
						title: instance.title
					}}
					session={session as any}
					messages={((session as any)?.sessionMessages ?? []) as any}
					channels={instance.channels}
					props={{ panelId: instance.id, title: instance.title }}
					{placement}
					source={manager}
					onAction={onFrameAction}
				>
					<NativeCmp
						{sessionId}
						{session}
						channels={instance.channels}
					/>
				</WidgetHost>
			{:else}
				<NativeCmp {sessionId} {session} channels={instance.channels} />
			{/if}
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
