<script lang="ts">
	import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
	/**
	 * The modular session layout (mockup: serene-pub-chat-layout.html, ruled
	 * 2026-08-28). The chat core (the page-supplied primary snippet) sits in
	 * the middle; every zone around it comes from the free-form ZoneLayout
	 * template in the user's layout blob — any zone ids, any widget lists, any
	 * number of width rules, resolved against the MEASURED container width.
	 *
	 * Side-zone presentation follows the pin rule verbatim: a pinned rail
	 * takes layout space; unpinned (or too narrow to dock) the zone reduces
	 * to a per-widget icon strip, and clicking an icon pops the zone over the
	 * chat until the user clicks away — or pins it, which docks it and
	 * persists. Narrow "drawer" widths behave like icons plus a scrim.
	 *
	 * Widgets are the same PanelInstances the SurfaceManager owns; this host
	 * renders them through Panel (chrome="zone") so remote/frame surfaces and
	 * channel wiring are untouched. Placement changes reparent the panel stack
	 * between rail and flyout — rare (resize/pin), and accepted for zones,
	 * unlike the old grid's no-reparent law.
	 */
	import { getContext, onMount, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import {
		normalizeZoneLayout,
		pinsOnFirstDrop,
		placedWidgetIds,
		resolveZone,
		withWidget,
		withoutWidget,
		type ResolvedZone,
		type ZoneLayout
	} from "./schema"
	// The BASE conversation styling (the zero-styled grid skeleton, the
	// shared message-state treatment, and the mode-aware `--sp-*` skin palette).
	// The looks themselves are widget styles now — see messageLayouts.css.
	// Imported here as a plain global sheet so it lands outside Tailwind's
	// cascade layers and wins over the components' utility classes.
	import "./messageLayouts.css"
	// The header's "Layout" button is the one way into this editor, and while
	// the desktop editor is open the shell hands its top band to the toolbar
	// below. Header and this component are siblings under <main>, so a module
	// singleton is the bridge — see layoutEditor.svelte.ts.
	import { layoutEditor } from "./layoutEditor.svelte"
	// Ruled 2026-08-30 (P6): below the app's 1024px breakpoint the side zones
	// take no layout space at all and are reached only as an overlay, opened
	// from a two-button group the app header renders. This module is the bridge
	// — the header is a sibling of the routed page, so context cannot reach it.
	import {
		mobileSidePanels,
		type MobileGroup
	} from "./mobileSidePanels.svelte"
	// PLAN 25: the chat middle is a widget grid. Messages (GROW, filling it) is
	// the genre default that falls out of the model — no bespoke center
	// layout. Placement is free (brief 7a): the conversation may sit in any
	// zone, and the one rule left is the primary floor (./primaryFloor).
	import WidgetZone from "./WidgetZone.svelte"
	import {
		DEFAULT_CELL,
		loadChatLayout,
		placementOf,
		widgetsInZone,
		withGridWidget,
		withoutGridWidget,
		type GridLayout,
		type WidgetConfig,
		type Zone
	} from "./widgetGrid"
	import {
		floorKeeps,
		floorNote,
		withPrimaryFloor
	} from "./primaryFloor"
	import { placementAtDone } from "./donePlacement"
	// The two owner questions free placement leaves open (QE, QF), answered
	// with the plan's recommended defaults — flipped in that one file.
	import { emptyMiddleRefusal, stageOf, type StagePick } from "./placementRules"
	import { toaster } from "$lib/client/utils/toaster"
	import type {
		ActionsV1,
		PlacementInput
	} from "$lib/shared/widgets/context"
	import { withHostCard } from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	// PLAN 25: the docked-rail case (the common one — a pinned, single-column
	// side zone) also now runs on the widget-grid engine, via this pure
	// translation of the panel/zone system. See panelWidgets.ts's module doc
	// for exactly what it does and doesn't cover.
	import {
		widgetsFromSideZones,
		zoneEntries,
		type ZoneEntry
	} from "./panelWidgets"
	// The editor's grid is gridstack (free 2D drag / resize / snap), mounted by
	// LayoutEditCanvas; what is read here is the shape of what it reports back.
	// See GridStackZone — gridstack owns its DOM, Svelte owns only the host.
	import {
		GS_CELL_PX,
		type GsAnchor,
		type GsItem,
		type GsLayout,
		type GsPos
	} from "./GridStackZone.svelte"
	// The saved-arrangement round trip (rehydrate → lay over the editor's items
	// → re-express in the zone as measured now), pure and tested away from the
	// browser. See ./arrangedGeometry.
	import {
		MIDDLE_TARGET,
		arrangedIds,
		arrangementIsEmpty,
		clampPos,
		dedupeArranged,
		firstSlot,
		loadArranged,
		makeRoom,
		seedPositions,
		unitPinned,
		withGeometry,
		withPins,
		type Arranged,
		type ZoneKey
	} from "./arrangedGeometry"
	// The Move tab's screen-size simulator: the ONE implementation of the
	// editor's ¼ | ½ | ¼ split, called with the real width or a tier's width.
	import {
		SIM_HEIGHT_PX,
		SIM_OPTIONS,
		mobileEditing,
		narrowWidth,
		simulatedGeometry,
		simulationExit,
		type SimGeometry,
		type SimTier
	} from "./simulator"
	import { unitsOf, type RenderUnit } from "./tabGroups"
	import {
		dockedZoneWidths,
		emptyColumnPx,
		emptyColumnsPx,
		sideFlowPx,
		sidePopulated,
		zonePopulated,
		middleIsOneColumn,
		sideSlot,
		type SideSlot,
		type SideZoneFill
	} from "./sideSlot"
	// The side column's RAIL MODEL (ruled 2026-09-10): each docked widget group
	// in a side column is its own toggling panel — expanded in the column, an
	// icon in the slim rail at its outer edge, or (when it cannot fit beside the
	// pinned ones) a flyout over the session. The decision and its unit tests
	// are ./sideRail; this file only measures the column, draws the answer, and
	// holds the transient open/pin state — nothing about it is persisted.
	// The same module also owns the COLUMN COLLAPSE (ruled 2026-09-10): a layout
	// made at 4K has to translate to a phone, so side-by-side placements become
	// rows when the column cannot hold them — always below the breakpoint, and
	// on the desktop whenever the column is narrower than the widgets sharing a
	// row need. Anchors survive that as ORDER, which is all a single column can
	// honour.
	import {
		MIN_WIDGET_PX,
		collapseColumn,
		collapsedOrder,
		resolveRailColumn,
		rovingStep,
		rovingStop,
		type CellState,
		type ColumnLayout,
		type RailPlacement
	} from "./sideRail"
	// Tucked sides and the centred stage (ruled 2026-09-27): when the session's
	// box cannot hold the docked sides and the stage at its measure, the sides
	// draw only their icon rails and a panel comes out as a flyout, one at a
	// time; and the column is centred by a balance the middle zone carries.
	import {
		balancedGutters,
		sidesTucked,
		stagePlanPx,
		toggleTuckedFlyout,
		type Gutters,
		type TuckedFlyout
	} from "./tuckedSides"
	import { HOST_CARD_CLASS, hostCardShown } from "./hostCard"
	// Per-widget styling (PLAN 25) is NOT a panel any more (ruled 2026-09-09):
	// each widget wears its own hover overlay, mounted by WidgetHost. All this
	// file still owns is turning that mode on and persisting the pins.
	import {
		resolveWidgetStyle,
		setLegacyStylePacks,
		setWidgetStyleMode,
		setWidgetStylePinWriter,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"
	import type { WidgetStyleRef } from "$lib/shared/widgets/types"
	// Per-widget settings (PLAN 25, ruled 2026-09-10) reach the overlays the same
	// way the style pins do: this file is the one component that sees every
	// widget on screen, so it pushes the declarations the panel renders from.
	import {
		setWidgetSettingDecls,
		widgetSettingValues
	} from "$lib/client/stores/widgetSettings.svelte"
	import {
		resolveWidgetInstance,
		type WidgetSettingsDecl
	} from "$lib/shared/widgets/settings"
	import { CORE_WIDGETS } from "$lib/shared/widgets/types"
	// A second copy of a widget is placed under `<widget id>#<instance name>`
	// (the Lair's `messages#sanctum`, S1): its settings and pins are the copy's,
	// its declaration the widget's.
	import { isInstanceOf, widgetOfInstance } from "$lib/shared/widgets/instanceId"
	import { channelClaims, channelsForCopy, primaryLogOf } from "./channelClaims"
	// A widget's settings and style open in ONE app-level modal (owner ruling
	// 2026-09-27); every entry point calls `openWidgetSettings`, and this file
	// mounts the modal once.
	import WidgetSettingsModal from "./WidgetSettingsModal.svelte"
	import { closeWidgetSettings } from "./widgetSettingsModal.svelte"
	import { legacyLayoutAttr } from "$lib/shared/widgets/corePresets"
	// The per-widget context + skin wrapper. Messages wears one for the same
	// reason every other widget does (ruled 2026-08-30): it is what injects its
	// style and what grows its Style-mode overlay.
	import RemoteWidget from "$lib/client/components/host/RemoteWidget.svelte"
	import { CORE_CONVERSATION } from "$lib/client/components/sessionPage/coreWidgets"
	// The phone editor itself (ruled 2026-09-10) — the row list, its sheets and
	// their state, which unmounts with it. The gates that mount it (`mobileEdit`,
	// `liveStowed`) stay here, because the live session's own mount reads them.
	import MobileLayoutEditor from "./MobileLayoutEditor.svelte"
	// The DESKTOP toolbar (tabbed: Presets · Settings · Move) and the one-at-a-
	// time rename/delete of a layout you saved. The `editing && !isNarrow` that
	// decides whether there is a toolbar at all stays here.
	import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
	// The Move tab's three editor zones. The scrim, the simulator's frame and
	// the `{#if placing && !mobileEdit}` that mounts it stay here — the frame
	// wraps both this and the phone preview.
	import LayoutEditCanvas from "./LayoutEditCanvas.svelte"
	// The Presets tab's picture — a pure blob → geometry translation, never a
	// live mount (see presetPreview.ts for why that limit is deliberate).
	import { previewOf } from "./presetPreview"
	/** The three columns a preset picture is drawn in, left to right. */
	const PREVIEW_ZONES = ["left", "middle", "right"] as const

	import { desktop } from "$lib/client/utils/breakpoint.svelte"
	import { primaryUnitKey, stageOnlyActive } from "./stageOnly"

	interface Props {
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * 🚧 What core's conversation widget is told about the session (C0b):
		 * its `session_full.v1`, granted to that one widget.
		 */
		conversationDossier?: ConversationDossierV1 | null
		/**
		 * The layout presets this user may pick for the session's genre (PLAN
		 * 25 redesign): the shipped default first, then their own saved ones.
		 * Read-only here — the page owns the socket round trips.
		 */
		presets?: Sockets.Sessions.LayoutPreset[]
		/** The applied preset, or null for the genre default. */
		activePresetId?: number | null
		onApplyPreset?: (presetId: number | null) => void
		onSavePreset?: (name: string) => void
		/**
		 * Managing a preset you saved. Only ever asked for a card this user
		 * authored (`isDefault: false`) — the shipped default is offered no
		 * actions at all, so the server's "built-in layouts can't be renamed"
		 * refusal is a backstop rather than something a person can walk into.
		 * The page owns the round trips and pushes the refreshed list back down
		 * through `presets`, so nothing here holds an edited copy.
		 */
		onRenamePreset?: (presetId: number, name: string) => void
		onDeletePreset?: (presetId: number) => void
		/**
		 * Ask how many sessions are on a preset. Deleting one silently drops
		 * every session using it back to the genre default, so the count is
		 * fetched BEFORE the confirmation rather than reported after it — the
		 * answer arrives back as `presetUsage`.
		 */
		onPresetUsage?: (presetId: number) => void
		/**
		 * The answer to the last `onPresetUsage` ask. `null` while nothing has
		 * been asked or an ask is still in flight, which is what the pending
		 * confirmation renders as "Checking…" — an unknown count must never be
		 * drawn as zero.
		 */
		presetUsage?: { id: number; sessions: number } | null
		/**
		 * This user's per-widget layout settings blob, round-tripped by the
		 * page. Read-only here; the Settings tab writes through
		 * `onLayoutSettings`, which is the page's existing
		 * `sessions:panelLayout:set` round trip.
		 */
		layoutSettings?: Record<string, unknown>
		onLayoutSettings?: (next: Record<string, unknown>) => void
		/**
		 * The session's action venues (`sessions:actions`), as the page holds
		 * them — the one source, threaded from here to EVERY widget mount
		 * below (the messages widget's own `WidgetHost`, every `Panel`, and
		 * the stage) so `actions.v1` is the same table whichever mount reads
		 * it. A prop rather than a Svelte context because the page already
		 * hands the other half of this pair — `onFrameAction` — as one, and
		 * one fact should not arrive by two mechanisms.
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
		manager,
		sessionId,
		session,
		conversationDossier = null,
		presets = [],
		activePresetId = null,
		onApplyPreset,
		onSavePreset,
		onRenamePreset,
		onDeletePreset,
		onPresetUsage,
		presetUsage = null,
		layoutSettings = {},
		onLayoutSettings,
		actions,
		actionDispatch,
		onFrameAction
	}: Props = $props()

	// The chat's widget grid: this user's saved widget blob (courier'd
	// verbatim by the manager), read AS SAVED — the conversation stays in
	// whichever zone it was put (brief 7a). Read here — what the editor
	// changes about the middle is its ARRANGEMENT, which commits through
	// `manager.setArrangedGrid` on Done.
	// The genre's PRIMARY widget is the conversation, or — for a genre that
	// withholds it (R71) — its own (Battleship's board).
	let primaryId = $derived(
		manager.omitted.has("messages")
			? (manager.instances.find((p) => p.role === "primary")?.id ?? "messages")
			: "messages"
	)
	let savedGrid = $derived<GridLayout>(
		loadChatLayout(manager.effectiveWidgetGrid, primaryId, manager.omitted)
	)
	/** The saved arrangement, before the floor (see `floored`). */
	let storedArranged = $derived<Arranged>(
		loadArranged(manager.effectiveArrangedGrid)
	)
	/**
	 * The layout with the PRIMARY FLOOR applied (./primaryFloor): handed back
	 * by reference when an instance of the primary is placed anywhere — a side
	 * list, the grid or the arrangement — else with the bare primary appended
	 * to the middle, in the grid and in an arranged middle alike. While the
	 * editor is open the arrangement asked is its working copy, so a card
	 * dragged into a side is still placed. Declared up here, read lazily:
	 * `saved`, `editing` and `editArranged` are further down.
	 */
	let floored = $derived.by(() =>
		withPrimaryFloor(
			{
				zones: saved,
				grid: savedGrid,
				arranged: editing ? editArranged : storedArranged
			},
			primaryId
		)
	)
	let chatGrid = $derived<GridLayout>(floored.grid)
	/**
	 * The ids the middle widget grid places. The zone template covers the sides
	 * and never names the middle, so every "is this widget placed?" question has
	 * to union the two or a middle-zone widget reads as unplaced and the tray
	 * offers it again.
	 */
	let middleGridIds = $derived(
		new Set<string>(widgetsInZone(chatGrid, "middle").map((w) => w.id))
	)

	/* ── shell awareness + the root's measured offsets ──────────────────
	 * `mLeft` / `mRight` / `mTop` are the session root's distances from the
	 * viewport's edges, measured off its own rect (`updateMargins`) and
	 * re-measured whenever the shell reflows around it. Two things position
	 * against them, both of them `position: fixed` and so unable to read the
	 * root's box themselves: a group's flyout, which flies out at the edge the
	 * column is already on (`flyoutStyle`, via `bLeft` / `bRight`, the capped
	 * body's edges), and the editor toolbar, which
	 * starts where `<main>` does on every tab but Move (see `.editor`).
	 *
	 * `mLeft` IS the nav rail — 64px, or 208 while the rail is wide — plus any
	 * sidebar view open beside it, and `mRight` is 0. That is also why the side
	 * zones have no `margin` slot: there is no reserved dead space to lift them
	 * into (see ./sideSlot).
	 *
	 * `leftPanel` / `rightPanel` are read for one thing only: a view opening or
	 * closing reflows `<main>`, so the offsets have to be taken again once the
	 * DOM settles (the effect further down). */
	const panelsCtx = getContext<
		| {
				leftPanel?: string | null
				rightPanel?: string | null
				stageOnly?: boolean
		  }
		| undefined
	>("panelsCtx")
	let isDesktop = $state(false)
	/**
	 * Below the app's 1024px breakpoint (P6, ruled 2026-08-30): side zones take
	 * NO layout space — no rails, no icon strips — and a populated side is
	 * reached only through the header's L/R overlay toggles.
	 *
	 * `mounted` guards the pre-hydration frame: `isDesktop` starts optimistically
	 * false and is only told the truth in onMount, so without it every desktop
	 * first paint would drop its side zones for a frame and snap them back.
	 * Same matchMedia, no second breakpoint source.
	 */
	let mounted = $state(false)
	let isNarrow = $derived(mounted && !isDesktop)
	// Viewport-relative offsets (px), measured off the root's rect.
	let mLeft = $state(0)
	let mRight = $state(0)
	let mTop = $state(0)
	let vw = $state(1024)
	/**
	 * The side columns' own edges, for the flyout: `.layout-body`'s. Since the
	 * body lost its width cap (2026-09-27, see `measureStage`) they equal
	 * `mLeft` / `mRight`; measured anyway, so a flyout follows the body and
	 * not an assumption about it.
	 */
	let bLeft = $state(0)
	let bRight = $state(0)

	function updateMargins() {
		if (!rootEl) return
		const r = rootEl.getBoundingClientRect()
		vw = window.innerWidth
		mLeft = Math.max(0, Math.round(r.left))
		mRight = Math.max(0, Math.round(window.innerWidth - r.right))
		mTop = Math.max(0, Math.round(r.top))
		const b = bodyEl?.getBoundingClientRect() ?? r
		bLeft = Math.max(0, Math.round(b.left))
		bRight = Math.max(0, Math.round(window.innerWidth - b.right))
	}
	// The editor lays out as a consistent ¼ | ½ | ¼ across the viewport: it
	// uses a viewport-quarter for the sides and centres the middle to the
	// middle half, whatever the live session's own sides are doing. This keeps
	// the edit screen the same wherever it is opened from.
	//
	// ── the screen-size simulator (P5, ruled 2026-08-30) ────────────────
	// `simTier` is the Move tab's width preset: null = Actual (the real
	// viewport — today's behaviour), otherwise a tier's width from `simulator`.
	// BOTH go through `simulatedGeometry`, so a previewed tier can never drift
	// from what the editor really draws.
	//
	// The simulator is a LENS, not a second layout. Nothing about it is
	// persisted (no per-tier storage, no saved selection): a layout arranged at
	// a narrow tier is the SAME `arrangedGrid` as one arranged at a wide tier,
	// and it will be clamped down — or spread back out — on every other tier,
	// exactly as that device would clamp it. Seeing that clamp is the point.
	//
	// `SimTier`, not `WidgetTier`: Ultrawide is a preset, not a fifth tier — see
	// the type's note in ./simulator.
	let simTier = $state<SimTier | null>(null)
	let simWidth = $derived(
		SIM_OPTIONS.find((o) => o.tier === simTier)?.width ?? null
	)
	// ── the guard that keeps a LOOK from becoming an EDIT ────────────────
	// Drawing a zone narrower re-measures it, so gridstack re-columns and
	// reports the clamped result back through `onChange` — indistinguishable, at
	// that seam, from the user having dragged everything into one column. So
	// previewing Compact would rewrite the real arrangement, and Actual would not
	// spread it back out: a preview button would be a destructive edit.
	//
	// Hence: snapshot on the way in, put it back on the way out — unless a real
	// GESTURE happened while simulating, which the zones report through
	// `onGesture` (gridstack's `change` fires for the clamp too, so it can't be
	// the signal). A gesture at a narrow tier is a deliberate edit to the ONE
	// arrangement, at every size, which is what the panel's note says out loud.
	/** The arrangement as it stood the moment Actual was left. */
	let simSnapshot = $state<Arranged | null>(null)
	/** Whether the user has arranged anything since. */
	let simDirty = $state(false)
	/** A zone reported a user gesture — only meaningful while simulating. */
	function markSimDirty() {
		if (simTier !== null) simDirty = true
	}
	/** Pick a tier, or `null` for Actual. Entering Actual→tier takes the snapshot. */
	function setSimTier(tier: SimTier | null) {
		if (tier === simTier) return
		if (tier === null) {
			exitSimulation()
			return
		}
		// Tier→tier keeps the original snapshot: the arrangement to restore is
		// still the one from before any preview, not the last preview's clamp.
		if (simTier === null) {
			simSnapshot = $state.snapshot(editArranged) as Arranged
			simDirty = false
		}
		simTier = tier
	}
	/**
	 * Back to Actual, restoring the pre-preview arrangement unless the user
	 * earned the simulated one. The zones re-seed themselves: leaving the
	 * simulated branch destroys the whole edit canvas and rebuilds it from
	 * `editArranged` (fresh `GridStackZone`s, `withGeometry` off the restored
	 * blob), so putting the state back is the whole job. Safe to call when not
	 * simulating — Done leans on that.
	 */
	function exitSimulation() {
		if (simTier === null) return
		editArranged = simulationExit(
			simSnapshot,
			$state.snapshot(editArranged) as Arranged,
			simDirty
		).arranged
		simTier = null
		simSnapshot = null
		simDirty = false
	}

	/* ── measured width (never the viewport) ───────────────────────── */
	let rootEl: HTMLDivElement | null = $state(null)
	/**
	 * `.layout-body`, the row of Left | Middle | Right. UNCAPPED (ruled
	 * 2026-09-27): a cap would leave part of a wide screen empty whatever the
	 * layout asked for. The stage is centred by the middle zone's balance
	 * (`measureStage`), so the zones take the width the window gives them.
	 */
	let bodyEl: HTMLDivElement | null = $state(null)
	let containerW = $state(1024)

	/* ── the centred stage (ruled 2026-09-27; ./tuckedSides) ────────────────
	 * The conversation's column sits in the middle of the body, not in the
	 * middle of what the sides leave: the lighter end needs a balance as wide
	 * as the difference, paid only out of room the stage's measure does not
	 * need. The MIDDLE ZONE carries it (revised 2026-09-27, "the whole panel
	 * scrolls"): `.layout-center` runs from side to side with no body padding,
	 * the widgets in it fill that width, and the balance reaches the column as
	 * `--sp-stage-balance-start` / `-end` (styles/conversation.css). Measured
	 * rather than summed — a side is a rail, an icon strip or an arranged
	 * column, each with its own box — as the distance from each body edge to
	 * the middle; the balance is inside the middle, so writing it cannot
	 * change what it was computed from. */
	let centerEl: HTMLDivElement | null = $state(null)
	/**
	 * A classic scrollbar's width on this platform (0 for overlay
	 * scrollbars), measured once on mount. The balance plans
	 * the stage as its measure plus one of these on each edge (`stagePlanPx`),
	 * the room the conversation's scroll region keeps so its rows centre where
	 * the composer does.
	 */
	let scrollbarPx = $state(0)
	let stagePlan = $derived(stagePlanPx(scrollbarPx))
	let gutters = $state<Gutters>({ start: 0, end: 0 })
	/** Body edge → the column's area, balance included: where a tucked flyout stops. */
	let flowEdge = $state<Gutters>({ start: 0, end: 0 })
	/**
	 * Which ends of the middle zone have a side in the flow next to them. The
	 * middle reaches over the body gap on those ends (a negative margin of
	 * the gap), so the conversation covers the gap too and no strip between
	 * a side and the column is outside a widget. The sides and every width
	 * sum keep the gap exactly as before; only the middle's box grows into it.
	 * Stable: covering the gap leaves the side itself between the body edge
	 * and the middle, so the measure that set it still reads > 0.
	 */
	let middleOverGap = $state({ start: false, end: false })
	function measureStage() {
		if (!bodyEl || !centerEl) return
		const b = bodyEl.getBoundingClientRect()
		const c = centerEl.getBoundingClientRect()
		if (!(b.width > 0) || !(c.width > 0)) return
		const start = Math.max(0, Math.round(c.left - b.left))
		const end = Math.max(0, Math.round(b.right - c.right))
		// What the box just measured was drawn with: the gap already covered
		// or not yet.
		const drawn = middleOverGap
		const over = { start: start > 0, end: end > 0 }
		if (over.start !== drawn.start || over.end !== drawn.end)
			middleOverGap = over
		const next = balancedGutters({
			bodyPx: Math.round(b.width),
			startPx: start,
			endPx: end,
			stagePx: stagePlan
		})
		if (next.start !== gutters.start || next.end !== gutters.end)
			gutters = next
		// A tucked flyout stops where it always did: past the gap as well.
		const edge = {
			start: start + (drawn.start ? BODY_GAP_PX : 0) + next.start,
			end: end + (drawn.end ? BODY_GAP_PX : 0) + next.end
		}
		if (edge.start !== flowEdge.start || edge.end !== flowEdge.end)
			flowEdge = edge
	}
	$effect(() => {
		const body = bodyEl
		const centre = centerEl
		if (!body || !centre) return
		const ro = new ResizeObserver(() => measureStage())
		ro.observe(body)
		ro.observe(centre)
		untrack(measureStage)
		return () => ro.disconnect()
	})

	// The editor's zone widths, for the real viewport or a simulated tier —
	// declared here because the scale needs `containerW` above.
	let editGeom: SimGeometry = $derived(
		simulatedGeometry(simWidth ?? vw, GS_CELL_PX, {
			// Only a SIMULATED frame can be wider than the space it is drawn in
			// — the real viewport is by definition its own available width, so
			// Actual is never scaled. The frame is drawn inside the root, so
			// the root's measured width (less a gutter) is what it may occupy.
			available: simWidth == null ? undefined : containerW - 24
		})
	)
	/** Frame scale as a percent; 100 = drawn at true size. */
	let simPct = $derived(Math.round(editGeom.scale * 100))

	onMount(() => {
		if (!rootEl) return
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (w) {
				containerW = w
				manager.setWidth(w) // keep the manager's tier honest for panels
			}
			updateMargins()
		})
		ro.observe(rootEl)
		containerW = rootEl.clientWidth || containerW
		{
			const probe = document.createElement("div")
			probe.style.cssText =
				"position:absolute;inset-block-start:-9999px;inline-size:100px;block-size:100px;overflow:auto;scrollbar-gutter:stable;visibility:hidden"
			// What a `scrollbar-gutter: stable` region RESERVES — the room the
			// conversation's scroll region keeps — rather than what a drawn
			// scrollbar takes: a browser run with hidden scrollbars (headless
			// Chromium) draws none yet still reserves the gutter.
			rootEl.appendChild(probe)
			scrollbarPx = Math.max(0, probe.offsetWidth - probe.clientWidth)
			probe.remove()
		}
		manager.setWidth(containerW)

		const mq = window.matchMedia("(min-width: 1024px)")
		isDesktop = mq.matches
		mounted = true
		const onMq = () => (isDesktop = mq.matches)
		mq.addEventListener("change", onMq)
		const onWin = () => updateMargins()
		window.addEventListener("resize", onWin)
		window.addEventListener("scroll", onWin, true)
		updateMargins()
		return () => {
			ro.disconnect()
			mq.removeEventListener("change", onMq)
			window.removeEventListener("resize", onWin)
			window.removeEventListener("scroll", onWin, true)
			// The header's panels button is app-wide state; leaving the session
			// has to retract it, or it would follow the user onto every other
			// page — the menu it opens with it.
			mobileSidePanels.setSides(false, 0, 0)
			mobileSidePanels.setGroups([])
			mobileSidePanels.menuOpen = false
			// Same reason: leaving the session while editing has to give the
			// shell its session header and Jump pill back.
			layoutEditor.open = false
		}
	})

	// A sidebar opening/closing reflows main → the measured offsets change;
	// recompute after the DOM settles. (rootEl's ResizeObserver also catches
	// most of it.)
	$effect(() => {
		void (panelsCtx as any)?.leftPanel
		void (panelsCtx as any)?.rightPanel
		requestAnimationFrame(updateMargins)
	})

	/* ── the effective layout ──────────────────────────────────────── */
	// Seed: with no saved template, active secondaries land in the right zone.
	let activeSecondaryIds = $derived(
		manager.instances
			.filter((p) => p.role !== "primary" && p.active)
			.map((p) => p.id)
	)
	let saved = $derived(
		normalizeZoneLayout(manager.effectiveZoneLayout, activeSecondaryIds)
	)
	// Widgets activated after the template was saved (channel intents, the old
	// grid menu) still need a home: append them to the first side zone. A widget
	// the MIDDLE grid places is already at home — the zone template does not name
	// the middle, so without this a preset's own strip lands in a side rail as
	// well and renders twice.
	//
	// A grid entry that names a SIDE zone (a preset's or a hand-written blob —
	// the editor never writes one; `loadChatLayout` keeps the zone it names,
	// the conversation's included) is drawn in that side: folded into the
	// side's first zone here, after what the list already holds. Done then
	// writes it into the list for good (./donePlacement).
	let layout = $derived.by((): ZoneLayout => {
		const sideZoneOf = (side: "left" | "right") =>
			Object.entries(saved.zones).find(
				([, z]) => z.kind === "side" && (side === "left" ? z.side === "left" : z.side !== "left")
			)?.[0]
		let out = saved
		for (const w of chatGrid.widgets) {
			if (w.zone === "middle" || placedWidgetIds(out).includes(w.id)) continue
			const host = sideZoneOf(w.zone)
			if (host) out = withWidget(out, host, w.id)
		}
		const placed = new Set([
			...placedWidgetIds(out),
			...chatGrid.widgets.map((w) => w.id)
		])
		const extras = activeSecondaryIds.filter((id) => !placed.has(id))
		if (!extras.length) return out
		const host = sideZoneOf("right") ?? Object.keys(out.zones)[0]
		return extras.reduce((l, id) => withWidget(l, host, id), out)
	})

	function commit(next: ZoneLayout) {
		manager.setZoneLayout(next)
	}
	/**
	 * `commit`'s sibling for the other half of the membership model: the SIDE
	 * zones' widgets live in the zone template above, the MIDDLE's in the chat
	 * widget grid, which that template never names. See `place`.
	 */
	function commitGrid(next: GridLayout) {
		manager.setWidgetGrid(next)
	}

	/** Every zone as the ladder resolves it at this width — the DOCKED answer. */
	let resolvedDocked = $derived(
		Object.entries(layout.zones).map(([id, def]) =>
			resolveZone(id, def, containerW)
		)
	)
	/**
	 * What is drawn. While the sides are tucked (./tuckedSides) a docked rail
	 * is drawn as its icon strip, the same one an unpinned zone has always
	 * had; nothing is written, so untucking draws the rail again.
	 */
	let resolved = $derived(
		tuckedNow()
			? resolvedDocked.map((z) =>
					z.def.kind === "side" && z.mode === "rail"
						? { ...z, mode: "icons" as const }
						: z
				)
			: resolvedDocked
	)
	let leftZones = $derived(
		resolved.filter((z) => z.def.kind === "side" && z.def.side === "left")
	)
	let rightZones = $derived(
		resolved.filter((z) => z.def.kind === "side" && z.def.side !== "left")
	)
	let topStrips = $derived(
		resolved.filter((z) => z.def.kind === "strip" && z.def.area !== "bottom")
	)
	let bottomStrips = $derived(
		resolved.filter((z) => z.def.kind === "strip" && z.def.area === "bottom")
	)

	/* ── the message style packs ───────────────────────────────────────────
	 * The packs are per-widget STYLES now (ruled 2026-08-30): shipped
	 * `widget_styles` rows the widget's own `WidgetHost` injects, picked from
	 * the widget's own overlay. Two things are left here.
	 *
	 * ONE: the layout blob's old `styles.chat` choice is pushed to the store as
	 * a fallback UNDER the pins, so a session saved before the change still
	 * opens on the look it was saved with. It is derived, never written back —
	 * the first pick from the overlay writes a real pin and this stops
	 * mattering. Cleared on teardown so it cannot leak into the next session.
	 *
	 * TWO: `data-msg-layout` is still written on `.chat-core`, from the RESOLVED
	 * style rather than the blob. TRANSITIONAL, for one release: nothing in this
	 * repo keys off it any more (the packs' rules moved into the style rows), so
	 * it is there for CSS outside it. Drop it after 0.6. */
	$effect(() => {
		setLegacyStylePacks(layout.styles ?? null)
		return () => setLegacyStylePacks(null)
	})
	// Called for the subscription — the same contract WidgetHost keeps: it
	// starts the one fetch, and the deriveds below read the same module state,
	// so they re-run when the rows or the pins land.
	widgetStylesStore()
	let msgLayoutAttr = $derived(
		legacyLayoutAttr("messages", resolveWidgetStyle("messages")?.slug)
	)

	function inst(id: string): PanelInstance | undefined {
		return manager.instances.find((p) => p.id === id)
	}
	/**
	 * Is this placed id drawn as the conversation — a `messages` instance, the
	 * bare id included (brief 7a: the log may sit in a side), or a copy
	 * (`messages#sanctum`, S1)? Never a panel instance, so `inst()` does not
	 * know it. A genre that withholds the conversation (R71) draws none.
	 */
	const isConversation = (id: string) =>
		isInstanceOf(id, "messages") && !manager.omitted.has("messages")
	/**
	 * What a zone draws, lists and counts, in the zone's own order — its
	 * panel instances and its conversations (./panelWidgets `zoneEntries`, the
	 * one reader for the rail, the icon strip, the editor's side lists, the
	 * side counts and the phone's panels menu).
	 */
	function zoneEntriesOf(z: ResolvedZone): ZoneEntry[] {
		return zoneEntries(z.def.widgets, manager.instances, isConversation, widgetLabel)
	}
	/** An entry's icon, as a component to draw with. */
	function entryIcon(e: ZoneEntry) {
		if (!e.panel) return middleWidgetIcon(e.id)
		return iconOf(e.panel)
	}
	/**
	 * A zone as ./sideSlot's populated test reads it: its mode and its entry
	 * count, conversation copies included — so the desktop's empty column and
	 * the phone's panels menu answer one question the same way.
	 */
	function zoneFill(z: ResolvedZone): SideZoneFill {
		return { mode: z.mode, entries: zoneEntriesOf(z).length }
	}
	function iconOf(p: PanelInstance) {
		return (p.icon && (Icons as any)[p.icon]) || Icons.LayoutPanelTop
	}
	function labelOf(z: ResolvedZone): string {
		return z.def.label ?? z.id
	}

	/* ── the visual grid editor (PLAN 25) ──────────────────────────────────
	 * Edit mode's Widgets tab is a live map of the whole layout: the three
	 * zones (Left / Middle / Right) drawn as cell grids, every placed widget a
	 * card sitting in its cells, and the palette of everything not yet placed.
	 * There is no top/bottom — a widget that wants to be at the top is just
	 * anchored to the top of its zone. Placement here writes straight through
	 * the same commit path the live layout reads, so what you arrange is what
	 * you get. */
	// The canonical side zones the editor targets (one per side). A saved
	// layout may still carry extra/legacy zones; the editor works the primary
	// left/right pair and leaves any others to the raw JSON escape hatch.
	let leftZoneId = $derived(leftZones[0]?.id ?? null)
	let rightZoneId = $derived(rightZones[0]?.id ?? null)
	let editorLeftPanels = $derived(leftZones.flatMap(zoneEntriesOf))
	let editorRightPanels = $derived(rightZones.flatMap(zoneEntriesOf))
	function middleWidgetLabel(id: string): string {
		return isInstanceOf(id, "messages") ? "Messages" : id
	}
	function middleWidgetIcon(_id: string) {
		return Icons.MessagesSquare
	}
	// The editor draws cells at the SAME module the live grid uses, so the cell
	// count you see = the cell count you get.
	const EDITOR_CELL = DEFAULT_CELL

	// The editor renders each zone through the real WidgetZone engine, so a
	// widget's grow/fixed/anchor shows exactly as it will on Done — the editor
	// is the live layout plus cell guides.
	//   Middle: the real chat grid, at the editor's cell module.
	let editorMiddleGrid = $derived<GridLayout>({
		...chatGrid,
		cell: EDITOR_CELL
	})
	//   Sides: each panel is a full-width widget (grow width, a min-height so an
	//   empty card reads as a real block), top-anchored — the panel stack.
	function editorSideGrid(zoneKey: Zone, panels: { id: string }[]): GridLayout {
		return {
			version: 1,
			cell: EDITOR_CELL,
			widgets: panels.map(
				(p, i): WidgetConfig => ({
					id: p.id,
					zone: zoneKey,
					order: i,
					size: { w: "grow", h: { minCells: 3 } },
					anchor: { top: true, left: true, right: true }
				})
			)
		}
	}
	let editorLeftGrid = $derived(editorSideGrid("left", editorLeftPanels))
	let editorRightGrid = $derived(editorSideGrid("right", editorRightPanels))

	// ── gridstack-backed editor items ──────────────────────────────────────
	// Each zone hands gridstack a plain {id,title,size,floorNote} list; gridstack
	// owns drag/resize/snap. The list is keyed by its ids, so adding/removing a
	// widget (palette drop, remove) re-seeds the grid, while a drag/resize —
	// which changes only positions, not the id set — leaves it untouched.
	// ── connector: editor arrangement → live render + persistence ───────────
	// TWO arrangements, because they answer two different questions.
	//
	// `editArranged` is the EDITOR's working copy: the gridstack zones report
	// each zone's arrangement (cell dims + item cells) into it as you edit, and
	// it is seeded from persistence every time the editor opens (and re-seeded
	// by reset / apply-preset, which change what "persisted" means). Committed
	// on Done.
	//
	// `arranged` is what the LIVE view draws, and it is DERIVED, never a
	// `$state` seeded once at construction: the layout blob arrives on
	// `sessions:panelLayout:get`, after this component exists, so a one-time
	// seed would draw the pre-edit default until the editor opened. The
	// manager is read reactively, and a load, a preset applied, or the active
	// preset deleted all repaint on their own.
	//
	// While editing it is the working copy instead, so the live preview under
	// the Presets/Style tabs shows the arrangement in progress rather than the
	// last saved one. A malformed or absent blob yields {} — the pre-edit
	// default render. (Declared here, above the GsItems that read it — and with
	// `editing`, which the derived reads where it is written.)
	let editing = $state(false)
	let editArranged = $state<Arranged>({})
	/**
	 * The zones' membership as the editor opened, and the whole of what Cancel
	 * can put back: adding or removing a widget writes straight through to the
	 * layout, so an editor that could only restore the arrangement would leave
	 * a cancelled add behind.
	 */
	let editZonesSnapshot = $state<ZoneLayout | null>(null)
	/**
	 * Which secondaries were ACTIVE as the editor opened — the other half of
	 * what Cancel puts back. Adding a widget activates its panel and removing
	 * one closes it, and `layout` below re-injects every active-but-unplaced
	 * secondary into a side zone, so restoring the zones alone would hand a
	 * cancelled add straight back on the right and leave a cancelled removal
	 * gone. Not `$state`: nothing renders it, and a `$state(new Set())` would
	 * not be reactive on mutation anyway.
	 */
	let editActiveSnapshot: Set<string> | null = null
	/**
	 * The MIDDLE's membership as the editor opened — the third thing Cancel
	 * puts back, because adding or removing a widget there writes straight
	 * through to the widget grid and `editZonesSnapshot` cannot see it.
	 *
	 * The manager's OWN slot, never `effectiveWidgetGrid`: a session on a
	 * preset has this unset, and reading the effective one back would copy the
	 * preset's content into this user's column — turning a live reference into
	 * a snapshot (see the manager's `baseLayout`). Boxed so that `undefined`
	 * is a value to restore rather than "nothing was taken". Not `$state`:
	 * nothing renders it.
	 */
	let editWidgetGridSnapshot: { value: unknown } | null = null
	/**
	 * The last cross-zone drop, as the destination zone reported it. The one
	 * event that names a widget AND the zone that now holds it, so it is what
	 * `commitArrangement`'s one-zone-per-widget invariant breaks a tie with.
	 * Not `$state`: nothing renders it.
	 */
	let lastDropped: { id: string; zone: ZoneKey } | null = null
	let arranged = $derived<Arranged>(
		editing ? editArranged : floored.arranged
	)

	// Each list carries its default placement (place/h); `withGeometry` overlays
	// any saved x/y/w/h from the working copy so re-opening the editor restores
	// what was arranged rather than re-laying-out from defaults (the
	// reset-to-defaults bug).
	let middleGsItems = $derived<GsItem[]>(
		withGeometry(
			widgetsInZone(chatGrid, "middle").map((w) => ({
				id: w.id,
				title: widgetLabel(w.id),
				// The primary floor: the LAST placed Messages (or an R71
				// genre's own primary) offers no ×, and says why. Every card
				// moves, into any zone — placement is free (brief 7a).
				...floorNoteProp(w.id),
				// The chat's bound default, read off the widget rather than its
				// name: a GROW height fills what is left, a FIXED one docks three
				// cells deep against the edge it anchors to. Both full-width.
				...(w.size.h === "grow"
					? { place: "fill" as const }
					: {
							place: (w.anchor.bottom
								? "bottom"
								: "top") as GsItem["place"],
							h: 3
						})
			})),
			editArranged.middle
		)
	)
	let leftGsItems = $derived<GsItem[]>(
		withGeometry(
			editorLeftPanels.map((p) => ({
				id: p.id,
				title: p.title,
				h: 3,
				...floorNoteProp(p.id)
			})),
			editArranged.left
		)
	)
	let rightGsItems = $derived<GsItem[]>(
		withGeometry(
			editorRightPanels.map((p) => ({
				id: p.id,
				title: p.title,
				h: 3,
				...floorNoteProp(p.id)
			})),
			editArranged.right
		)
	)
	/**
	 * The primary floor's note for a widget (./primaryFloor): what its card
	 * says in place of the × when it is the last placed instance of the
	 * genre's primary widget, else null. Counted over `placedIds` — the side
	 * lists, the grid and the arrangement (the working one while editing).
	 */
	function floorNoteOf(id: string): string | null {
		if (!floorKeeps(id, placedIds, primaryId)) return null
		const decl = CORE_WIDGETS.find((w) => w.id === widgetOfInstance(id))
		return floorNote(decl?.title ?? inst(id)?.title ?? widgetLabel(id))
	}
	function floorNoteProp(id: string): { floorNote?: string } {
		const note = floorNoteOf(id)
		return note ? { floorNote: note } : {}
	}

	/**
	 * justify/align-self for an arranged cell from a widget's anchor edges — the
	 * connector's analog of widgetItemStyle's anchoring. Default (no anchor) is
	 * stretch, so an unanchored widget renders exactly as before; only a widget
	 * the user explicitly anchored changes.
	 */
	function cellSelfAlign(near?: boolean, far?: boolean): string {
		if (near && far) return "stretch"
		if (near) return "start"
		if (far) return "end"
		return "stretch"
	}
	function anchorCellStyle(a?: GsAnchor): string {
		if (!a) return ""
		return `justify-self:${cellSelfAlign(a.left, a.right)};align-self:${cellSelfAlign(a.top, a.bottom)};`
	}

	// ── live tab groups ────────────────────────────────────────────────────
	// Widgets sharing a `group` collapse in the LIVE view to ONE footprint and
	// render as a tab set — click a tab to switch. Members stay mounted
	// (shown/hidden), never unmounted, so a panel/frame keeps its state across
	// tab switches (the no-reload law). The EDITOR keeps grouped cards separate
	// (individually draggable / un-groupable) — only these live renderers collapse
	// them. `unitsOf` (with the scattered-overlap guard) lives in ./tabGroups.
	// Which member is showing in each tab group (keyed by group id). Defaults to
	// the first member; falls back if the remembered one is not present.
	let activeTabs = $state<Record<string, string>>({})
	function activeTab(u: RenderUnit): string {
		const a = activeTabs[u.key]
		return a && u.members.some((m) => m.id === a) ? a : u.members[0].id
	}
	function setActiveTab(key: string, id: string) {
		activeTabs = { ...activeTabs, [key]: id }
	}
	/* ── per-widget settings (PLAN 25, ruled 2026-09-10) ────────────────────
	 * Every widget on screen is either a panel instance or one of the two
	 * primaries, which are snippets rather than instances — so this is the one
	 * place that can name them all. The declarations go to the store the
	 * overlays read, and `resolvedWidget` is what every mount and label here
	 * threads: the title override, the lane, and the settings themselves. */
	function widgetDeclOf(id: string): WidgetSettingsDecl {
		const p = inst(id)
		if (p && p.role !== "primary")
			return {
				id,
				title: p.title,
				channels: p.channels,
				settings: p.settings
			}
		// A copy (`messages#sanctum`) is declared by its widget; a
		// conversation copy pinned to a channel is titled by the channel's
		// declared label (S1: the panel reads _Sanctum_).
		const core = CORE_WIDGETS.find((w) => w.id === widgetOfInstance(id))
		return {
			id,
			title: pinnedChannelTitle(id) ?? core?.title ?? middleWidgetLabel(id),
			channels: core?.channels,
			settings: core?.settings
		}
	}
	/**
	 * A conversation copy's title when it claims a channel: the channel's
	 * label in the viewer's language (`composer.channelLabels`, off
	 * `ChannelDecl.label`), else its slug title-cased. Read off the stored
	 * settings, not `resolvedWidget` — that resolves THROUGH this.
	 */
	function pinnedChannelTitle(id: string): string | undefined {
		if (!isInstanceOf(id, "messages")) return undefined
		const claim = widgetSettingValues(id).channel
		if (typeof claim !== "string" || !claim.trim()) return undefined
		const slug = claim.trim()
		return (
			conversationDossier?.composer.channelLabels?.[slug] ??
			slug
				.split(/[-_]/)
				.filter(Boolean)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(" ")
		)
	}
	function resolvedWidget(id: string) {
		return resolveWidgetInstance(widgetDeclOf(id), widgetSettingValues(id))
	}
	$effect(() => {
		const out: Record<string, WidgetSettingsDecl> = {}
		for (const w of CORE_WIDGETS)
			if (!manager.omitted.has(w.id))
				out[w.id] = {
				id: w.id,
				title: w.title,
				channels: w.channels,
				settings: w.settings
			}
		for (const p of manager.instances)
			if (p.role !== "primary")
				out[p.id] = {
					id: p.id,
					title: p.title,
					channels: p.channels,
					settings: p.settings
				}
		// A placed copy of a core widget (S1) has its own settings under its
		// own id, declared by its widget.
		for (const id of placedIds)
			if (id !== widgetOfInstance(id) && !out[id]) out[id] = widgetDeclOf(id)
		setWidgetSettingDecls(out)
	})

	/**
	 * Every id this layout places, anywhere: the side zones, the middle grid
	 * and the saved arrangement. The one list the channel claims (S1) and the
	 * copies' declarations read.
	 */
	let placedIds = $derived(
		new Set<string>([
			...placedWidgetIds(layout),
			...middleGridIds,
			...(arranged.left?.items ?? []).map((i) => i.id),
			...(arranged.middle?.items ?? []).map((i) => i.id),
			...(arranged.right?.items ?? []).map((i) => i.id)
		])
	)
	/**
	 * Which placed conversation copy claims which channel (S1): a copy with a
	 * `channel` setting shows that channel alone; the others share the rest.
	 */
	let claims = $derived(
		channelClaims(placedIds, (id) => widgetSettingValues(id))
	)
	/**
	 * The layout's primary log (./channelClaims `primaryLogOf`): the first
	 * unclaimed Messages in reading order, else the first Messages. When it
	 * claims a channel — no unclaimed copy is placed — it also shows what no
	 * copy claims, so `main` never leaves the session with the log it was in.
	 */
	let primaryLog = $derived.by(() =>
		primaryLogOf(
			[...readingOrder.middle, ...readingOrder.left, ...readingOrder.right],
			claims
		)
	)
	/**
	 * The dossier one conversation copy is handed: the page's, with its
	 * composer told only this copy's channels — the rows it draws and the
	 * lanes its strip offers. The page's own object when nothing narrows it.
	 */
	function dossierFor(id: string): ConversationDossierV1 | null {
		const d = conversationDossier
		if (!d) return d
		const all = d.composer.channels
		const mine = channelsForCopy(all, claims, id, primaryLog)
		if (mine.length === all.length && mine.every((c, i) => c === all[i]))
			return d
		return { ...d, composer: { ...d.composer, channels: mine } }
	}

	function widgetLabel(id: string): string {
		return resolvedWidget(id).title
	}

	/* ── real placement for the arranged renderers (PLAN 25) ───────────────
	 * A widget's `layout.v1` has to describe the cells it is actually in, and
	 * the arranged zones are the one place that geometry already exists in full:
	 * `arr.cols`/`arr.rows` are the zone's cell grid and each render unit's box
	 * is the widget's x/y/w/h in it. So the placement is a repackaging, not a
	 * second layout pass — `placementOf` derives the zone edges the box touches
	 * and the tier from the cell's measured width.
	 *
	 * Widths are measured per CELL rather than divided out of the zone: the
	 * tracks are `1fr`, so their real size is the browser's answer. Keyed by
	 * `zone:unitKey` in one map because the same widget can be measured in more
	 * than one place at once, and each mount has its own box.
	 * Unmeasured for a frame → 0 → `compact`, corrected by an ordinary
	 * `layout:changed`. */
	/**
	 * The conversation's channel declaration: none, i.e. the whole log — for
	 * every copy of it. Which channels a copy SHOWS is not this (S1): a
	 * declared list switches the wire to per-lane posts the conversation does
	 * not read, so the host narrows the copy's dossier instead (`dossierFor`:
	 * its composer's channels), and the conversation draws those rows alone.
	 *
	 * A constant rather than an `[]` literal in the mount below because a widget
	 * host SUBSCRIBES against this array — a fresh literal on every re-render
	 * (and the middle re-renders on every message) would tear that subscription
	 * down and rebuild it each time, for a value that never changes.
	 */
	const ALL_CHANNELS: string[] = []

	let cellWidths = $state<Record<string, number>>({})
	/* The block size of the same cells, keyed the same way. Bound beside the
	   width so the contract's `layout.v1.box.px` can report a real box: cell
	   COUNTS are the interim grid's and lose their meaning under the layout
	   document, while the pixels a browser resolved keep it whatever the
	   tracks are made of. Absent until both axes have a number. */
	let cellHeights = $state<Record<string, number>>({})
	function unitPlacement(
		zone: { cols: number; rows: number },
		u: RenderUnit,
		widthPx: number,
		id: string,
		heightPx?: number
	): PlacementInput {
		// Geometry is the UNIT's — grouped widgets share one footprint, which is
		// what a tab group is — while pinned/collapsed and the chrome are the
		// individual widget's.
		const p = inst(id)
		const primary = isInstanceOf(id, "messages")
		return placementOf({
			zone: { cols: zone.cols, rows: zone.rows },
			box: u.box,
			widthPx,
			heightPx,
			// The contract's `pinned`: "placed in the grid, not collapsible /
			// closable away". The conversation — and an R71 genre's own
			// primary — never collapses or closes away wherever it is placed;
			// for a panel it is its own declaration.
			pinned:
				primary || p?.role === "primary"
					? true
					: !(p?.layout.closable ?? true),
			collapsed: p?.collapsed ?? false,
			// Nothing in an arranged zone is drawered — the zone places its
			// widgets (Panel's `chrome="zone"`), and the drawer rail is the
			// pack-era host.
			drawered: false,
			// Told, not derived. `deriveChrome`'s rule (pinned or drawered ⇒ the
			// host paints) is the pack-era host's; here the answer is simply
			// known — `Panel` paints a card and a title bar for every secondary,
			// and the primary widget renders full-bleed with neither. A
			// grouped member's title comes from its TAB, so it gets no bar.
			chrome: primary
				? { background: false, wrapper: false, titleBar: false }
				: {
						background: true,
						wrapper: true,
						titleBar: u.members.length === 1
					}
		})
	}

	/**
	 * The widgets that can wear a `widget_styles` skin: every id placed
	 * ANYWHERE in this layout — side zones, the middle grid, or the saved
	 * arrangement — that is backed by a real panel instance.
	 *
	 * Since the ruling of 2026-09-09 the CONTROLS are not built from this list
	 * — each widget grows its own overlay from inside its `WidgetHost`, which
	 * is the only thing that knows a widget is skinnable at all. What is left
	 * for this list is the Style panel's one line of guidance: with nothing
	 * here, there is nothing to hover, and saying so beats an empty panel.
	 *
	 * `messages` is named explicitly because it is a primary SNIPPET rather than
	 * a panel instance — `inst()` has never known it — but it wears a
	 * `WidgetHost` like everything else now (the packs became styles, ruled
	 * 2026-08-30), so it belongs here. Nothing renders without a `WidgetHost`,
	 * so everything in this list is a widget the skin can actually reach.
	 */
	let styleableWidgets = $derived.by(() => {
		const ids = new Set<string>([
			...placedWidgetIds(layout),
			...widgetsInZone(chatGrid, "middle").map((w) => w.id),
			...(arranged.left?.items ?? []).map((i) => i.id),
			...(arranged.middle?.items ?? []).map((i) => i.id),
			...(arranged.right?.items ?? []).map((i) => i.id)
		])
		return [...ids]
			.filter(
				(id) =>
					isInstanceOf(id, "messages") ||
					(inst(id)?.role && inst(id)!.role !== "primary")
			)
			.map((id) => ({ id, label: widgetLabel(id) }))
	})

	/**
	 * Commit editor arrangement on Done: side-zone membership → zoneLayout (for
	 * the palette/active logic), and the full per-zone geometry → arrangedGrid
	 * (positions + anchors + groups — what makes the arrangement survive a reload
	 * and restore into the editor).
	 *
	 * Returns false, having written NOTHING, when Done is refused — QF (1)
	 * (./placementRules): a middle left empty is almost always a move
	 * half-made, so the editor stays open and says so.
	 */
	function commitArrangement(): boolean {
		// Never persist a PREVIEW. Done can be pressed with a tier still showing,
		// and the reset $effect only runs after this handler — so leave simulation
		// here, synchronously, and save the arrangement the user actually made
		// rather than what a phone-width preview clamped it into. A no-op at
		// Actual, and a no-op after a gesture (that arrangement is theirs).
		exitSimulation()
		// The invariant, enforced here because here is where the three zones
		// first exist side by side: a widget id lives in exactly ONE zone. A
		// zone that failed to report a card leaving it would otherwise be
		// committed holding a widget another zone also holds, and the session
		// would draw it twice. The warning is deliberate — a silent repair
		// hides the regression that made the repair necessary.
		const deduped = dedupeArranged(
			$state.snapshot(editArranged) as Arranged,
			lastDropped
		)
		for (const d of deduped.duplicates)
			console.warn(
				`[session layout] "${d.id}" was arranged in more than one zone ` +
					`(${[d.kept, ...d.dropped].join(", ")}); kept ${d.kept}.`
			)
		const arrangement = deduped.arranged
		// Membership, both halves (./donePlacement): each side that reported a
		// frame has its list replaced in row order, and the middle's grid is
		// reconciled against its frame — an ABSENT middle frame is no opinion,
		// never an empty middle (`withGridMembership`). Placement is free: the
		// conversation is written wherever its card was left, a side included.
		const done = placementAtDone({
			zones: layout,
			grid: chatGrid,
			arrangement,
			sideZoneIds: { left: leftZoneId, right: rightZoneId }
		})
		const refusal = emptyMiddleRefusal(done.middle)
		if (refusal) {
			toaster.error({ title: refusal })
			return false
		}
		if (done.zones !== layout) commit(done.zones)
		if (done.grid !== chatGrid) commitGrid(done.grid)
		// The manager is now the live view's only source (`arranged` derives
		// from it), so this write is also what repaints the session behind the
		// editor when Done closes it.
		//
		// ⚠ Except when there is nothing to write. Opening the editor and
		// pressing Done without any zone reporting — only reachable with no
		// widgets at all — leaves `editArranged` empty, and `{}` is TRUTHY:
		// `effectiveArrangedGrid`'s `??` would short-circuit on it and mask the
		// preset base for good, so the session would be stuck on the pre-edit
		// default with no way back but a reset. Stop asserting an arrangement
		// instead, which is what an empty one means and what reset already does.
		if (arrangementIsEmpty(arrangement)) manager.clearArrangement()
		else manager.setArrangedGrid(arrangement)
		return true
	}

	/* ── pop-over (unpinned rails + narrow drawers) ────────────────── */
	let popId = $state<string | null>(null)
	/**
	 * Every zone popped over at least once, kept (unit M): its flyout is
	 * mounted the first time it opens and HIDDEN when it closes, never
	 * unmounted, so closing and reopening a flyout remounts (and reloads) no
	 * widget in it. Only while the zone still pops over: pinned, its
	 * widgets live in its rail instead.
	 */
	const poppedZones = new SvelteSet<string>()
	$effect(() => {
		if (popId) poppedZones.add(popId)
	})
	let keptPops = $derived(resolved.filter((z) => poppedZones.has(z.id) && z.mode !== "rail"))

	/* ── the tucked flyout (ruled 2026-09-27; ./tuckedSides) ───────────────
	 * While the sides are tucked, a rail icon brings ITS panel out over the
	 * session, one at a time across both sides: opening another puts the first
	 * away, and Esc or an outside click puts it away. It is the same flyout
	 * both paths already had — an arranged group's cell positioned over the
	 * session (`cell-flyout`), an un-arranged zone's `.zone-flyout` — driven by
	 * this one value instead of by `groupOpen` / `popId`, which keep the docked
	 * choices for when the sides untuck. Transient; nothing is persisted. */
	let tuckedFlyout = $state<TuckedFlyout | null>(null)
	/** The rail icon that opened it — where focus goes back to. */
	let tuckedTrigger: HTMLElement | null = null
	/**
	 * The widget an un-arranged zone's flyout shows while tucked, by zone.
	 * Kept after it closes so the closed flyout keeps the SAME mount hidden
	 * (the keep-alive `keptPops` exists for) rather than filling with the
	 * zone's other widgets.
	 */
	let tuckedShown = $state<Record<string, string>>({})
	/** The un-arranged zone holding the tucked panel that is out, if any. */
	let tuckedZoneId = $derived.by(() => {
		const t = tuckedFlyout
		if (!t || !sidesAreTucked || arrangedHere(t.side)) return null
		const zones = t.side === "left" ? leftZones : rightZones
		return zones.find((z) => z.def.widgets.includes(t.key))?.id ?? null
	})
	$effect(() => {
		const id = tuckedZoneId
		const t = tuckedFlyout
		if (!id || !t) return
		untrack(() => {
			poppedZones.add(id)
			if (tuckedShown[id] !== t.key) tuckedShown[id] = t.key
		})
	})
	/** A zone narrowed to the one widget its tucked flyout shows. */
	function tuckedZone(z: ResolvedZone): ResolvedZone {
		const id = tuckedShown[z.id]
		return id && z.def.widgets.includes(id)
			? { ...z, def: { ...z.def, widgets: [id] } }
			: z
	}
	function tuckedOpen(side: "left" | "right", key: string): boolean {
		return tuckedFlyout?.side === side && tuckedFlyout.key === key
	}
	/** A rail icon pressed while tucked. */
	function toggleTucked(
		side: "left" | "right",
		key: string,
		trigger: HTMLElement
	) {
		const next = toggleTuckedFlyout(tuckedFlyout, { side, key })
		if (!next) {
			closeTucked(true)
			return
		}
		tuckedFlyout = next
		tuckedTrigger = trigger
		// Focus moves INTO the panel once it is drawn: its first control, or
		// the dialog itself.
		requestAnimationFrame(() => {
			const el = rootEl?.querySelector<HTMLElement>("[data-tucked-flyout]")
			if (!el) return
			const first = focusablesIn(el)[0]
			;(first ?? el).focus({ preventScroll: true })
		})
	}
	/**
	 * Put the tucked panel away. Focus goes back to its rail icon on Esc and
	 * on the icon itself — never on an outside click, which has already put
	 * focus where the user wanted it.
	 */
	function closeTucked(returnFocus: boolean) {
		const back = tuckedTrigger
		tuckedFlyout = null
		tuckedTrigger = null
		if (returnFocus) back?.focus({ preventScroll: true })
	}
	// Untucking puts the panel away: the docked layout is back, and its own
	// open/closed choices with it.
	$effect(() => {
		if (!sidesAreTucked && untrack(() => tuckedFlyout)) closeTucked(false)
	})
	$effect(() => {
		if (!tuckedFlyout) return
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null
			if (t?.closest("[data-pop-keep]")) return
			closeTucked(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return
			// The shell's Escape steps a layer down (Stage only, Focus, the
			// dock) unless something took it — and folding the dock would
			// untuck the sides under the user's hands.
			e.preventDefault()
			closeTucked(true)
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	function togglePop(zoneId: string, widgetId?: string) {
		if (popId === zoneId && !widgetId) {
			popId = null
			return
		}
		popId = zoneId
		if (widgetId) {
			const p = inst(widgetId)
			if (p?.collapsed) manager.toggleCollapse(widgetId)
			// Scroll the tapped widget into view once the flyout paints.
			requestAnimationFrame(() =>
				rootEl
					?.querySelector(`.zone-flyout [data-panel-id="${widgetId}"]`)
					?.scrollIntoView({ block: "nearest" })
			)
		}
	}

	/**
	 * Which icon holds each rail's one tab stop, keyed by rail (./sideRail
	 * `rovingStep`). Transient UI state, never written to the layout.
	 */
	let railStop = $state<Record<string, number>>({})
	function onRailKeydown(e: KeyboardEvent, rail: string) {
		const bar = (e.currentTarget as HTMLElement).closest("[data-rail]")
		if (!bar) return
		const btns = [...bar.querySelectorAll<HTMLButtonElement>(":scope > button")]
		const at = btns.indexOf(e.currentTarget as HTMLButtonElement)
		const next = rovingStep(e.key, at < 0 ? 0 : at, btns.length)
		if (next == null) return
		e.preventDefault()
		railStop[rail] = next
		btns[next]?.focus()
	}

	// Click-away + Escape close the pop-over (mockup behavior).
	$effect(() => {
		if (!popId) return
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null
			if (t?.closest("[data-pop-keep]")) return
			popId = null
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") popId = null
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	/* ── mobile side panels (P6, ruled 2026-08-30) ──────────────────────────
	 * Below 1024px the side zones are hidden inline entirely — the centre takes
	 * the full width. A populated side is reached from a compact L/R group the
	 * app header grows (Header.svelte + mobileSidePanels.svelte.ts); tapping one
	 * slides that side in over the session as a modal overlay, one at a time.
	 *
	 * It is the SAME overlay the unpinned-rail flyout uses — `.zone-flyout`,
	 * `.pop-scrim`, `panelStack(z, true)` — so a panel that lives in a rail on a
	 * wider screen arrives here as the same manager-owned PanelInstance in a
	 * different container rather than a fresh one (the no-reload law). What it
	 * does NOT reuse is `popId`: the trigger lives outside this component, so the
	 * pop-over's document-level click-away would fight it (its pointerdown closes
	 * what its click then re-opens), and a side may own more than one zone. */
	// A side shows on mobile exactly when it is POPULATED on the desktop: a
	// visible mode with at least one entry, conversation copies included
	// (./sideSlot `zonePopulated`, the same test `populatedHere` asks, so a
	// side is never an empty column on the desktop and listed on the phone).
	let mobileLeftZones = $derived(
		leftZones.filter((z) => zonePopulated(zoneFill(z)))
	)
	let mobileRightZones = $derived(
		rightZones.filter((z) => zonePopulated(zoneFill(z)))
	)
	/* The panels menu's list (ruled 2026-09-10). The two per-side buttons are
	 * gone; one button in the header opens a sheet listing the side groups, and
	 * this is what it lists. An arranged side lists its render units — the same
	 * groups the rail draws — and a side with no arrangement yet lists its zone
	 * widgets, so the menu is never empty while the button is showing.
	 *
	 * While a side is the phone's stage (QE, `stageSide`), its conversation is
	 * the stage rather than a line here, and the MIDDLE's widgets are listed
	 * instead ("Middle"), opening the middle as a sheet of its own.
	 *
	 * `untrack` for the same reason `setSides` needs it: publishing is a write
	 * to shared state this effect must not then depend on. */
	function mobileGroupsOf(side: "left" | "right"): MobileGroup[] {
		const stageId = stageSide === side ? stagePick?.id : undefined
		const units = side === "left" ? leftUnits : rightUnits
		if (units.length)
			return units
				.filter((u) => !stageId || !u.members.some((m) => m.id === stageId))
				.map((u) => ({
					side,
					key: u.key,
					title: groupTitle(u),
					icon: groupIconName(u),
					pinned: groupPinned(u)
				}))
		const zones = side === "left" ? mobileLeftZones : mobileRightZones
		return zones.flatMap((z) =>
			zoneEntriesOf(z)
				.filter((p) => p.id !== stageId)
				.map((p) => ({
					side,
					key: p.id,
					title: p.title,
					icon: p.icon || "LayoutPanelTop",
					pinned: zonePinned(side)
				}))
		)
	}
	/** The middle's widgets as menu lines, while a side is the phone's stage. */
	function mobileMiddleGroups(): MobileGroup[] {
		if (!(stageSide && isNarrow)) return []
		const units: { key: string; members: { id: string }[] }[] = arranged.middle
			? columnUnits(arranged.middle.items)
			: widgetsInZone(chatGrid, "middle").map((w) => ({
					key: w.id,
					members: [{ id: w.id }]
				}))
		return units.map((u) => ({
			side: "middle" as const,
			key: u.key,
			title: u.members.map((m) => widgetLabel(m.id)).join(" · "),
			icon:
				u.members.length > 1
					? "Layers"
					: isConversation(u.members[0].id)
						? "MessagesSquare"
						: inst(u.members[0].id)?.icon || "LayoutPanelTop",
			pinned: true
		}))
	}
	let mobileGroups = $derived<MobileGroup[]>(
		isNarrow
			? [
					...mobileGroupsOf("left"),
					...mobileGroupsOf("right"),
					...mobileMiddleGroups()
				]
			: []
	)
	// The one writer of the shared store: the breakpoint plus how many lines
	// each sheet lists. `untrack` because setSides also RESOLVES `open`
	// (dropping an overlay a resize just invalidated), and reading that back
	// would make this effect depend on its own write.
	$effect(() => {
		const n = isNarrow
		const count = (side: MobileGroup["side"]) =>
			mobileGroups.filter((g) => g.side === side).length
		const l = count("left")
		const r = count("right")
		const m = count("middle")
		untrack(() => mobileSidePanels.setSides(n, l, r, m))
	})
	$effect(() => {
		const groups = mobileGroups
		untrack(() => mobileSidePanels.setGroups(groups))
	})
	/**
	 * A group tapped in the menu: its side's sheet is already opening (the store
	 * set `open`), so all that is left is to make sure the group itself is not
	 * folded, and to bring it into view. Taken exactly once — a pending value is
	 * a request, not a state.
	 */
	$effect(() => {
		if (!mobileSidePanels.pending) return
		untrack(() => {
			const p = mobileSidePanels.takePending()
			if (!p) return
			if (p.side !== "middle") {
				groupOpen[groupKey(p.side, p.key)] = true
				groupFocus[p.side] = p.key
			}
			requestAnimationFrame(() =>
				rootEl
					?.querySelector(
						`:is(.slot-overlay, .center-sheet) [data-group-key="${CSS.escape(p.key)}"]`
					)
					?.scrollIntoView({ block: "nearest" })
			)
		})
	})

	// Crossing INTO mobile retires any desktop pop-over, so coming back out does
	// not re-reveal a flyout the user left open on a wider screen.
	$effect(() => {
		// Tucking retires it too: a tucked zone's flyout is `tuckedFlyout`'s.
		if (isNarrow || sidesAreTucked) popId = null
	})
	let mobileSide = $derived(isNarrow ? mobileSidePanels.open : null)
	/**
	 * Each side's wrapper, by side. The overlay's dialog IS the open side's one
	 * mount (`.slot-overlay` — see `sideMount`), not a second render of it, so
	 * there is no single element to bind for the focus trap: which wrapper is
	 * the dialog changes with `mobileSide`.
	 */
	let sideEls = $state<Record<"left" | "right", HTMLDivElement | null>>({
		left: null,
		right: null
	})
	/** The middle's sheet (QE, `centerSlot`) is `.layout-center` itself. */
	let mobileOverlayEl = $derived(
		mobileSide === "middle"
			? centerEl
			: mobileSide
				? sideEls[mobileSide]
				: null
	)

	/* ── one mount per side, three places (the no-reload law) ───────────────
	 * The live render writes each side zone ONCE and moves the container
	 * around it; `sideSlot` is the whole decision (and its unit tests). It
	 * reads `mobileSide`, so it is declared down here with it rather than up
	 * with the breakpoint. See ./sideSlot for what each slot means, why
	 * "stowed" is a display:none rather than an unmount, and what the retired
	 * `margin` slot was. */
	// `.by`: the stage (`stageSide`) is decided further down, with Stage only.
	let leftSlot = $derived.by(() =>
		sideSlot({
			narrow: isNarrow,
			overlayOwns: mobileSide === "left",
			stage: stageSide === "left"
		})
	)
	let rightSlot = $derived.by(() =>
		sideSlot({
			narrow: isNarrow,
			overlayOwns: mobileSide === "right",
			stage: stageSide === "right"
		})
	)

	/* ── how wide a side is in the FLOW ─────────────────────────────────────
	 * An arranged side is one proportional grid, and a grid has no width of
	 * its own: as a flex child of `.layout-body` it asked for the whole body,
	 * and two of those starved `.layout-center` to 0. The rail it replaces has
	 * always had a definite width — the ladder's answer at this container
	 * width — so the arranged side takes the same footprint and the centre
	 * takes the rest.
	 *
	 * The un-arranged rail carried the SAME starvation, unfired: it is
	 * `flex: none` at that definite width and `.layout-center` is
	 * `min-inline-size: 0`, so two rails wider than the body squeeze the chat
	 * to 0 just as the grids did — it only takes a narrower desktop to reach.
	 * So both paths report here and the body's reserve is computed ONCE
	 * (`sideFlowPx` + `inlineSideWidths`), whichever path each side takes; the
	 * arranged grid wears the answer as its `flex-basis`, the rail as a
	 * `max-inline-size` (`--side-flow-px`, below in the CSS).
	 *
	 * Only the `inline` slot needs any of this — a stowed side has no box in
	 * the flow at all, and the overlay's sheet has a width of its own. See
	 * ./sideSlot for the rule and its tests. */
	/** `.layout-body`'s 0.5rem flex gap — one per side actually in the flow. */
	const BODY_GAP_PX = 8
	/** What the un-arranged rail would occupy: `width × columns`, per the ladder. */
	function ladderPx(zones: ResolvedZone[], side: "left" | "right"): number {
		// One arranged grid stands in for the whole side, so the widest zone's
		// footprint is the side's. An arrangement can also outlive the zones it
		// was captured from — fall back to the side's default ladder then,
		// rather than to no width at all.
		if (zones.length) return Math.max(...zones.map((z) => z.width * z.columns))
		return resolveZone(side, { kind: "side", side, widgets: [] }, containerW)
			.width
	}
	/**
	 * The ladder footprint of each RAIL this side actually draws — `sideZone`'s
	 * own guard, so an empty or hidden zone reserves no rail. (An EMPTY side's
	 * column is asked for separately and softly — `emptyAsk` below, ./sideSlot
	 * `emptyColumnPx` — and a hidden one has none.) An icon strip is not a
	 * rail: it is a fixed 2.25rem the ladder never sized.
	 */
	function railLadderPx(zones: ResolvedZone[]): number[] {
		return zones
			.filter((z) => z.mode === "rail" && zoneEntriesOf(z).length > 0)
			.map((z) => z.width * z.columns)
	}
	/**
	 * Does this side's arrangement actually place anything?
	 *
	 * An arrangement EXISTS the moment a zone reports its cell grid, items or
	 * not — emptying a side leaves `{cols, rows, items: []}` behind, and the
	 * middle deliberately treats that as authoritative (an emptied middle stays
	 * empty). A SIDE's arrangement with no items places nothing, so this is
	 * false for it and the side draws its zones' way instead. That does NOT
	 * make it disappear any more: an empty side keeps an empty column (ruled
	 * 2026-09-29, `emptyAsk` below). What the old `!!arranged.right` got wrong
	 * was the SIZE — it drew the arranged grid with no width reserved, so it
	 * took `.side-column`'s `inline-size: 100%`, shoved the conversation off
	 * centre (seen live after moving a side's only widget to the other side).
	 * The empty column is sized by the same reserve as every other side, and
	 * a box is drawn exactly when its width was granted.
	 */
	function arrangedHere(side: "left" | "right"): boolean {
		return ((side === "left" ? arranged.left : arranged.right)?.items
			.length ?? 0) > 0
	}
	/**
	 * Does this side hold anything — an arranged item, or a visible zone with
	 * an entry, conversation copies included (./sideSlot `sidePopulated`)? The
	 * phone's panels menu asks the same question (`mobileLeftZones`), so a
	 * side holding only a Sanctum copy is populated on both. A side that is
	 * not keeps an EMPTY COLUMN (ruled 2026-09-29, "the columns shouldn't
	 * disappear if the pane is empty"; `emptyAsk` below).
	 */
	function populatedHere(side: "left" | "right", zones: ResolvedZone[]): boolean {
		return sidePopulated({
			arranged: arrangedHere(side),
			zones: zones.map(zoneFill)
		})
	}
	/* ── tucked sides (ruled 2026-09-27; ./tuckedSides) ─────────────────────
	 * Decided from the session's own measured box (`containerW`, the root's
	 * ResizeObserver), never the viewport — an open sidebar narrows the box and
	 * not the window, and that is the case this exists for. The threshold is
	 * the layout's own minimums: each side's DOCKED footprint (the ladder's,
	 * the same `sideFlowPx` the flow reserves) plus a gap each, plus the
	 * stage's measure. Read off `resolvedDocked`, never the drawn zones, so
	 * tucking cannot free the room that would untuck it.
	 *
	 * Not below the breakpoint (the sides are already stowed there, with their
	 * own sheet) and not while the editor is open (it needs the whole layout). */
	function dockedZonesOf(side: "left" | "right"): ResolvedZone[] {
		return resolvedDocked.filter(
			(z) =>
				z.def.kind === "side" &&
				(side === "left" ? z.def.side === "left" : z.def.side !== "left")
		)
	}
	let dockedFlow = $derived({
		left: sideFlowPx({
			slot: leftSlot,
			arranged: arrangedHere("left"),
			arrangedPx: ladderPx(dockedZonesOf("left"), "left"),
			railPx: railLadderPx(dockedZonesOf("left"))
		}),
		right: sideFlowPx({
			slot: rightSlot,
			arranged: arrangedHere("right"),
			arrangedPx: ladderPx(dockedZonesOf("right"), "right"),
			railPx: railLadderPx(dockedZonesOf("right"))
		})
	})
	/**
	 * `resolved` (above) reads the tuck through this hoisted accessor: the
	 * decision needs the docked footprints declared further down, and a
	 * derived's closure is only evaluated after the script has run.
	 */
	function tuckedNow(): boolean {
		return sidesAreTucked
	}
	let sidesAreTucked = $derived(
		mounted &&
			!isNarrow &&
			!editing &&
			sidesTucked({
				leftPx: dockedFlow.left,
				rightPx: dockedFlow.right,
				gapPx: BODY_GAP_PX,
				bodyPx: containerW
			})
	)

	/**
	 * The MIDDLE grows with the window; a docked side keeps its ladder width
	 * (ruled 2026-09-28, reversing the 09-27 fill; ./sideSlot
	 * `dockedZoneWidths`). The conversation's column keeps its measure inside
	 * the wider middle, centred on the session by the balance below.
	 */
	let middleOneColumn = $derived(middleIsOneColumn(arranged.middle?.items ?? []))
	/**
	 * The balance the middle zone hands the conversation's column. Only a
	 * one-column middle has one column to centre: a middle arranged across
	 * has no single column, so it takes its whole width unbalanced — either
	 * way nothing between the sides is left outside a widget.
	 */
	let stageBalance = $derived<Gutters>(
		middleOneColumn ? gutters : { start: 0, end: 0 }
	)
	/** What each side DRAWS in the row — 0 for an empty side. */
	let drawnFlow = $derived({
		left: sideFlowPx({
			slot: leftSlot,
			arranged: arrangedHere("left"),
			arrangedPx: ladderPx(leftZones, "left"),
			railPx: railLadderPx(leftZones),
			tucked: sidesAreTucked
		}),
		right: sideFlowPx({
			slot: rightSlot,
			arranged: arrangedHere("right"),
			arrangedPx: ladderPx(rightZones, "right"),
			railPx: railLadderPx(rightZones),
			tucked: sidesAreTucked
		})
	})
	/**
	 * An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
	 * `emptyColumnPx` / `emptyColumnsPx`): every declared side that docks at
	 * this width — pinned rail or unpinned icon strip — asks for the width its
	 * first widget will have, read off the DOCKED zones. The ask is soft: the
	 * column is granted only from room the populated sides and the stage's
	 * measure do not need, so it gives way before any populated side tucks
	 * (the tuck threshold, `dockedFlow`, never counts it). Tucked, stowed or
	 * in the sheet it asks nothing, and a hidden side has nothing to ask.
	 */
	let emptyColumns = $derived(
		emptyColumnsPx({
			hardLeftPx: drawnFlow.left,
			hardRightPx: drawnFlow.right,
			emptyLeftPx: emptyColumnPx({
				slot: leftSlot,
				tucked: sidesAreTucked,
				populated: populatedHere("left", leftZones),
				zones: dockedZonesOf("left")
			}),
			emptyRightPx: emptyColumnPx({
				slot: rightSlot,
				tucked: sidesAreTucked,
				populated: populatedHere("right", rightZones),
				zones: dockedZonesOf("right")
			}),
			bodyPx: containerW,
			gapPx: BODY_GAP_PX
		})
	)
	let sideWidths = $derived(
		dockedZoneWidths({
			left: drawnFlow.left || emptyColumns.left,
			right: drawnFlow.right || emptyColumns.right,
			bodyPx: containerW,
			gapPx: BODY_GAP_PX
		})
	)
	/** Is this zone's side the phone's open sheet? Momentarily opened, so carded. */
	function inSheet(z: ResolvedZone): boolean {
		return (z.def.side === "left" ? leftSlot : rightSlot) === "overlay"
	}

	/* ── the side rail model (ruled 2026-09-10) ─────────────────────────────
	 * The idea this replaces was a parent side panel that arbitrated the
	 * column's space for everything in it. Instead each docked widget GROUP —
	 * a tab group, or a lone widget, which is a group of one — is its own
	 * toggling panel, and the column is a stack of them plus a slim rail of
	 * icons at its outer edge:
	 *
	 *   (a) a group is EXPANDED in the column or COLLAPSED to a rail icon, so
	 *       enabling more widgets only ever adds icons;
	 *   (b) PINNED groups are expanded by default and KEEP their height when a
	 *       sibling expands;
	 *   (c) a group with no room left beside them opens as a FLYOUT over the
	 *       session at full column height rather than squeezing the column, and
	 *       closes on outside click, Escape or its own rail icon.
	 *
	 * ./sideRail is all three, pure and tested. Of the two inputs it takes,
	 * exactly one is persisted (ruled 2026-09-10): a group's `pinned` is a field
	 * on the arranged ITEMS it is made of (see `unitPinned` / `withPins` in
	 * ./arrangedGeometry), written by the Move tab and saved with the preset,
	 * while `open` — which unpinned groups the user has out right now — is
	 * transient per session view and defaults to exactly `pinned`. So a reload
	 * lands back on the docked layout the user arranged, with nothing else out.
	 */
	/** Measured height of each side's column of groups (0 = not laid out yet). */
	let columnPx = $state<Record<"left" | "right", number>>({ left: 0, right: 0 })
	/** And its width, which is what decides whether widgets still fit side by side. */
	let columnWPx = $state<Record<"left" | "right", number>>({
		left: 0,
		right: 0
	})
	/** Transient per-group open state, keyed `side:groupKey`. Default: pinned. */
	let groupOpen = $state<Record<string, boolean>>({})
	/** The group opened last, per side — the only one allowed to fly out. */
	let groupFocus = $state<Record<"left" | "right", string | null>>({
		left: null,
		right: null
	})

	function zonePinned(side: "left" | "right"): boolean {
		const id = side === "left" ? leftZoneId : rightZoneId
		return id ? layout.zones[id]?.pinned !== false : true
	}
	function groupKey(side: "left" | "right", key: string): string {
		return `${side}:${key}`
	}
	/**
	 * A group's pin, read off the arrangement it is made of.
	 *
	 * NOT the zone's pin any more. That one is still the un-arranged rail's
	 * (docked rail vs icon strip — `zonePinned` above, and `setPinned`); an
	 * ARRANGED side has a pin per group instead, and an arrangement that
	 * carries none reads as all pinned, which is what such a side already drew.
	 */
	function groupPinned(u: RenderUnit): boolean {
		return unitPinned(u.members)
	}
	function groupIsOpen(side: "left" | "right", u: RenderUnit): boolean {
		return groupOpen[groupKey(side, u.key)] ?? groupPinned(u)
	}
	/**
	 * The column's groups, top to bottom. Sorted by the arrangement's own cells
	 * — a pure function of the saved geometry, so the order never changes as
	 * groups open and close. It must not: a keyed `{#each}` MOVES its nodes to
	 * follow a reorder, and moving an iframe reloads it.
	 */
	function columnUnits(items: GsPos[]): RenderUnit[] {
		return unitsOf(items).sort(
			(a, b) => a.box.y - b.box.y || a.box.x - b.box.x
		)
	}
	/** A group's icon: its widget's, or the stacked one for a tab group. */
	function groupIcon(u: RenderUnit) {
		if (u.members.length > 1) return Icons.Layers
		const id = u.members[0].id
		if (isInstanceOf(id, "messages")) return middleWidgetIcon(id)
		const p = inst(id)
		return p ? iconOf(p) : Icons.LayoutPanelTop
	}
	/**
	 * The same icon as a NAME, for the panels menu — that list crosses a module
	 * bridge to the header, and a component reference is a thing to draw with,
	 * not a thing to publish.
	 */
	function groupIconName(u: RenderUnit): string {
		if (u.members.length > 1) return "Layers"
		const id = u.members[0].id
		if (isInstanceOf(id, "messages")) return "MessagesSquare"
		return inst(id)?.icon || "LayoutPanelTop"
	}
	/** A group's tooltip: every title in it, which is what opening it opens. */
	function groupTitle(u: RenderUnit): string {
		return u.members.map((m) => widgetLabel(m.id)).join(" · ")
	}

	/**
	 * A column's BANDS: the units that share a row of it, read off the
	 * arrangement's own cells. A pure function of the geometry, so a band never
	 * changes as groups open and close — and a band, not a widget, is what the
	 * rail model sizes: two widgets side by side are one row of the column.
	 */
	function bandsOf(units: RenderUnit[]): RenderUnit[][] {
		const bands: RenderUnit[][] = []
		for (const u of units) {
			const last = bands[bands.length - 1]
			if (last?.some((v) => u.box.y < v.box.y + v.box.h)) last.push(u)
			else bands.push([u])
		}
		return bands
	}
	function bandRows(b: RenderUnit[]): number {
		return (
			Math.max(...b.map((u) => u.box.y + u.box.h)) -
			Math.min(...b.map((u) => u.box.y))
		)
	}
	/**
	 * Resolve a whole side column: the rail model over its bands, plus the
	 * collapse and the order a collapsed column draws in.
	 *
	 * Collapsing gives every unit its OWN band — that is what "side by side
	 * becomes rows" means — and the bands are then taken in the collapsed order,
	 * so a top-anchored widget is first and a bottom-anchored one last. The
	 * order is spent as an explicit `grid-row` (and a CSS `order` for the sheet,
	 * which is a flex column): re-sorting the `{#each}` instead would MOVE the
	 * nodes, and moving an iframe reloads it.
	 */
	interface ColumnMeasure {
		/** The mobile sheet: the side's panels listed, not a column of them. */
		sheet: boolean
		/** Below the app's 1024px breakpoint (or previewing a width that is). */
		narrow: boolean
		/**
		 * The sides are tucked (./tuckedSides): every group is a rail icon and
		 * the one `tuckedFlyout` names is the flyout — whatever the user's
		 * docked open/closed choices were, which are kept for untucking.
		 */
		tucked?: boolean
		heightPx: number
		widthPx: number
	}
	function columnLayout(
		side: "left" | "right",
		units: RenderUnit[],
		totalRows: number,
		m: ColumnMeasure
	): ColumnLayout {
		const sheet = m.sheet
		const tucked = !!m.tucked && !sheet
		const tuckedKey =
			tucked && tuckedFlyout?.side === side ? tuckedFlyout.key : null
		const isOpen = (u: RenderUnit) =>
			tucked ? u.key === tuckedKey : groupIsOpen(side, u)
		const focusKey = tucked ? tuckedKey : groupFocus[side]
		const natural = bandsOf(units)
		const collapsed = collapseColumn({
			columnPx: m.widthPx,
			// One minimum per widget in the widest row: what has to fit side by
			// side is what decides whether it can.
			minWidthPx: Array(
				Math.max(1, ...natural.map((b) => b.length))
			).fill(MIN_WIDGET_PX),
			// Tucked, every group is its own rail icon, so its own band: the
			// flyout is exactly the group asked for.
			narrow: m.narrow || tucked
		})
		const orderKeys = collapsedOrder(
			units.map((u) => ({
				key: u.key,
				box: u.box,
				anchor: u.members[0]?.anchor
			}))
		)
		const order: Record<string, number> = {}
		orderKeys.forEach((k, i) => (order[k] = i))
		const byKey = new Map(units.map((u) => [u.key, u]))
		const bands = collapsed
			? orderKeys.map((k) => [byKey.get(k)!]).filter((b) => !!b[0])
			: natural
		const focus = bands.findIndex((b) => b.some((u) => u.key === focusKey))
		// The SHEET is not a column — it is the side's panels, listed — so
		// nothing in it competes for height and nothing flies out of it.
		const place: RailPlacement[] = sheet
			? bands.map((_, i) => ({
					key: `b${i}`,
					state: "expanded" as const,
					heightPx: 0
				}))
			: resolveRailColumn({
					columnPx: m.heightPx,
					totalRows,
					groups: bands.map((b, i) => ({
						key: `b${i}`,
						rows: bandRows(b),
						pinned: b.some((u) => groupPinned(u)),
						open: b.some((u) => isOpen(u))
					})),
					focusKey: focus >= 0 ? `b${focus}` : null,
					// The rail model's no-column answer: all icons, and the one
					// asked for flies out.
					narrow: m.narrow || tucked
				})
		const state: Record<string, CellState> = {}
		const row: Record<string, number> = {}
		const heights: number[] = []
		bands.forEach((b, i) => {
			const p = place[i]
			const drawn = p.state !== "collapsed"
			if (drawn && p.state !== "flyout") heights.push(p.heightPx)
			const r = Math.max(1, heights.length)
			// A band that flies out flies out ONCE: two members positioned over
			// the session at the same edge would sit on top of each other, so
			// the one the user asked for goes and the rest stay icons.
			let flownHere = false
			for (const u of b) {
				const open = isOpen(u)
				const mine =
					p.state !== "flyout" ||
					(!flownHere &&
						(focusKey === u.key ||
							b.every((v) => focusKey !== v.key)))
				if (p.state === "flyout" && mine && open) flownHere = true
				row[u.key] = r
				state[u.key] = sheet
					? // Ruled 2026-09-10: the pinned / expanded state carries
						// over, and a group that is not open arrives folded to
						// its title bar rather than gone.
						open
						? "expanded"
						: "folded"
					: drawn && open && mine
						? p.state
						: "collapsed"
			}
		})
		return {
			state,
			row,
			order,
			collapsed,
			flyout:
				Object.entries(state).find(
					([, v]) => v === "flyout"
				)?.[0] ?? null,
			// A band with a height of its own gets it; 0 is the unmeasured
			// column, where flex/grid sharing them out is the better guess.
			rows: heights.map((h) => (h > 0 ? `${h}px` : "1fr")).join(" ")
		}
	}

	/* ── the MIDDLE zone's collapse (ruled 2026-09-10) ──────────────────────
	 * The same rule, in the zone that is not a rail: below the breakpoint there
	 * are no side-by-side placements anywhere, and above it the middle collapses
	 * when it is narrower than the widgets sharing a row need. The order is the
	 * collapsed one — top-anchored first, bottom-anchored last — and it is spent
	 * as an explicit grid row, never as a re-sorted `{#each}`: the middle is
	 * where Messages and Composer live, and moving those is the reload the whole
	 * layout is built to avoid.
	 *
	 * The row heights stay PROPORTIONAL (`<rows>fr` each), so a collapsed middle
	 * is the arrangement stacked, not the arrangement forgotten. */
	let middleWPx = $state(0)
	let middleCol = $derived.by(() => {
		const arr = arranged.middle
		const units = arr ? columnUnits(arr.items) : []
		const bands = bandsOf(units)
		const collapsed = collapseColumn({
			columnPx: middleWPx,
			minWidthPx: Array(
				Math.max(1, ...bands.map((b) => b.length))
			).fill(MIN_WIDGET_PX),
			narrow: isNarrow
		})
		const keys = collapsedOrder(
			units.map((u) => ({
				key: u.key,
				box: u.box,
				anchor: u.members[0]?.anchor
			}))
		)
		const row: Record<string, number> = {}
		keys.forEach((k, i) => (row[k] = i + 1))
		const byKey = new Map(units.map((u) => [u.key, u]))
		return {
			collapsed,
			row,
			rows: keys
				.map((k) => `${Math.max(1, byKey.get(k)?.box.h ?? 1)}fr`)
				.join(" ")
		}
	})

	let leftUnits = $derived(
		arranged.left ? columnUnits(arranged.left.items) : []
	)
	let rightUnits = $derived(
		arranged.right ? columnUnits(arranged.right.items) : []
	)
	let leftCol = $derived(
		columnLayout("left", leftUnits, arranged.left?.rows ?? 1, {
			sheet: leftSlot === "overlay",
			narrow: isNarrow,
			tucked: sidesAreTucked,
			heightPx: columnPx.left,
			widthPx: columnWPx.left
		})
	)
	let rightCol = $derived(
		columnLayout("right", rightUnits, arranged.right?.rows ?? 1, {
			sheet: rightSlot === "overlay",
			narrow: isNarrow,
			tucked: sidesAreTucked,
			heightPx: columnPx.right,
			widthPx: columnWPx.right
		})
	)

	/* ── the Move tab's rail preview ────────────────────────────────────────
	 * The same model, drawn from the EDITOR's working arrangement so the rail
	 * can be played with at every screen size before it is lived with: toggle a
	 * group, pin or unpin one, and watch (b) and (c) happen at Compact through
	 * Ultrawide. The cards here are titles, not live panels — a second mount of
	 * a real panel is exactly what the no-reload law forbids, and the editor has
	 * never drawn one.
	 */
	/** Move tab: draw the side columns as rails instead of the editor's grids. */
	let railPreview = $state(false)
	/**
	 * Move tab: while a phone width is previewed, draw the GRID rather than the
	 * row editor that width really gets. A desktop-only escape — a real narrow
	 * window has no zones to drag in (see `mobileEditing`).
	 */
	let simGrid = $state(false)
	/** Measured height and width of each preview column. */
	let previewPx = $state<Record<"left" | "right", number>>({
		left: 0,
		right: 0
	})
	let previewWPx = $state<Record<"left" | "right", number>>({
		left: 0,
		right: 0
	})
	/**
	 * The previewed device's height. The tier table's, not the window's: the
	 * rail model is decided against the COLUMN's height, so previewing five
	 * tiers in this window would answer it with this monitor's number five
	 * times (see SIM_HEIGHT_PX). Capped by what the frame actually has.
	 */
	let simHeight = $derived(simTier ? SIM_HEIGHT_PX[simTier] : 0)
	/** Is the previewed width below the app's breakpoint? */
	let simNarrow = $derived(narrowWidth(simWidth ?? vw))

	/* The three keys an arrangement is stored under are ./arrangedGeometry's
	   `ZoneKey`, imported above — the blob's shape is that module's, and two
	   declarations of the same three words is one too many. */

	/**
	 * The cell rows an UN-arranged middle is read at: enough of them that a
	 * strip above the conversation reads as a strip against the widget that
	 * fills what is left. A stated choice, not a measured one — the grid editor
	 * measures its own zone, and this is for the editor that has no grid to
	 * measure.
	 */
	const MIDDLE_SEED_ROWS = 12

	function previewColumn(side: ZoneKey): {
		/**
		 * The arrangement the preview is a view of. It IS `editArranged[side]`
		 * when there is one; without one it is the default placement resolved
		 * for this side, which is what the gridstack zone would have reported
		 * the moment it mounted. Either way it is a frame the pin toggle can
		 * write into (see `toggleGroupPin`).
		 */
		frame: GsLayout
		units: RenderUnit[]
	} {
		const items =
			side === "left"
				? leftGsItems
				: side === "right"
					? rightGsItems
					: middleGsItems
		const frame = editArranged[side]
		const cols = frame?.cols ?? 1
		// No frame yet (a layout never arranged): the items' own default
		// placement is the arrangement, and its rows are what they stack to.
		// The middle is the exception — its messages widget FILLS, so its rows
		// are a proportion rather than a sum, and summing them would hand a
		// 3-cell strip half the chat.
		const rows =
			frame?.rows ??
			(side === "middle"
				? MIDDLE_SEED_ROWS
				: Math.max(
						1,
						items.reduce((n, it) => n + (it.h ?? 3), 0)
					))
		const meta = new Map(items.map((it) => [it.id, it]))
		// `seedPositions` reads cells and returns cells; group, anchor and the
		// group's pin ride on the ITEMS, so they are laid back over its answer.
		const pos: GsPos[] = seedPositions(items, cols, rows, frame).map((c) => {
			const m = meta.get(c.id)
			return {
				...c,
				...(m?.group ? { group: m.group } : {}),
				...(m?.anchor ? { anchor: m.anchor } : {}),
				...(m?.pinned === false ? { pinned: false } : {})
			}
		})
		return { frame: { cols, rows, items: pos }, units: columnUnits(pos) }
	}
	let leftPreview = $derived(previewColumn("left"))
	let rightPreview = $derived(previewColumn("right"))
	let middlePreview = $derived(previewColumn("middle"))
	function previewRail(
		side: "left" | "right",
		p: { frame: GsLayout; units: RenderUnit[] }
	): ColumnLayout {
		// The same call the live column makes, over the previewed device's
		// numbers: below 1024 a side takes no layout space at all, so the
		// preview shows what that device does — icons, and the tapped group as
		// a sheet. One decision, never a second model.
		return columnLayout(side, p.units, p.frame.rows, {
			sheet: false,
			narrow: simNarrow,
			heightPx: previewPx[side],
			widthPx: previewWPx[side]
		})
	}
	let leftPreviewCol = $derived(previewRail("left", leftPreview))
	let rightPreviewCol = $derived(previewRail("right", rightPreview))

	function toggleGroup(side: "left" | "right", u: RenderUnit) {
		const open = !groupIsOpen(side, u)
		groupOpen[groupKey(side, u.key)] = open
		// Only the group the user just asked for may fly out (see ./sideRail),
		// so closing one hands the focus back rather than leaving it pointing at
		// a group that is now an icon.
		groupFocus[side] = open ? u.key : null
	}
	/**
	 * Pin / unpin one group (ruled 2026-09-10) — the Move tab's toggle, and a
	 * real persisted decision: it is written onto the arranged ITEMS the group
	 * is made of, so Done commits it with the rest of the arrangement and a
	 * preset saved from it carries it.
	 *
	 * Intentionally NOT `markSimDirty`. A pin moves no cell, so it must not make
	 * a previewed width's clamp count as an arrangement the user made — the
	 * same reading the zone pin already gets. But `exitSimulation` puts the
	 * pre-preview arrangement back, which would take the pin with it, so the pin
	 * is written into that snapshot too: it survives the restore without
	 * rescuing the clamp.
	 */
	function toggleGroupPin(side: "left" | "right", u: RenderUnit) {
		const next = !groupPinned(u)
		const ids = u.members.map((m) => m.id)
		const saved = editArranged[side]
		// The frame to write into. Normally the working arrangement itself —
		// but the preview can show a group that arrangement has not caught up
		// with (a side with none yet, or a widget enabled since it was last
		// reported), and a pin written into a frame missing that id would be
		// dropped on the floor. The preview's own frame always contains it, and
		// is that same arrangement with the newcomer placed by default: what the
		// gridstack zone would report the moment it mounted.
		const base =
			saved && ids.every((id) => saved.items.some((i) => i.id === id))
				? saved
				: (side === "left" ? leftPreview : rightPreview).frame
		editArranged[side] = withPins(base, ids, next)
		if (simTier !== null && simSnapshot)
			simSnapshot[side] = withPins(simSnapshot[side] ?? base, ids, next)
		// "Pinned" IS "expanded by default", so saying it opens the group; and
		// unpinning hands it back to the rail.
		groupOpen[groupKey(side, u.key)] = next
		if (!next && groupFocus[side] === u.key) groupFocus[side] = null
	}
	/** alt+[ / alt+]: expand everything that fits, or send it all to the rail. */
	function setAllGroups(open: boolean) {
		for (const side of ["left", "right"] as const) {
			const units = side === "left" ? leftUnits : rightUnits
			for (const u of units) groupOpen[groupKey(side, u.key)] = open
			// No focus, so nothing flies out: "expand everything" fills the
			// column and leaves what does not fit as icons.
			groupFocus[side] = null
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

	/**
	 * The one group per side that is currently OVER the session, if any — read
	 * off whichever column is on screen, since the editor's preview replaces
	 * the live one rather than sitting beside it.
	 */
	let flyoutKey = $derived({
		left: (editing && railPreview ? leftPreviewCol : leftCol).flyout,
		right: (editing && railPreview ? rightPreviewCol : rightCol).flyout
	})
	/**
	 * A flyout closes on outside click and Escape, exactly like the unpinned
	 * rail's pop-over — `data-pop-keep` marks what is inside it (the flyout
	 * itself, the rail that opened it, and the editor's zones). Only armed while
	 * something is actually flying: an EXPANDED group is part of the layout and
	 * clicking the chat must not put it away.
	 */
	$effect(() => {
		if (!mobileSidePanels.menuOpen) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") mobileSidePanels.closeMenu()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})

	$effect(() => {
		if (!flyoutKey.left && !flyoutKey.right) return
		// Tucked, the flyout is `tuckedFlyout`'s and so are its closers.
		if (sidesAreTucked) return
		const shut = () => {
			for (const side of ["left", "right"] as const) {
				const k = flyoutKey[side]
				if (!k) continue
				groupOpen[groupKey(side, k)] = false
				groupFocus[side] = null
			}
		}
		const onDown = (e: PointerEvent) => {
			if ((e.target as HTMLElement | null)?.closest("[data-pop-keep]"))
				return
			shut()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") shut()
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	/**
	 * A group's box in the column. The height is the grid's (`col.rows`), so all
	 * this places is WHICH row — and, when the column is collapsed, that it has
	 * a column of its own. `order` rides along for the mobile sheet, which is a
	 * flex column and so cannot read an explicit grid row; in the grid it is
	 * inert, because every cell there is placed explicitly.
	 */
	function cellGridStyle(
		u: RenderUnit,
		col: ColumnLayout,
		state: CellState
	): string {
		if (state === "collapsed") return "display:none;"
		const order = `order:${col.order[u.key] ?? 0};`
		// A flyout is out of flow entirely (see `flyoutStyle`).
		if (state === "flyout") return order
		const row = col.row[u.key] ?? 1
		return col.collapsed
			? `grid-column:1;grid-row:${row};${order}`
			: `grid-column:${u.box.x + 1} / span ${u.box.w};grid-row:${row};${order}`
	}
	/**
	 * Rule (c)'s box: over the session, at the column's full height, on the edge
	 * the column is already on. `position: fixed` rather than absolute because
	 * the side it flies out of is a scrolling box — a fixed element is not
	 * clipped by an ancestor's overflow, and there is no transformed ancestor in
	 * the live render to re-anchor it. The column sits at the edge of
	 * `.layout-body`, which is what `bLeft` / `bRight` measure (the root's
	 * edge until the body reaches its cap).
	 */
	function flyoutStyle(side: "left" | "right"): string {
		// Tucked, it stops at the stage's edge so the rail that opened it —
		// and the other icons on it — stay in reach.
		const edge =
			(side === "left" ? bLeft : bRight) +
			(sidesAreTucked ? flowEdge[side === "left" ? "start" : "end"] : 0)
		const start = side === "left" ? "inset-inline-start" : "inset-inline-end"
		return `position:fixed;z-index:30;inset-block-start:${liveTop}px;inset-block-end:0;${start}:${edge}px;inline-size:min(22rem,86vw);`
	}

	/**
	 * Below the breakpoint a side takes no layout space, so there is no rail
	 * for an unpinned zone to collapse INTO: the icon strip has nothing to open
	 * (the desktop pop-over is off down here — see the `isNarrow` guard on it),
	 * and the sheet has to show the panels themselves. Same zone, docked — so the one
	 * mount is in the form the sheet needs BEFORE it is opened, and opening it
	 * changes the container and nothing else.
	 */
	function dockedZone(z: ResolvedZone): ResolvedZone {
		return z.mode === "hidden" || z.mode === "rail"
			? z
			: { ...z, mode: "rail" }
	}

	function closeMobilePanels() {
		mobileSidePanels.close()
	}

	/** Visible, tabbable descendants — the overlay's focus ring, in DOM order. */
	function focusablesIn(el: HTMLElement): HTMLElement[] {
		return [
			...el.querySelectorAll<HTMLElement>(
				'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
			)
		].filter((n) => n.getClientRects().length > 0)
	}

	// Focus moves into the overlay on open and returns to the header button on
	// close (mobileSidePanels owns the return trip). Tab cycles inside it, which
	// is what makes `aria-modal` honest: the session behind the scrim is not
	// reachable while the overlay is up.
	$effect(() => {
		const el = mobileOverlayEl
		// The sheet itself is a box inside the live session, so a STOWED
		// session has no sheet on screen — but this trap is a document
		// listener, and the one thing here that would outlive the box it
		// belongs to. The mount survives the Move tab, so the guard is
		// explicit. (Reachable only by narrowing the window below the
		// breakpoint while a tier is previewed — enough to swallow Tab and
		// Escape with nothing visible to swallow them for.)
		if (!mobileSide || !el || liveStowed) return
		el.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				closeMobilePanels()
				return
			}
			if (e.key !== "Tab") return
			const f = focusablesIn(el)
			if (!f.length) {
				e.preventDefault()
				el.focus()
				return
			}
			const i = f.indexOf(document.activeElement as HTMLElement)
			const next = e.shiftKey
				? f[i <= 0 ? f.length - 1 : i - 1]
				: f[i === -1 || i === f.length - 1 ? 0 : i + 1]
			e.preventDefault()
			next.focus()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})

	function setPinned(zoneId: string, pinned: boolean) {
		const def = layout.zones[zoneId]
		if (!def) return
		commit({
			...layout,
			zones: { ...layout.zones, [zoneId]: { ...def, pinned } }
		})
		if (pinned && popId === zoneId) popId = null
	}
	/**
	 * The Move tab's pin, from a card's own toolbar (ruled 2026-08-30): pinned
	 * is a docked rail that takes layout space, unpinned collapses to icons the
	 * panels fly out of. It is the ZONE's state and the SAME state the live
	 * rail's pin button writes — the card is just another way to reach it, so
	 * there is nothing extra to persist. Unpinned is the explicit `false`;
	 * absent means pinned (schema default).
	 */
	function toggleZonePin(zoneId: string | null) {
		if (!zoneId) return
		setPinned(zoneId, layout.zones[zoneId]?.pinned === false)
	}

	/* ── the way in: the header's Layout button ─────────────────────── */
	/** Open the editor on the layout that is actually saved. */
	function openEditor() {
		// Reseed from the persisted arrangement (not wiped) so the editor
		// opens on what was last saved — the source of truth, so there's no
		// stale in-memory state to re-commit, and a saved layout restores
		// into the grid instead of resetting to defaults. The EFFECTIVE
		// one: a session on a preset it has never overridden has its own
		// slot empty, and reading that empty slot opened the editor on
		// nothing and then wrote that nothing back over the preset.
		editArranged = loadArranged(manager.effectiveArrangedGrid)
		// What Cancel puts back; the arrangement's own restore is the
		// reseed above.
		editZonesSnapshot = JSON.parse(JSON.stringify(layout)) as ZoneLayout
		// The middle's half of the same restore. `$state.snapshot` rather than
		// the JSON round trip above because the slot is legitimately
		// `undefined` on a session that has never overridden its preset, and
		// that is a value to put back.
		editWidgetGridSnapshot = { value: $state.snapshot(manager.widgetGrid) }
		// The other half of it: which panels were on. See the field's comment.
		editActiveSnapshot = new Set(activeSecondaryIds)
		// A drop from a previous editing session says nothing about this one.
		lastDropped = null
		editing = true
	}
	// The header's Layout button asks; this is the only place that answers. Seeded
	// from the current count so a request made on a previous session page does
	// not fire here on mount.
	let seenRequests = untrack(() => layoutEditor.requests)
	$effect(() => {
		const n = layoutEditor.requests
		if (n === seenRequests) return
		seenRequests = n
		untrack(() => (editing ? finishEditing() : openEditor()))
	})
	// What the shell reads: while the DESKTOP editor is up its toolbar owns the
	// header's band, so the session header and the Jump pill step out of it. A
	// narrow window keeps both — the row editor wears a bar of its own instead.
	$effect(() => {
		layoutEditor.open = editing && !isNarrow
	})
	/** The toolbar's measured height: its panel wraps, so it is never a constant. */
	let toolbarH = $state(0)
	/** The px the fixed toolbar takes above the root while it is up. */
	let editorTop = $derived(editing && !isNarrow ? toolbarH : 0)
	/**
	 * Where the LIVE view's viewport-pinned boxes start. With the editor open
	 * the header is unmounted, so `mTop` measures 0 and the toolbar is the whole
	 * of it; with it closed the toolbar is 0 and this is `mTop` unchanged.
	 */
	let liveTop = $derived(mTop + editorTop)
	// Opening or closing the editor unmounts the header, which MOVES the root's
	// top without resizing it — a pure offset change the ResizeObserver never
	// sees. Re-measure once the DOM has settled.
	$effect(() => {
		void editing
		requestAnimationFrame(updateMargins)
	})

	/* ── edit mode ─────────────────────────────────────────────────── */
	// `editing` itself is declared with the arrangement state above: `arranged`
	// derives from it, and a derived's expression is evaluated where it is
	// written, not where it is read.
	// Editor tabs (PLAN 25 redesign):
	//   Presets — pick the genre default or one of your saved layouts, and save
	//             the current arrangement as a new one.
	//   Settings — per-widget settings and styling, both a hover gesture on each
	//             widget in the live preview rather than a list in the panel, so
	//             the panel itself holds nothing but the line that says so.
	//   Move    — drag + anchor/pin/group + the screen-size simulator.
	// Only Move lights up the structural drag affordances, so the other two
	// stay clean live previews.
	let editTab = $state<"presets" | "settings" | "move">("move")
	let placing = $derived(editing && editTab === "move")
	/**
	 * A phone has no tab strip: presets are a sheet, settings and style are the
	 * sheet a row's own button opens, so the tabs collapse to the one the row
	 * list is.
	 */
	$effect(() => {
		if (editing && mobileEdit) editTab = "move"
	})

	/* ── per-widget styling (PLAN 25, ruled 2026-09-09) ─────────────────
	 * Two things cross from here to the overlays, and both go through the
	 * widget-style store rather than props: the overlay is mounted inside a
	 * `WidgetHost`, which sits several layers below anything this component
	 * hands down (the same reason the page pushes the pins there).
	 *
	 * `placing` is intentionally not part of the mode: the Move tab draws
	 * gridstack CARDS, not `WidgetHost`s, so an overlay could not appear on
	 * one anyway — but style mode ending is what disarms and drops any
	 * half-typed draft, so it must end when the tab changes. */
	$effect(() => {
		// The phone editor has no hover and no overlays: its rows open the
		// settings modal directly, which needs no mode.
		setWidgetStyleMode(editing && editTab === "settings")
	})
	$effect(() => {
		// Re-registered whenever the blob or the setter changes, so the write
		// always merges into the CURRENT settings; dropped on teardown so a
		// late write can never land in a page that has gone.
		const settings = layoutSettings
		const persist = onLayoutSettings
		setWidgetStylePinWriter((widgetStyles: Record<string, WidgetStyleRef>) =>
			persist?.({ ...settings, widgetStyles })
		)
		return () => setWidgetStylePinWriter(null)
	})
	// Reads nothing, so it runs once and its teardown is the unmount: leaving
	// the session with the Style tab open must not leave style mode ON in
	// module state, or the next session's widgets open wearing overlays.
	// Intentionally NOT folded into the effect above — that one re-runs, and a
	// teardown there would drop a half-typed draft every time it did.
	$effect(() => () => setWidgetStyleMode(false))
	// The width simulator belongs to the Move tab and only to it: leaving the
	// tab (or Done) drops back to Actual, so the editor is never left looking
	// at a screen the user isn't on — and drops the preview's clamp with it.
	// `untrack` so the restore's write to `arranged` isn't also a read this
	// effect re-runs on.
	$effect(() => {
		if (placing) return
		untrack(() => exitSimulation())
	})
	/** Tap-to-place: the palette chip currently armed. */
	let armedId = $state<string | null>(null)
	/** The zone currently under a drag (highlight). */
	let dragOverZone = $state<string | null>(null)

	let paletteWidgets = $derived.by(() => {
		// The middle is the ARRANGED zone once there is an arrangement and the
		// widget grid until then — the same precedence the live view draws on,
		// so a widget taken out of the middle is offered here again.
		const middle = arranged.middle
			? arranged.middle.items.map((i) => i.id)
			: [...middleGridIds]
		const placed = new Set([...placedWidgetIds(layout), ...middle])
		// While EDITING, committed membership is not yet the truth: the
		// arrangement in progress is. A card dragged from the MIDDLE into a
		// side is reported by both zones' frames at once, but neither list
		// above has caught up — `layout.zones` gains it only at Done, and the
		// middle's own membership lives in `chatGrid`, which `commitArrangement`
		// reconciles only at Done too. So for a moment the card was in no list
		// and the tray offered it again, ready to be added a second time.
		//
		// A side→side drag never showed it: the SOURCE zone's committed widget
		// list still names the card until Done, so `placedWidgetIds` covered it
		// the whole way across. The middle has no such list to lag behind.
		//
		// The live view is unchanged — it reads `arranged`/`layout` as before.
		if (editing) for (const id of arrangedIds(editArranged)) placed.add(id)
		return manager.instances.filter(
			(p) => p.role !== "primary" && !placed.has(p.id)
		)
	})

	// Add/remove don't go through gridstack's own gesture events (they change the
	// id set, which re-seeds the zone), so they report themselves here.
	/**
	 * A widget landed in a side zone — from the tray, from a tap-to-place, or
	 * dragged out of another zone. Ruled 2026-09-17: the FIRST one also pins the
	 * zone, when its `pinned: false` is only `defaultZoneLayout` talking. The
	 * decision and its "how do you tell the two apart" are in ./schema's
	 * `pinsOnFirstDrop`; the snapshot the editor opened on is what answers
	 * "did this zone have widgets before?", so a zone unpinned DURING this edit
	 * cannot be re-pinned by a second drop.
	 */
	function pinOnDrop(zoneId: string | null) {
		if (!zoneId) return
		const def = layout.zones[zoneId]
		if (!def || def.kind !== "side") return
		const before = editZonesSnapshot?.zones[zoneId]
		if (!before) return
		if (!pinsOnFirstDrop({ pinned: def.pinned, hadWidgets: before.widgets.length > 0 }))
			return
		setPinned(zoneId, true)
	}
	/**
	 * A new card's default footprint: the zone's full width, three rows deep.
	 * The numbers are `leftGsItems`/`rightGsItems`' `h: 3` and `seedPositions`'
	 * `it.w ?? cols` — the placement the newcomer would be seeded at, so it is
	 * the size the room has to be made for. A middle card declared by
	 * `withGridWidget` (grow width, fixed height, top-anchored) reads as the
	 * same footprint through `middleGsItems`.
	 */
	const NEW_CARD_ROWS = 3
	/** Which working arrangement a place target writes its cells into. */
	function targetZoneKey(target: string): ZoneKey | null {
		if (target === MIDDLE_TARGET) return "middle"
		if (target === leftZoneId) return "left"
		if (target === rightZoneId) return "right"
		return null
	}
	/**
	 * Seat one more card in a zone's working arrangement: make room if the zone
	 * is full, then WRITE the newcomer's own cells at the slot that opens.
	 *
	 * Both halves are needed, and the second is the one that does the work.
	 * `makeRoom` frees rows under the biggest card, which is not where
	 * `seedPositions` puts a card with no saved cells: that goes to the foot of
	 * the x = 0 stack and, in a full zone, is clamped straight back on top of
	 * whatever holds the bottom rows — and gridstack, capped by `maxRow`,
	 * cannot move anything out of the way, so the two simply overlap (the block
	 * above `MIN_CARD_ROWS` in ./arrangedGeometry has the whole story). Writing
	 * the cells also makes the frame account for exactly the cards on screen,
	 * so the re-seeded zone reads as a faithful restore and draws them.
	 *
	 * A zone reports a frame the moment it mounts, so the no-frame return is a
	 * safety net rather than a path. A zone that cannot make room is left
	 * exactly as it was — today's behaviour, and the Full note stays true.
	 */
	function seatInFrame(target: string, widgetId: string) {
		const zoneKey = targetZoneKey(target)
		if (!zoneKey) return
		const frame = editArranged[zoneKey]
		if (!frame) return
		const need = { w: frame.cols, h: NEW_CARD_ROWS }
		const roomy = makeRoom(frame, need)
		const slot = firstSlot(roomy, need)
		if (!slot) return
		editArranged[zoneKey] = {
			...roomy,
			// `clampPos` rather than the raw `need`: it is the clamp
			// `firstSlot` measured the slot with and the one `seedPositions`
			// ends on, so the card written here is the card the zone draws.
			items: [
				...roomy.items,
				clampPos(
					{ id: widgetId, x: slot.x, y: slot.y, ...need },
					roomy.cols,
					roomy.rows
				)
			]
		}
		markSimDirty()
	}
	/**
	 * The tray's one landing — a drop or a tap-to-place, into a side zone or
	 * the middle. A card dragged BETWEEN zones is gridstack's and does not come
	 * here: a full zone still snaps that one back.
	 *
	 * The two halves of the membership model part here. A side zone's widgets
	 * are the zone template's; the middle's are the chat widget grid's, which
	 * `withWidget` cannot reach, so the middle's drop has its own path.
	 */
	function place(target: string, widgetId: string, beforeId?: string) {
		manager.activate(widgetId)
		seatInFrame(target, widgetId)
		// A widget lives in ONE zone. `withWidget` already clears the template
		// before it adds, and `withGridWidget` the grid — but neither can see
		// the other half, so landing across the two models clears the one being
		// left by hand. The tray only ever offers an unplaced widget, so this
		// is the invariant being kept rather than a case being handled.
		if (target === MIDDLE_TARGET) {
			if (placedWidgetIds(layout).includes(widgetId))
				commit(withoutWidget(layout, widgetId))
			commitGrid(withGridWidget(chatGrid, widgetId, "middle"))
		} else {
			commit(withWidget(layout, target, widgetId, beforeId))
			// Any grid entry, not only the middle's: a side entry the grid
			// named (folded into `layout`) is now the list's.
			if (gridHolds(widgetId))
				commitGrid(withoutGridWidget(chatGrid, widgetId))
			pinOnDrop(target)
		}
		armedId = null
		markSimDirty()
	}
	/** Does the chat widget grid hold this id, in any zone? */
	function gridHolds(id: string): boolean {
		return chatGrid.widgets.some((w) => w.id === id)
	}
	function removeWidget(widgetId: string) {
		// The primary floor (./primaryFloor): the last placed instance of the
		// genre's primary never goes. Its × is not drawn; this also turns away
		// the other ways in — a card dragged back to the tray.
		const keep = floorNoteOf(widgetId)
		if (keep) {
			toaster.info({ title: keep })
			return
		}
		commit(withoutWidget(layout, widgetId))
		// The same split as `place`: the zone template above cannot reach a
		// grid widget, so its card's × would remove nothing at all and the
		// re-seed would bring it straight back from `chatGrid`.
		if (gridHolds(widgetId))
			commitGrid(withoutGridWidget(chatGrid, widgetId))
		manager.close(widgetId)
		markSimDirty()
	}

	function onChipDragStart(e: DragEvent, id: string) {
		e.dataTransfer?.setData("text/sp-widget", id)
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
	}
	function draggedId(e: DragEvent): string | null {
		return e.dataTransfer?.getData("text/sp-widget") || null
	}
	// `target` is a side zone's id or `MIDDLE_TARGET` — what `place` routes on
	// and what the drag-over highlight is keyed by.
	function onZoneDragOver(e: DragEvent, target: string) {
		if (!placing) return
		e.preventDefault()
		dragOverZone = target
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
	}
	function onZoneDrop(e: DragEvent, target: string, beforeId?: string) {
		if (!placing) return
		e.preventDefault()
		e.stopPropagation()
		dragOverZone = null
		const id = draggedId(e)
		if (id) place(target, id, beforeId)
	}
	function onZoneClick(target: string) {
		if (placing && armedId) place(target, armedId)
	}

	/**
	 * Drop this user's own arrangement so the active preset shows through. NOT
	 * "copy the default over mine": the row stops asserting an arrangement
	 * instead of storing a snapshot, which is what keeps a preset a live
	 * reference. With no preset (the shipped default composes to no base at
	 * all) this is exactly the old reset — every slot back to undefined.
	 */
	function resetLayout() {
		manager.clearArrangement()
		// The live view follows the manager on its own; this is the editor's
		// working copy catching up with what "persisted" now means.
		editArranged = loadArranged(manager.effectiveArrangedGrid)
		popId = null
	}

	/* ── the PHONE editor (ruled 2026-09-10) ───────────────────────────────
	 * Below the breakpoint the layout is an ordered list per zone, because that
	 * is what the session draws there — no side-by-side placements, anchors
	 * reduced to order, each side group a panel that is either open or an icon.
	 * The editor edits exactly those three facts, through ./mobileEdit, into the
	 * SAME `editArranged` the grid writes and the same commit on Done. There is
	 * no mobile layout blob and no mobile preset.
	 */
	/** The editor draws rows, not a grid. */
	let mobileEdit = $derived(
		mobileEditing({ narrow: isNarrow, simNarrow, grid: simGrid })
	)
	/**
	 * A canvas is up, so the live session is STOWED under it — mounted and
	 * `display: none`, never unmounted (see the mount at the foot of this
	 * file). Exactly the two branches that draw one: the grid editor, and the
	 * phone editor drawn in the simulator's frame from a desktop. A REAL
	 * narrow window's row editor is drawn over the live session instead, and
	 * is intentionally not one of them.
	 */
	let liveStowed = $derived(placing && (!mobileEdit || simWidth != null))
	/**
	 * Stage only (the shell's Ctrl/⌘ + ., ./stageOnly): the sides, the strips,
	 * every flyout, sheet, scrim and the panels menu are marked
	 * `data-stage-hidden`, and so is every middle cell but the primary's, which
	 * takes the whole middle. Marks only — nothing unmounts and nothing is
	 * written, so turning it off draws the previous layout exactly. Never
	 * while the editor is open: the editor needs the whole layout.
	 */
	let stageOnly = $derived(
		!editing && stageOnlyActive(panelsCtx, desktop.matches)
	)
	/* ── the stage (QE, ./placementRules; brief 7a) ─────────────────────────
	 * Placement is free, so the conversation may sit in a side. Stage only
	 * and the phone draw ONE widget as the stage — `stagePick`, the layout's
	 * primary log (the first unclaimed Messages in reading order), in
	 * whichever zone holds it. In the middle that is what they always did.
	 * In a side (QE (1), the recommended default) that side's mount becomes
	 * the stage (./sideSlot's `stage` slot), showing that one widget full
	 * width; the middle is hidden with the rest, and on the phone its widgets
	 * join the panels menu as "Middle". Marks and containers only — nothing
	 * unmounts, and nothing is written. */
	/** A zone's placed ids in reading order: by row, then by column. */
	function readingIds(frame: GsLayout | undefined): string[] {
		return [...(frame?.items ?? [])]
			.sort((a, b) => a.y - b.y || a.x - b.x)
			.map((i) => i.id)
	}
	/**
	 * A side's drawable ids as the side draws them: its arrangement when it
	 * places anything, else its zone lists. Read off `layout`, never the
	 * resolved zones: those depend on the tuck, which depends on the slots,
	 * which depend on this.
	 */
	function sideReadingIds(side: "left" | "right"): string[] {
		const frame = side === "left" ? arranged.left : arranged.right
		if (frame?.items.length) return readingIds(frame)
		return Object.values(layout.zones)
			.filter(
				(z) =>
					z.kind === "side" &&
					(side === "left" ? z.side === "left" : z.side !== "left")
			)
			.flatMap((z) => z.widgets)
			.filter((id) => isConversation(id) || !!inst(id))
	}
	/** Every zone's placed ids in reading order — middle, left, right. */
	let readingOrder = $derived({
		middle: arranged.middle
			? readingIds(arranged.middle)
			: widgetsInZone(chatGrid, "middle").map((w) => w.id),
		left: sideReadingIds("left"),
		right: sideReadingIds("right")
	})
	let stagePick = $derived<StagePick | null>(
		stageOf({ ...readingOrder, claims, primaryId })
	)
	/**
	 * The side drawn as the stage right now, or null: on the phone, and in
	 * Stage only, while the stage sits in a side. Never while editing — the
	 * editor needs the whole layout.
	 */
	let stageSide = $derived<"left" | "right" | null>(
		!editing && (isNarrow || stageOnly) && stagePick && stagePick.zone !== "middle"
			? stagePick.zone
			: null
	)
	/**
	 * The middle on the phone while a side is the stage: stowed (mounted,
	 * `display: none`), or opened from the panels menu as a sheet of its own.
	 * `flow` everywhere else — Stage only hides it with a mark instead.
	 */
	let centerSlot = $derived<"flow" | "stowed" | "overlay">(
		stageSide && isNarrow
			? mobileSide === "middle"
				? "overlay"
				: "stowed"
			: "flow"
	)
	/**
	 * What a side's rail hides around their mounts for the stage: in the stage
	 * slot, everything but the stage; in that side's phone sheet, the stage
	 * alone (it is drawn as the stage, not listed in the sheet).
	 */
	function stageHiddenIn(
		side: "left" | "right",
		ids: readonly string[]
	): ReadonlySet<string> | undefined {
		const id = stagePick?.zone === side ? stagePick.id : null
		if (!id || !ids.includes(id)) return undefined
		const slot = side === "left" ? leftSlot : rightSlot
		if (slot === "stage") return new Set(ids.filter((i) => i !== id))
		if (slot === "overlay" && isNarrow && !editing) return new Set([id])
		return undefined
	}
	/** The same, for an arranged side's render units, by unit key. */
	function stageUnitKey(side: "left" | "right", units: RenderUnit[]): string | null {
		const id = stagePick?.zone === side ? stagePick.id : null
		if (!id) return null
		return units.find((u) => u.members.some((m) => m.id === id))?.key ?? null
	}
	/** The middle's stage while Stage only draws it there, else null. */
	let stageMiddleId = $derived(
		stageOnly && stagePick?.zone === "middle" ? stagePick.id : null
	)
	/** The arranged middle's stage unit while stage-only is on, else null. */
	let stagePrimaryKey = $derived(
		stageMiddleId && arranged.middle
			? primaryUnitKey(
					unitsOf(arranged.middle.items).map((u) => ({
						key: u.key,
						memberIds: u.members.map((m) => m.id)
					})),
					stageMiddleId
				)
			: null
	)
	/** What the un-arranged middle (`WidgetZone`) hides while stage-only is on. */
	let stageHiddenMiddleIds = $derived.by(() => {
		if (!stageMiddleId || arranged.middle) return undefined
		const ids = widgetsInZone(chatGrid, "middle").map((w) => w.id)
		return ids.includes(stageMiddleId)
			? new Set(ids.filter((id) => id !== stageMiddleId))
			: undefined
	})
	/** Leave the editor, keeping everything — the desktop Done, and the bar's. */
	function finishEditing() {
		// Commit FIRST: the save reads the arrangement this writes, so a preset
		// saved on Done captures what was just arranged. A refused Done (QF:
		// an empty middle) leaves the editor open on the arrangement as it is.
		if (!commitArrangement()) return
		savePreset()
		closeEditor()
	}
	/**
	 * Leave the editor, keeping nothing: the arrangement goes back to what is
	 * persisted, and the zones' membership AND the panels' active state to what
	 * they held when the editor opened — adding and removing a widget writes
	 * straight through to both, and putting only the zones back would leave a
	 * cancelled add to be re-injected by `layout` and a cancelled removal gone.
	 */
	function cancelEditing() {
		exitSimulation()
		// Activations first: `commit` writes the zones, and a zone naming a
		// panel that is still closed is not the layout that was opened on.
		const wasActive = editActiveSnapshot
		if (wasActive) {
			for (const p of manager.instances) {
				if (p.role === "primary") continue
				if (p.active && !wasActive.has(p.id)) manager.close(p.id)
				else if (!p.active && wasActive.has(p.id))
					manager.activate(p.id)
			}
		}
		const zones = editZonesSnapshot
		if (zones) commit(zones)
		// …and the middle's membership, which lives in the other blob. Straight
		// to the manager rather than through `commitGrid`: what was taken is
		// the stored blob, verbatim and possibly unset, not a parsed grid.
		if (editWidgetGridSnapshot)
			manager.setWidgetGrid(editWidgetGridSnapshot.value)
		editArranged = loadArranged(manager.effectiveArrangedGrid)
		presetName = ""
		closeEditor()
	}
	function closeEditor() {
		editing = false
		armedId = null
		editZonesSnapshot = null
		editActiveSnapshot = null
		editWidgetGridSnapshot = null
		lastDropped = null
		// `pickerTarget` and `presetSheet` went with the sheets: MobileLayoutEditor
		// owns them now, and closing the editor unmounts it, which is what
		// clearing them here did. A widget's settings modal is module state, so
		// it is closed here: its entry points are the editor's.
		closeWidgetSettings()
	}

	/* ── presets (PLAN 25 redesign) ─────────────────────────────────────
	 * The tab lists the genre default plus this user's saved layouts. The page
	 * owns the socket round trips; this only decides what is shown and hands
	 * back the intent. */
	/** The preset in force — the pinned one, else the shipped default. */
	let activePreset = $derived(
		presets.find((p) => p.id === activePresetId) ??
			presets.find((p) => p.isDefault) ??
			null
	)
	/** The name box for "save this arrangement as a preset". */
	let presetName = $state("")

	function applyPreset(presetId: number) {
		onApplyPreset?.(presetId)
		// The editor's working copy is seeded on open, so re-read it from the
		// base that just changed — otherwise the editor would keep drawing the
		// arrangement that was just discarded. (The live view underneath is
		// derived from the manager and needs no such nudge, here or when the
		// round trip lands a new base a moment later.)
		editArranged = loadArranged(manager.effectiveArrangedGrid)
		popId = null
		armedId = null
	}

	/** Save the current arrangement as a new preset. A no-op without a name. */
	function savePreset() {
		const name = presetName.trim()
		if (!name) return
		onSavePreset?.(name)
		presetName = ""
	}
</script>

<!-- A preset's PICTURE: three columns of blocks, drawn from the pure
     `previewOf` translation. Deliberately inert — aria-hidden and
     pointer-events:none — because it is a diagram of a layout, not a second
     live copy of it. Mounting the real widgets to preview them would run their
     sockets and reload their frames. -->
{#snippet presetPicture(layout: unknown)}
	{@const pv = previewOf(layout, widgetLabel)}
	<span class="pv" aria-hidden="true">
		{#each PREVIEW_ZONES as key (key)}
			{@const z = pv[key]}
			<span
				class="pv-zone"
				class:pv-middle={key === "middle"}
				class:pv-empty={z.cells.length === 0}
				style={`grid-template-columns:repeat(${z.cols},1fr);grid-template-rows:repeat(${z.rows},1fr);`}
			>
				{#each z.cells as c (c.id)}
					<span
						class="pv-cell"
						style={`grid-column:${c.x + 1}/span ${c.w};grid-row:${c.y + 1}/span ${c.h};`}
					></span>
				{/each}
			</span>
		{/each}
	</span>
{/snippet}

<!-- Unified live widget renderer: turns a widget id into its real content, so
     ANY widget renders correctly in ANY zone (a panel dragged into the middle,
     or chat dragged into a side, still draws). Used by the middle grid
     AND the side connector. -->
<!-- `placement` is the cells the zone that drew this widget placed it at (PLAN
     25). Every live renderer below measures and threads it, so `layout.v1` is
     the geometry on screen rather than a stand-in; a caller with none (a
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
		     (`dossierFor`, below). `eager`: the
		     conversation mounts at once, shown or not (every other widget
		     mounts on first show). Nothing to show until
		     the session is here. -->
		{@const r = resolvedWidget(id)}
		<!-- Each copy is told its own channels (S1): the Sanctum copy the
		     Sanctum, the story's log what no copy claims. -->
		{@const copyDossier = dossierFor(id)}
		<!-- The conversation has no panel around it, so its card (./hostCard) is
		     worn by its own box — the same classes, never a wrapper that comes
		     and goes with the setting (that would remount it). -->
		{@const carded = hostCardShown({ setting: r.settings.hostCard, popover })}
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
				placement={withHostCard(placement, carded, false)}
				source={manager}
				{actions}
				{actionDispatch}
				onAction={onFrameAction}
				grants={["session:full"]}
				scoped={copyDossier ? { session_full: copyDossier } : undefined}
				class="h-full {carded ? HOST_CARD_CLASS : ''}"
				eager
			/>
		{/if}
	{:else}
		{@const p = inst(id)}
		<!-- A primary here is a genre's own middle (R71: it withheld the
		     conversation — Battleship's board), drawn bare like the log is. -->
		{#if p && (p.role !== "primary" || manager.omitted.has("messages"))}
			<Panel
				instance={p}
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
	{#if placing}
		{@const keep = floorNoteOf(p.id)}
		<div class="edit-item-bar">
			<Icons.GripVertical size={12} />
			<span class="min-w-0 flex-1 truncate">{p.title}</span>
			{#if keep}
				<span class="edit-x" role="note" title={keep} aria-label={keep}>
					<Icons.Lock size={12} aria-hidden="true" />
				</span>
			{:else}
				<button
					class="edit-x"
					title="Remove from layout"
					aria-label="Remove {p.title} from layout"
					onclick={(e) => {
						e.stopPropagation()
						removeWidget(p.id)
					}}
				>
					<Icons.X size={12} />
				</button>
			{/if}
		</div>
	{/if}
	{#if p.panel}
		<Panel
			instance={p.panel}
			{manager}
			{sessionId}
			{session}
			{placement}
			chrome="zone"
			popover={popover || inSheet(z)}
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
			popover: popover || inSheet(z)
		})}
	{/if}
{/snippet}

{#snippet panelStack(z: ResolvedZone, flyout: boolean)}
	{#if !flyout && z.columns === 1}
		<!-- PLAN 25: the common docked-rail case (pinned, single column) runs on
		     the widget-grid engine itself — proves the model handles a real side
		     zone, not just the chat's middle. Flyout and multi-column (ultrawide)
		     rails stay on the grid math below for now: a flyout's container can
		     shrink below the declared width (min(...,86%)), which needs the old
		     0-floor `minmax(0,1fr)`; multi-column needs a row-generalization the
		     engine doesn't do yet (see panelWidgets.ts's module doc). -->
		{@const zoneSide = z.def.side === "left" ? "left" : "right"}
		{@const entries = zoneEntriesOf(z)}
		{@const sideGrid = {
			version: 1 as const,
			cell: z.width,
			widgets: widgetsFromSideZones([z], manager.instances, z.width, isConversation)
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
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="zone-panel"
					class:conversation={!p.panel}
					class:edit-item={placing}
					draggable={placing}
					role={placing ? "listitem" : undefined}
					ondragstart={(e) => onChipDragStart(e, p.id)}
					ondragover={(e) => placing && e.preventDefault()}
					ondrop={(e) => onZoneDrop(e, z.id, p.id)}
				>
					{@render railPanelInner(p, z, placement)}
				</div>
			{/if}
		{/snippet}
		<div class="zone-stack-host">
			{#if placing && !z.def.widgets.length}
				<div class="zone-empty">Drop widgets here</div>
			{:else}
				<!-- `hiddenIds`: the stage (QE) hides this rail's other widgets
				     while it draws the conversation full width, and the phone's
				     sheet of this side hides the conversation the stage shows.
				     Hidden around their mounts, never unmounted. -->
				<WidgetZone
					layout={sideGrid}
					zone={zoneSide}
					widget={railPanel}
					gap="0.5rem"
					hiddenIds={stageHiddenIn(zoneSide, entries.map((e) => e.id))}
				/>
			{/if}
		</div>
	{:else}
		{@const hidden = stageHiddenIn(z.def.side === "left" ? "left" : "right", zoneEntriesOf(z).map((e) => e.id))}
		<div
			class="zone-stack"
			style="grid-template-columns:repeat({flyout ? 1 : z.columns},minmax(0,1fr));"
		>
			{#each zoneEntriesOf(z) as p (p.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="zone-panel"
					class:conversation={!p.panel}
					class:edit-item={placing}
					draggable={placing}
					role={placing ? "listitem" : undefined}
					data-stage-hidden={!flyout && hidden?.has(p.id) ? "" : undefined}
					ondragstart={(e) => onChipDragStart(e, p.id)}
					ondragover={(e) => placing && e.preventDefault()}
					ondrop={(e) => onZoneDrop(e, z.id, p.id)}
				>
					{@render railPanelInner(p, z, undefined, flyout)}
				</div>
			{/each}
			{#if placing && !z.def.widgets.length}
				<div class="zone-empty">Drop widgets here</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet sideZone(z: ResolvedZone)}
	{@const widgets = zoneEntriesOf(z)}
	{#if z.mode !== "hidden" && (widgets.length || placing)}
		{#if z.mode === "rail"}
			<!-- Pinned rail: takes layout space. Edit-mode drop/click targets are
			     mouse-only affordances; the palette buttons remain the keyboard
			     path. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<aside
				class="zone-rail"
				class:edit-zone={placing}
				class:drag-over={dragOverZone === z.id}
				style="inline-size:var(--side-flow-px, {z.width * z.columns}px);"
				aria-label={labelOf(z)}
				data-pop-keep
				ondragover={(e) => onZoneDragOver(e, z.id)}
				ondragleave={() => (dragOverZone = null)}
				ondrop={(e) => onZoneDrop(e, z.id)}
				onclick={() => onZoneClick(z.id)}
			>
				<div class="zone-head">
					<span class="zone-label" class:always={placing}>
						{labelOf(z)}
					</span>
					<span class="flex-1"></span>
					<button
						class="zone-head-btn"
						title="Unpin — collapse to icons"
						aria-label="Unpin {labelOf(z)}"
						onclick={(e) => {
							e.stopPropagation()
							setPinned(z.id, false)
						}}
					>
						<Icons.PinOff size={13} />
					</button>
				</div>
				{@render panelStack(z, false)}
			</aside>
		{:else}
			<!-- Unpinned / narrow: an icon strip; tapping pops the zone over. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<div
				class="zone-iconstrip"
				tabindex="-1"
				class:edit-zone={placing}
				class:drag-over={dragOverZone === z.id}
				role="toolbar"
				aria-orientation="vertical"
				aria-label={labelOf(z)}
				data-pop-keep
				data-rail
				ondragover={(e) => onZoneDragOver(e, z.id)}
				ondragleave={() => (dragOverZone = null)}
				ondrop={(e) => onZoneDrop(e, z.id)}
				onclick={() => onZoneClick(z.id)}
			>
				{#each widgets as p, i (p.id)}
					{@const IconCmp = entryIcon(p)}
					{@const zSide = z.def.side === "left" ? "left" : "right"}
					{@const out = sidesAreTucked && tuckedOpen(zSide, p.id)}
					<!-- Template literals, not "{p.title}": inside an expression
					     those braces are ordinary characters, and a screen reader
					     was announcing the literal text "Open {p.title}". -->
					<button
						class="icon-btn"
						tabindex={i === rovingStop(railStop[`z:${z.id}`], widgets.length) ? 0 : -1}
						onkeydown={(e) => onRailKeydown(e, `z:${z.id}`)}
						onfocus={() => (railStop[`z:${z.id}`] = i)}
						class:active={sidesAreTucked ? out : popId === z.id}
						class:edit-item={placing}
						draggable={placing}
						title={placing ? `Drag to move ${p.title}` : p.title}
						aria-label={placing
							? `Move ${p.title}`
							: `Open ${p.title}`}
						aria-pressed={sidesAreTucked ? undefined : popId === z.id}
						aria-expanded={sidesAreTucked ? out : undefined}
						aria-haspopup={sidesAreTucked ? "dialog" : undefined}
						aria-controls={out ? `tucked-zone-${z.id}` : undefined}
						ondragstart={(e) => onChipDragStart(e, p.id)}
						onclick={(e) => {
							e.stopPropagation()
							// In edit mode the icon is a drag handle for moving the
							// widget between zones, not an opener. Tucked, it brings
							// THIS widget out, one at a time (./tuckedSides).
							if (placing) return
							if (sidesAreTucked)
								toggleTucked(zSide, p.id, e.currentTarget)
							else togglePop(z.id, p.id)
						}}
					>
						<IconCmp size={16} />
					</button>
				{/each}
				{#if placing && !widgets.length}
					<div class="icon-empty" title="Empty zone">
						<Icons.CircleDashed size={14} />
					</div>
				{/if}
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet stripZone(z: ResolvedZone)}
	{@const widgets = zoneEntriesOf(z)}
	{#if z.mode !== "hidden" && (widgets.length || placing)}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="zone-strip"
			data-stage-hidden={stageOnly ? "" : undefined}
			class:edit-zone={placing}
			class:drag-over={dragOverZone === z.id}
			aria-label={labelOf(z)}
			ondragover={(e) => onZoneDragOver(e, z.id)}
			ondragleave={() => (dragOverZone = null)}
			ondrop={(e) => onZoneDrop(e, z.id)}
			onclick={() => onZoneClick(z.id)}
		>
			{#if placing}
				<span class="zone-label always">{labelOf(z)}</span>
			{/if}
			{#each widgets as p (p.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="strip-panel"
					class:edit-item={placing}
					draggable={placing}
					ondragstart={(e) => onChipDragStart(e, p.id)}
					ondragover={(e) => placing && e.preventDefault()}
					ondrop={(e) => onZoneDrop(e, z.id, p.id)}
				>
					{#if placing}
						{@const keep = floorNoteOf(p.id)}
						<div class="edit-item-bar">
							<Icons.GripVertical size={12} />
							<span class="min-w-0 flex-1 truncate">{p.title}</span>
							{#if keep}
								<span class="edit-x" role="note" title={keep} aria-label={keep}>
									<Icons.Lock size={12} aria-hidden="true" />
								</span>
							{:else}
								<button
									class="edit-x"
									title="Remove from layout"
									aria-label="Remove {p.title} from layout"
									onclick={(e) => {
										e.stopPropagation()
										removeWidget(p.id)
									}}
								>
									<Icons.X size={12} />
								</button>
							{/if}
						</div>
					{/if}
					{#if p.panel}
						<Panel
							instance={p.panel}
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
			{#if placing && !widgets.length}
				<div class="zone-empty strip">Drop widgets here</div>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Live render of a side zone FROM THE EDITOR ARRANGEMENT (connector): the
     real panels placed at the cells you arranged, via a proportional grid so it
     maps to the side's actual size. Replaces the interim rail/icons whenever
     an arrangement for that side exists. -->
<!-- A tab group in the live view: grouped widgets share one footprint, one tab
     per member, all members mounted (shown/hidden) so their state survives a
     switch. Used by both the middle connector and the side connector. -->
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
					{widgetLabel(m.id)}
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
							? unitPlacement(geom.zone, u, geom.widthPx, m.id, geom.heightPx)
							: undefined,
						popover
					})}
				</div>
			{/each}
		</div>
	</div>
{/snippet}

<!-- `flowPx` is this side's width when it is drawn IN THE FLOW, and 0 when it
     is not (a stowed side has no box; the mobile sheet has a width of its own).
     Without it the grid was `inline-size: 100%` of `.layout-body` — see
     `sideWidths` / ./sideSlot's `dockedZoneWidths`. -->
{#snippet groupRail(
	side: "left" | "right",
	units: RenderUnit[],
	col: ColumnLayout,
	markPinned: boolean
)}
	<!-- The slim rail (a): one icon per group, at the column's OUTER edge (the
	     `.side-column` reverses its row for a left column, so one DOM order
	     serves both sides). This is the ONLY thing more enabled widgets adds —
	     an icon, never more chrome. `data-pop-keep` so clicking the rail that
	     opened a flyout is not "outside" it. -->
	<div
		class="side-rail"
		data-pop-keep
		data-rail
		role="toolbar"
		aria-orientation="vertical"
		aria-label="{side === "left" ? "Left" : "Right"} panels"
	>
		{#each units as u, i (u.key)}
			{@const st = col.state[u.key] ?? "collapsed"}
			{@const Icon = groupIcon(u)}
			{@const title = groupTitle(u)}
			<!-- Tucked, the icon opens a flyout (a dialog), so it says so with
			     `aria-expanded`; docked, it toggles a group in the column. -->
			<button
				class="icon-btn rail-btn"
				tabindex={i === rovingStop(railStop[`g:${side}`], units.length) ? 0 : -1}
				onkeydown={(e) => onRailKeydown(e, `g:${side}`)}
				onfocus={() => (railStop[`g:${side}`] = i)}
				class:active={st !== "collapsed"}
				class:pinned={markPinned && groupPinned(u)}
				title={title}
				aria-label={title}
				aria-pressed={sidesAreTucked ? undefined : st !== "collapsed"}
				aria-expanded={sidesAreTucked ? tuckedOpen(side, u.key) : undefined}
				aria-haspopup={sidesAreTucked ? "dialog" : undefined}
				aria-controls={sidesAreTucked && tuckedOpen(side, u.key)
					? `tucked-${side}-${u.key}`
					: undefined}
				onclick={(e) =>
					sidesAreTucked
						? toggleTucked(side, u.key, e.currentTarget)
						: toggleGroup(side, u)}
			>
				<Icon size={16} />
			</button>
		{/each}
	</div>
{/snippet}

{#snippet arrangedSide(side: "left" | "right", flowPx: number, slot: SideSlot)}
	{@const arr = side === "left" ? arranged.left : arranged.right}
	{#if arr}
		{@const units = side === "left" ? leftUnits : rightUnits}
		{@const col = side === "left" ? leftCol : rightCol}
		{@const sheet = slot === "overlay"}
		<!-- The unit holding the stage's conversation (QE), when this side has
		     it: as the stage it is the ONE cell drawn, full size and open;
		     in this side's phone sheet it is the one cell NOT listed. -->
		{@const stageKey = stageUnitKey(side, units)}
		{@const asStage = slot === "stage" && stageKey !== null}
		{@const sheetHides = sheet && isNarrow && !editing && stageKey !== null}
		<!-- The column and its rail. The stack is still a grid, but its ROWS are
		     the rail model's answer rather than the arrangement's own
		     `repeat(rows,1fr)`: a group that collapses has to give its height
		     BACK to the column, and an empty track of a fixed template gives
		     nothing back. The arrangement still decides the order and each
		     group's share — see `columnUnits` / `columnLayout` / ./sideRail. -->
		<div
			class="side-column"
			class:col-left={side === "left"}
			class:tucked={sidesAreTucked && !sheet && !asStage}
			style={flowPx > 0
				? `flex:0 0 ${flowPx}px; inline-size:${flowPx}px;`
				: ""}
		>
			<!-- One grid. Not collapsed it is the arrangement's own columns with
			     a row per band, at the heights the rail model resolved; collapsed
			     it is ONE column and a row per group, in the collapsed order —
			     which is where a top/bottom anchor ends up meaning first and
			     last. Either way the cells are placed explicitly, so nothing in
			     the `{#each}` ever has to be re-sorted to reorder the column. -->
			<div
				class="live-side"
				class:sheet
				class:one-column={col.collapsed}
				bind:clientHeight={columnPx[side]}
				bind:clientWidth={columnWPx[side]}
				style={asStage
					? "grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);"
					: `grid-template-columns:repeat(${col.collapsed
							? 1
							: arr.cols},1fr);grid-template-rows:${col.rows || '1fr'};`}
			>
				{#each units as u (u.key)}
					<!-- The cell's own measured width is the widget's tier: a rail
					     widget is `compact` however wide the window is, which is what
					     it has to reflow against (PLAN 25). Bound per cell rather
					     than divided out of the zone, because a flex item's real
					     size is the browser's answer, not ours. -->
					{@const widthPx = cellWidths[`${side}:${u.key}`] ?? 0}
					{@const heightPx = cellHeights[`${side}:${u.key}`] ?? 0}
					<!-- The stage cell is open, whatever the column decided. -->
					{@const st = asStage && u.key === stageKey
						? "expanded"
						: (col.state[u.key] ?? "expanded")}
					<!-- ONE cell per group, whatever it is doing: expanded is a
					     row, collapsed is a display:none, folded is its title bar
					     and a hidden body, and a flyout is the same box
					     positioned over the session. Four containers, one mount —
					     a second call site for any of them would reload every
					     iframe in it. -->
					{@const tuckedOut = sidesAreTucked && st === "flyout"}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="live-side-cell cell-{st}"
						class:from-left={side === "left"}
						data-group-key={u.key}
						data-pop-keep={st === "flyout" ? "" : undefined}
						id={tuckedOut ? `tucked-${side}-${u.key}` : undefined}
						data-tucked-flyout={tuckedOut ? "" : undefined}
						role={tuckedOut ? "dialog" : undefined}
						aria-label={tuckedOut ? groupTitle(u) : undefined}
						tabindex={tuckedOut ? -1 : undefined}
						data-stage-hidden={(asStage && u.key !== stageKey) ||
						(sheetHides && u.key === stageKey)
							? ""
							: undefined}
						bind:clientWidth={cellWidths[`${side}:${u.key}`]}
						bind:clientHeight={cellHeights[`${side}:${u.key}`]}
						style={asStage && u.key === stageKey
							? "grid-column:1; grid-row:1;"
							: `${cellGridStyle(u, col, st)}${st === "flyout"
									? flyoutStyle(side)
									: ""}${u.members.length === 1 && !col.collapsed
									? anchorCellStyle(u.members[0].anchor)
									: ""}`}
					>
						{#if st === "folded"}
							<!-- Ruled 2026-09-10: on a phone a tap on the header
							     folds a widget to a title bar. Its own nodes,
							     added at their anchor — the widget below never
							     moves, which is the whole point. -->
							{@const FoldIcon = groupIcon(u)}
							<button
								class="fold-bar"
								aria-expanded="false"
								onclick={() => toggleGroup(side, u)}
							>
								<FoldIcon size={14} />
								<span class="fold-title">{groupTitle(u)}</span>
								<Icons.ChevronDown size={14} />
							</button>
						{/if}
						<!-- Out over the session (rule (c), a tucked panel) or in the
						     phone's sheet, a group is momentarily opened: carded
						     whatever its setting says (./hostCard). -->
						{#if u.members.length === 1}
							{@render middleWidget({
								id: u.members[0].id,
								placement: unitPlacement(
									arr,
									u,
									widthPx,
									u.members[0].id,
									heightPx
								),
								popover: st === "flyout" || sheet
							})}
						{:else}
							{@render tabGroup(
								u,
								{ zone: arr, widthPx, heightPx },
								st === "flyout" || sheet
							)}
						{/if}
					</div>
				{/each}
			</div>
			<!-- No groups, no rail. In the mobile SHEET there is no rail either:
			     the sheet IS the side, opened from the header's own control. -->
			{#if units.length && !sheet && !asStage}
				{@render groupRail(side, units, col, false)}
			{/if}
		</div>
	{/if}
{/snippet}

<!-- A side zone's ONE mount. It is written once, never once in the flow and
     once inside a fixed layer behind a flag — swapping which `{#if}` is live
     would destroy one subtree and build the other, reloading every iframe in
     the zone and dropping every native panel's state. The SUBTREE never moves
     and only the container around it changes — the same trick the tab groups
     below use to keep an inactive pane alive (`.wtab-hidden` is a display:none,
     not an unmount). `sideSlot` (and its unit tests) is the whole decision.

     The mobile overlay is a container too: it never renders the side a
     SECOND time, since that would make opening the sheet reload every iframe
     in it and drop every native panel's state. The wrapper itself wears `.zone-flyout.mobile` and IS the dialog; the sheet's
     chrome is the header below, and the backdrop, the focus trap and the
     Esc/return-focus trip are untouched. No slot is a no-render. -->
{#snippet sideMount(side: "left" | "right", slot: SideSlot)}
	{@const arr = side === "left" ? arranged.left : arranged.right}
	{@const zones = side === "left" ? leftZones : rightZones}
	<!-- Already 0 unless this side's slot is `inline` — `sideWidths` reads
	     the same `leftSlot`/`rightSlot` this snippet is handed. -->
	{@const flowPx = side === "left" ? sideWidths.left : sideWidths.right}
	<!-- This side's EMPTY COLUMN, when it has one; 0 for a populated side. -->
	{@const emptyPx = side === "left" ? emptyColumns.left : emptyColumns.right}
	{@const overlay = slot === "overlay"}
	{@const sideLabel = side === "left" ? "Left" : "Right"}
	<!-- The dialog role and the `tabindex="-1"` are the SAME condition — this
	     wrapper is only focusable while it is the sheet — but the compiler
	     can't follow that through two ternaries and reads a bare div with a
	     dynamic tabindex. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- Stage only hides every side but the one that IS the stage (QE). -->
	<div
		bind:this={sideEls[side]}
		class="side-slot slot-{slot}"
		data-stage-hidden={stageOnly && slot !== "stage" ? "" : undefined}
		class:zone-flyout={overlay}
		class:mobile={overlay}
		class:from-left={overlay && side === "left"}
		role={overlay ? "dialog" : undefined}
		aria-modal={overlay ? "true" : undefined}
		aria-label={overlay ? `${sideLabel} panels` : undefined}
		tabindex={overlay ? -1 : undefined}
		data-pop-keep={overlay ? "" : undefined}
		style={slot === "inline" && flowPx > 0
			? `--side-flow-px:${flowPx}px;`
			: ""}
	>
		{#if overlay}
			<!-- The sheet's chrome. An `{#if}` adds and removes its OWN nodes at
			     its anchor; the mount below never moves, which is the whole
			     point (an appendChild would reload its iframes). -->
			<div class="zone-head">
				<span class="zone-label always">{sideLabel}</span>
				<span class="flex-1"></span>
				<button
					class="zone-head-btn"
					title="Close"
					aria-label="Close {sideLabel.toLowerCase()} panels"
					onclick={closeMobilePanels}
				>
					<Icons.X size={16} />
				</button>
			</div>
		{/if}
		<!-- `arr.items.length`, not just `arr`: see `arrangedHere`. The two have
		     to agree — a box drawn here with no width reserved for it falls back
		     to `.side-column { inline-size: 100% }` and shrinks the centre. -->
		{#if arr && arr.items.length}
			{@render arrangedSide(side, flowPx, slot)}
		{:else if emptyPx > 0 && flowPx > 0 && !placing}
			<!-- An EMPTY side keeps its column (ruled 2026-09-29; `emptyColumns`,
			     ./sideSlot `emptyColumnsPx`). Drawn exactly when its width was
			     granted, so the box and the reserve cannot disagree; the grant
			     is already 0 where the side takes no room — stowed, in the
			     sheet, tucked, hidden, or given way to the stage. Nothing in it
			     to reach, so no tab stop and no a11y tree; widgets go in from
			     the editor's Move tab. -->
			<div
				class="side-empty"
				aria-hidden="true"
				style="flex:0 0 {flowPx}px; inline-size:{flowPx}px;"
			></div>
		{:else}
			<!-- Docked below the breakpoint, and as the stage: an unpinned
			     zone's icon strip mounts nothing, and the stage has to draw
			     its conversation. -->
			{#each zones as z (z.id)}
				{@render sideZone(isNarrow || slot === "stage" ? dockedZone(z) : z)}
			{/each}
		{/if}
	</div>
{/snippet}

<!-- The toolbar is taken out of flow (it owns the window's top band), so the
     room it needs is reserved here: the live view under the Presets/Settings
     tabs, and the simulator's stage, start below it. -->
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
	bind:this={rootEl}
	class="session-layout"
	class:editing
	data-stage-only={stageOnly ? "" : undefined}
	style:padding-block-start="{editorTop}px"
>
	<!-- The toolbar is the DESKTOP's, and it survives a previewed phone width:
	     the tier buttons and the grid escape live in it, so hiding it with the
	     grid would strand the preview it started. A real narrow window has no
	     toolbar at all — the sticky bar at the foot of the row editor is it. -->
	{#if editing && !isNarrow}
		<LayoutEditorToolbar
			bind:editTab
			insetStart={placing ? 0 : mLeft}
			bind:height={toolbarH}
			{presets}
			{activePreset}
			{applyPreset}
			bind:presetName
			{savePreset}
			{resetLayout}
			{onRenamePreset}
			{onDeletePreset}
			{onPresetUsage}
			{presetUsage}
			{presetPicture}
			{styleableWidgets}
			{paletteWidgets}
			{iconOf}
			bind:armedId
			bind:dragOverZone
			{onChipDragStart}
			{draggedId}
			{removeWidget}
			{simTier}
			{setSimTier}
			bind:railPreview
			bind:simGrid
			{simNarrow}
			onCancel={cancelEditing}
			onDone={finishEditing}
		/>
	{/if}

	<!-- A width below the breakpoint gets the ROW editor instead of the grid
	     (ruled 2026-09-10) — see `MobileLayoutEditor`. The live session
	     stays mounted underneath it rather than being swapped for a canvas, so
	     nothing in it reloads while the order is edited. -->
	{#if placing && !mobileEdit}
		<!-- The Widgets tab is the visual grid editor: each zone is drawn as its
		     own square-cell grid, IN PLACE — Left and Right ride in the site's
		     margins (where they live in a session), Middle in the centre. Cards
		     occupy cells; you drag widgets straight onto the zone they belong in.
		     (Style/Advanced tabs keep the live preview.) -->
		<div class="edit-scrim"></div>
		{#if simWidth != null}
			<!-- Simulated: the whole canvas is drawn at the tier's width inside a
			     centred, labelled frame. `transform` (always set, even at 1) is
			     the scale itself, and what keeps the frame inside the real
			     viewport when the tier is wider than it instead of overflowing.
			     Caveat: gridstack's drag helper lives on <body>, so while the
			     frame is scaled DOWN (label says so) a drag reads a little off.
			     Arranging at true size and previewing narrower is the happy path;
			     the column clamp it is previewing is exact either way. -->
			<div class="sim-stage">
				<div class="sim-label">
					Previewing at {simWidth} px{simPct < 100
						? ` · shown at ${simPct}%`
						: ""}
				</div>
				<div
					class="sim-frame"
					style="inline-size:{simWidth}px; transform:scale({editGeom.scale});"
				>
					<LayoutEditCanvas
						{editGeom}
						{leftZoneId}
						{rightZoneId}
						{leftGsItems}
						{middleGsItems}
						{rightGsItems}
						bind:editArranged
						{railPreview}
						bind:dragOverZone
						{armedId}
						{onZoneDragOver}
						{onZoneDrop}
						{onZoneClick}
						{placing}
						{layout}
						{toggleZonePin}
						{removeWidget}
						onDropped={(id, zone) => (lastDropped = { id, zone })}
						{pinOnDrop}
						{markSimDirty}
						{leftPreview}
						{rightPreview}
						{leftPreviewCol}
						{rightPreviewCol}
						{simNarrow}
						{simHeight}
						bind:previewPx
						bind:previewWPx
						{groupIcon}
						{groupTitle}
						{groupPinned}
						{toggleGroupPin}
						{cellGridStyle}
						{groupRail}
					/>
				</div>
			</div>
		{:else}
			<!-- Actual: one fixed row filling the window below the toolbar,
			     nav rail included — the scrim already covers it, and the three
			     columns are a split of the whole width, not of `<main>`. -->
			<div class="edit-shell" style="inset-block-start:{toolbarH}px;">
				<LayoutEditCanvas
					{editGeom}
					{leftZoneId}
					{rightZoneId}
					{leftGsItems}
					{middleGsItems}
					{rightGsItems}
					bind:editArranged
					{railPreview}
					bind:dragOverZone
					{armedId}
					{onZoneDragOver}
					{onZoneDrop}
					{onZoneClick}
					{placing}
					{layout}
					{toggleZonePin}
					{removeWidget}
					onDropped={(id, zone) => (lastDropped = { id, zone })}
					{pinOnDrop}
					{markSimDirty}
					{leftPreview}
					{rightPreview}
					{leftPreviewCol}
					{rightPreviewCol}
					{simNarrow}
					{simHeight}
					bind:previewPx
					bind:previewWPx
					{groupIcon}
					{groupTitle}
					{groupPinned}
					{toggleGroupPin}
					{cellGridStyle}
					{groupRail}
				/>
			</div>
		{/if}
	{:else if placing && simWidth != null}
		<!-- A phone width previewed from a desktop: the row editor drawn in the
		     same frame the grid preview uses, at that device's width and height.
		     The frame's `transform` is what its fixed boxes — the editor and its
		     sheets — anchor to, so the preview is a phone rather than a takeover
		     of the whole window. -->
		<div class="edit-scrim"></div>
		<div class="sim-stage">
			<div class="sim-label">
				Previewing at {simWidth} px{simPct < 100
					? ` · shown at ${simPct}%`
					: ""}
			</div>
			<div
				class="sim-frame"
				style="inline-size:{simWidth}px; max-block-size:{simHeight}px; transform:scale({editGeom.scale});"
			>
				<MobileLayoutEditor
					bind:editArranged
					{leftPreview}
					{rightPreview}
					{middlePreview}
					{simTier}
					{simWidth}
					bind:simSnapshot
					{leftZoneId}
					{rightZoneId}
					bind:groupOpen
					{groupKey}
					{inst}
					{iconOf}
					{middleWidgetIcon}
					{widgetLabel}
					{paletteWidgets}
					{place}
					{removeWidget}
					{floorNoteOf}
					{presets}
					{activePreset}
					{applyPreset}
					bind:presetName
					{savePreset}
					{resetLayout}
					onCancel={cancelEditing}
					onDone={finishEditing}
					{presetPicture}
				/>
			</div>
		</div>
	{/if}

	<!-- ── the live session: ONE mount, drawn or stowed ─────────────────────
	     The canvas above is never the other arm of an `{#if}` with this: a
	     switch to or from the Move tab would destroy the whole session and
	     build it again, reloading every panel iframe and dropping every native
	     panel's state. That is the reload `sideSlot` exists to forbid, one
	     level up — a stowed side is `display: none` and never an unmount,
	     precisely because an iframe goes on running under it.

	     So the session is written ONCE and the canvas is drawn over it. The
	     Presets and Settings tabs are this live view; the Move tab merely
	     covers it, and a tab switch reloads nothing. `.live-body` is
	     `display: contents` while drawn and `display: none` while stowed —
	     the side slots' own rule, shared with them rather than restated.

	     Everything FIXED in the session is inside this subtree — the flyout,
	     the mobile sheet (which is a side's own mount), their scrims and the
	     panels menu — so it all vanishes with it and nothing needs gating a
	     second time. `display: none` also needs no `inert`: no box, no tab
	     stop, no a11y tree. The toolbar and the real-width row editor are the
	     two things deliberately left outside. -->
	<div class="live-body" class:body-stowed={liveStowed}>
	<div
		class="layout-body"
		class:sides-tucked={sidesAreTucked}
		bind:this={bodyEl}
	>
		<!-- The left side, mounted ONCE. `leftSlot` says whether it is drawn in
		     the flow here or stowed (mobile — P6: no rail, no icon strip, the
		     centre gets the full width; it comes back as the overlay at the
		     bottom of this block). Stowed is display:none, never an unmount. -->
		{@render sideMount("left", leftSlot)}

		<!-- The middle zone runs side to side and carries the balance that
		     centres the column on the body (./tuckedSides rule (1)); the
		     conversation reads it, so its scroll region covers it. -->
		<!-- While a SIDE is the stage (QE, `stageSide`) the middle stands down
		     around its one mount, like a side does: Stage only marks it hidden,
		     and the phone stows it (`centerSlot`) or opens it as a sheet from
		     the panels menu ("Middle") — the same element wearing
		     `.zone-flyout.mobile`, never a second render. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="layout-center"
			class:center-stowed={centerSlot === "stowed"}
			class:center-sheet={centerSlot === "overlay"}
			class:zone-flyout={centerSlot === "overlay"}
			class:mobile={centerSlot === "overlay"}
			role={centerSlot === "overlay" ? "dialog" : undefined}
			aria-modal={centerSlot === "overlay" ? "true" : undefined}
			aria-label={centerSlot === "overlay" ? "Middle panels" : undefined}
			tabindex={centerSlot === "overlay" ? -1 : undefined}
			data-pop-keep={centerSlot === "overlay" ? "" : undefined}
			data-stage-hidden={stageOnly && stageSide ? "" : undefined}
			bind:this={centerEl}
			style:--sp-stage-balance-start="{stageBalance.start}px"
			style:--sp-stage-balance-end="{stageBalance.end}px"
			style:margin-inline-start={middleOverGap.start && centerSlot === "flow"
				? `-${BODY_GAP_PX}px`
				: undefined}
			style:margin-inline-end={middleOverGap.end && centerSlot === "flow"
				? `-${BODY_GAP_PX}px`
				: undefined}
		>
			{#if centerSlot === "overlay"}
				<!-- The middle sheet's chrome: its own nodes, added at their
				     anchor; the mount below never moves. -->
				<div class="zone-head">
					<span class="zone-label always">Middle</span>
					<span class="flex-1"></span>
					<button
						class="zone-head-btn"
						title="Close"
						aria-label="Close middle panels"
						onclick={closeMobilePanels}
					>
						<Icons.X size={16} />
					</button>
				</div>
			{/if}
			{#each topStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
			<!-- The layout attribute is TRANSITIONAL (see the block above
			     `msgLayoutAttr`): written from the RESOLVED style so CSS outside
			     this repo that still keys on a pack name keeps working for one
			     release. A style with no pack name (someone's own) writes none,
			     which is correct — no pack is active. -->
			<!-- The measure of the message column belongs to the `messages`
			     widget, which centres its own stage inside whatever width this
			     zone gives it; the zone takes the width it is given. -->
			<div class="chat-core" data-msg-layout={msgLayoutAttr}>
				{#if arranged.middle}
					<!-- Temporary connector: render the live chat from the editor
					     arrangement. A PROPORTIONAL grid (repeat(cols,1fr) ×
					     repeat(rows,1fr)) maps the captured cell coords to this
					     zone's actual size, so it fills regardless of the editor's
					     (toolbar-shortened) height. An arrangement that EXISTS is
					     authoritative even when empty — an intentionally-emptied
					     middle stays empty instead of falling back to the default
					     (which was silently repopulating the chat). -->
					<div
						class="chat-arranged"
						class:one-column={middleCol.collapsed}
						bind:clientWidth={middleWPx}
						style={stagePrimaryKey !== null
							? "grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr);"
							: `grid-template-columns:repeat(${middleCol.collapsed
									? 1
									: arranged.middle.cols},1fr); grid-template-rows:${middleCol.collapsed
									? middleCol.rows || '1fr'
									: `repeat(${arranged.middle.rows},1fr)`};`}
					>
						{#each unitsOf(arranged.middle.items) as u (u.key)}
							{@const widthPx = cellWidths[`middle:${u.key}`] ?? 0}
							{@const heightPx = cellHeights[`middle:${u.key}`] ?? 0}
							<div
								class="chat-arranged-cell"
								bind:clientWidth={cellWidths[`middle:${u.key}`]}
								bind:clientHeight={cellHeights[`middle:${u.key}`]}
								data-stage-primary={stagePrimaryKey !== null && u.key === stagePrimaryKey ? "" : undefined}
								data-stage-hidden={stagePrimaryKey !== null && u.key !== stagePrimaryKey ? "" : undefined}
								style="{stagePrimaryKey === u.key
									? 'grid-column:1; grid-row:1;'
									: middleCol.collapsed
									? `grid-column:1; grid-row:${middleCol.row[u.key] ?? 1};`
									: `grid-column:${u.box.x + 1} / span ${u.box.w}; grid-row:${u.box.y + 1} / span ${u.box.h};`}{u
									.members.length === 1 && !middleCol.collapsed
									? anchorCellStyle(u.members[0].anchor)
									: ''}"
							>
								{#if u.members.length === 1}
									{@render middleWidget({
										id: u.members[0].id,
										placement: unitPlacement(
											arranged.middle,
											u,
											widthPx,
											u.members[0].id,
											heightPx
										)
									})}
								{:else}
									{@render tabGroup(u, {
										zone: arranged.middle,
										widthPx,
										heightPx
									})}
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<!-- No arrangement yet (fresh / never edited): the default —
					     Messages fills the middle. -->
					<WidgetZone
						layout={chatGrid}
						zone="middle"
						gap="0"
						widget={middleWidget}
						hiddenIds={stageHiddenMiddleIds}
					/>
				{/if}
			</div>
			{#each bottomStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
		</div>

		<!-- The right side, mounted ONCE — same deal as the left above. Both
		     keep their DOM position around `.layout-center`: the wrapper is
		     `display: contents` in the flow, so where it sits in this list only
		     decides which side of the centre it lands on — and in the mobile
		     sheet it is out of flow entirely. -->
		{@render sideMount("right", rightSlot)}

		<!-- The pop-over: an unpinned/narrow zone slid over the chat.
		     Desktop only — below the breakpoint the header's L/R group owns the
		     overlay, and the icon strips that arm this one are not rendered. -->
		{#if !isNarrow}
			{#each keptPops as z (z.id)}
				{@const tuckedHere = sidesAreTucked && !!tuckedShown[z.id]}
				{@const open = sidesAreTucked ? z.id === tuckedZoneId : z.id === popId}
				{@const onLeft = z.def.side === "left"}
				{@const shownZone = tuckedHere ? tuckedZone(z) : z}
				{@const title = tuckedHere
					? (inst(tuckedShown[z.id])?.title ??
						(isConversation(tuckedShown[z.id])
							? widgetLabel(tuckedShown[z.id])
							: labelOf(z)))
					: labelOf(z)}
				{#if open && z.mode === "drawer"}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div
						class="pop-scrim"
						data-stage-hidden={stageOnly ? "" : undefined}
						onclick={() =>
							sidesAreTucked ? closeTucked(false) : (popId = null)}
					></div>
				{/if}
				<!-- Closed, it is `display: none` — kept, not unmounted (`keptPops`). -->
				<!-- Tucked, it stops at the stage's edge (`flowEdge`) so the icon
				     strip that opened it stays in reach, and shows the ONE widget
				     whose icon was pressed (`tuckedZone`). -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="zone-flyout"
					data-stage-hidden={stageOnly ? "" : undefined}
					class:from-left={onLeft}
					class:pop-closed={!open}
					style="inline-size:min({z.width}px, 86%);{sidesAreTucked
						? `${onLeft ? 'inset-inline-start' : 'inset-inline-end'}:${onLeft ? flowEdge.start : flowEdge.end}px;`
						: ''}"
					role="dialog"
					aria-label={title}
					id={sidesAreTucked ? `tucked-zone-${z.id}` : undefined}
					data-tucked-flyout={sidesAreTucked && open ? "" : undefined}
					tabindex={sidesAreTucked ? -1 : undefined}
					data-pop-keep
				>
					<div class="zone-head">
						<span class="zone-label always">{title}</span>
						<span class="flex-1"></span>
						{#if z.mode === "icons" && !sidesAreTucked}
							<button
								class="zone-head-btn"
								title="Pin — keep this zone open"
								aria-label="Pin {labelOf(z)}"
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
								sidesAreTucked ? closeTucked(true) : (popId = null)}
						>
							<Icons.X size={13} />
						</button>
					</div>
					{@render panelStack(shownZone, true)}
				</div>
			{/each}
		{/if}

		<!-- Mobile side panels (P6, ruled 2026-08-30): one side at a time, slid
		     in from its own edge over the session and opened from the header's
		     L/R group. The SHEET is that side's own mount wearing
		     `.zone-flyout.mobile` (see `sideMount` / `sideSlot`'s `overlay`
		     slot), not a second render of the same panels, so opening it
		     reloads nothing. What is here is the backdrop, which belongs to no
		     side. -->
		{#if mobileSide}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="pop-scrim"
				data-stage-hidden={stageOnly ? "" : undefined}
				onclick={closeMobilePanels}
			></div>
		{/if}

		<!-- The panels menu (ruled 2026-09-10): the sheet the header's one
		     panels button opens. It LISTS the side groups — icon, title, which
		     side, and which are pinned — and tapping one opens that side's
		     overlay showing it. The list is what scales: another widget is
		     another line here, not another button in the header. Nothing is mounted by it, so it is an ordinary `{#if}`. -->
		{#if mobileSidePanels.menuOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="pop-scrim"
				data-stage-hidden={stageOnly ? "" : undefined}
				onclick={() => mobileSidePanels.closeMenu()}
			></div>
			<div
				class="panels-menu"
				data-stage-hidden={stageOnly ? "" : undefined}
				role="dialog"
				aria-modal="true"
				aria-label="Session panels"
				data-pop-keep
			>
				<div class="zone-head">
					<span class="zone-label always">Panels</span>
					<span class="flex-1"></span>
					<button
						class="zone-head-btn"
						title="Close"
						aria-label="Close panels menu"
						onclick={() => mobileSidePanels.closeMenu()}
					>
						<Icons.X size={16} />
					</button>
				</div>
				<ul class="panels-menu-list">
					{#each mobileSidePanels.groups as g (`${g.side}:${g.key}`)}
						{@const GroupIcon =
							(Icons as any)[g.icon] || Icons.LayoutPanelTop}
						<li>
							<button
								class="panels-menu-item"
								onclick={() =>
									mobileSidePanels.openGroup(g.side, g.key)}
							>
								<GroupIcon size={18} />
								<span class="pm-title">{g.title}</span>
								{#if g.pinned}
									<Icons.Pin size={12} />
								{/if}
								<span class="pm-side">
									{g.side === "left"
										? "Left"
										: g.side === "right"
											? "Right"
											: "Middle"}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
	</div>

	<!-- The row editor at the REAL width, over the live session: everything in
	     the session stays mounted while the order is edited. A previewed one is
	     drawn in the simulator's frame instead (above). -->
	{#if editing && mobileEdit && simWidth == null}
		<MobileLayoutEditor
			bind:editArranged
			{leftPreview}
			{rightPreview}
			{middlePreview}
			{simTier}
			{simWidth}
			bind:simSnapshot
			{leftZoneId}
			{rightZoneId}
			bind:groupOpen
			{groupKey}
			{inst}
			{iconOf}
			{middleWidgetIcon}
			{widgetLabel}
			{paletteWidgets}
			{place}
			{removeWidget}
			{floorNoteOf}
			{presets}
			{activePreset}
			{applyPreset}
			bind:presetName
			{savePreset}
			{resetLayout}
			onCancel={cancelEditing}
			onDone={finishEditing}
			{presetPicture}
		/>
	{/if}
</div>

<!-- Portalled to the body: no widget box, zone or flyout can clip it. -->
<WidgetSettingsModal />

<style>
	/* Stage only (see `stageOnly`): marked, never unmounted — the mount stays
	   and an iframe under it keeps running. `!important` because a side's
	   slot and a flyout set their own `display` by class. */
	.session-layout [data-stage-hidden] {
		display: none !important;
	}
	.session-layout {
		position: relative;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
	}
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

	/* ── the one mount per side, moved by class (see ./sideSlot) ──────────
	   The wrapper exists so the side's subtree can stay put while its
	   CONTAINER changes; it must therefore be invisible in the flow slot, or
	   it would be a new box the layout never had. `display: contents` is
	   exactly that: the rails / the arranged grid go on being the flex items
	   of `.layout-body` they were before this element existed — same widths,
	   same 0.5rem gap. */
	.side-slot.slot-inline {
		display: contents;
	}
	/* Stowed: below the breakpoint (P6), where a side takes no room in the
	   layout at all — no box, no tab stop, no a11y tree — but is still
	   MOUNTED, so the iframes keep running and the panels keep their state
	   (the no-reload law). Stowing is never an unmount, so it costs no
	   reload.

	   `.live-body.body-stowed` is the WHOLE session in that same state, under
	   the Move tab's canvas. One law, one rule — not a second one to drift
	   from it. */
	.side-slot.slot-stowed,
	.live-body.body-stowed {
		display: none;
	}
	/* The live session's one mount. `display: contents` for the same reason
	   `.side-slot.slot-inline` has it: the wrapper exists only so the subtree
	   can be stowed whole, and it must not be a box the layout never had —
	   `.layout-body` (or the stage) stays the flex child of `.session-layout`
	   it has always been. */
	.live-body {
		display: contents;
	}
	/* Overlay: the same mount, wearing the mobile sheet. Every box rule comes
	   from `.zone-flyout.mobile` further down — this wrapper IS the dialog, so
	   there is nothing here but making its contents fill the sheet under the
	   header. A rail's ladder width and the inline slot's clamp are both wrong
	   in a sheet that already has a width of its own. */
	.side-slot.slot-overlay > :global(.zone-rail) {
		inline-size: 100% !important;
		max-inline-size: none;
		flex: 1;
	}
	.side-slot.slot-overlay > :global(.side-column) {
		flex: 1;
		min-block-size: 0;
	}
	/* The stage (QE, brief 7a): this side holds the conversation the phone or
	   Stage only draws full width. The wrapper becomes the body's one flex
	   item and its column or rail fills it; everything in the side but the
	   conversation is `data-stage-hidden` around its mount, and the rail's
	   own chrome goes. A container change, never a second render. */
	.side-slot.slot-stage {
		display: flex;
		flex: 1 1 auto;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.side-slot.slot-stage > :global(.side-column) {
		flex: 1;
		inline-size: auto;
	}
	.side-slot.slot-stage > :global(.zone-rail) {
		flex: 1;
		inline-size: auto !important;
		max-inline-size: none;
	}
	.side-slot.slot-stage > :global(.zone-rail > .zone-head) {
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
	/* Live render of the editor arrangement (temporary connector). Proportional
	   grid so the captured cell layout fills this zone's real size. */
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
	/* Live side zone rendered from the arrangement — a proportional grid with
	   the panels at their cells. It has nothing definite to be 100% OF —
	   `.layout-body` is the whole session — so the snippet writes an inline
	   `flex: 0 0 <ladder>px` on it instead (see `sideWidths`). */
	/* ── the side rail model (ruled 2026-09-10) ───────────────────────────
	   A side column is a stack of toggling group panels plus a slim rail of
	   icons at its OUTER edge. `row-reverse` on a left column puts the rail on
	   the left and the stack on the right from the SAME dom order the right
	   column uses — one markup, both sides, and no reordering to move an
	   iframe. `position: relative` is the preview's flyout anchor; the live
	   flyout is fixed (see `flyoutStyle`). */
	.side-column {
		position: relative;
		display: flex;
		flex-direction: row;
		gap: 0.25rem;
		block-size: 100%;
		inline-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.side-column.col-left {
		flex-direction: row-reverse;
	}
	/* An EMPTY side's column (ruled 2026-09-29, `emptyColumns`): the room its
	   first widget will take, kept so the middle does not move into it. A
	   quiet region — a faint tint of the mid stop, which reads the same over
	   a dark or a light ground (STYLE-GUIDE 2.6), no border and no text: a
	   drop hint belongs to the editor, where there is something to drop
	   (6.7). Its width is the inline `flex-basis` `sideMount` writes. */
	.side-empty {
		flex: none;
		block-size: 100%;
		min-inline-size: 0;
		border-radius: 12px;
		background: color-mix(in oklab, var(--color-surface-500) 7%, transparent);
	}
	/* Tucked (./tuckedSides): the column is its rail and nothing more. The
	   stack keeps its mount and its cells — the one out is a fixed flyout, the
	   rest are display:none — but gives its width back to the stage. */
	.side-column.tucked {
		gap: 0;
	}
	.side-column.tucked > .live-side {
		flex: 0 0 0;
	}
	/* The stack. Still a grid, but its ROWS are the rail model's answer rather
	   than the arrangement's `repeat(rows,1fr)`: a collapsed group has to give
	   its height BACK, and an empty track of a fixed template gives nothing
	   back. Both templates are written inline, per column. `overflow: hidden`
	   keeps the measured column height — which the model is decided against —
	   from being the sum of what is in it. */
	.live-side {
		flex: 1;
		display: grid;
		gap: 0.4rem;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
	}
	/* The mobile sheet (ruled 2026-09-10): the side's panels LISTED, not a
	   column of them competing for height. Each is its content height, capped
	   at what the sheet has, and the list scrolls. A flex column, so the cells'
	   explicit grid rows go quiet and their `order` — the collapsed order —
	   is what the list follows. */
	.live-side.sheet {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}
	.live-side.sheet > .live-side-cell {
		flex: 0 0 auto;
		max-block-size: 100%;
	}
	.side-rail {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		inline-size: 2.25rem;
		padding-block: 0.375rem;
	}
	.rail-btn {
		position: relative;
	}
	/* Pinned, where that is worth saying: the preview and the mobile sheet,
	   both of which are lists of groups you are choosing between. */
	.rail-btn.pinned::after {
		content: "";
		position: absolute;
		inset-block-start: 0.15rem;
		inset-inline-end: 0.15rem;
		inline-size: 0.3rem;
		block-size: 0.3rem;
		border-radius: 50%;
		background: var(--color-primary-500);
	}
	.live-side-cell {
		/* Same containing-block job as `.chat-arranged-cell` above. */
		position: relative;
		min-inline-size: 0;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.live-side-cell > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
	/* Folded (mobile): the title bar stays, the widget stays MOUNTED and is
	   hidden — the fold is a display, not an unmount, or folding a panel would
	   cost it its state and reload its iframe. */
	.live-side-cell.cell-folded {
		overflow: hidden;
	}
	.live-side-cell.cell-folded > :global(*) {
		display: none;
	}
	.fold-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		inline-size: 100%;
		min-block-size: 2.75rem;
		padding-inline: 0.6rem;
		border-radius: 0.5rem;
		text-align: start;
		color: var(--color-surface-600-400);
		background: color-mix(
			in oklab,
			var(--color-surface-500) 12%,
			transparent
		);
	}
	.live-side-cell.cell-folded > .fold-bar {
		display: flex;
	}
	.fold-title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
		font-weight: 650;
	}

	/* Rule (c): the group could not fit beside the pinned ones, so it is over
	   the session at the column's full height instead of squeezing it. The box
	   is the desktop pop-over's — same surface, same shadow, same slide — since
	   it is the same gesture the unpinned rails have always had. */
	.live-side-cell.cell-flyout {
		padding: 0.4rem;
		border-radius: 0.6rem 0 0 0.6rem;
		background: var(--color-surface-50);
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.22);
		animation: fly-in-right 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.live-side-cell.cell-flyout.from-left {
		border-radius: 0 0.6rem 0.6rem 0;
		border-inline-start: none;
		border-inline-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 10px 0 28px rgba(0, 0, 0, 0.22);
		animation-name: fly-in-left;
	}
	:global([data-mode="dark"]) .live-side-cell.cell-flyout {
		background: var(--color-surface-950);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 60%,
			transparent
		);
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

	/* ── the visual grid editor (Widgets tab), square-cell grids ──────── */
	/* Dim the live chat / scene backdrop so the grid reads as a distinct mode.
	   Fixed layer under the zones (which are z-index 20). */
	.edit-scrim {
		position: fixed;
		inset: 0;
		z-index: 15;
		background: color-mix(in oklab, var(--color-surface-950) 62%, transparent);
		backdrop-filter: blur(2px);
	}
	/* Actual: the canvas fills the window below the toolbar, nav rail included
	   — the three columns are a split of the whole VIEWPORT (the scrim already
	   covers the rail), not of `<main>`. The toolbar's measured height is an
	   inline style, so this rule owns only the box. */
	.edit-shell {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 16;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}

	/* ── the screen-size simulator's frame ─────────────────────────────────
	   The stage takes the editor body's slot (in flow, below the toolbar, so it
	   can never cover it) and centres one frame drawn at the simulated width.
	   `overflow: hidden` is the belt to the scale's braces: a frame can never
	   push the page sideways. */
	.sim-stage {
		position: relative;
		z-index: 16;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-block-size: 0;
		overflow: hidden;
	}
	/* The frame's label sits OUTSIDE the transform, so "shown at 60%" is not
	   itself rendered at 60%. */
	.sim-label {
		flex: none;
		margin-block-end: 0.3rem;
		padding: 0.12rem 0.5rem;
		border-radius: 0 0 0.45rem 0.45rem;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-surface-50);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 78%,
			transparent
		);
	}
	/* The simulated viewport. Its `transform` is always set (scale(1) included)
	   — the scale itself, and what keeps a tier wider than the window inside
	   it. The canvas it holds is a plain grid row now, so nothing depends on
	   this box being a containing block; the mobile row editor's fixed sheets
	   still do, which is the other reason it is never unset. */
	.sim-frame {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		transform-origin: top center;
		border: 1.5px solid
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		border-radius: 0.5rem;
		background: color-mix(
			in oklab,
			var(--color-surface-950) 22%,
			transparent
		);
	}
	/* ── zones ─────────────────────────────────────────────────────── */
	.zone-rail {
		display: flex;
		flex-direction: column;
		flex: none;
		min-block-size: 0;
		gap: 0.35rem;
	}
	/* The centre's floor, on the rail path. A rail is `flex: none` at the
	   ladder's definite width and `.layout-center` is `min-inline-size: 0`, so
	   two rails wider than the body would have squeezed the chat to nothing —
	   the same starvation the arranged grids hit, waiting on a narrower
	   desktop. `--side-flow-px` is this side's share after the body reserved
	   MIN_CENTER_PX (see `sideWidths` / ./sideSlot), and with room to spare it
	   IS the ladder width, so the cap only bites in the tight case. `flex: none`
	   still honours a max on the item's hypothetical main size, so the rail
	   simply comes out narrower. */
	.side-slot.slot-inline > :global(.zone-rail) {
		max-inline-size: var(--side-flow-px, none);
	}
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
	.zone-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: none;
		min-block-size: 1.25rem;
	}
	.zone-label {
		display: none;
		font-size: 0.6875rem;
		font-weight: 650;
		color: var(--color-surface-500);
		padding-inline: 0.2rem;
	}
	.zone-label.always,
	.editing .zone-label {
		display: inline;
	}
	.zone-head-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.4rem;
		block-size: 1.4rem;
		border-radius: 0.4rem;
		color: var(--color-surface-500);
	}
	.zone-head-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 15%,
			transparent
		);
		color: var(--color-primary-600);
	}

	/* Icon strip (unpinned rail / narrow drawer) */
	/* A collapsed side panel is just its icons — no boxed "ring" around them
	   (the edit-mode dashed outline is the only frame, and only while editing). */
	.zone-iconstrip {
		display: flex;
		flex-direction: column;
		flex: none;
		align-items: center;
		gap: 0.25rem;
		inline-size: 2.25rem;
		padding-block: 0.375rem;
		border-radius: 0.6rem;
		background: transparent;
		border: none;
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.75rem;
		block-size: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-surface-600);
	}
	.icon-btn.edit-item {
		cursor: grab;
	}
	:global([data-mode="dark"]) .icon-btn {
		color: var(--color-surface-400);
	}
	.icon-btn:hover,
	.icon-btn.active {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 15%,
			transparent
		);
		color: var(--color-primary-600);
	}
	.icon-empty {
		color: var(--color-surface-400);
		padding: 0.25rem;
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
	.zone-flyout {
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
	.zone-flyout.from-left {
		inset-inline-end: auto;
		inset-inline-start: 0;
		border-radius: 0 0.6rem 0.6rem 0;
		border-inline-start: none;
		border-inline-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 10px 0 28px rgba(0, 0, 0, 0.22);
		animation-name: fly-in-left;
	}
	:global([data-mode="dark"]) .zone-flyout {
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
	   These now dress the OPEN SIDE'S OWN MOUNT (`.side-slot.slot-overlay`)
	   rather than a dialog of their own — the animation still plays, because
	   naming an animation on an element that had none starts it. There is no
	   `.mobile-stack` any more for the same reason: a wrapper element around
	   the mount would be an appendChild, and that reloads its iframes. */
	.zone-flyout.mobile {
		inline-size: min(85vw, 26rem);
		max-inline-size: 100%;
		animation-name: fly-in-mobile-right;
	}
	.zone-flyout.mobile.from-left {
		animation-name: fly-in-mobile-left;
	}
	/* The sheet's close control is a thumb target, not a desktop icon button —
	   the 1.4rem default is a third of the 44px minimum the header bar keeps. */
	.zone-flyout.mobile .zone-head-btn {
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

	/* The panels menu: a sheet from the top, under the header the button is in,
	   so it reads as that button's menu rather than as a page of its own. */
	.panels-menu {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		z-index: 30;
		max-block-size: 70%;
		display: flex;
		flex-direction: column;
		padding: 0.4rem 0.5rem 0.6rem;
		border-radius: 0 0 0.8rem 0.8rem;
		background: var(--color-surface-50);
		box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
		animation: fly-in-menu 180ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global([data-mode="dark"]) .panels-menu {
		background: var(--color-surface-950);
	}
	@keyframes fly-in-menu {
		from {
			transform: translateY(-8px);
			opacity: 0;
		}
	}
	.panels-menu-list {
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.panels-menu-item {
		inline-size: 100%;
		min-block-size: 2.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-inline: 0.5rem;
		border-radius: 0.5rem;
		text-align: start;
		color: inherit;
	}
	.panels-menu-item:hover,
	.panels-menu-item:focus-visible {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 12%,
			transparent
		);
	}
	.pm-title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.pm-side {
		flex: none;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--color-surface-500);
	}

	/* ── tools + palette + edit mode ───────────────────────────────── */
	.layout-center {
		position: relative;
	}

	/* ── a preset's PICTURE ─────────────────────────────────────────── */
	/* The picture itself: inert, and dimmed so it never reads as live chrome. */
	.pv {
		display: grid;
		grid-template-columns: 1fr 2.2fr 1fr;
		gap: 2px;
		width: 6.5rem;
		height: 3.2rem;
		opacity: 0.8;
		pointer-events: none;
	}
	.pv-zone {
		display: grid;
		gap: 1px;
		border-radius: 0.2rem;
		background: color-mix(
			in oklab,
			var(--color-surface-300) 55%,
			transparent
		);
	}
	.pv-zone.pv-empty {
		background: color-mix(
			in oklab,
			var(--color-surface-300) 22%,
			transparent
		);
	}
	.pv-cell {
		border-radius: 0.12rem;
		background: color-mix(
			in oklab,
			var(--color-surface-600) 55%,
			transparent
		);
	}
	.pv-middle .pv-cell {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 55%,
			transparent
		);
	}
	:global([data-mode="dark"]) .pv-cell {
		background: color-mix(
			in oklab,
			var(--color-surface-400) 65%,
			transparent
		);
	}

	.editing .edit-zone {
		outline: 1.5px dashed
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		outline-offset: 2px;
		border-radius: 0.6rem;
		min-inline-size: 2.25rem;
		min-block-size: 2.25rem;
	}
	.editing .edit-zone.drag-over {
		outline-style: solid;
		background: color-mix(
			in oklab,
			var(--color-primary-500) 8%,
			transparent
		);
	}
	.zone-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-block-size: 4rem;
		border-radius: 0.5rem;
		font-size: 13px;
		color: var(--color-surface-500);
		border: 1px dashed
			color-mix(in oklab, var(--color-surface-400) 60%, transparent);
	}
	.zone-empty.strip {
		flex: 1;
		min-block-size: 2.75rem;
	}
	.edit-item {
		cursor: grab;
	}
	.edit-item-bar {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: none;
		padding: 0.15rem 0.35rem;
		font-size: 12px;
		font-weight: 500;
		border-radius: 0.4rem 0.4rem 0 0;
		background: color-mix(
			in oklab,
			var(--color-primary-500) 16%,
			transparent
		);
		color: var(--color-primary-700, var(--color-primary-600));
	}
	.edit-x {
		display: flex;
		border-radius: 0.3rem;
		padding: 0.1rem;
	}
	.edit-x:hover {
		background: color-mix(in oklab, var(--color-error-500) 25%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.zone-flyout {
			animation: none;
		}
		/* Spelled out because a media query adds no specificity: the mobile
		   sheet's `animation-name` is set at (0,2,0) and would otherwise outrank
		   the single-class reset above. */
		.zone-flyout.mobile,
		.zone-flyout.mobile.from-left {
			animation: none;
		}
	}
</style>
