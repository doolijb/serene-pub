<script lang="ts">
	/**
	 * The panel chrome wrapper (plan 21 §6): one title bar + body for every
	 * panel, whether its body is a remote component (core's or a plugin's), a
	 * plugin frame, or the page-supplied primary. The grid places the *slot* around
	 * this; the wrapper itself is placement-agnostic, so a panel dragged between
	 * grid and drawer never changes parent — the law that keeps frames from
	 * reloading (21 §4).
	 */
	import { getContext, type Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PluginFrame from "$lib/client/components/frames/PluginFrame.svelte"
	import RemoteWidget from "$lib/client/components/host/RemoteWidget.svelte"
	import WidgetStyleOverlay from "$lib/client/sessionLayout/WidgetStyleOverlay.svelte"
	import {
		effectiveWidgetSkin,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"
	import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
	import { resolveWidgetInstance } from "$lib/shared/widgets/settings"
	import {
		SCOPED_SECTION_CONTEXT_KEYS,
		withHostCard
	} from "$lib/shared/widgets/context"
	import {
		HOST_CARD_CLASS,
		hostCardShown
	} from "$lib/client/sessionLayout/hostCard"
	import {
		WIDGET_SCOPED_SECTIONS,
		projectMessageRow,
		widgetReads,
		type WidgetScopedSectionValues,
		type WidgetSectionScope
	} from "@serene-pub/sdk"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type {
		ActionsV1,
		PlacementInput
	} from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"

	interface Props {
		instance: PanelInstance
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * This panel's measured cell geometry, threaded in by the zone that drew
		 * it (PLAN 25). Handed to whichever body this panel has; a remote and a
		 * frame are each pushed it. Absent only where no zone placed it (a
		 * pop-over flyout), which `RemoteWidget` tells `UNPLACED`.
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
		/**
		 * Is this mount momentarily opened over the session — a pop-over, a
		 * flyout, the phone's panel sheet? Then it wears the host card whatever
		 * its Card setting says (ruled 2026-09-27; `sessionLayout/hostCard`).
		 */
		popover?: boolean
		/** The primary conversation body, supplied by the session page. */
		primaryChildren?: Snippet
		/**
		 * The session's action venues (`sessions:actions`; U5c review W4),
		 * handed to BOTH bodies as `actions.v1` — a frame over its port, a
		 * remote over its wire. Threaded from the page through
		 * `SessionLayout`. Absent (a panel outside a session), a body gets no
		 * venues and its `invoke` refuses everything by name.
		 */
		actions?: ActionsV1
		/** The host's routing for a press — core's verbs and its own fire (W4). */
		actionDispatch?: ActionDispatch
		onFrameAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
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
		popover = false,
		primaryChildren,
		actions,
		actionDispatch,
		onFrameAction
	}: Props = $props()

	/* This instance's settings (PLAN 25): the declaration and this user's stored
	   deviations, resolved once into the three things a host threads — the
	   header's title, the lane the subscription reads, and the settings the
	   widget is posted. Both bodies below read the same triple, so a frame
	   is a remote plus the iframe here too. */
	/**
	 * What this widget was granted beyond the base sections (C5, R21): each
	 * granted scope's section, read off the page context that supplies it
	 * (`SCOPED_SECTION_CONTEXT_KEYS`: the dossier for `session:full`, the
	 * session's state for `session:state`, the cast for `characters`) and
	 * filed under the name the SDK's table posts it as, and posted to the
	 * remote. A scope
	 * whose context the page does not set (or has not filled yet) is simply
	 * absent: "not granted", never an empty.
	 *
	 * The contexts are taken once, at init (Svelte's rule); only the granted
	 * ones are READ, so a widget holding no scope never computes a section.
	 */
	const scopedContexts = new Map(
		(Object.entries(SCOPED_SECTION_CONTEXT_KEYS) as Array<[WidgetSectionScope, string]>).map(
			([scope, key]) => [scope, getContext<{ current: unknown } | undefined>(key)] as const
		)
	)
	const grantedScoped = $derived.by(() => {
		const out: Record<string, unknown> = {}
		for (const scope of instance.grants ?? []) {
			const value = scopedContexts.get(scope)?.current
			if (value != null) out[WIDGET_SCOPED_SECTIONS[scope]] = value
		}
		return Object.keys(out).length ? (out as Partial<WidgetScopedSectionValues>) : undefined
	})
	/**
	 * Does this widget read the log (`reads`, R75)? One that does not is
	 * handed none — not snapshotted per token for a frame (F4).
	 */
	const readsMessages = $derived(widgetReads(instance).includes("messages"))

	let resolved = $derived(
		resolveWidgetInstance(
			{
				id: instance.id,
				title: instance.title,
				channels: instance.channels,
				settings: instance.settings
			},
			widgetSettingValues(instance.id)
		)
	)

	// Map the declared icon name to a lucide component, with a sensible floor.
	let IconCmp = $derived(
		(instance.icon && (Icons as any)[instance.icon]) ||
			(instance.role === "primary" ? Icons.MessagesSquare : Icons.LayoutPanelTop)
	)

	// The primary conversation renders full-bleed — no title bar, no card
	// border — so the chat looks exactly as it does today. Only secondary
	// panels wear chrome (21 §5: primary is the anchor, not a widget).
	let isPrimary = $derived(instance.role === "primary")

	/* ── the host card (ruled 2026-09-27; sessionLayout/hostCard) ─────────
	 * A widget placed in a session zone sits FLUSH: no surface, no border, no
	 * title bar — its own style decides. The card is its `hostCard` setting's,
	 * and always on while it is opened over the session (`popover`). The
	 * pack-era grid host (`chrome="grid"`) keeps its card: its reorder and
	 * drawer controls live in the title bar and have nowhere else to go.
	 *
	 * Classes on the SAME section, never a wrapper that comes and goes: a
	 * wrapper toggled by a setting would re-parent the body and reload its
	 * frame (21 §4). The widget is told the answer in its placement
	 * (`layout.v1.chrome.card`) and on its box (`data-sp-card`). */
	let card = $derived(
		!isPrimary &&
			(chrome === "grid" ||
				hostCardShown({ setting: resolved.settings.hostCard, popover }))
	)
	let showHeader = $derived(card && !hideHeader)
	let told = $derived(withHostCard(placement, card, showHeader))

	// A frame idles when it's collapsed, or drawered but not the open drawer —
	// suspended, never unmounted, so its state and port survive (21 §7).
	// A collapse is the title bar's control: a flush panel has none to undo
	// it with, so a collapse stored earlier does not strand it hidden.
	let suspended = $derived(
		(showHeader && instance.collapsed) ||
			(chrome === "grid" &&
				instance.drawered &&
				manager.drawerOpenId !== instance.id)
	)
	// What crosses into the frame must be (a) minimal — the frame gets what
	// the host chooses, same posture as the session-view lane — and (b) plain
	// data: the live session is a Svelte state proxy graph, which
	// port.postMessage cannot structured-clone (DataCloneError). Rows are
	// projected (less MESSAGE_HOST_FIELDS) BEFORE the snapshot, so the
	// per-token clone never walks an embedding vector or a debugMeta prompt.
	let frameSession = $derived(
		session
			? {
					id: (session as any).id,
					name: (session as any).name ?? null
				}
			: undefined
	)
	let frameMessages = $derived(
		readsMessages
			? ($state.snapshot(
					(((session as any)?.sessionMessages ?? []) as unknown[]).map(projectMessageRow)
				) as unknown[])
			: undefined
	)

	/* ── the frame's skin (PLAN 25, ruled 2026-08-30) ────────────────────
	 * A frame widget is treated identically to a remote one plus the iframe,
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
     overlay is rendered by WidgetHost (a remote's) or beside the frame; WidgetHost's own wrapper is `display: contents`
     and so has no box to position against. It changes nothing on its own — the
     panel card is the box a person points at, which is what the overlay covers. -->
<section
	class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden {card
		? HOST_CARD_CLASS
		: ''}"
	data-panel-id={instance.id}
	data-sp-card={isPrimary ? undefined : card ? "on" : "off"}
	tabindex="-1"
	aria-label={resolved.title}
>
	{#if showHeader}
	<!-- Title bar (secondary panels only; suppressed inside a tab group) -->
	<header
		class="preset-tonal-surface border-surface-200-800 flex shrink-0 items-center gap-1.5 border-b px-2 py-1"
	>
		{#if instance.layout.collapsible}
			<button
				class="hover:preset-tonal-primary text-surface-600-400 rounded p-0.5 transition-colors"
				onclick={() => manager.toggleCollapse(instance.id)}
				title={instance.collapsed ? "Expand" : "Collapse"}
				aria-label={instance.collapsed ? "Expand widget" : "Collapse widget"}
			>
				<IconCmp size={14} />
			</button>
		{:else}
			<span class="text-surface-600-400 p-0.5"><IconCmp size={14} /></span>
		{/if}
		<span class="min-w-0 flex-1 truncate text-xs font-semibold">
			{resolved.title}
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
					aria-label="Move widget earlier"
				>
					<Icons.ChevronUp size={14} />
				</button>
				<button
					class="hover:preset-tonal-primary text-surface-600-400 rounded p-0.5 transition-colors"
					onclick={() => manager.toggleDrawer(instance.id)}
					title="Send to drawer"
					aria-label="Send widget to drawer"
				>
					<Icons.PanelRight size={14} />
				</button>
			{/if}
			{#if instance.layout.closable}
				<button
					class="hover:preset-tonal-error text-surface-600-400 rounded p-0.5 transition-colors"
					onclick={() => manager.close(instance.id)}
					title="Close widget"
					aria-label="Close widget"
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
		class:hidden={showHeader && instance.collapsed}
	>
		{#if isPrimary && primaryChildren}
			{@render primaryChildren()}
		{:else if instance.surface.kind === "frame" && instance.src}
			<PluginFrame
				src={instance.src}
				title={resolved.title}
				surface="panel"
				session={frameSession}
				channels={resolved.channels}
				messages={frameMessages}
				props={{ panelId: instance.id, title: resolved.title }}
				settings={resolved.settings}
				skin={frameSkin}
				surfaceId={instance.id}
				reads={instance.reads}
				placement={told}
				source={manager}
				{actions}
				{actionDispatch}
				{suspended}
				onAction={onFrameAction}
			/>
			<!-- The style controls for the frame, on the SAME terms a remote
			     widget gets them (PLAN 25). Outside the iframe by construction,
			     which is the happy accident here: the skin being edited lands
			     inside the frame's document and so cannot restyle — or hide — the
			     controls you would use to take it back off. Renders nothing at all
			     outside Style mode. -->
			<WidgetStyleOverlay
				widgetId={instance.id}
				label={resolved.title}
				mount="frame"
			/>
		{:else if instance.surface.kind === "remote"}
			<!-- A remote component — core's or a plugin's — run in its owner's
			     UI worker and mirrored through the host-element allowlist (§3.5,
			     R79). Its data is the frame's: a remote is a frame minus the
			     document. Mounted once the session is here, for its projection —
			     a primary at once, any other on first show (unit M). With no
			     module (an authored component switched off, deleted or saved
			     broken: C6 P5) `RemoteWidget` draws its own missing floor. -->
			{#if session}
				<RemoteWidget
					widget={{ id: instance.id, title: resolved.title }}
					owner={instance.surface.owner}
					src={instance.src}
					session={session as any}
					channels={resolved.channels}
					props={{ panelId: instance.id, title: resolved.title }}
					settings={resolved.settings}
					reads={instance.reads}
					grants={instance.grants}
					scoped={grantedScoped}
					placement={told}
					source={manager}
					{actions}
					{actionDispatch}
					{suspended}
					onAction={onFrameAction}
					eager={isPrimary}
				/>
			{/if}
		{:else}
			<!-- Unknown surface: a labeled floor, never a crash (21 §6). -->
			<div
				class="text-surface-500 flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs"
			>
				<Icons.PackageOpen size={20} />
				<span>This widget isn't available (its plugin may be disabled).</span>
			</div>
		{/if}
	</div>
</section>
