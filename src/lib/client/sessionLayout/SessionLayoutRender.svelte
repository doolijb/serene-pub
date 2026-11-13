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
	 * mounts, and publishes the zone switch.
	 *
	 * Every zone — Left, Middle, Right — is a stack of PANELS drawn by the one
	 * height engine (./ZoneColumn): a panel is ./PanelTabs, a tab strip when it
	 * holds two or more widgets, and it draws its own backing (the layout's
	 * look). Every panel is always open: no pin, no rail, no fly-out. Each
	 * side is ONE mount (./SideMount, the no-reload law), and so is the
	 * middle; while the zones do not fit, the zone switch (./ZoneSwitch) picks
	 * which one is drawn and the rest are stowed, never unmounted.
	 *
	 * Widgets are the same PanelInstances the SurfaceManager owns, rendered
	 * through Panel (chrome="zone") — and the conversation family (Messages,
	 * Composer, Turn line) through core's own remote components — so
	 * remote/frame surfaces and channel wiring are untouched. Every mount is
	 * in THIS file (the `middleWidget` and `livePanel` snippets), and each is
	 * handed the session's venues (`actions`) and the page's dispatch
	 * (`actionDispatch`) as props, never a context.
	 *
	 * Nothing here writes the layout but a panel's own tab a person opens,
	 * which goes through the manager (`setPanelOpen`); the editor never writes
	 * this component's state.
	 */
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { DrawnInstance, DrawnPanel } from "@serene-pub/sdk"
	import PanelTabs from "./PanelTabs.svelte"
	import { createStageBalance } from "./stageBalance.svelte"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { WidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import SideMount from "./SideMount.svelte"
	import LayoutBackdrop from "./LayoutBackdrop.svelte"
	import ZoneColumn, { type CellAt } from "./ZoneColumn.svelte"
	import ZoneSwitch from "./ZoneSwitch.svelte"
	import { sessionZones } from "./sessionZones.svelte"
	import { backingShown, widgetBoxStyle } from "./panelBacking"
	import { conversationKindOf } from "./conversationTarget"
	import { CONVERSATION_MOUNTS } from "./conversationMounts"
	import { conversationStyleSources, styleSourceOf } from "./conversationStyles"
	import RemoteWidget from "$lib/client/components/host/RemoteWidget.svelte"
	import { effectiveWidgetSkin } from "$lib/client/stores/widgetStyles.svelte"
	import type { ActionsV1, PlacementInput } from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	// 🚧 A dot on a tab with news (PLAN-dc-after-walk2 Q3-3).
	import { createTabAttention } from "./tabAttention.svelte"
	import { laneClaimOf } from "./channelClaims"
	import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
	import { getContext, untrack } from "svelte"

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

	/* ── the zone switch (./sessionZones) ─────────────────────────────────
	 * The header and the phone's row draw it; this publishes its state. */
	$effect(() =>
		sessionZones.publish({
			switchOn: model.switchOn,
			available: model.availableZones,
			opening: model.openingZone
		})
	)

	/* ── a Composer / Turn line wears its Messages' style (PLAN D8) ───────
	 * The map ./conversationStyles holds: every placed composer / turn-line
	 * instance and the Messages copy it follows, unless the person pinned
	 * its own (`styleSourceOf`). */
	$effect(() => {
		const next = new Map<string, string | null>()
		for (const zone of [model.zones.left, model.zones.middle, model.zones.right])
			for (const p of zone)
				for (const t of p.tabs) {
					const kind = conversationKindOf(t.instanceId)
					if (kind === "composer" || kind === "turn-line")
						next.set(t.instanceId, model.conversationTargetFor(t.instanceId))
				}
		untrack(() => {
			for (const [id, target] of next) {
				if (target === null) conversationStyleSources.delete(id)
				else if (conversationStyleSources.get(id) !== target)
					conversationStyleSources.set(id, target)
			}
			for (const id of [...conversationStyleSources.keys()])
				if (!next.has(id)) conversationStyleSources.delete(id)
		})
	})
</script>

<!-- Unified live widget renderer: turns a widget id into its real content, so
     ANY widget renders correctly in ANY zone. `placement` is the cells the
     zone that drew this widget placed it at (PLAN 25); a caller with none is
     told `UNPLACED` by `RemoteWidget`. -->
{#snippet middleWidget({
	id,
	bare = false,
	placement
}: {
	id: string
	bare?: boolean
	placement?: PlacementInput
})}
	{#if model.isConversation(id)}
		<!-- The conversation family — Messages (the log), Composer (the field
		     you write into) and Turn line — are core's own remote components
		     (C7, R79), mounted like every other widget: same skin, same
		     Style-mode overlay, the same inputs a panel gets, narrowed to what
		     each declares it reads (K12). So is every COPY of one a layout
		     places (`messages#sanctum`, S1), under its own id, settings and
		     pins. `channels` stays empty: each is handed the whole log and
		     draws its own channels' rows (`dossierFor`). `eager`: the
		     conversation mounts at once, shown or not (every other widget
		     mounts on first show). The PANEL around it draws the backing, so
		     there is no `backing` here. Nothing to show until the session is
		     here. -->
		{@const kind = conversationKindOf(id)!}
		{@const mount = CONVERSATION_MOUNTS[kind]}
		{@const r = flow.resolvedWidget(id)}
		{@const dossier = model.dossierFor(id)}
		{#if session}
			<!-- A copy landing (`copiesLanded`, not every re-seed: a `sessions:view`
			     reply re-inits the manager too) remounts the conversation. -->
			<RemoteWidget
				widget={{ id, title: r.title }}
				owner="core"
				src={mount.src}
				session={session as any}
				channels={ALL_CHANNELS}
				props={{ widgetId: id, title: r.title }}
				settings={r.settings}
				reads={mount.reads}
				{placement}
				source={manager}
				{actions}
				{actionDispatch}
				onAction={onFrameAction}
				grants={["session:full"]}
				scoped={dossier ? { session_full: dossier } : undefined}
				class="h-full"
				eager
				pageIds={kind === "messages" && model.pageIdsHeld.has(id)}
				remountKey={manager.copiesLanded}
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
				{actions}
				{actionDispatch}
				{onFrameAction}
			/>
		{/if}
	{/if}
{/snippet}

<!-- One PANEL, wherever it is drawn, through ./PanelTabs: its tabs (a strip
     when two or more) and its backing. Every tab shares the panel's ONE box,
     so they share its placement; the placement is told whether the panel
     draws a backing (`chrome.card`). -->
{#snippet livePanel(p: DrawnPanel, at: CellAt)}
	{#snippet pane(t: DrawnInstance, multi: boolean)}
		{@const placed = model.rail.panelPlacement(
			p,
			{ index: at.index, count: at.count },
			t.instanceId,
			at.widthPx,
			at.heightPx
		)}
		{@render middleWidget({
			id: t.instanceId,
			bare: multi,
			placement: {
				...placed,
				chrome: { ...placed.chrome, card: backingShown(model.look) }
			}
		})}
	{/snippet}
	<PanelTabs
		panel={p}
		dots={tabAttention.dots(p, attentionRows, attentionViewer)}
		label={(id) => flow.widgetLabel(id)}
		onSelect={(tab) => manager.setPanelOpen(p.key, tab)}
		backing={model.look.backing}
		boxStyle={widgetBoxStyle(
			model.look,
			effectiveWidgetSkin(styleSourceOf(p.open))
		)}
		{pane}
	/>
{/snippet}

<!-- ── the live session: ONE mount, drawn or stowed ─────────────────────
     Never the other arm of an `{#if}` with the editor's canvas: a switch to
     or from the Arrange tab would rebuild the whole session, reloading every
     iframe (the reload ./sideSlot forbids, one level up). The canvas is drawn
     over it; `.live-body` is `display: contents` while drawn and
     `display: none` while stowed. -->
<div class="live-body" class:body-stowed={model.liveStowed}>
	{#if model.isNarrow && model.switchOn}
		<!-- Phone (<lg): the zone switch has its own row under the header; on a
		     desktop it is in the header (ZoneSwitch draws nothing while off). -->
		<div class="zone-switch-row"><ZoneSwitch /></div>
	{/if}
	<div
		class="layout-body"
		style:--sp-zone-gap="{model.gapPx}px"
		class:has-backdrop={model.look.behind === "backdrop"}
		bind:this={model.bodyEl}
	>
		<LayoutBackdrop
			look={model.look}
			backdropMediaId={(
				session as { backdropMediaId?: number | null } | null | undefined
			)?.backdropMediaId}
		/>

		<!-- The left side, mounted ONCE. Its slot says whether it is drawn in
		     the row, stowed, or the one zone drawn (solo). -->
		<SideMount side="left" slot={model.leftSlot} {model} panel={livePanel} />

		<!-- The middle zone runs side to side and carries the balance that
		     centres the column on the body (./tuckedSides); the conversation
		     reads it, so its scroll region covers it. Stowed (display:none)
		     while a side is the one zone drawn — mounted, never unmounted. -->
		<div
			class="layout-center"
			class:center-stowed={model.centerSlot === "stowed"}
			bind:this={centerEl}
			style:--sp-stage-balance-start="{stage.stageBalance.start}px"
			style:--sp-stage-balance-end="{stage.stageBalance.end}px"
			style:margin-inline-start={stage.middleOverGap.start &&
			model.centerSlot === "flow"
				? `-${model.gapPx}px`
				: undefined}
			style:margin-inline-end={stage.middleOverGap.end &&
			model.centerSlot === "flow"
				? `-${model.gapPx}px`
				: undefined}
		>
			<!-- The layout attribute is TRANSITIONAL (./widgetSettingsFlow
			     `msgLayoutAttr`): written from the RESOLVED style so CSS outside
			     this repo that still keys on a pack name keeps working for one
			     release. The measure of the message column belongs to the
			     `messages` widget, which centres its own stage inside whatever
			     width this zone gives it. The middle is a stack of panels, like
			     the sides. -->
			<div class="chat-core" data-msg-layout={flow.msgLayoutAttr}>
				<ZoneColumn
					zone="middle"
					panels={model.zones.middle}
					gapPx={model.gapPx}
					isMessages={model.isMessages}
					panel={livePanel}
				/>
			</div>
		</div>

		<!-- The right side, mounted ONCE — same deal as the left above. -->
		<SideMount side="right" slot={model.rightSlot} {model} panel={livePanel} />
	</div>
</div>

<style>
	/* The whole width, uncapped. The gap between zones and the padding around
	   them are the layout's (`--sp-zone-gap`, PLAN ★9); the balance that
	   centres the column belongs to the middle zone (`measureStage`,
	   ./tuckedSides). */
	.layout-body {
		position: relative;
		display: flex;
		flex: 1;
		inline-size: 100%;
		gap: var(--sp-zone-gap);
		padding: var(--sp-zone-gap);
		box-sizing: border-box;
		min-block-size: 0;
		overflow: hidden;
	}
	/* While the backdrop is drawn, the zones are positioned (auto z-index, no
	   stacking context), so they paint over it as later siblings. */
	.layout-body.has-backdrop > :global(.side-slot) {
		position: relative;
	}
	/* The live session's one mount. `display: contents`: the wrapper exists
	   only so the subtree can be stowed whole, and it must not be a box the
	   layout never had — `.layout-body` stays the flex child of
	   `.session-layout` it has always been. Stowed (under the Arrange tab's
	   canvas) it is `display: none`, for the whole session: no box, still
	   MOUNTED. */
	.live-body {
		display: contents;
	}
	.live-body.body-stowed {
		display: none;
	}
	/* The phone's zone switch: its own row under the header. */
	.zone-switch-row {
		flex: none;
		display: flex;
		justify-content: center;
		padding: var(--sp-zone-gap, 0.5rem) var(--sp-zone-gap, 0.5rem) 0;
	}
	/* The middle while a side is the one zone drawn: mounted, no box. */
	.layout-center.center-stowed {
		display: none;
	}
	.layout-center {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
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
</style>
