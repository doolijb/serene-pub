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
	 * mounts, and holds the transient UI state of the live view — the
	 * pop-overs, the tucked flyout, the phone's sheets and panels menu, the tab
	 * groups' active member.
	 *
	 * Side-zone presentation follows the pin rule verbatim: a pinned rail takes
	 * layout space; unpinned (or too narrow to dock) the zone reduces to a
	 * per-widget icon strip, and clicking an icon pops the zone over the chat
	 * until the user clicks away — or pins it, which docks it and persists.
	 * Each side is ONE mount (./SideMount, the no-reload law).
	 *
	 * Widgets are the same PanelInstances the SurfaceManager owns, rendered
	 * through Panel (chrome="zone") — and the conversation through core's own
	 * remote component — so remote/frame surfaces and channel wiring are
	 * untouched. Every mount is in THIS file (the `middleWidget`, `panelStack`
	 * and `tabGroup` snippets), and each is handed the session's venues
	 * (`actions`) and the page's dispatch (`actionDispatch`) as props, never a
	 * context.
	 *
	 * Nothing here writes the layout but the rail's and the pop-over's own pin
	 * buttons, which go up through `onSetPinned`; the editor never writes this
	 * component's state.
	 */
	import * as Icons from "@lucide/svelte"
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { ResolvedZone } from "./schema"
	import WidgetZone from "./WidgetZone.svelte"
	import { widgetsFromSideZones, type ZoneEntry } from "./panelWidgets"
	import type { RenderUnit } from "./tabGroups"
	import { createStageBalance } from "./stageBalance.svelte"
	import { HOST_CARD_CLASS, hostCardShown } from "./hostCard"
	import { mobileSidePanels } from "./mobileSidePanels.svelte"
	import { createLiveFlyouts } from "./liveFlyouts.svelte"
	import {
		BODY_GAP_PX,
		type SessionLayoutModel
	} from "./sessionLayoutModel.svelte"
	import type { WidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import SideMount from "./SideMount.svelte"
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
		/** Pin or unpin an un-arranged zone; the composition root persists it. */
		onSetPinned: (zoneId: string, pinned: boolean) => void
	}

	let {
		model,
		flow,
		manager,
		sessionId,
		session,
		actions,
		actionDispatch,
		onFrameAction,
		onSetPinned
	}: Props = $props()

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

	/* ── the arranged middle and its collapse ───────────────────────────── */
	/** The middle's cell grid, when it is drawn from an arrangement. */
	let middleFrame = $derived(model.frameOf(model.drawn.middle))
	let middleWPx = $state(0)
	let middleCol = $derived(model.middleCollapse(middleWPx))

	/* ── real placement for the arranged renderers (PLAN 25; the model's
	 * `unitPlacement`) ──────────────────────────────────────────────────────
	 * Widths are measured per CELL rather than divided out of the zone: the
	 * tracks are `1fr`, so their real size is the browser's answer. Unmeasured
	 * for a frame → 0 → `compact`, corrected by an ordinary `layout:changed`. */
	let cellWidths = $state<Record<string, number>>({})
	/* The block size of the same cells, keyed the same way, so the contract's
	   `layout.v1.box.px` can report a real box. Absent until both axes have a
	   number. */
	let cellHeights = $state<Record<string, number>>({})
	const unitPlacement: SessionLayoutModel["unitPlacement"] = (...a) =>
		model.unitPlacement(...a)
	const anchorCellStyle: SessionLayoutModel["anchorCellStyle"] = (a) =>
		model.anchorCellStyle(a)
	/* ── live tab groups ────────────────────────────────────────────────────
	 * Widgets sharing a `group` collapse in the LIVE view to ONE footprint and
	 * render as a tab set. Members stay mounted (shown/hidden), never
	 * unmounted, so a panel/frame keeps its state across tab switches (the
	 * no-reload law). Which member is showing, by group: the first member by
	 * default, falling back if the remembered one is not present. */
	let activeTabs = $state<Record<string, string>>({})
	function activeTab(u: RenderUnit): string {
		const a = activeTabs[u.key]
		return a && u.members.some((m) => m.id === a) ? a : u.members[0].id
	}
	function setActiveTab(key: string, id: string) {
		activeTabs = { ...activeTabs, [key]: id }
	}

	/* ── the flyouts: the pop-over and the tucked flyout (./liveFlyouts) ── */
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
	 * Put the pop-over away — any, or only `zoneId`'s. What the editor's
	 * starting points and a zone pinned from the Move tab ask for, through the
	 * composition root: the editor never writes this component's state.
	 */
	export function putAway(zoneId?: string) {
		flyouts.putAway(zoneId)
	}
	function setPinned(zoneId: string, pinned: boolean) {
		onSetPinned(zoneId, pinned)
		if (pinned) flyouts.putAway(zoneId)
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

	/** alt+[ / alt+]: expand everything that fits, or send it all to the rail. */
	function setAllGroups(open: boolean) {
		for (const side of ["left", "right"] as const) {
			const units = side === "left" ? model.leftUnits : model.rightUnits
			for (const u of units)
				model.rail.groupOpen[model.rail.groupKey(side, u.key)] = open
			// No focus, so nothing flies out: "expand everything" fills the
			// column and leaves what does not fit as icons.
			model.rail.groupFocus[side] = null
		}
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

<!-- `placement` is what the rail's `WidgetZone` measured for this panel; the
     multi-column / flyout branch of `panelStack` doesn't run on that engine yet
     and passes none, so those mounts fall through to `UNPLACED`. -->
{#snippet railPanelInner(
	p: ZoneEntry,
	z: ResolvedZone,
	placement?: PlacementInput,
	popover = false
)}
	{#if p.panel}
		<Panel
			instance={p.panel}
			title={flow.titleApart.get(p.panel.id)}
			{manager}
			{sessionId}
			{session}
			{placement}
			chrome="zone"
			popover={popover || model.inSheet(z)}
			{actions}
			{actionDispatch}
			{onFrameAction}
		/>
	{:else}
		<!-- A conversation in a side (brief 7a): drawn like the log is
		     anywhere, through the one renderer. -->
		{@render middleWidget({
			id: p.id,
			placement,
			popover: popover || model.inSheet(z)
		})}
	{/if}
{/snippet}

{#snippet panelStack(z: ResolvedZone, flyout: boolean)}
	{#if !flyout && z.columns === 1}
		<!-- PLAN 25: the common docked-rail case (pinned, single column) runs on
		     the widget-grid engine itself. Flyout and multi-column (ultrawide)
		     rails stay on the grid math below: a flyout's container can shrink
		     below the declared width (min(...,86%)), which needs the old
		     0-floor `minmax(0,1fr)`; multi-column needs a row-generalization the
		     engine doesn't do yet (see panelWidgets.ts's module doc). -->
		{@const zoneSide = z.def.side === "left" ? "left" : "right"}
		{@const entries = model.zoneEntriesOf(z)}
		{@const sideGrid = {
			version: 1 as const,
			cell: z.width,
			widgets: widgetsFromSideZones(
				[z],
				manager.instances,
				z.width,
				model.isConversation
			)
		}}
		{#snippet railPanel({
			id,
			placement
		}: {
			id: string
			placement: PlacementInput
		})}
			{@const p = entries.find((e) => e.id === id)}
			{#if p}
				<div class="zone-panel" class:conversation={!p.panel}>
					{@render railPanelInner(p, z, placement)}
				</div>
			{/if}
		{/snippet}
		<div class="zone-stack-host">
			<!-- `hiddenIds`: the stage (QE) hides this rail's other widgets
			     while it draws the conversation full width, and the phone's
			     sheet of this side hides the conversation the stage shows.
			     Hidden around their mounts, never unmounted. -->
			<WidgetZone
				layout={sideGrid}
				zone={zoneSide}
				widget={railPanel}
				gap="0.5rem"
				hiddenIds={model.stageHiddenIn(
					zoneSide,
					entries.map((e) => e.id)
				)}
			/>
		</div>
	{:else}
		{@const hidden = model.stageHiddenIn(
			z.def.side === "left" ? "left" : "right",
			model.zoneEntriesOf(z).map((e) => e.id)
		)}
		<div
			class="zone-stack"
			style="grid-template-columns:repeat({flyout
				? 1
				: z.columns},minmax(0,1fr));"
		>
			{#each model.zoneEntriesOf(z) as p (p.id)}
				<div
					class="zone-panel"
					class:conversation={!p.panel}
					data-stage-hidden={!flyout && hidden?.has(p.id)
						? ""
						: undefined}
				>
					{@render railPanelInner(p, z, undefined, flyout)}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet stripZone(z: ResolvedZone)}
	{@const widgets = model.zoneEntriesOf(z)}
	{#if z.mode !== "hidden" && widgets.length}
		<!-- A top strip is a header row: it rolls up with a furled session
		     header (note 29), except while the layout is being edited. -->
		<div
			class="zone-strip"
			data-stage-hidden={model.stageOnly ||
			(shellPrefs.headerFurled &&
				!model.editing &&
				z.def.area !== "bottom")
				? ""
				: undefined}
			aria-label={model.labelOf(z)}
		>
			{#each widgets as p (p.id)}
				<div class="strip-panel">
					{#if p.panel}
						<Panel
							instance={p.panel}
							title={flow.titleApart.get(p.panel.id)}
							{manager}
							{sessionId}
							{session}
							chrome="zone"
							{actions}
							{actionDispatch}
							{onFrameAction}
						/>
					{:else}
						{@render middleWidget({ id: p.id })}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- A tab group in the live view: grouped widgets share one footprint, one tab
     per member, all members mounted (shown/hidden) so their state survives a
     switch. Used by the middle and by the sides (`unit`). -->
{#snippet tabGroup(
	u: RenderUnit,
	geom?: {
		zone: { cols: number; rows: number }
		widthPx: number
		heightPx?: number
	},
	popover = false
)}
	{@const active = activeTab(u)}
	<div class="wtabs">
		<div class="wtabs-bar" role="tablist">
			{#each u.members as m (m.id)}
				<button
					class="wtab"
					class:active={m.id === active}
					role="tab"
					aria-selected={m.id === active}
					onclick={() => setActiveTab(u.key, m.id)}
				>
					{flow.widgetLabel(m.id)}
				</button>
			{/each}
		</div>
		<!-- Every member shares the group's ONE footprint — that is what a tab
		     group is — so they share its placement. The tab bar it wears is the
		     group's chrome, not a member's, so the geometry a member reports is
		     the cell, not the cell minus a bar it does not own. -->
		<div class="wtabs-body">
			{#each u.members as m (m.id)}
				<div class="wtab-pane" class:wtab-hidden={m.id !== active}>
					{@render middleWidget({
						id: m.id,
						bare: true,
						placement: geom
							? unitPlacement(
									geom.zone,
									u,
									geom.widthPx,
									m.id,
									geom.heightPx
								)
							: undefined,
						popover
					})}
				</div>
			{/each}
		</div>
	</div>
{/snippet}

<!-- One arranged cell's content: a lone widget at the unit's placement, or a
     tab group. The middle's cells and a side's (./SideMount) both draw here. -->
{#snippet unit(
	u: RenderUnit,
	geom: {
		zone: { cols: number; rows: number }
		widthPx: number
		heightPx?: number
	},
	popover: boolean
)}
	{#if u.members.length === 1}
		{@render middleWidget({
			id: u.members[0].id,
			placement: unitPlacement(
				geom.zone,
				u,
				geom.widthPx,
				u.members[0].id,
				geom.heightPx
			),
			popover
		})}
	{:else}
		{@render tabGroup(u, geom, popover)}
	{/if}
{/snippet}

<!-- ── the live session: ONE mount, drawn or stowed ─────────────────────
     Never the other arm of an `{#if}` with the editor's canvas: a switch to
     or from the Move tab would rebuild the whole session, reloading every
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
			{unit}
			{panelStack}
			flowEdge={stage.flowEdge}
			{flyouts}
			onSetPinned={setPinned}
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
			{#each model.topStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
			<!-- The layout attribute is TRANSITIONAL (./widgetSettingsFlow
			     `msgLayoutAttr`): written from the RESOLVED style so CSS outside
			     this repo that still keys on a pack name keeps working for one
			     release. The measure of the message column belongs to the
			     `messages` widget, which centres its own stage inside whatever
			     width this zone gives it. -->
			<div class="chat-core" data-msg-layout={flow.msgLayoutAttr}>
				{#if middleFrame}
					<!-- The middle drawn from its arrangement: a PROPORTIONAL grid
					     (repeat(cols,1fr) × repeat(rows,1fr)) maps the captured cell
					     coords to this zone's actual size. An arrangement that EXISTS
					     is authoritative even when empty — an intentionally-emptied
					     middle stays empty instead of falling back to the default. -->
					<div
						class="chat-arranged"
						class:one-column={middleCol.collapsed}
						bind:clientWidth={middleWPx}
						style={model.stagePrimaryKey !== null
							? "grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr);"
							: `grid-template-columns:repeat(${
									middleCol.collapsed ? 1 : middleFrame.cols
								},1fr); grid-template-rows:${
									middleCol.collapsed
										? middleCol.rows || "1fr"
										: `repeat(${middleFrame.rows},1fr)`
								};`}
					>
						{#each model.middleUnits as u (u.key)}
							{@const widthPx =
								cellWidths[`middle:${u.key}`] ?? 0}
							{@const heightPx =
								cellHeights[`middle:${u.key}`] ?? 0}
							<div
								class="chat-arranged-cell"
								bind:clientWidth={cellWidths[`middle:${u.key}`]}
								bind:clientHeight={
									cellHeights[`middle:${u.key}`]
								}
								data-stage-primary={model.stagePrimaryKey !==
									null && u.key === model.stagePrimaryKey
									? ""
									: undefined}
								data-stage-hidden={model.stagePrimaryKey !==
									null && u.key !== model.stagePrimaryKey
									? ""
									: undefined}
								style="{model.stagePrimaryKey === u.key
									? 'grid-column:1; grid-row:1;'
									: middleCol.collapsed
										? `grid-column:1; grid-row:${middleCol.row[u.key] ?? 1};`
										: `grid-column:${u.box.x + 1} / span ${u.box.w}; grid-row:${u.box.y + 1} / span ${u.box.h};`}{u
									.members.length === 1 &&
								!middleCol.collapsed
									? anchorCellStyle(u.members[0].anchor)
									: ''}"
							>
								{@render unit(
									u,
									{ zone: middleFrame, widthPx, heightPx },
									false
								)}
							</div>
						{/each}
					</div>
				{:else}
					<!-- No arrangement (fresh / never edited): the middle widget
					     grid — Messages fills the middle. -->
					<WidgetZone
						layout={model.chatGrid}
						zone="middle"
						gap="0"
						widget={middleWidget}
						hiddenIds={model.stageHiddenMiddleIds}
					/>
				{/if}
			</div>
			{#each model.bottomStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
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
			{unit}
			{panelStack}
			flowEdge={stage.flowEdge}
			{flyouts}
			onSetPinned={setPinned}
			bind:el={sideEls.right}
		/>

		<!-- The pop-over: an unpinned/narrow zone slid over the chat.
		     Desktop only — below the breakpoint the header's panels menu owns
		     the overlay, and the icon strips that arm this one are not drawn. -->
		{#if !model.isNarrow}
			{#each flyouts.keptPops as z (z.id)}
				<!-- Tucked per side: the side holding the log never is. -->
				{@const zTucked =
					model.tucked[z.def.side === "left" ? "left" : "right"]}
				{@const shown = flyouts.tuckedShown[z.id]}
				{@const tuckedHere = zTucked && !!shown}
				{@const open = zTucked
					? z.id === flyouts.tuckedZoneId
					: z.id === flyouts.popId}
				{@const onLeft = z.def.side === "left"}
				{@const shownZone = tuckedHere ? flyouts.tuckedZone(z) : z}
				{@const title = tuckedHere
					? (model.inst(shown)?.title ??
						(model.isConversation(shown)
							? flow.widgetLabel(shown)
							: model.labelOf(z)))
					: model.labelOf(z)}
				{#if open && z.mode === "drawer"}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div
						class="pop-scrim"
						data-stage-hidden={model.stageOnly ? "" : undefined}
						onclick={() =>
							zTucked
								? flyouts.closeTucked(false)
								: (flyouts.popId = null)}
					></div>
				{/if}
				<!-- Closed, it is `display: none` — kept, not unmounted (`keptPops`).
				     Tucked, it stops at the stage's edge (`flowEdge`) so the icon
				     strip that opened it stays in reach, and shows the ONE widget
				     whose icon was pressed (`tuckedZone`). -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="zone-flyout"
					data-stage-hidden={model.stageOnly ? "" : undefined}
					class:from-left={onLeft}
					class:pop-closed={!open}
					style="inline-size:min({z.width}px, 86%);{zTucked
						? `${onLeft ? 'inset-inline-start' : 'inset-inline-end'}:${onLeft ? stage.flowEdge.start : stage.flowEdge.end}px;`
						: ''}"
					role="dialog"
					aria-label={title}
					id={zTucked ? `tucked-zone-${z.id}` : undefined}
					data-tucked-flyout={zTucked && open ? "" : undefined}
					tabindex={zTucked ? -1 : undefined}
					data-pop-keep
				>
					<div class="zone-head">
						<span class="zone-label always">{title}</span>
						<span class="flex-1"></span>
						{#if z.mode === "icons" && !zTucked}
							<button
								class="zone-head-btn"
								title="Pin — keep this zone open"
								aria-label="Pin {model.labelOf(z)}"
								onclick={() => setPinned(z.id, true)}
							>
								<Icons.Pin size={13} />
							</button>
						{/if}
						<button
							class="zone-head-btn"
							title="Close"
							aria-label="Close {title}"
							onclick={() =>
								zTucked
									? flyouts.closeTucked(true)
									: (flyouts.popId = null)}
						>
							<Icons.X size={13} />
						</button>
					</div>
					{@render panelStack(shownZone, true)}
				</div>
			{/each}
		{/if}

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
	   been. Stowed (under the Move tab's canvas) it is ./SideMount's
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
	.chat-core > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
	/* The middle drawn from its arrangement. Proportional grid so the captured
	   cell layout fills this zone's real size. */
	.chat-arranged {
		flex: 1;
		min-block-size: 0;
		display: grid;
		gap: 0;
	}
	.chat-arranged-cell {
		/* The containing block for this cell's widget overlay. `WidgetHost`'s
		   wrapper is `display: contents` and has no box, so an inset-0 overlay
		   inside a widget anchors to the nearest POSITIONED ancestor — which,
		   with these cells static, was some zone far above: the conversation's
		   controls stretched across the whole chat column instead of sitting on
		   the widget they style. (A Panel-chromed widget was already fine —
		   Panel's own section is relative.) Nothing inside a cell is
		   absolutely positioned against anything higher: the message list roots
		   itself in a `relative` box of its own, and the composer's only
		   escapees are `fixed` modals, which a positioned ancestor does not
		   catch. */
		position: relative;
		min-inline-size: 0;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.chat-arranged-cell > :global(*) {
		flex: 1;
		min-block-size: 0;
	}

	/* Live tab group: grouped widgets share one cell — a tab bar plus one active
	   pane. The inactive panes are display:none but stay mounted, so a panel or
	   frame keeps its state across a tab switch (the no-reload law). */
	.wtabs {
		block-size: 100%;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	.wtabs-bar {
		flex: none;
		display: flex;
		gap: 0.15rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 0.15rem 0.15rem 0;
	}
	.wtab {
		flex: none;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.2rem 0.55rem;
		border-radius: 0.4rem 0.4rem 0 0;
		color: var(--color-surface-600-400);
		white-space: nowrap;
	}
	.wtab.active {
		background: var(--color-surface-100-900);
		color: inherit;
	}
	.wtabs-body {
		flex: 1;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		background: var(--color-surface-100-900);
		border-radius: 0 0.45rem 0.45rem 0.45rem;
		overflow: hidden;
	}
	.wtab-pane {
		/* And again for a grouped widget: without it the overlay anchors past
		   the tab strip and covers the whole group, so the pane you are looking
		   at and the ones hidden behind it style as if they were one widget. */
		position: relative;
		flex: 1;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	.wtab-pane.wtab-hidden {
		display: none;
	}
	.wtab-pane > :global(*) {
		flex: 1;
		min-block-size: 0;
	}

	/* ── zones ─────────────────────────────────────────────────────── */
	.zone-stack {
		display: grid;
		gap: 0.5rem;
		align-content: start;
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
	}
	/* The widget-grid-engine rail path (see panelStack): same sizing role as
	   .zone-stack above (a scrolling flex:1 slot in the rail's column), but the
	   grid itself is WidgetZone's — this just gives it a definite height. */
	.zone-stack-host {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
	}
	.zone-panel {
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	/* A conversation in a rail (brief 7a) GROWS down it (./panelWidgets), so
	   its wrapper fills the track and the log has a box to scroll in. */
	.zone-panel.conversation {
		flex: 1;
		min-block-size: 0;
	}
	/* …and in the grid-math stack (a flyout, a pop-over, a multi-column rail),
	   whose auto rows would size the log to its whole transcript and push the
	   composer below it: while the stack holds a conversation its rows share
	   the stack's height (each at least a readable 12rem, the stack scrolling
	   past that), and every panel scrolls inside its own row. */
	.zone-stack:has(> .zone-panel.conversation) {
		grid-auto-rows: minmax(min(12rem, 100%), 1fr);
		align-content: stretch;
	}
	.zone-stack:has(> .zone-panel.conversation) > .zone-panel {
		min-block-size: 0;
		overflow: auto;
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

	/* Strips (top/bottom rows) */
	.zone-strip {
		display: flex;
		flex: none;
		gap: 0.5rem;
		align-items: stretch;
		overflow-x: auto;
		min-block-size: 0;
	}
	.strip-panel {
		flex: 1 1 16rem;
		min-inline-size: 14rem;
		max-block-size: 14rem;
		display: flex;
		flex-direction: column;
	}

	/* Fly-out (popped zone) */
	.zone-flyout.pop-closed {
		display: none;
	}
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
	.zone-flyout.from-left,
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
	.pop-scrim {
		position: absolute;
		inset: 0;
		z-index: 25;
		background: rgba(0, 0, 0, 0.32);
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
