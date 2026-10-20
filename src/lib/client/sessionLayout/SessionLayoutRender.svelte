<script lang="ts" module>
	/**
	 * The conversation's channel declaration: none, i.e. the whole log, for
	 * every copy (S1: a copy's channels narrow its DOSSIER, the model's
	 * `dossierFor`, because a declared list switches the wire to per-lane
	 * posts the conversation does not read). A constant, not an `[]` literal:
	 * a widget host SUBSCRIBES against it, and a fresh literal on every
	 * re-render would rebuild that subscription on every message.
	 */
	const ALL_CHANNELS: string[] = []
</script>

<script lang="ts">
	/**
	 * The LIVE session layout: the drawn layout, mounted. The conversation and every widget around it come
	 * from the model (./sessionLayoutModel — the SDK's `resolveDrawn` over the
	 * stored layout, at the measured width); this component only measures,
	 * mounts, and holds the transient UI state of the live view — the tucked
	 * flyout, the phone's sheets and panels menu.
	 *
	 * Every zone is PANELS (PLAN-session-panels-2026-10-14): the middle's
	 * strips above, its primary panel (it fills), its strips below; a side's
	 * column of panels and its rail. A panel is drawn by ./PanelTabs — a tab
	 * strip when it holds two or more widgets, the widget's own chrome when it
	 * holds one — and the pin rule is the panel's: docked, or in the rail.
	 * Each side is ONE mount (./SideMount, the no-reload law).
	 *
	 * Widgets are the same PanelInstances the SurfaceManager owns, rendered
	 * through Panel (chrome="zone") — and the conversation through core's own
	 * remote component — so remote/frame surfaces and channel wiring are
	 * untouched. Every mount is in THIS file (the `middleWidget` and
	 * `livePanel` snippets), and each is handed the session's venues
	 * (`actions`) and the page's dispatch (`actionDispatch`) as props, never a
	 * context.
	 *
	 * Nothing here writes the layout but a panel's own controls — the tab a
	 * person opens and its pin — which go through the manager
	 * (`setPanelOpen`, `setPanelPinned`); the editor never writes this
	 * component's state.
	 */
	import * as Icons from "@lucide/svelte"
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { DrawnInstance, DrawnPanel } from "@serene-pub/sdk"
	import PanelTabs from "./PanelTabs.svelte"
	import { openWidgetSettings } from "./widgetSettingsModal.svelte"
	import { createStageBalance } from "./stageBalance.svelte"
	import { HOST_CARD_CLASS, hostCardShown } from "./hostCard"
	import { mobileSidePanels } from "./mobileSidePanels.svelte"
	import { createLiveFlyouts } from "./liveFlyouts.svelte"
	import {
		BODY_GAP_PX,
		type SessionLayoutModel
	} from "./sessionLayoutModel.svelte"
	import type { WidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import SideMount, { type PanelAt } from "./SideMount.svelte"
	import PanelsMenu from "./PanelsMenu.svelte"
	import RemoteWidget from "$lib/client/components/host/RemoteWidget.svelte"
	import { CORE_CONVERSATION } from "$lib/client/components/sessionPage/coreWidgets"
	import { effectiveWidgetSkin } from "$lib/client/stores/widgetStyles.svelte"
	import {
		BACKING_MODE_KEY,
		declaredBacking,
		resolveBacking
	} from "$lib/shared/widgets/messageBacking"
	import type { ActionsV1, PlacementInput } from "$lib/shared/widgets/context"
	import { withHostCard } from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import { isInstanceOf } from "@serene-pub/sdk"
	// The session header furled (note 29): the top strips roll up with it.
	import { shellPrefs } from "$lib/client/shell/shellPrefs.svelte"
	// 🚧 A dot on a tab with news (PLAN-dc-after-walk2 Q3-3).
	import { createTabAttention } from "./tabAttention.svelte"
	import { laneClaimOf } from "./channelClaims"
	import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
	import { getContext } from "svelte"

	interface Props {
		model: SessionLayoutModel
		flow: WidgetSettingsFlow
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * The session's action venues — the one source, threaded to EVERY
		 * widget mount here (the conversation's own host, every `Panel`) so
		 * `actions.v1` is the same table whichever mount reads it. A prop, never
		 * a context: the page hands the other half of this pair as one.
		 */
		actions?: ActionsV1
		/** The page's routing for a press — core's verbs and its own fire (W4). */
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
		model,
		flow,
		manager,
		sessionId,
		session,
		actions,
		actionDispatch,
		onFrameAction
	}: Props = $props()

	/* ── 🚧 a dot on a tab with news (PLAN-dc-after-walk2 Q3-3; ./tabAttention) ──
	 * A conversation copy's tab claims a channel; while another tab is shown,
	 * a line somebody else wrote there puts a dot on it — the walk's secret,
	 * death and question on Planner said nothing while the Story was up. */
	const attentionUser: UserCtx | undefined = getContext("userCtx")
	const tabAttention = createTabAttention(
		(id) => widgetSettingValues(id),
		// A Planner tab shows the viewer's own lane: the others' an owner also
		// receives are never its news.
		(id) =>
			laneClaimOf(widgetSettingValues(id), {
				viewerId: attentionViewer,
				annex: null,
				channels: ((session as { channels?: unknown } | null | undefined)?.channels ?? null) as never
			})
	)
	let attentionRows = $derived(
		((session as { sessionMessages?: unknown } | null | undefined)?.sessionMessages ?? []) as {
			id: number
			channel?: string | null
			userId?: number | null
		}[]
	)
	let attentionViewer = $derived(attentionUser?.user?.id ?? null)
	$effect(() => {
		tabAttention.observe(model.drawn, attentionRows, attentionViewer)
	})

	/** `.live-body`: what the live view's own queries are scoped to. */
	let liveEl: HTMLDivElement | null = $state(null)

	/* ── the centred stage (ruled 2026-09-27; ./stageBalance) ──────────── */
	let centerEl: HTMLDivElement | null = $state(null)
	const stage = createStageBalance({
		get model() {
			return model
		},
		get centerEl() {
			return centerEl
		}
	})

	/* ── each middle panel's measured box, for its placement ──────────────
	 * Measured per panel rather than divided out of the zone: a flex item's
	 * real size is the browser's answer. Unmeasured → 0 → `compact`, corrected
	 * by an ordinary `layout:changed`. */
	let midWidths = $state<Record<string, number>>({})
	let midHeights = $state<Record<string, number>>({})
	/** The middle's panels in reading order: above, the primary, below. */
	let middlePanels = $derived([
		...model.middle.above,
		model.middle.primary,
		...model.middle.below
	])
	/**
	 * A strip's box in the middle's column (PLAN-session-panels §1.3): `fit`
	 * its content (capped, so a long one scrolls instead of pushing the
	 * conversation away), `fill` an equal share with the primary panel, and
	 * `{ share }` its twelfths of the middle's height.
	 */
	function stripStyle(p: DrawnPanel): string {
		const h = p.height
		if (typeof h === "object")
			return `flex:0 0 calc(${Math.min(12, Math.max(1, h.share))} / 12 * 100%);`
		if (h === "fit") return "flex:0 1 auto;max-block-size:40%;"
		return "flex:1 1 0;"
	}

	/* ── the tucked flyout (./liveFlyouts) ───────────────────────────────── */
	const flyouts = createLiveFlyouts({
		get model() {
			return model
		},
		get manager() {
			return manager
		},
		get liveEl() {
			return liveEl
		}
	})
	/**
	 * Put every flyout away. What the editor's starting points ask for,
	 * through the composition root: the editor never writes this component's
	 * state. (The argument is the ⏳ old editor's zone id, not read.)
	 */
	export function putAway(_zoneId?: string) {
		flyouts.putAway()
	}
	/**
	 * A side panel docked or moved to the rail, from its own pin: saved with
	 * the layout. Its transient open state goes back to the default the pin
	 * gives it — docked is open, in the rail is an icon — and a tucked
	 * flyout of it is put away.
	 */
	function setPinned(side: "left" | "right", key: string, pinned: boolean) {
		manager.setPanelPinned(key, pinned)
		delete model.rail.groupOpen[model.rail.groupKey(side, key)]
		if (model.rail.groupFocus[side] === key) model.rail.groupFocus[side] = null
		if (flyouts.tuckedOpen(side, key)) flyouts.closeTucked(false)
	}
	/** A tab chosen: the panel's `open`, written to the layout at once. */
	function selectTab(key: string, tab: string) {
		manager.setPanelOpen(key, tab)
	}
	/** A tab's gear: the widget settings flow, the one modal. */
	function openSettings(tab: string, trigger: HTMLElement) {
		openWidgetSettings({ widgetId: tab, label: flow.widgetLabel(tab) }, trigger)
	}

	/* ── the phone's sheets (./PanelsMenu) ─────────────────────────────────
	 * Each side's wrapper, by side. The overlay's dialog IS the open side's one
	 * mount (./SideMount), not a second render of it, so there is no single
	 * element to bind for the focus trap: which wrapper is the dialog changes
	 * with the sheet. The middle's sheet (QE, `centerSlot`) is `.layout-center`
	 * itself. */
	let sideEls = $state<Record<"left" | "right", HTMLDivElement | null>>({
		left: null,
		right: null
	})
	let mobileOverlayEl = $derived(
		model.mobileSide === "middle"
			? centerEl
			: model.mobileSide
				? sideEls[model.mobileSide]
				: null
	)

	/** alt+[ / alt+]: open every rail panel that fits, or put them all away. */
	function setAllGroups(open: boolean) {
		for (const side of ["left", "right"] as const) {
			for (const p of model.sides[side].panels)
				model.rail.groupOpen[model.rail.groupKey(side, p.key)] = open
			// No focus, so nothing flies out: "expand everything" fills the
			// column and leaves what does not fit as icons.
			model.rail.groupFocus[side] = null
		}
		// "Put them all away" includes the one flying out over the session.
		if (!open) flyouts.putAway()
	}
	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey) return
			if (e.key !== "[" && e.key !== "]") return
			const t = e.target as HTMLElement | null
			// Never steal the bracket from someone writing a message.
			if (
				t?.isContentEditable ||
				(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
			)
				return
			e.preventDefault()
			setAllGroups(e.key === "[")
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})
</script>

<!-- Unified live widget renderer: turns a widget id into its real content, so
     ANY widget renders correctly in ANY zone (a panel dragged into the middle,
     or chat dragged into a side, still draws). `placement` is the cells the
     zone that drew this widget placed it at (PLAN 25); a caller with none (a
     pop-over flyout) is told `UNPLACED` by `RemoteWidget`. -->
{#snippet middleWidget({
	id,
	bare = false,
	placement,
	popover = false
}: {
	id: string
	bare?: boolean
	placement?: PlacementInput
	/** Momentarily opened over the session: carded whatever the setting (./hostCard). */
	popover?: boolean
})}
	{#if isInstanceOf(id, "messages")}
		<!-- The `messages` widget — the log, the field you write into, and
		     the strips beside it — is core's own remote component (C7, R79),
		     mounted like every other widget: same skin, same Style-mode overlay,
		     the same inputs a panel gets, narrowed to what it declares it reads
		     (K12). So is every COPY of it a layout places (`messages#sanctum`,
		     S1), under its own id, settings and pins. `channels` stays empty:
		     each copy is handed the whole log and draws its own channels' rows
		     (`dossierFor`). `eager`: the conversation mounts at once, shown or
		     not (every other widget mounts on first show). Nothing to show until
		     the session is here. -->
		{@const r = flow.resolvedWidget(id)}
		<!-- Each copy is told its own channels (S1): the Sanctum copy the
		     Sanctum, the story's log what no copy claims. -->
		{@const copyDossier = model.dossierFor(id)}
		<!-- The conversation has no panel around it. Opened over the session
		     (a pop-over) its box wears the host card (./hostCard) — the same
		     classes, never a wrapper that comes and goes (that would remount
		     it). Placed, its Card setting is a backing mode (note 18;
		     $lib/shared/widgets/messageBacking): Auto follows what its message
		     style declares, On / Off are the person's word, and the pane is
		     drawn by widgets.css from `data-sp-backing` in the theme's look. -->
		{@const carded = hostCardShown({ setting: false, popover })}
		{@const backing = carded
			? "none"
			: resolveBacking({
					mode: r.settings[BACKING_MODE_KEY],
					declared: declaredBacking(effectiveWidgetSkin(id)),
					background: !!copyDossier?.appBackground
				})}
		{#if session}
			<RemoteWidget
				widget={{ id, title: r.title }}
				owner="core"
				src={CORE_CONVERSATION.src}
				session={session as any}
				channels={ALL_CHANNELS}
				props={{ widgetId: id, title: r.title }}
				settings={r.settings}
				reads={CORE_CONVERSATION.reads}
				placement={withHostCard(
					placement,
					carded || backing === "card",
					false
				)}
				{backing}
				source={manager}
				{actions}
				{actionDispatch}
				onAction={onFrameAction}
				grants={["session:full"]}
				scoped={copyDossier ? { session_full: copyDossier } : undefined}
				class="h-full {carded ? HOST_CARD_CLASS : ''}"
				eager
				pageIds={model.pageIdsHeld.has(id)}
			/>
		{/if}
	{:else}
		{@const p = model.inst(id)}
		<!-- A primary here is a genre's own middle (R71: it withheld the
		     conversation — Battleship's board), drawn bare like the log is. -->
		{#if p && (p.role !== "primary" || manager.omitted.has("messages"))}
			<Panel
				instance={p}
				title={flow.titleApart.get(p.id)}
				{manager}
				{sessionId}
				{session}
				{placement}
				chrome="zone"
				hideHeader={bare || p.role === "primary"}
				{popover}
				{actions}
				{actionDispatch}
				{onFrameAction}
			/>
		{/if}
	{/if}
{/snippet}

<!-- One PANEL, wherever it is drawn — a side's column, the middle's strips,
     its primary — through ./PanelTabs: its tabs (a strip when two or more),
     its pin (sides only) and the gear for the active tab. Every tab shares
     the panel's ONE box, so they share its placement. -->
{#snippet livePanel(
	p: DrawnPanel,
	at: {
		zone: "left" | "middle" | "right"
		index: number
		count: number
		widthPx: number
		heightPx?: number
	},
	popover: boolean
)}
	{@const side = at.zone === "middle" ? null : at.zone}
	<!-- The conversation alone in the primary panel wears no corner gear: a
	     control hovering over the whole session would sit on the messages
	     themselves. Its settings open from the editor, as before. Any other
	     widget as the primary (R-B: the primary is a place) keeps its gear. -->
	{@const lonePrimary =
		p === model.middle.primary &&
		p.tabs.length === 1 &&
		model.isConversation(p.tabs[0].instanceId)}
	{#snippet pane(t: DrawnInstance, multi: boolean)}
		{@render middleWidget({
			id: t.instanceId,
			bare: multi,
			placement: model.rail.panelPlacement(
				p,
				{ index: at.index, count: at.count },
				t.instanceId,
				at.widthPx,
				at.heightPx
			),
			popover
		})}
	{/snippet}
	<PanelTabs
		panel={p}
		dots={tabAttention.dots(p, attentionRows, attentionViewer)}
		label={(id) => flow.widgetLabel(id)}
		pinnable={side !== null && !p.key.startsWith("x:")}
		controls={!model.editing && !p.floor}
		onSelect={(tab) => selectTab(p.key, tab)}
		onPin={side ? (pinned) => setPinned(side, p.key, pinned) : undefined}
		onSettings={lonePrimary ? undefined : openSettings}
		{pane}
	/>
{/snippet}

<!-- A side's panel (./SideMount draws the cell around it). -->
{#snippet sidePanel(p: DrawnPanel, at: PanelAt, popover: boolean)}
	{@render livePanel(
		p,
		{
			zone: at.side,
			index: at.index,
			count: at.count,
			widthPx: at.widthPx,
			heightPx: at.heightPx
		},
		popover
	)}
{/snippet}

<!-- ── the live session: ONE mount, drawn or stowed ─────────────────────
     Never the other arm of an `{#if}` with the editor's canvas: a switch to
     or from the Arrange tab would rebuild the whole session, reloading every
     iframe (the reload ./sideSlot forbids, one level up). The canvas is drawn
     over it; `.live-body` is `display: contents` while drawn and
     `display: none` while stowed. Everything FIXED in the session — flyouts,
     the phone's sheet, scrims, the panels menu — is inside this subtree, so it
     vanishes with it: no box, no tab stop, no a11y tree, no `inert` needed. -->
<div class="live-body" class:body-stowed={model.liveStowed} bind:this={liveEl}>
	<div
		class="layout-body"
		class:sides-tucked={model.sidesAreTucked}
		bind:this={model.bodyEl}
	>
		<!-- The left side, mounted ONCE. Its slot says whether it is drawn in
		     the flow here, stowed (mobile — P6: no rail, no icon strip, the
		     centre gets the full width), the phone's sheet, or the stage. -->
		<SideMount
			side="left"
			slot={model.leftSlot}
			{model}
			panel={sidePanel}
			flowEdge={stage.flowEdge}
			{flyouts}
			bind:el={sideEls.left}
		/>

		<!-- The middle zone runs side to side and carries the balance that
		     centres the column on the body (./tuckedSides rule (1)); the
		     conversation reads it, so its scroll region covers it.
		     While a SIDE is the stage (QE, `stageSide`) the middle stands down
		     around its one mount, like a side does: Stage only marks it hidden,
		     and the phone stows it (`centerSlot`) or opens it as a sheet from
		     the panels menu ("Middle") — the same element wearing
		     `.zone-flyout.mobile`, never a second render. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="layout-center"
			class:center-stowed={model.centerSlot === "stowed"}
			class:center-sheet={model.centerSlot === "overlay"}
			class:zone-flyout={model.centerSlot === "overlay"}
			class:mobile={model.centerSlot === "overlay"}
			role={model.centerSlot === "overlay" ? "dialog" : undefined}
			aria-modal={model.centerSlot === "overlay" ? "true" : undefined}
			aria-label={model.centerSlot === "overlay"
				? "Middle panels"
				: undefined}
			tabindex={model.centerSlot === "overlay" ? -1 : undefined}
			data-pop-keep={model.centerSlot === "overlay" ? "" : undefined}
			data-stage-hidden={model.stageOnly && model.stageSide
				? ""
				: undefined}
			bind:this={centerEl}
			style:--sp-stage-balance-start="{stage.stageBalance.start}px"
			style:--sp-stage-balance-end="{stage.stageBalance.end}px"
			style:margin-inline-start={stage.middleOverGap.start &&
			model.centerSlot === "flow"
				? `-${BODY_GAP_PX}px`
				: undefined}
			style:margin-inline-end={stage.middleOverGap.end &&
			model.centerSlot === "flow"
				? `-${BODY_GAP_PX}px`
				: undefined}
		>
			{#if model.centerSlot === "overlay"}
				<!-- The middle sheet's chrome: its own nodes, added at their
				     anchor; the mount below never moves. -->
				<div class="zone-head">
					<span class="zone-label always">Middle</span>
					<span class="flex-1"></span>
					<button
						class="zone-head-btn"
						title="Close"
						aria-label="Close middle panels"
						onclick={() => mobileSidePanels.close()}
					>
						<Icons.X size={16} />
					</button>
				</div>
			{/if}
			<!-- The layout attribute is TRANSITIONAL (./widgetSettingsFlow
			     `msgLayoutAttr`): written from the RESOLVED style so CSS outside
			     this repo that still keys on a pack name keeps working for one
			     release. The measure of the message column belongs to the
			     `messages` widget, which centres its own stage inside whatever
			     width this zone gives it.
			     The middle is a column of panels: the strips above, the primary
			     panel (it fills), the strips below. Strips never pin. -->
			<div class="chat-core" data-msg-layout={flow.msgLayoutAttr}>
				{#each middlePanels as p, i (p.key)}
					{@const primary = p === model.middle.primary}
					{@const above = i < model.middle.above.length}
					<!-- Stage only draws the panel holding the middle's stage, alone
					     and filling; with none holding it, the primary panel. -->
					{@const isStage =
						model.stageOnly && model.stageMiddleKey === p.key}
					<!-- A strip above is a header row: it rolls up with a
					     furled session header (note 29), except while the
					     layout is being edited. -->
					<div
						class="mid-panel"
						class:primary
						data-panel-place={primary ? "primary" : above ? "above" : "below"}
						bind:clientWidth={midWidths[p.key]}
						bind:clientHeight={midHeights[p.key]}
						style={primary || isStage ? "flex:1 1 0;" : stripStyle(p)}
						data-stage-hidden={(model.stageOnly &&
							(model.stageMiddleKey !== null ? !isStage : !primary)) ||
						(above && shellPrefs.headerFurled && !model.editing)
							? ""
							: undefined}
					>
						{#if p.tabs.length}
							{@render livePanel(
								p,
								{
									zone: "middle",
									index: i,
									count: middlePanels.length,
									widthPx: midWidths[p.key] ?? 0,
									heightPx: midHeights[p.key] ?? 0
								},
								false
							)}
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- The right side, mounted ONCE — same deal as the left above. Both
		     keep their DOM position around `.layout-center`: the wrapper is
		     `display: contents` in the flow, so where it sits in this list only
		     decides which side of the centre it lands on — and in the mobile
		     sheet it is out of flow entirely. -->
		<SideMount
			side="right"
			slot={model.rightSlot}
			{model}
			panel={sidePanel}
			flowEdge={stage.flowEdge}
			{flyouts}
			bind:el={sideEls.right}
		/>

		<!-- The phone's panels menu and the sheet's backdrop (P6; ruled
		     2026-09-10). The sheet itself is a side's own mount (./SideMount's
		     `overlay` slot) or the middle, never a second render. -->
		<PanelsMenu {model} {flow} {liveEl} sheetEl={mobileOverlayEl} />
	</div>
</div>

<style>
	/* The whole width, uncapped, and no padding: the balance that centres the
	   column belongs to the middle zone (`measureStage`, ./tuckedSides). */
	.layout-body {
		position: relative;
		display: flex;
		flex: 1;
		inline-size: 100%;
		gap: 0.5rem;
		min-block-size: 0;
		overflow: hidden; /* clip flyouts sliding past the edges */
	}
	/* The live session's one mount. `display: contents` for the same reason
	   a side's inline slot has it: the wrapper exists only so the subtree can
	   be stowed whole, and it must not be a box the layout never had —
	   `.layout-body` stays the flex child of `.session-layout` it has always
	   been. Stowed (under the Arrange tab's canvas) it is ./SideMount's
	   `.slot-stowed`, for the whole session: no box, still MOUNTED. */
	.live-body {
		display: contents;
	}
	.live-body.body-stowed {
		display: none;
	}
	/* The middle while a side is the phone's stage: stowed like a side is —
	   mounted, no box — or opened as its own sheet from the panels menu. The
	   sheet's box is `.zone-flyout.mobile`'s; `position` is restated because
	   `.layout-center`'s own `relative` comes later in this sheet. */
	.layout-center.center-stowed {
		display: none;
	}
	.layout-center.center-sheet {
		position: absolute;
	}

	.layout-center {
		display: flex;
		flex-direction: column;
		flex: 1;
		gap: 0.5rem;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.chat-core {
		flex: 1;
		min-block-size: 0;
		min-inline-size: 0;
		inline-size: 100%;
		display: flex;
		flex-direction: column;
	}
	/* One panel of the middle. The primary fills; a strip's box is its
	   height's (`stripStyle`). `relative` is the containing block for the
	   widget overlay and a one-tab panel's hover controls: `WidgetHost`'s
	   wrapper is `display: contents` and has no box of its own. */
	.chat-core {
		gap: 0.5rem;
	}
	.mid-panel {
		position: relative;
		min-inline-size: 0;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.mid-panel.primary {
		flex: 1 1 0;
	}
	.mid-panel > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
	/* The zone chrome — a zone's head, the pop-over, the phone's sheet — is
	   this component's, for its whole body: a zone head is the same wherever
	   it is drawn (here, ./SideMount's rail and sheet, ./PanelsMenu), and the
	   pop-over's box also dresses a side's own mount as the phone's sheet. */
	.layout-body :global(.zone-head) {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: none;
		min-block-size: 1.25rem;
	}
	.layout-body :global(.zone-label) {
		display: none;
		font-size: 0.6875rem;
		font-weight: 650;
		color: var(--color-surface-500);
		padding-inline: 0.2rem;
	}
	.layout-body :global(.zone-label.always),
	:global(.session-layout.editing) .layout-body :global(.zone-label) {
		display: inline;
	}
	.layout-body :global(.zone-head-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.4rem;
		block-size: 1.4rem;
		border-radius: 0.4rem;
		color: var(--color-surface-500);
	}
	.layout-body :global(.zone-head-btn:hover) {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 15%,
			transparent
		);
		color: var(--color-primary-600);
	}

	/* The phone's sheet (a side's own mount, or the middle) */
	.zone-flyout,
	.layout-body :global(.side-slot.zone-flyout) {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem;
		border-radius: 0.6rem 0 0 0.6rem;
		background: var(--color-surface-50);
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.22);
		animation: fly-in-right 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.layout-body :global(.side-slot.zone-flyout.from-left) {
		inset-inline-end: auto;
		inset-inline-start: 0;
		border-radius: 0 0.6rem 0.6rem 0;
		border-inline-start: none;
		border-inline-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 10px 0 28px rgba(0, 0, 0, 0.22);
		animation-name: fly-in-left;
	}
	:global([data-mode="dark"]) .zone-flyout,
	:global([data-mode="dark"]) .layout-body :global(.side-slot.zone-flyout) {
		background: var(--color-surface-950);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 60%,
			transparent
		);
	}
	@keyframes fly-in-right {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}
	@keyframes fly-in-left {
		from {
			transform: translateX(-24px);
			opacity: 0;
		}
	}

	/* Mobile side panels (P6): the same fly-out, sized for a phone. 85vw is the
	   ruled cap; the rem ceiling stops a landscape tablet from serving a 700px
	   "panel". A full-width slide rather than the desktop 24px nudge, because
	   here the sheet arrives from off-screen.
	   These dress the OPEN SIDE'S OWN MOUNT (./SideMount's `.slot-overlay`)
	   rather than a dialog of their own — the animation still plays, because
	   naming an animation on an element that had none starts it. There is no
	   wrapper element around the mount for the same reason: that would be an
	   appendChild, and that reloads its iframes. */
	.zone-flyout.mobile,
	.layout-body :global(.side-slot.zone-flyout.mobile) {
		inline-size: min(85vw, 26rem);
		max-inline-size: 100%;
		animation-name: fly-in-mobile-right;
	}
	.layout-body :global(.side-slot.zone-flyout.mobile.from-left) {
		animation-name: fly-in-mobile-left;
	}
	/* The sheet's close control is a thumb target, not a desktop icon button —
	   the 1.4rem default is a third of the 44px minimum the header bar keeps. */
	.layout-body :global(.zone-flyout.mobile .zone-head-btn) {
		inline-size: 2.75rem;
		block-size: 2.75rem;
	}
	@keyframes fly-in-mobile-right {
		from {
			transform: translateX(100%);
		}
	}
	@keyframes fly-in-mobile-left {
		from {
			transform: translateX(-100%);
		}
	}

	.layout-center {
		position: relative;
	}

	@media (prefers-reduced-motion: reduce) {
		.zone-flyout,
		.layout-body :global(.side-slot.zone-flyout) {
			animation: none;
		}
		/* Spelled out because a media query adds no specificity: the mobile
		   sheet's `animation-name` is set at (0,2,0) and would otherwise outrank
		   the single-class reset above. */
		.zone-flyout.mobile,
		.layout-body :global(.side-slot.zone-flyout.mobile),
		.layout-body :global(.side-slot.zone-flyout.mobile.from-left) {
			animation: none;
		}
	}
</style>
