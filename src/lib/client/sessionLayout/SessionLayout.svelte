<script lang="ts">
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
	 * renders them through Panel (chrome="zone") so native/frame surfaces and
	 * channel wiring are untouched. Placement changes reparent the panel stack
	 * between rail and flyout — rare (resize/pin), and accepted for zones,
	 * unlike the old grid's no-reparent law.
	 */
	import type { Snippet } from "svelte"
	import { getContext, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import {
		normalizeZoneLayout,
		placedWidgetIds,
		resolveMessageCap,
		resolveZone,
		withWidget,
		withoutWidget,
		type ResolvedZone,
		type ZoneLayout
	} from "./schema"
	// The BASE message + composer styling (the zero-styled grid skeleton, the
	// shared message-state treatment, and the mode-aware `--sp-*` skin palette).
	// The looks themselves are widget styles now — see messageLayouts.css.
	// Imported here as a plain global sheet so it lands outside Tailwind's
	// cascade layers and wins over the components' utility classes.
	import "./messageLayouts.css"
	import { navHover } from "./navHover.svelte"
	// Ruled 2026-08-30 (P6): below the app's 1024px breakpoint the side zones
	// take no layout space at all and are reached only as an overlay, opened
	// from a two-button group the app header renders. This module is the bridge
	// — the header is a sibling of the routed page, so context cannot reach it.
	import { mobileSidePanels } from "./mobileSidePanels.svelte"
	// PLAN 25: the chat middle is a widget grid. Messages (GROW) + Composer
	// (FIXED, bottom) are two required widgets that fall out of the model — no
	// bespoke center layout. The surrounding zones stay the interim system for
	// now; this proves the normal chat in the new model first.
	import WidgetZone from "./WidgetZone.svelte"
	import {
		cellsFromPx,
		DEFAULT_CELL,
		loadChatLayout,
		placementOf,
		updateWidget,
		widgetsInZone,
		type GridLayout,
		type SizeSpec,
		type WidgetConfig,
		type Zone
	} from "./widgetGrid"
	import type { PlacementInput } from "$lib/shared/widgets/context"
	// PLAN 25: the docked-rail case (the common one — a pinned, single-column
	// side zone) also now runs on the widget-grid engine, via this pure
	// translation of the panel/zone system. See panelWidgets.ts's module doc
	// for exactly what it does and doesn't cover.
	import { widgetsFromSideZones } from "./panelWidgets"
	// The editor's grid is gridstack (free 2D drag / resize / snap). See
	// GridStackZone — gridstack owns its DOM, Svelte owns only the host.
	import GridStackZone, {
		GS_CELL_PX,
		type GsAnchor,
		type GsItem,
		type GsLayout
	} from "./GridStackZone.svelte"
	// The saved-arrangement round trip (rehydrate → lay over the editor's items
	// → re-express in the zone as measured now), pure and tested away from the
	// browser. See ./arrangedGeometry.
	import {
		arrangementIsEmpty,
		loadArranged,
		withGeometry,
		type Arranged
	} from "./arrangedGeometry"
	// The Move tab's screen-size simulator: the ONE implementation of the
	// editor's ¼ | ½ | ¼ split, called with the real width or a tier's width.
	import {
		SIM_OPTIONS,
		simulatedGeometry,
		simulationExit,
		type SimGeometry,
		type SimTier
	} from "./simulator"
	import { unitsOf, type RenderUnit } from "./tabGroups"
	import {
		inlineSideWidths,
		sideFlowPx,
		sideSlot,
		type SideSlot
	} from "./sideSlot"
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
	import { legacyLayoutAttr } from "$lib/shared/widgets/corePresets"
	// The per-widget context + skin wrapper. Messages and Composer wear one for
	// the same reason every other widget does (ruled 2026-08-30): it is what
	// injects their style and what grows their Style-mode overlay.
	import WidgetHost from "./WidgetHost.svelte"
	// The Presets tab's picture — a pure blob → geometry translation, never a
	// live mount (see presetPreview.ts for why that limit is deliberate).
	import { previewOf } from "./presetPreview"
	/** The three columns a preset picture is drawn in, left to right. */
	const PREVIEW_ZONES = ["left", "middle", "right"] as const

	interface Props {
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * The two middle-zone widgets (PLAN 25). The page owns each one's wiring;
		 * the layout only decides where they sit. `messagesChildren` is the
		 * message list (GROW-anchored to the top); `composerChildren` is the
		 * composer (FIXED, anchored to the bottom).
		 */
		messagesChildren?: Snippet
		composerChildren?: Snippet
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
		onFrameAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>
		) => void
	}

	let {
		manager,
		sessionId,
		session,
		messagesChildren,
		composerChildren,
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
		onFrameAction
	}: Props = $props()

	// The chat's widget grid: the genre's default Chat layout merged with this
	// user's saved widget blob (courier'd verbatim by the manager). Editing
	// commits back through the manager, which debounce-persists it.
	let chatGrid = $derived<GridLayout>(
		loadChatLayout(manager.effectiveWidgetGrid)
	)
	function commitGrid(next: GridLayout) {
		manager.setWidgetGrid(next)
	}

	// ── middle-zone widget editing (PLAN 25 §9, structural controls) ──────
	// The composer's minimum height, in cells. "Auto" = content-sized (fixed);
	// a cell count reserves at least that much room (great for a multi-line
	// writing composer) while still growing with content.
	const COMPOSER_HEIGHTS: { label: string; h: SizeSpec }[] = [
		{ label: "Auto", h: "fixed" },
		{ label: "3", h: { minCells: 3 } },
		{ label: "4", h: { minCells: 4 } },
		{ label: "5", h: { minCells: 5 } }
	]
	let composerWidget = $derived(
		widgetsInZone(chatGrid, "middle").find((w) => w.id === "composer")
	)
	function composerHeightActive(h: SizeSpec): boolean {
		const cur = composerWidget?.size.h
		if (h === "fixed") return cur === "fixed" || cur === "grow"
		return (
			typeof cur === "object" &&
			typeof h === "object" &&
			cur.minCells === h.minCells
		)
	}
	function setComposerHeight(h: SizeSpec) {
		if (!composerWidget) return
		commitGrid(
			updateWidget(chatGrid, "composer", {
				size: { w: composerWidget.size.w, h }
			})
		)
	}

	/* ── drag-to-resize (§ "widgets are draggable, resizable across grid
	 * cells") ────────────────────────────────────────────────────────────
	 * The presets above are the 90% path; this handle is the free-form one —
	 * grabbing the boundary between the message list and the composer and
	 * dragging sets an exact cell count, snapping to the same grid the model
	 * already speaks. Pointer capture keeps the drag tracking even if the
	 * cursor crosses a sandboxed frame panel in a side zone. */
	const MIN_COMPOSER_CELLS = 2
	const MAX_COMPOSER_CELLS = 16
	let composerDrag = $state<{ startY: number; startCells: number } | null>(
		null
	)
	function currentComposerCells(): number {
		const h = composerWidget?.size.h
		if (typeof h === "object" && h.minCells != null) return h.minCells
		const el = rootEl?.querySelector<HTMLElement>(
			'.chat-core .widget[data-widget-id="composer"]'
		)
		return cellsFromPx(
			el?.getBoundingClientRect().height ?? chatGrid.cell * 3,
			chatGrid.cell
		)
	}
	function setComposerCells(cells: number) {
		if (!composerWidget) return
		const clamped = Math.min(
			MAX_COMPOSER_CELLS,
			Math.max(MIN_COMPOSER_CELLS, cells)
		)
		commitGrid(
			updateWidget(chatGrid, "composer", {
				size: { w: composerWidget.size.w, h: { minCells: clamped } }
			})
		)
	}
	function startComposerResize(e: PointerEvent) {
		if (!placing) return
		// Capture is a robustness nicety (keeps tracking if the cursor strays
		// over a sandboxed frame panel) — the drag still works without it via
		// the direct listeners below, so a capture failure must never abort it.
		try {
			;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		} catch {
			/* no active pointer for this id — proceed uncaptured */
		}
		composerDrag = { startY: e.clientY, startCells: currentComposerCells() }
	}
	function onComposerResizeMove(e: PointerEvent) {
		if (!composerDrag) return
		// Dragging UP (clientY decreases) grows the composer.
		const deltaCells = Math.round(
			(composerDrag.startY - e.clientY) / chatGrid.cell
		)
		setComposerCells(composerDrag.startCells + deltaCells)
	}
	function endComposerResize(e: PointerEvent) {
		if (!composerDrag) return
		composerDrag = null
		try {
			;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
		} catch {
			/* capture was never established (see startComposerResize) */
		}
	}
	function onComposerResizeKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowUp") {
			e.preventDefault()
			setComposerCells(currentComposerCells() + 1)
		} else if (e.key === "ArrowDown") {
			e.preventDefault()
			setComposerCells(currentComposerCells() - 1)
		}
	}

	/* ── shell awareness + margin geometry ─────────────────────────────
	 * In STANDARD width the app centres the chat (main = ½) with a permanent
	 * ¼ margin on each side that the closed sidebars reserve — currently dead
	 * space, while the session's own side rails squeeze the centre. In that
	 * mode we lift the side zones OUT into those margins, pinned to the
	 * viewport at a z-index below the sidebars (so an open panel overlays
	 * them — "under the sidebars"). In FULL-PAGE width (`wideContent`) there
	 * is no margin, so the zones stay inline in the centre and reflow with the
	 * sidebars as before. */
	const panelsCtx = getContext<
		| {
				wideContent?: boolean
				leftPanel?: string | null
				rightPanel?: string | null
		  }
		| undefined
	>("panelsCtx")
	let isDesktop = $state(false)
	let marginMode = $derived(
		isDesktop && !!panelsCtx && panelsCtx.wideContent === false
	)
	/**
	 * Below the app's 1024px breakpoint (P6, ruled 2026-08-30): side zones take
	 * NO layout space — no rails, no icon strips, no margins — and a populated
	 * side is reached only through the header's L/R overlay toggles.
	 *
	 * `mounted` guards the pre-hydration frame: `isDesktop` starts optimistically
	 * false and is only told the truth in onMount, so without it every desktop
	 * first paint would drop its side zones for a frame and snap them back.
	 * Same matchMedia, no second breakpoint source.
	 */
	let mounted = $state(false)
	let isNarrow = $derived(mounted && !isDesktop)
	// A margin is available only while that side's app panel is closed (an open
	// panel takes the margin). First cut: show the zone in the empty margin,
	// hide it when the panel opens — no z-fighting with the shell.
	let leftMarginFree = $derived(marginMode && !panelsCtx?.leftPanel)
	let rightMarginFree = $derived(marginMode && !panelsCtx?.rightPanel)
	// Viewport-relative margin geometry (px), measured off the root's rect.
	let mLeft = $state(0)
	let mRight = $state(0)
	let mTop = $state(0)
	let vw = $state(1024)

	function updateMargins() {
		if (!rootEl) return
		const r = rootEl.getBoundingClientRect()
		vw = window.innerWidth
		mLeft = Math.max(0, Math.round(r.left))
		mRight = Math.max(0, Math.round(window.innerWidth - r.right))
		mTop = Math.max(0, Math.round(r.top))
	}
	// The editor lays out as a consistent ¼ | ½ | ¼ across the viewport,
	// regardless of the full-width toggle: in standard width the sides sit in the
	// real margins; in full-width there are none, so the editor uses a
	// viewport-quarter for the sides and centres the middle to the middle half.
	// This keeps the edit screen identical in both modes.
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
	let containerW = $state(1024)

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
			// The header's L/R group is app-wide state; leaving the session has
			// to retract it, or it would follow the user onto every other page.
			mobileSidePanels.setSides(false, 0, 0)
		}
	})

	// A sidebar opening/closing reflows main → the margins change; recompute
	// after the DOM settles. (rootEl's ResizeObserver also catches most of it.)
	$effect(() => {
		void marginMode
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
	// grid menu) still need a home: append them to the first side zone.
	let layout = $derived.by((): ZoneLayout => {
		const placed = new Set(placedWidgetIds(saved))
		const extras = activeSecondaryIds.filter((id) => !placed.has(id))
		if (!extras.length) return saved
		const host =
			Object.entries(saved.zones).find(
				([, z]) => z.kind === "side" && z.side === "right"
			)?.[0] ?? Object.keys(saved.zones)[0]
		return extras.reduce((l, id) => withWidget(l, host, id), saved)
	})

	function commit(next: ZoneLayout) {
		manager.setZoneLayout(next)
	}

	let resolved = $derived(
		Object.entries(layout.zones).map(([id, def]) =>
			resolveZone(id, def, containerW)
		)
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
	let msgCap = $derived(resolveMessageCap(layout, containerW))

	/* ── the message + composer style packs ────────────────────────────────
	 * The packs are per-widget STYLES now (ruled 2026-08-30): shipped
	 * `widget_styles` rows the widget's own `WidgetHost` injects, picked from
	 * the widget's own overlay. Two things are left here.
	 *
	 * ONE: the layout blob's old `styles.chat` / `styles.composer` choice is
	 * pushed to the store as a fallback UNDER the pins, so a session saved
	 * before the change still opens on the look it was saved with. It is
	 * derived, never written back — the first pick from the overlay writes a
	 * real pin and this stops mattering. Cleared on teardown so it cannot leak
	 * into the next session.
	 *
	 * TWO: `data-msg-layout` / `data-composer-layout` are still written on
	 * `.chat-core`, from the RESOLVED style rather than the blob. TRANSITIONAL,
	 * for one release: nothing in this repo keys off them any more (the packs'
	 * rules moved into the style rows), so they are there for CSS outside it.
	 * Drop both after 0.6. */
	$effect(() => {
		setLegacyStylePacks(layout.styles ?? null)
		return () => setLegacyStylePacks(null)
	})
	// Called for the subscription, not the value — the same contract WidgetHost
	// keeps: it starts the one fetch, and the deriveds below read the same
	// module state, so they re-run when the rows or the pins land.
	widgetStylesStore()
	let msgLayoutAttr = $derived(
		legacyLayoutAttr("messages", resolveWidgetStyle("messages")?.slug)
	)
	let composerLayoutAttr = $derived(
		legacyLayoutAttr("composer", resolveWidgetStyle("composer")?.slug)
	)

	function inst(id: string): PanelInstance | undefined {
		return manager.instances.find((p) => p.id === id)
	}
	function widgetsOf(z: ResolvedZone): PanelInstance[] {
		return z.def.widgets
			.map(inst)
			.filter((p): p is PanelInstance => !!p && p.role !== "primary")
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
	let editorLeftPanels = $derived(leftZones.flatMap(widgetsOf))
	let editorRightPanels = $derived(rightZones.flatMap(widgetsOf))
	function middleWidgetLabel(id: string): string {
		return id === "messages" ? "Messages" : id === "composer" ? "Composer" : id
	}
	function middleWidgetIcon(id: string) {
		return id === "composer" ? Icons.PanelBottom : Icons.MessagesSquare
	}
	// The editor draws cells at the SAME module the live grid uses, so the cell
	// count you see = the cell count you get.
	const EDITOR_CELL = DEFAULT_CELL

	// The editor renders each zone through the real WidgetZone engine, so a
	// widget's grow/fixed/anchor shows exactly as it will on Done — the editor
	// is the live layout plus cell guides.
	//   Middle: the real chat grid; a bare-"fixed" composer gets a small min
	//   height only so its (content-less) card is visible as the bottom strip.
	let editorMiddleGrid = $derived<GridLayout>({
		...chatGrid,
		cell: EDITOR_CELL,
		widgets: chatGrid.widgets.map((w) =>
			w.id === "composer" && w.size.h === "fixed"
				? { ...w, size: { ...w.size, h: { minCells: 3 } } }
				: w
		)
	})
	//   Sides: each panel is a full-width widget (grow width, a min-height so an
	//   empty card reads as a real block), top-anchored — the panel stack.
	function editorSideGrid(zoneKey: Zone, panels: PanelInstance[]): GridLayout {
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
	// Which editor zone a widget id currently sits in (for its card's drag /
	// remove wiring). Null = the display-only middle (chat), not a drop target.
	function editorZoneIdOf(id: string): string | null {
		if (editorLeftPanels.some((p) => p.id === id)) return leftZoneId
		if (editorRightPanels.some((p) => p.id === id)) return rightZoneId
		return null
	}

	// ── gridstack-backed editor items ──────────────────────────────────────
	// Each zone hands gridstack a plain {id,title,size,locked} list; gridstack
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
	// `arranged` is what the LIVE view draws, and it is DERIVED — this used to
	// be one `$state` seeded once, at construction, from a manager the page had
	// not `init`ed yet: the layout blob arrives on `sessions:panelLayout:get`,
	// after this component exists, and nothing re-read it. The session
	// remembered its arrangement and the page drew the pre-edit default until
	// you opened the editor once, which is exactly the shape of the old
	// `state_referenced_locally` warning here. So: the manager is read
	// reactively, and a load, a preset applied, or the active preset deleted
	// all repaint on their own.
	//
	// While editing it is the working copy instead, so the live preview under
	// the Presets/Style tabs shows the arrangement in progress rather than the
	// last saved one. A malformed or absent blob yields {} — the pre-edit
	// default render. (Declared here, above the GsItems that read it — and with
	// `editing`, which the derived reads where it is written.)
	let editing = $state(false)
	let editArranged = $state<Arranged>({})
	let arranged = $derived<Arranged>(
		editing ? editArranged : loadArranged(manager.effectiveArrangedGrid)
	)

	// Each list carries its default placement (place/h); `withGeometry` overlays
	// any saved x/y/w/h from the working copy so re-opening the editor restores
	// what was arranged rather than re-laying-out from defaults (the
	// reset-to-defaults bug).
	let middleGsItems = $derived<GsItem[]>(
		withGeometry(
			widgetsInZone(chatGrid, "middle").map((w) => ({
				id: w.id,
				title: middleWidgetLabel(w.id),
				locked: true,
				// The chat's bound default: messages fills, composer docks to the
				// bottom as a fixed 3-cell strip — both full-width.
				...(w.id === "composer"
					? { place: "bottom" as const, h: 3 }
					: { place: "fill" as const })
			})),
			editArranged.middle
		)
	)
	let leftGsItems = $derived<GsItem[]>(
		withGeometry(
			editorLeftPanels.map((p) => ({ id: p.id, title: p.title, h: 3 })),
			editArranged.left
		)
	)
	let rightGsItems = $derived<GsItem[]>(
		withGeometry(
			editorRightPanels.map((p) => ({ id: p.id, title: p.title, h: 3 })),
			editArranged.right
		)
	)
	function gsKey(items: GsItem[]): string {
		return items.map((i) => i.id).join(",")
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
	// the first member; falls back if the remembered one is no longer present.
	let activeTabs = $state<Record<string, string>>({})
	function activeTab(u: RenderUnit): string {
		const a = activeTabs[u.key]
		return a && u.members.some((m) => m.id === a) ? a : u.members[0].id
	}
	function setActiveTab(key: string, id: string) {
		activeTabs = { ...activeTabs, [key]: id }
	}
	function widgetLabel(id: string): string {
		if (id === "messages" || id === "composer") return middleWidgetLabel(id)
		return inst(id)?.title ?? id
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
	 * `zone:unitKey` in one map because a widget can be on screen twice (a
	 * margin rail alongside the inline one) and each mount has its own box.
	 * Unmeasured for a frame → 0 → `compact`, corrected by an ordinary
	 * `layout:changed`. */
	/**
	 * The two primary widgets' channel declaration: none, i.e. the whole log.
	 *
	 * A constant rather than an `[]` literal in the mount below because a widget
	 * host SUBSCRIBES against this array — a fresh literal on every re-render
	 * (and the middle re-renders on every message) would tear that subscription
	 * down and rebuild it each time, for a value that never changes.
	 */
	const ALL_CHANNELS: string[] = []

	let cellWidths = $state<Record<string, number>>({})
	function unitPlacement(
		zone: { cols: number; rows: number },
		u: RenderUnit,
		widthPx: number,
		id: string
	): PlacementInput {
		// Geometry is the UNIT's — grouped widgets share one footprint, which is
		// what a tab group is — while pinned/collapsed and the chrome are the
		// individual widget's.
		const p = inst(id)
		const primary = id === "messages" || id === "composer"
		return placementOf({
			zone: { cols: zone.cols, rows: zone.rows },
			box: u.box,
			widthPx,
			// The contract's `pinned`: "placed in the grid, not collapsible /
			// closable away". For the two chat widgets that is the anchor
			// guarantee (`required`); for a panel it is its own declaration.
			pinned: primary ? true : !(p?.layout.closable ?? true),
			collapsed: p?.collapsed ?? false,
			// Nothing in an arranged zone is drawered — the zone places its
			// widgets (Panel's `chrome="zone"`), and the drawer rail is the
			// pack-era host.
			drawered: false,
			// Told, not derived. `deriveChrome`'s rule (pinned or drawered ⇒ the
			// host paints) is the pack-era host's; here the answer is simply
			// known — `Panel` paints a card and a title bar for every secondary,
			// and the two primary widgets render full-bleed with neither. A
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
	 * `messages` and `composer` are named explicitly because they are the
	 * primary SNIPPETS rather than panel instances — `inst()` has never known
	 * them — but they wear a `WidgetHost` like everything else now (the packs
	 * became styles, ruled 2026-08-30), so they belong here. Nothing renders
	 * without a `WidgetHost`, so everything in this list is a widget the skin
	 * can actually reach.
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
					id === "messages" ||
					id === "composer" ||
					(inst(id)?.role && inst(id)!.role !== "primary")
			)
			.map((id) => ({ id, label: widgetLabel(id) }))
	})

	/**
	 * Commit editor arrangement on Done: side-zone membership → zoneLayout (for
	 * the palette/active logic), and the full per-zone geometry → arrangedGrid
	 * (positions + anchors + groups — what makes the arrangement survive a reload
	 * and restore into the editor).
	 */
	function commitArrangement() {
		// Never persist a PREVIEW. Done can be pressed with a tier still showing,
		// and the reset $effect only runs after this handler — so leave simulation
		// here, synchronously, and save the arrangement the user actually made
		// rather than what a phone-width preview clamped it into. A no-op at
		// Actual, and a no-op after a gesture (that arrangement is theirs).
		exitSimulation()
		let next = layout
		for (const [key, zid] of [
			["left", leftZoneId],
			["right", rightZoneId]
		] as const) {
			const a = editArranged[key]
			if (!a || !zid || !next.zones[zid]) continue
			// order top→bottom by the widget's row so the saved list matches
			const ids = [...a.items]
				.sort((p, q) => p.y - q.y)
				.map((i) => i.id)
			next = {
				...next,
				zones: {
					...next.zones,
					[zid]: { ...next.zones[zid], widgets: ids }
				}
			}
		}
		if (next !== layout) commit(next)
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
		const snapshot = $state.snapshot(editArranged) as Arranged
		if (arrangementIsEmpty(snapshot)) manager.clearArrangement()
		else manager.setArrangedGrid(snapshot)
	}

	/* ── pop-over (unpinned rails + narrow drawers) ────────────────── */
	let popId = $state<string | null>(null)
	let popZone = $derived(resolved.find((z) => z.id === popId) ?? null)

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
	// A side shows on mobile exactly when it would have shown inline: a visible
	// mode with at least one live widget (`sideZone` skips `hidden` the same way).
	let mobileLeftZones = $derived(
		leftZones.filter((z) => z.mode !== "hidden" && widgetsOf(z).length > 0)
	)
	let mobileRightZones = $derived(
		rightZones.filter((z) => z.mode !== "hidden" && widgetsOf(z).length > 0)
	)
	let leftWidgetCount = $derived(
		mobileLeftZones.reduce((n, z) => n + widgetsOf(z).length, 0)
	)
	let rightWidgetCount = $derived(
		mobileRightZones.reduce((n, z) => n + widgetsOf(z).length, 0)
	)
	// The one writer of the shared store: the breakpoint plus each side's count.
	// `untrack` because setSides also RESOLVES `open` (dropping an overlay a
	// resize just invalidated), and reading that back would make this effect
	// depend on its own write.
	$effect(() => {
		const n = isNarrow
		const l = leftWidgetCount
		const r = rightWidgetCount
		untrack(() => mobileSidePanels.setSides(n, l, r))
	})
	// Crossing INTO mobile retires any desktop pop-over, so coming back out does
	// not re-reveal a flyout the user left open on a wider screen.
	$effect(() => {
		if (isNarrow) popId = null
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
	let mobileOverlayEl = $derived(mobileSide ? sideEls[mobileSide] : null)

	/* ── one mount per side, four places (the no-reload law) ────────────────
	 * The live render writes each side zone ONCE and moves the container
	 * around it; `sideSlot` is the whole decision (and its unit tests). It
	 * reads `mobileSide`, so it is declared down here with it rather than up
	 * with `marginMode`. See ./sideSlot for what each slot means and why
	 * "stowed" is a display:none rather than an unmount. */
	let leftSlot = $derived(
		sideSlot({
			narrow: isNarrow,
			overlayOwns: mobileSide === "left",
			marginMode,
			marginFree: leftMarginFree,
			marginPx: mLeft
		})
	)
	let rightSlot = $derived(
		sideSlot({
			narrow: isNarrow,
			overlayOwns: mobileSide === "right",
			marginMode,
			marginFree: rightMarginFree,
			marginPx: mRight
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
	 * Only the `inline` slot needs any of this — the margin slot's width comes
	 * from the measured margin its wrapper sets, and a stowed or overlay side
	 * has no box in the flow at all. See ./sideSlot for the rule and its
	 * tests. */
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
	 * own guard, so an empty or hidden zone reserves nothing. An icon strip is
	 * not a rail: it is a fixed 2.25rem the ladder never sized.
	 */
	function railLadderPx(zones: ResolvedZone[]): number[] {
		return zones
			.filter((z) => z.mode === "rail" && widgetsOf(z).length > 0)
			.map((z) => z.width * z.columns)
	}
	let sideWidths = $derived(
		inlineSideWidths({
			left: sideFlowPx({
				slot: leftSlot,
				arranged: !!arranged.left,
				arrangedPx: ladderPx(leftZones, "left"),
				railPx: railLadderPx(leftZones)
			}),
			right: sideFlowPx({
				slot: rightSlot,
				arranged: !!arranged.right,
				arrangedPx: ladderPx(rightZones, "right"),
				railPx: railLadderPx(rightZones)
			}),
			bodyPx: containerW,
			gapPx: BODY_GAP_PX
		})
	)

	/**
	 * Below the breakpoint a side takes no layout space, so there is no rail
	 * for an unpinned zone to collapse INTO: the icon strip has nothing to open
	 * (the desktop pop-over is off down here — see the `isNarrow` guard on it),
	 * and the sheet has to show the panels themselves, which is what the
	 * overlay's own `panelStack` used to render. Same zone, docked — so the one
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
		if (!mobileSide || !el) return
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

	/* ── the "Layout" pull-tab: hidden until the nav is hovered ──────── */
	// Revealed while the header/nav is hovered OR the tab itself is
	// hovered/focused; on leaving, a short grace delay keeps it up long enough
	// for the pointer to travel from the nav down to the tab.
	let tabActive = $state(false)
	let tabRevealed = $state(false)
	$effect(() => {
		if (navHover.over || tabActive) {
			tabRevealed = true
			return
		}
		const t = setTimeout(() => (tabRevealed = false), 350)
		return () => clearTimeout(t)
	})

	/* ── edit mode ─────────────────────────────────────────────────── */
	// `editing` itself is declared with the arrangement state above: `arranged`
	// derives from it, and a derived's expression is evaluated where it is
	// written, not where it is read.
	// Editor tabs (PLAN 25 redesign):
	//   Presets — pick the genre default or one of your saved layouts, and save
	//             the current arrangement as a new one.
	//   Style   — per-widget styling, which is a hover gesture on each widget in
	//             the live preview rather than a list in the panel. The
	//             message/composer packs are widget styles too now, so the
	//             panel itself holds nothing but the line that says so.
	//   Move    — drag + anchor/pin/group + the screen-size simulator.
	// Only Move lights up the structural drag affordances, so the other two
	// stay clean live previews.
	let editTab = $state<"presets" | "style" | "move">("move")
	let placing = $derived(editing && editTab === "move")

	/* ── per-widget styling (PLAN 25, ruled 2026-09-09) ─────────────────
	 * Two things cross from here to the overlays, and both go through the
	 * widget-style store rather than props: the overlay is mounted inside a
	 * `WidgetHost`, which sits several layers below anything this component
	 * hands down (the same reason the page pushes the pins there).
	 *
	 * `placing` is deliberately not part of the mode: the Move tab draws
	 * gridstack CARDS, not `WidgetHost`s, so an overlay could not appear on
	 * one anyway — but style mode ending is what disarms and drops any
	 * half-typed draft, so it must end when the tab changes. */
	$effect(() => {
		setWidgetStyleMode(editing && editTab === "style")
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
	// Deliberately NOT folded into the effect above — that one re-runs, and a
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
		const placed = new Set(placedWidgetIds(layout))
		return manager.instances.filter(
			(p) => p.role !== "primary" && !placed.has(p.id)
		)
	})

	// Add/remove don't go through gridstack's own gesture events (they change the
	// id set, which re-seeds the zone), so they report themselves here.
	function place(zoneId: string, widgetId: string, beforeId?: string) {
		manager.activate(widgetId)
		commit(withWidget(layout, zoneId, widgetId, beforeId))
		armedId = null
		markSimDirty()
	}
	function removeWidget(widgetId: string) {
		commit(withoutWidget(layout, widgetId))
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
	function onZoneDragOver(e: DragEvent, zoneId: string) {
		if (!placing) return
		e.preventDefault()
		dragOverZone = zoneId
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
	}
	function onZoneDrop(e: DragEvent, zoneId: string, beforeId?: string) {
		if (!placing) return
		e.preventDefault()
		e.stopPropagation()
		dragOverZone = null
		const id = draggedId(e)
		if (id) place(zoneId, id, beforeId)
	}
	function onZoneClick(zoneId: string) {
		if (placing && armedId) place(zoneId, armedId)
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

	/* ── managing a layout you saved ────────────────────────────────────
	 * Rename and delete are offered on your OWN cards only; the shipped default
	 * gets no actions. Both are one-at-a-time by construction — a single id of
	 * state each — so the row can never show two open editors or two pending
	 * confirmations, and starting one closes the other. */
	/** The card whose name is being edited inline, if any. */
	let renamingId = $state<number | null>(null)
	let renameValue = $state("")
	let renameField = $state<HTMLInputElement | null>(null)
	/** The card a delete has been asked for, awaiting its "how many?" answer. */
	let deleteAskId = $state<number | null>(null)
	/** That card, or null once it is gone from the pushed list (deleted). */
	let deletingPreset = $derived(
		presets.find((p) => p.id === deleteAskId) ?? null
	)
	/** Its session count, or null while the answer is still in flight. */
	let deleteUsage = $derived(
		presetUsage && presetUsage.id === deleteAskId
			? presetUsage.sessions
			: null
	)

	function startRename(p: Sockets.Sessions.LayoutPreset) {
		deleteAskId = null
		renamingId = p.id
		renameValue = p.name
	}
	/**
	 * Commit the inline rename. Enter and blur both land here, and so does the
	 * blur that Escape causes by unmounting the field — which is why the first
	 * line checks the field is still open for THIS card: by then `cancelRename`
	 * has already cleared it, so the cancel wins the race with its own blur.
	 *
	 * An unchanged or blank name is dropped rather than sent: the server refuses
	 * a blank one anyway, and a refusal toast for pressing Enter on a name you
	 * did not edit would be noise.
	 */
	function commitRename(id: number) {
		if (renamingId !== id) return
		const name = renameValue.trim()
		const was = presets.find((p) => p.id === id)?.name
		renamingId = null
		if (!name || name === was) return
		onRenamePreset?.(id, name)
	}
	function cancelRename() {
		renamingId = null
	}
	// The field only exists while a rename is open, so focus it as it appears
	// and select what is there — the common edit is replacing the name, not
	// appending to it.
	$effect(() => {
		if (renamingId != null && renameField) {
			renameField.focus()
			renameField.select()
		}
	})

	/**
	 * Step one of the delete: ask how many sessions are on it. The confirmation
	 * cannot be answered until that count lands, which is the whole point — the
	 * FK drops every session using this preset back to the genre default, and
	 * that is worth knowing before, not after.
	 */
	function askDelete(p: Sockets.Sessions.LayoutPreset) {
		renamingId = null
		deleteAskId = p.id
		onPresetUsage?.(p.id)
	}
	/** Step two. The refreshed list arrives on the reply and redraws the row. */
	function confirmDelete(id: number) {
		deleteAskId = null
		onDeletePreset?.(id)
	}
	function cancelDelete() {
		deleteAskId = null
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
     or chat dragged into a side, no longer vanishes). Used by the middle grid
     AND the side connector. -->
<!-- `placement` is the cells the zone that drew this widget placed it at (PLAN
     25). Every live renderer below measures and threads it, so `layout.v1` is
     the geometry on screen rather than a stand-in; a caller with none (a
     pop-over flyout) falls through to `WidgetHost`'s `UNPLACED`. -->
{#snippet middleWidget({
	id,
	bare = false,
	placement
}: {
	id: string
	bare?: boolean
	placement?: PlacementInput
})}
	{#if id === "messages" || id === "composer"}
		{@const primary = id === "messages" ? messagesChildren : composerChildren}
		<!-- The two primary widgets go through a `WidgetHost` like every other
		     one (ruled 2026-08-30): same ctx projection, same skin injection,
		     same Style-mode hover overlay — which is what makes the message and
		     composer packs ordinary widget styles rather than a special case.
		     They get the same FOUR inputs a panel does — placement, channels,
		     props and the session event source — so nothing about their ctx is a
		     special case either. `channels` is deliberately empty: the primary
		     log is the whole session, not a view onto one channel, and an empty
		     declaration is exactly what `scopeMessages` reads as "all of it".
		     A session-less mount has nothing to project, so it renders bare,
		     exactly as Panel's native branch does. -->
		{#if session}
			<WidgetHost
				widget={{
					id,
					instanceId: id,
					title: middleWidgetLabel(id)
				}}
				session={session as any}
				messages={((session as any)?.sessionMessages ?? []) as any}
				channels={ALL_CHANNELS}
				props={{ widgetId: id, title: middleWidgetLabel(id) }}
				{placement}
				source={manager}
				onAction={onFrameAction}
			>
				{@render primary?.()}
			</WidgetHost>
		{:else}
			{@render primary?.()}
		{/if}
	{:else}
		{@const p = inst(id)}
		{#if p && p.role !== "primary"}
			<Panel
				instance={p}
				{manager}
				{sessionId}
				{session}
				{placement}
				chrome="zone"
				hideHeader={bare}
				{onFrameAction}
			/>
		{/if}
	{/if}
{/snippet}

<!-- `placement` is what the rail's `WidgetZone` measured for this panel; the
     multi-column / flyout branch of `panelStack` doesn't run on that engine yet
     and passes none, so those mounts fall through to `UNPLACED`. -->
{#snippet railPanelInner(
	p: PanelInstance,
	z: ResolvedZone,
	placement?: PlacementInput
)}
	{#if placing}
		<div class="edit-item-bar">
			<Icons.GripVertical size={12} />
			<span class="min-w-0 flex-1 truncate">{p.title}</span>
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
		</div>
	{/if}
	<Panel
		instance={p}
		{manager}
		{sessionId}
		{session}
		{placement}
		chrome="zone"
		{onFrameAction}
	/>
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
		{@const sideGrid = {
			version: 1 as const,
			cell: z.width,
			widgets: widgetsFromSideZones([z], widgetsOf(z), z.width)
		}}
		{#snippet railPanel({
			id,
			placement
		}: {
			id: string
			placement: PlacementInput
		})}
			{@const p = inst(id)}
			{#if p}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="zone-panel"
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
				<WidgetZone
					layout={sideGrid}
					zone={zoneSide}
					widget={railPanel}
					gap="0.5rem"
				/>
			{/if}
		</div>
	{:else}
		<div
			class="zone-stack"
			style="grid-template-columns:repeat({flyout ? 1 : z.columns},minmax(0,1fr));"
		>
			{#each widgetsOf(z) as p (p.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="zone-panel"
					class:edit-item={placing}
					draggable={placing}
					role={placing ? "listitem" : undefined}
					ondragstart={(e) => onChipDragStart(e, p.id)}
					ondragover={(e) => placing && e.preventDefault()}
					ondrop={(e) => onZoneDrop(e, z.id, p.id)}
				>
					{@render railPanelInner(p, z)}
				</div>
			{/each}
			{#if placing && !z.def.widgets.length}
				<div class="zone-empty">Drop widgets here</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet sideZone(z: ResolvedZone)}
	{@const widgets = widgetsOf(z)}
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
				style="inline-size:{z.width * z.columns}px;"
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
				ondragover={(e) => onZoneDragOver(e, z.id)}
				ondragleave={() => (dragOverZone = null)}
				ondrop={(e) => onZoneDrop(e, z.id)}
				onclick={() => onZoneClick(z.id)}
			>
				{#each widgets as p (p.id)}
					{@const IconCmp = iconOf(p)}
					<!-- Template literals, not "{p.title}": inside an expression
					     those braces are ordinary characters, and a screen reader
					     was announcing the literal text "Open {p.title}". -->
					<button
						class="icon-btn"
						class:active={popId === z.id}
						class:edit-item={placing}
						draggable={placing}
						title={placing ? `Drag to move ${p.title}` : p.title}
						aria-label={placing
							? `Move ${p.title}`
							: `Open ${p.title}`}
						aria-pressed={popId === z.id}
						ondragstart={(e) => onChipDragStart(e, p.id)}
						onclick={(e) => {
							e.stopPropagation()
							// In edit mode the icon is a drag handle for moving the
							// widget between zones, not an opener.
							if (!placing) togglePop(z.id, p.id)
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
	{@const widgets = widgetsOf(z)}
	{#if z.mode !== "hidden" && (widgets.length || placing)}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="zone-strip"
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
						<div class="edit-item-bar">
							<Icons.GripVertical size={12} />
							<span class="min-w-0 flex-1 truncate">{p.title}</span>
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
						</div>
					{/if}
					<Panel
						instance={p}
						{manager}
						{sessionId}
						{session}
						chrome="zone"
						{onFrameAction}
					/>
				</div>
			{/each}
			{#if placing && !widgets.length}
				<div class="zone-empty strip">Drop widgets here</div>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- One widget's card in the editor. It fills its real grid slot (so a GROW
     widget's card fills, a fixed one is its size) — the card IS the widget's
     footprint. `id` resolves everything: middle chat widgets are display-only,
     panels are draggable/removable and know their zone. -->
{#snippet editCard({ id }: { id: string })}
	{@const mid = id === "messages" || id === "composer"}
	{@const p = mid ? undefined : inst(id)}
	{@const title = mid ? middleWidgetLabel(id) : (p?.title ?? id)}
	{@const IconCmp = mid
		? middleWidgetIcon(id)
		: p
			? iconOf(p)
			: Icons.LayoutPanelTop}
	{@const zoneId = mid ? null : editorZoneIdOf(id)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ecard"
		class:ecard-middle={mid}
		draggable={!!zoneId}
		ondragstart={(e) => zoneId && onChipDragStart(e, id)}
		ondragover={(e) => zoneId && placing && e.preventDefault()}
		ondrop={(e) => zoneId && onZoneDrop(e, zoneId, id)}
	>
		<div class="ecard-head">
			<IconCmp size={15} />
			<span class="ecard-title">{title}</span>
			{#if !mid}
				<button
					class="ecard-x"
					title="Remove from layout"
					aria-label="Remove {title} from layout"
					onclick={(e) => {
						e.stopPropagation()
						removeWidget(id)
					}}
				>
					<Icons.X size={12} />
				</button>
			{/if}
		</div>
	</div>
{/snippet}

<!-- One zone drawn as its real widget grid + a square-cell guide overlay. -->
{#snippet editZonePanel(
	zoneId: string | null,
	label: string,
	HeadIcon: any,
	gsItems: GsItem[],
	isMiddle: boolean,
	onChange?: (layout: GsLayout) => void
)}
	<!-- The frame these cards were restored from, so the zone can re-express a
	     saved arrangement in the grid it is being drawn in — and can tell that
	     it is a restore, with nothing of its own to report yet. -->
	{@const frame = isMiddle
		? editArranged.middle
		: zoneId === leftZoneId
			? editArranged.left
			: editArranged.right}
	<!-- Tap-to-place (docs: "tap it and then tap where it goes"): the palette
	     arms a chip, the zone takes it. `armedId` is the whole guard — with
	     nothing armed a click here does nothing, so the cards keep their own
	     clicks (selection, controls). The zone is a region that becomes a
	     placement target only while a chip is armed, a state no element role
	     describes; it is focusable exactly then, so Tab reaches the zones when
	     landing a widget on one is a move you can make and never otherwise. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
	<section
		class="zgrid"
		class:zgrid-middle={isMiddle}
		class:drag-over={!!zoneId && dragOverZone === zoneId}
		class:armed={!!zoneId && !!armedId}
		data-pop-keep
		tabindex={zoneId && armedId ? 0 : undefined}
		aria-label={zoneId && armedId ? `Place in ${label}` : undefined}
		ondragover={(e) => zoneId && onZoneDragOver(e, zoneId)}
		ondragleave={() => (dragOverZone = null)}
		ondrop={(e) => zoneId && onZoneDrop(e, zoneId)}
		onclick={() => zoneId && onZoneClick(zoneId)}
		onkeydown={(e) => {
			// Only the zone's own Enter/Space places — a key pressed on a card's
			// button inside it is that button's, not a placement.
			if (!zoneId || e.target !== e.currentTarget) return
			if (e.key !== "Enter" && e.key !== " ") return
			e.preventDefault()
			onZoneClick(zoneId)
		}}
	>
		<header class="zgrid-head">
			<HeadIcon size={13} />
			{label}
		</header>
		<div class="zgrid-body">
			{#key gsKey(gsItems)}
				<GridStackZone
					items={gsItems}
					{frame}
					pinned={zoneId ? layout.zones[zoneId]?.pinned !== false : undefined}
					onTogglePin={zoneId ? () => toggleZonePin(zoneId) : undefined}
					{onChange}
					onRemove={(id) => removeWidget(id)}
					onGesture={markSimDirty}
				/>
			{/key}
		</div>
	</section>
{/snippet}

<!-- The three editor zones. ONE markup for both the real editor and a simulated
     one: the side rails are `position:fixed`, so they pin to the viewport when
     this renders at the top level (Actual) and to `.sim-frame` when it renders
     inside one (a transformed element is the containing block for its fixed
     descendants). Nothing branches on which — only the numbers change, and both
     sets come from `simulatedGeometry`.

     `GridStackZone` re-derives its column count from its own measured box, so a
     narrower frame clamps the arrangement exactly as that device would. It is
     NOT keyed on the simulated width: re-mounting would rebuild the zones from
     the saved items and throw away the arrangement in progress. -->
{#snippet editCanvas(simulating: boolean)}
	<div class="layout-body edit-grid-body">
		<!-- Middle editor, capped to the centre half and centred, so it lines up
		     with the side quarters in BOTH width modes (in full-width the main is
		     100vw, so we cap it here). -->
		<div
			class="layout-center edit-center"
			style="max-inline-size:{editGeom.centre}px;"
		>
			{@render editZonePanel(
				null,
				"Middle",
				Icons.MessageSquare,
				middleGsItems,
				true,
				(l) => (editArranged.middle = l)
			)}
		</div>
	</div>
	<!-- A margin culled to 0 is one too narrow to hold a single cell — the
	     device would show no rail there, so neither do we. -->
	{#if leftZoneId && editGeom.left > 0}
		<div
			class="edit-margin edit-margin-left"
			style="inset-block-start:{simulating
				? 0
				: mTop}px; inline-size:{editGeom.left}px;"
		>
			{@render editZonePanel(
				leftZoneId,
				"Left",
				Icons.PanelLeft,
				leftGsItems,
				false,
				(l) => (editArranged.left = l)
			)}
		</div>
	{/if}
	{#if rightZoneId && editGeom.right > 0}
		<div
			class="edit-margin edit-margin-right"
			style="inset-block-start:{simulating
				? 0
				: mTop}px; inline-size:{editGeom.right}px;"
		>
			{@render editZonePanel(
				rightZoneId,
				"Right",
				Icons.PanelRight,
				rightGsItems,
				false,
				(l) => (editArranged.right = l)
			)}
		</div>
	{/if}
{/snippet}

<!-- Live render of a side zone FROM THE EDITOR ARRANGEMENT (connector): the
     real panels placed at the cells you arranged, via a proportional grid so it
     maps to the margin's actual size. Replaces the interim rail/icons whenever
     an arrangement for that side exists. -->
<!-- A tab group in the live view: grouped widgets share one footprint, one tab
     per member, all members mounted (shown/hidden) so their state survives a
     switch. Used by both the middle connector and the side connector. -->
{#snippet tabGroup(
	u: RenderUnit,
	geom?: { zone: { cols: number; rows: number }; widthPx: number }
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
							? unitPlacement(geom.zone, u, geom.widthPx, m.id)
							: undefined
					})}
				</div>
			{/each}
		</div>
	</div>
{/snippet}

<!-- `flowPx` is this side's width when it is drawn IN THE FLOW, and 0 when it
     is not (the margin slot sizes itself from the measured margin; a stowed
     one has no box). Without it the grid was `inline-size: 100%` of
     `.layout-body` — see `sideWidths` / ./sideSlot's `inlineSideWidths`. -->
{#snippet arrangedSide(side: "left" | "right", flowPx: number)}
	{@const arr = side === "left" ? arranged.left : arranged.right}
	{#if arr}
		<div
			class="live-side"
			style="grid-template-columns:repeat({arr.cols},1fr); grid-template-rows:repeat({arr.rows},1fr);{flowPx >
			0
				? ` flex:0 0 ${flowPx}px; inline-size:${flowPx}px;`
				: ''}"
		>
			{#each unitsOf(arr.items) as u (u.key)}
				<!-- The cell's own measured width is the widget's tier: a rail
				     widget is `compact` however wide the window is, which is what
				     it has to reflow against (PLAN 25). Bound per cell rather
				     than divided out of the zone, because a `1fr` track's real
				     size is the browser's answer, not ours. -->
				{@const widthPx = cellWidths[`${side}:${u.key}`] ?? 0}
				<div
					class="live-side-cell"
					bind:clientWidth={cellWidths[`${side}:${u.key}`]}
					style="grid-column:{u.box.x + 1} / span {u.box
						.w}; grid-row:{u.box.y + 1} / span {u.box.h};{u.members
						.length === 1
						? anchorCellStyle(u.members[0].anchor)
						: ''}"
				>
					{#if u.members.length === 1}
						{@render middleWidget({
							id: u.members[0].id,
							placement: unitPlacement(arr, u, widthPx, u.members[0].id)
						})}
					{:else}
						{@render tabGroup(u, { zone: arr, widthPx })}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- A side zone's ONE mount. This used to be written twice — once in the flow,
     once inside the fixed margin layer — and flipping `marginMode` swapped
     which `{#if}` was live, so Svelte destroyed one subtree and built the
     other: every iframe in the zone reloaded and every native panel lost its
     state. Now the SUBTREE never moves and only the container around it
     changes — the same trick the tab groups below use to keep an inactive
     pane alive (`.wtab-hidden` is a display:none, not an unmount).
     `sideSlot` (and its unit tests) is the whole decision.

     The mobile overlay is a container too, and that is the newest of the four:
     it used to render the side a SECOND time (`panelStack`), so this mount had
     to stand down — and opening the sheet reloaded every iframe in it and
     dropped every native panel's state, the very thing this snippet exists to
     stop. Now the wrapper itself wears `.zone-flyout.mobile` and IS the dialog;
     the sheet's chrome is the header below, and the backdrop, the focus trap
     and the Esc/return-focus trip are untouched. No slot is a no-render. -->
{#snippet sideMount(side: "left" | "right", slot: SideSlot)}
	{@const arr = side === "left" ? arranged.left : arranged.right}
	{@const zones = side === "left" ? leftZones : rightZones}
	<!-- Already 0 unless this side's slot is `inline` — `sideWidths` reads
	     the same `leftSlot`/`rightSlot` this snippet is handed. -->
	{@const flowPx = side === "left" ? sideWidths.left : sideWidths.right}
	{@const overlay = slot === "overlay"}
	{@const sideLabel = side === "left" ? "Left" : "Right"}
	<!-- The dialog role and the `tabindex="-1"` are the SAME condition — this
	     wrapper is only focusable while it is the sheet — but the compiler
	     can't follow that through two ternaries and reads a bare div with a
	     dynamic tabindex. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={sideEls[side]}
		class="side-slot slot-{slot}"
		class:margin-rail={slot === "margin"}
		class:margin-left={slot === "margin" && side === "left"}
		class:margin-right={slot === "margin" && side === "right"}
		class:zone-flyout={overlay}
		class:mobile={overlay}
		class:from-left={overlay && side === "left"}
		role={overlay ? "dialog" : undefined}
		aria-modal={overlay ? "true" : undefined}
		aria-label={overlay ? `${sideLabel} panels` : undefined}
		tabindex={overlay ? -1 : undefined}
		data-pop-keep={overlay ? "" : undefined}
		style={slot === "margin"
			? `inset-block-start:${mTop}px; inline-size:${
					side === "left" ? mLeft : mRight
				}px;`
			: slot === "inline" && flowPx > 0
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
		{#if arr}
			{@render arrangedSide(side, flowPx)}
		{:else}
			{#each zones as z (z.id)}
				{@render sideZone(isNarrow ? dockedZone(z) : z)}
			{/each}
		{/if}
	</div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div bind:this={rootEl} class="session-layout" class:editing>
	{#if !editing}
		<!-- The "Layout" pull-tab: centered on the FULL session width (so it
		     lines up with the header's centre, not the offset chat column), and
		     hidden until the header/nav is hovered — then it fades in solid,
		     reading as a tab hanging from the header. -->
		<button
			class="edit-tab"
			class:revealed={tabRevealed}
			data-pop-keep
			onclick={() => {
				// Reseed from the persisted arrangement (not wiped) so the editor
				// opens on what was last saved — the source of truth, so there's no
				// stale in-memory state to re-commit, and a saved layout restores
				// into the grid instead of resetting to defaults. The EFFECTIVE
				// one: a session on a preset it has never overridden has its own
				// slot empty, and reading that empty slot opened the editor on
				// nothing and then wrote that nothing back over the preset.
				editArranged = loadArranged(manager.effectiveArrangedGrid)
				editing = true
			}}
			onmouseenter={() => (tabActive = true)}
			onmouseleave={() => (tabActive = false)}
			onfocus={() => (tabActive = true)}
			onblur={() => (tabActive = false)}
			title="Customize layout"
			aria-label="Customize layout"
		>
			<Icons.LayoutDashboard size={14} />
			<span>Layout</span>
		</button>
	{/if}
	{#if editing}
		<!-- The layout editor: a tabbed toolbar over the chat. Presets picks a
		     saved layout (and saves the current one); Style picks the
		     message/composer packs (live preview); Move places and arranges
		     widgets in the zones. -->
		<div class="editor" data-pop-keep>
			<div class="editor-tabs" role="tablist" aria-label="Layout editor">
				<span class="editor-title">
					<Icons.LayoutDashboard size={14} />
					Layout
				</span>
				<div class="editor-tablist">
					<button
						class="editor-tab"
						class:active={editTab === "presets"}
						role="tab"
						aria-selected={editTab === "presets"}
						onclick={() => (editTab = "presets")}
					>
						<Icons.LayoutTemplate size={13} />
						Presets
					</button>
					<button
						class="editor-tab"
						class:active={editTab === "style"}
						role="tab"
						aria-selected={editTab === "style"}
						onclick={() => (editTab = "style")}
					>
						<Icons.Palette size={13} />
						Style
					</button>
					<button
						class="editor-tab"
						class:active={editTab === "move"}
						role="tab"
						aria-selected={editTab === "move"}
						onclick={() => (editTab = "move")}
					>
						<Icons.Move size={13} />
						Move
					</button>
				</div>
				<span class="flex-1"></span>
				<button
					class="tool-btn primary"
					onclick={() => {
						// Commit FIRST: the save reads the arrangement this
						// writes, so a preset saved on Done captures what you
						// just arranged rather than what you started with.
						commitArrangement()
						savePreset()
						editing = false
						armedId = null
					}}
				>
					<Icons.Check size={14} />
					<span>Done</span>
				</button>
			</div>

			<div class="editor-panel">
				{#if editTab === "presets"}
					<div class="presets-row" role="group" aria-label="Layouts">
						{#each presets as p (p.id)}
							<div class="preset-item">
								<button
									class="preset-card"
									class:active={activePreset?.id === p.id}
									aria-pressed={activePreset?.id === p.id}
									onclick={() => applyPreset(p.id)}
									title={p.isDefault
										? "The layout this genre ships with"
										: `Apply "${p.name}"`}
								>
									{@render presetPicture(p.layout)}
									<span class="preset-name">
										{#if p.isDefault}
											<Icons.RotateCcw size={11} />
										{/if}
										{p.name}
									</span>
								</button>
								<!-- Only the layouts THIS user saved can be
								     renamed or deleted, so the shipped default
								     is simply offered nothing — a button that
								     only ever explains why it refuses is worse
								     than no button. -->
								{#if !p.isDefault}
									{#if renamingId === p.id}
										<input
											class="preset-input preset-rename"
											type="text"
											bind:this={renameField}
											bind:value={renameValue}
											maxlength="80"
											aria-label={`New name for "${p.name}"`}
											onkeydown={(e) => {
												if (e.key === "Enter")
													commitRename(p.id)
												else if (e.key === "Escape")
													cancelRename()
											}}
											onblur={() => commitRename(p.id)}
										/>
									{:else}
										<div class="preset-actions">
											<button
												class="preset-action"
												onclick={() => startRename(p)}
												title={`Rename "${p.name}"`}
												aria-label={`Rename "${p.name}"`}
											>
												<Icons.Pencil size={12} />
											</button>
											<button
												class="preset-action"
												class:armed={deleteAskId === p.id}
												onclick={() => askDelete(p)}
												title={`Delete "${p.name}"`}
												aria-label={`Delete "${p.name}"`}
											>
												<Icons.Trash2 size={12} />
											</button>
										</div>
									{/if}
								{/if}
							</div>
						{:else}
							<span class="advanced-note">
								No saved layouts for this session type yet.
							</span>
						{/each}
					</div>
					<!-- The delete confirmation. One at a time, and its own row
					     rather than something crammed into a 6.5rem card: it has
					     a sentence to say, and what it says is what deleting
					     actually does to other sessions. -->
					{#if deletingPreset}
						{@const dp = deletingPreset}
						<div class="presets-row preset-confirm" role="alert">
							<span class="preset-confirm-text">
								{#if deleteUsage === null}
									Checking where “{dp.name}” is used…
								{:else if deleteUsage > 0}
									“{dp.name}” is used by {deleteUsage}
									session{deleteUsage === 1 ? "" : "s"}, which
									will go back to the default layout. Delete
									it?
								{:else}
									Delete “{dp.name}”?
								{/if}
							</span>
							<button
								class="tool-btn preset-danger"
								onclick={() => confirmDelete(dp.id)}
								disabled={deleteUsage === null}
								title={deleteUsage === null
									? "Still counting the sessions on this layout"
									: `Delete "${dp.name}"`}
							>
								<Icons.Trash2 size={14} />
								<span>Delete</span>
							</button>
							<button class="tool-btn" onclick={cancelDelete}>
								<Icons.X size={14} />
								<span>Cancel</span>
							</button>
						</div>
					{/if}
					<div class="presets-row">
						<label class="preset-save">
							<span class="sr-only">Name this layout</span>
							<input
								class="preset-input"
								type="text"
								bind:value={presetName}
								placeholder="Name this layout…"
								maxlength="80"
								onkeydown={(e) => {
									if (e.key === "Enter") savePreset()
								}}
							/>
						</label>
						<button
							class="tool-btn"
							onclick={savePreset}
							disabled={!presetName.trim()}
							title="Save the current arrangement as a new layout"
						>
							<Icons.Save size={14} />
							<span>Save preset</span>
						</button>
						<button
							class="tool-btn"
							onclick={resetLayout}
							title="Drop your own changes and show the selected layout"
						>
							<Icons.RotateCcw size={14} />
							<span>Reset to default</span>
						</button>
						<span class="advanced-note">
							Saving also happens on Done while a name is typed.
						</span>
					</div>
				{:else if editTab === "style"}
					<!-- The whole panel, deliberately. The message and composer
					     packs were the last controls here; they are per-widget
					     styles now (ruled 2026-08-30), so Messages and Composer
					     are picked from their own hover overlay like every other
					     widget — including the New / Edit / Clone path, which the
					     segmented rows never had. -->
					<p class="pack-hint">
						{#if styleableWidgets.length}
							Hover a widget to style it.
						{:else}
							Put a widget in the layout on the Move tab, then
							hover it to style it.
						{/if}
					</p>
				{:else if editTab === "move"}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="palette"
						class:drag-over={dragOverZone === "__palette__"}
						ondragover={(e) => {
							e.preventDefault()
							dragOverZone = "__palette__"
							if (e.dataTransfer)
								e.dataTransfer.dropEffect = "move"
						}}
						ondragleave={() => (dragOverZone = null)}
						ondrop={(e) => {
							e.preventDefault()
							dragOverZone = null
							const id = draggedId(e)
							if (id) removeWidget(id)
						}}
					>
						<span class="palette-label">
							<Icons.Plus size={13} />
							Add
						</span>
						<div class="palette-tray">
							{#each paletteWidgets as p (p.id)}
								{@const IconCmp = iconOf(p)}
								<button
									class="widget-card"
									class:armed={armedId === p.id}
									draggable="true"
									ondragstart={(e) =>
										onChipDragStart(e, p.id)}
									onclick={() =>
										(armedId =
											armedId === p.id ? null : p.id)}
									title={armedId === p.id
										? "Tap a zone to place"
										: "Drag to a zone, or tap to arm"}
								>
									<IconCmp size={18} />
									<span class="widget-card-label">
										{p.title}
									</span>
								</button>
							{:else}
								<span class="palette-empty">
									All widgets are placed.
								</span>
							{/each}
						</div>
						{#if armedId}
							<span class="palette-hint">tap a zone to place</span>
						{/if}
						<span class="flex-1"></span>
						<span class="palette-tip">
							Drag onto a zone · drop here to remove
						</span>
					</div>
					<!-- The screen-size simulator (P5, ruled 2026-08-30): a LENS
					     on the one arrangement, never a second one. Picking a
					     tier redraws the three editor zones at that width, so
					     their column counts — and therefore how this same
					     `arrangedGrid` clamps into them — are the device's.
					     Nothing here is persisted; Done and leaving the tab drop
					     back to Actual — and a preview you only LOOKED at is
					     undone with it (see `exitSimulation`), so previewing a
					     phone can never clamp away a desktop arrangement.

					     The last preset, Ultrawide, is the one that is not a
					     container tier: it previews the width where the side
					     rails branch to 2-column in `DEFAULT_SIDE_RULES`, which
					     nothing else here could show. -->
					<div class="move-sim">
						<span class="move-sim-label">
							<Icons.MonitorSmartphone size={13} />
							Screen
						</span>
						<div
							class="move-sim-seg"
							role="group"
							aria-label="Preview width"
						>
							<button
								class="move-sim-btn"
								class:active={simTier === null}
								aria-pressed={simTier === null}
								title="Preview at this window's real width"
								onclick={() => setSimTier(null)}
							>
								Actual
							</button>
							{#each SIM_OPTIONS as o (o.tier)}
								<button
									class="move-sim-btn"
									class:active={simTier === o.tier}
									aria-pressed={simTier === o.tier}
									title={o.hint}
									onclick={() =>
										setSimTier(
											simTier === o.tier ? null : o.tier
										)}
								>
									{o.label}
									<span class="move-sim-px">{o.width}</span>
								</button>
							{/each}
						</div>
					</div>
					<!-- Says out loud what the guard enforces: looking at a tier
					     changes nothing, but ARRANGING at one is an edit to the
					     single layout, not to that tier. (Sibling of .move-sim so
					     the panel's flex-wrap gives it its own line when tight;
					     reuses the editor's existing hint style.) -->
					{#if simTier !== null}
						<span class="palette-hint">
							Changes you make here apply to the layout at every
							size.
						</span>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	{#if placing}
		<!-- The Widgets tab is the visual grid editor: each zone is drawn as its
		     own square-cell grid, IN PLACE — Left and Right ride in the site's
		     margins (where they live in a session), Middle in the centre. Cards
		     occupy cells; you drag widgets straight onto the zone they belong in.
		     (Style/Advanced tabs keep the live preview.) -->
		<div class="edit-scrim"></div>
		{#if simWidth != null}
			<!-- Simulated: the whole canvas is drawn at the tier's width inside a
			     centred, labelled frame. `transform` (always set, even at 1) is
			     what makes the frame the containing block for the canvas's fixed
			     side rails — and what keeps the frame inside the real viewport
			     when the tier is wider than it, instead of overflowing.
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
					{@render editCanvas(true)}
				</div>
			</div>
		{:else}
			{@render editCanvas(false)}
		{/if}
	{:else}
	<div class="layout-body" class:margin-mode={marginMode}>
		<!-- The left side, mounted ONCE. `leftSlot` says whether it is drawn in
		     the flow here, lifted into the reclaimed margin, or stowed (mobile
		     — P6: no rail, no icon strip, the centre gets the full width; it
		     comes back as the overlay at the bottom of this block). Stowed is
		     display:none, never an unmount. -->
		{@render sideMount("left", leftSlot)}

		<div class="layout-center">
			{#each topStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
			<!-- The two layout attributes are TRANSITIONAL (see the block above
			     `msgLayoutAttr`): written from the RESOLVED style so CSS outside
			     this repo that still keys on a pack name keeps working for one
			     release. A style with no pack name (someone's own) writes
			     neither, which is correct — no pack is active. -->
			<div
				class="chat-core"
				data-msg-layout={msgLayoutAttr}
				data-composer-layout={composerLayoutAttr}
				style={msgCap ? `max-inline-size:${msgCap}rem;` : ""}
			>
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
						style="grid-template-columns:repeat({arranged.middle.cols},1fr); grid-template-rows:repeat({arranged.middle.rows},1fr);"
					>
						{#each unitsOf(arranged.middle.items) as u (u.key)}
							{@const widthPx = cellWidths[`middle:${u.key}`] ?? 0}
							<div
								class="chat-arranged-cell"
								bind:clientWidth={cellWidths[`middle:${u.key}`]}
								style="grid-column:{u.box.x + 1} / span {u.box
									.w}; grid-row:{u.box.y + 1} / span {u.box
									.h};{u.members.length === 1
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
											u.members[0].id
										)
									})}
								{:else}
									{@render tabGroup(u, {
										zone: arranged.middle,
										widthPx
									})}
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<!-- No arrangement yet (fresh / never edited): the default —
					     Messages fill, Composer pins to the bottom. -->
					<WidgetZone layout={chatGrid} zone="middle" gap="0" widget={middleWidget} />
				{/if}
			</div>
			{#each bottomStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
		</div>

		<!-- The right side, mounted ONCE — same deal as the left above. Both
		     keep their DOM position around `.layout-center`: in margin mode the
		     wrapper is `position: fixed`, so it is out of flow and its place in
		     this list costs nothing (and the fixed layer's z-index, not source
		     order, is what puts it under the sidebars). -->
		{@render sideMount("right", rightSlot)}

		<!-- The pop-over: an unpinned/narrow zone slid over the chat.
		     Desktop only — below the breakpoint the header's L/R group owns the
		     overlay, and the icon strips that arm this one are not rendered. -->
		{#if popZone && popZone.mode !== "rail" && !isNarrow}
			{@const onLeft = popZone.def.side === "left"}
			{#if popZone.mode === "drawer"}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="pop-scrim" onclick={() => (popId = null)}></div>
			{/if}
			<div
				class="zone-flyout"
				class:from-left={onLeft}
				style="inline-size:min({popZone.width}px, 86%);"
				role="dialog"
				aria-label={labelOf(popZone)}
				data-pop-keep
			>
				<div class="zone-head">
					<span class="zone-label always">{labelOf(popZone)}</span>
					<span class="flex-1"></span>
					{#if popZone.mode === "icons"}
						<button
							class="zone-head-btn"
							title="Pin — keep this zone open"
							aria-label="Pin {labelOf(popZone)}"
							onclick={() => setPinned(popZone!.id, true)}
						>
							<Icons.Pin size={13} />
						</button>
					{/if}
					<button
						class="zone-head-btn"
						title="Close"
						aria-label="Close {labelOf(popZone)}"
						onclick={() => (popId = null)}
					>
						<Icons.X size={13} />
					</button>
				</div>
				{@render panelStack(popZone, true)}
			</div>
		{/if}

		<!-- Mobile side panels (P6, ruled 2026-08-30): one side at a time, slid
		     in from its own edge over the session and opened from the header's
		     L/R group. The SHEET is that side's own mount wearing
		     `.zone-flyout.mobile` (see `sideMount` / `sideSlot`'s `overlay`
		     slot) — it used to be a second render of the same panels here, and
		     opening it reloaded every iframe in the side. What is left here is
		     the backdrop, which belongs to no side. -->
		{#if mobileSide}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="pop-scrim" onclick={closeMobilePanels}></div>
		{/if}
	</div>
	{/if}
</div>

<style>
	.session-layout {
		position: relative;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
	}
	.layout-body {
		position: relative;
		display: flex;
		flex: 1;
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
	   same 0.5rem gap. `.slot-margin` wears `.margin-rail` below instead. */
	.side-slot.slot-inline {
		display: contents;
	}
	/* Stowed: below the breakpoint, or in margin mode while that margin is
	   taken by an open sidebar panel / too thin to be a rail. No layout space,
	   no tab stop, no a11y tree — but still MOUNTED, so the iframes keep
	   running and the panels keep their state (the no-reload law). This is the
	   state that used to be an unmount, and the reload it used to cost. */
	.side-slot.slot-stowed {
		display: none;
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
	.side-slot.slot-overlay > :global(.live-side) {
		flex: 1;
		min-block-size: 0;
	}

	/* ── margin mode: side zones lifted into the viewport margins ─────────
	   Fixed layers pinned to the window's left/right edges, sized to the dead
	   space the closed sidebars reserve. The container is click-through; only
	   the zone content is interactive, so empty margin doesn't trap clicks. */
	.margin-rail {
		position: fixed;
		inset-block-end: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.4rem;
		overflow-y: auto;
		pointer-events: none;
	}
	.margin-rail > :global(*) {
		pointer-events: auto;
	}
	.margin-rail.margin-left {
		inset-inline-start: 0;
		align-items: flex-start;
	}
	.margin-rail.margin-right {
		inset-inline-end: 0;
		align-items: flex-end;
	}
	/* Pinned rails fill the margin; icon strips hug the outer edge. */
	.margin-rail :global(.zone-rail) {
		inline-size: 100% !important;
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
		margin-inline: auto; /* centered when a message cap applies */
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
		   with these cells static, was some zone far above: Messages' and
		   Composer's controls stretched across the whole chat column instead of
		   sitting on the widget they style. (A Panel-chromed widget was already
		   fine — Panel's own section is relative.) Nothing inside a cell is
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
	/* Live side zone rendered from the arrangement — proportional grid filling
	   the margin, panels placed at their cells. The `100%` here is the MARGIN
	   slot's rule: the wrapper is a fixed layer sized to the measured margin,
	   so filling it is right. In the flow there is nothing definite to be 100%
	   OF — `.layout-body` is the whole session — so the snippet writes an
	   inline `flex: 0 0 <ladder>px` there instead (see `sideWidths`). */
	.live-side {
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
		display: grid;
		gap: 0.4rem;
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
	/* The centre column while editing: the chat zone's cell grid. */
	.edit-grid-body {
		position: relative;
		z-index: 16;
		overflow: visible;
	}
	/* Cap the middle editor to the centre half and centre it, so the ¼|½|¼ editor
	   layout is identical whether full-width is on or off (in full-width the main
	   is 100vw, so without this the middle would fill it). The cap itself is an
	   inline style — `simulatedGeometry`'s centre, for the real width or a
	   simulated one — so this rule only owns the centring. */
	.edit-center {
		margin-inline: auto;
	}
	/* Left/Right zones ride in the site's reclaimed margins (fixed layers,
	   same geometry as the live margin rails), so what you edit is where the
	   panels actually live in a session. */
	.edit-margin {
		position: fixed;
		inset-block-end: 0;
		z-index: 20;
		padding: 0.4rem;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}
	.edit-margin-left {
		inset-inline-start: 0;
	}
	.edit-margin-right {
		inset-inline-end: 0;
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
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-surface-50);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 78%,
			transparent
		);
	}
	/* The simulated viewport. Its `transform` is always set (scale(1) included)
	   — that is deliberate: a transformed element is the containing block for
	   its `position: fixed` descendants, which is how the canvas's side rails
	   pin to THIS box instead of escaping to the real window. */
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

	/* A zone rendered as its own grid of square cells. Opaque so the busy chat
	   / scene backdrop behind never bleeds through the grid. */
	.zgrid {
		flex: 1;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		border-radius: 0.7rem;
		border: 1.5px dashed
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		background: var(--color-surface-100);
		box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.55);
		/* Not clipped: a dragged card must be able to leave the zone box for a
		   cross-zone drop; the rounded corners still read via the header/body. */
		overflow: visible;
		transition:
			border-color 120ms ease,
			background 120ms ease;
	}
	:global([data-mode="dark"]) .zgrid {
		background: var(--color-surface-900);
	}
	.zgrid.drag-over {
		border-style: solid;
		border-color: var(--color-primary-500);
		background: color-mix(in oklab, var(--color-primary-500) 12%, var(--color-surface-100));
	}
	:global([data-mode="dark"]) .zgrid.drag-over {
		background: color-mix(in oklab, var(--color-primary-500) 18%, var(--color-surface-900));
	}
	/* A chip is armed: the zones that can take it say so, and the focused one
	   says which is about to. */
	.zgrid.armed {
		cursor: copy;
		border-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent);
	}
	.zgrid.armed:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
	.zgrid-middle {
		border-style: solid;
		border-color: color-mix(
			in oklab,
			var(--color-surface-400) 55%,
			transparent
		);
	}
	.zgrid-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: none;
		padding: 0.35rem 0.6rem;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-surface-600);
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
	}
	:global([data-mode="dark"]) .zgrid-head {
		color: var(--color-surface-300);
	}
	/* The zone body hosts the real WidgetZone grid (which draws its own square
	   cell guides via `.cells`) plus the empty-state overlay. */
	.zgrid-body {
		position: relative;
		flex: 1;
		min-block-size: 0;
		padding: 0.4rem;
	}
	/* A widget's editor card. It fills its real grid slot (WidgetZone gives the
	   slot flex:1), so a GROW widget's card fills and a fixed one is its size —
	   the card is the widget's actual footprint, cells and all. */
	.ecard {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		margin: 2px;
		border-radius: 0.5rem;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--color-surface-50);
		background: color-mix(in oklab, var(--color-primary-500) 82%, black 4%);
		border: 1px solid
			color-mix(in oklab, var(--color-primary-300) 60%, transparent);
		box-shadow: 0 3px 10px -5px rgba(0, 0, 0, 0.55);
		cursor: grab;
		overflow: hidden;
	}
	.ecard:active {
		cursor: grabbing;
	}
	.ecard-middle {
		cursor: default;
		background: color-mix(in oklab, var(--color-surface-500) 32%, transparent);
		color: var(--color-surface-900);
		border-color: color-mix(
			in oklab,
			var(--color-surface-500) 45%,
			transparent
		);
	}
	:global([data-mode="dark"]) .ecard-middle {
		color: var(--color-surface-50);
	}
	.ecard-head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: none;
		padding: 0.4rem 0.6rem;
	}
	.ecard-title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ecard-x {
		display: flex;
		border-radius: 0.35rem;
		padding: 0.15rem;
		color: inherit;
		opacity: 0.85;
	}
	.ecard-x:hover {
		background: color-mix(in oklab, black 25%, transparent);
		opacity: 1;
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
	.zone-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex: none;
		min-block-size: 1.25rem;
	}
	.zone-label {
		display: none;
		font-size: 0.65rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.07em;
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

	/* ── tools + palette + edit mode ───────────────────────────────── */
	.layout-center {
		position: relative;
	}
	/* Edit entry: a slim pull-tab centered on the FULL session width (so it
	   lines up with the header's centre, not the offset chat column). Solid,
	   header-coloured, and HIDDEN until the nav is hovered (`.revealed`), so it
	   reads as a tab dropping out of the header rather than floating over the
	   conversation. pointer-events off while hidden so it never eats clicks. */
	.edit-tab {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.18rem 0.75rem;
		border-radius: 0 0 0.6rem 0.6rem;
		font-size: 0.78rem;
		font-weight: 650;
		letter-spacing: 0.02em;
		color: var(--color-surface-800);
		/* Matches the header's bg-surface-100-900. */
		background: var(--color-surface-100);
		box-shadow: 0 2px 8px -4px rgba(0, 0, 0, 0.35);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 200ms ease,
			color 120ms ease;
	}
	.edit-tab.revealed {
		opacity: 1;
		pointer-events: auto;
	}
	.edit-tab:hover,
	.edit-tab:focus-visible {
		color: var(--color-primary-600);
	}
	:global([data-mode="dark"]) .edit-tab {
		color: var(--color-surface-200);
		background: var(--color-surface-900);
	}
	:global([data-mode="dark"]) .edit-tab:hover,
	:global([data-mode="dark"]) .edit-tab:focus-visible {
		color: var(--color-primary-400);
	}
	/* ── Layout editor toolbar (tabbed: Style · Widgets · Advanced) ──── */
	.editor {
		position: relative;
		z-index: 25;
		flex: none;
		margin-block-end: 0.5rem;
		border-radius: 0.7rem;
		background: var(--color-surface-100);
		border: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 0 6px 20px -12px rgba(0, 0, 0, 0.4);
		overflow: hidden;
	}
	:global([data-mode="dark"]) .editor {
		background: var(--color-surface-900);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 60%,
			transparent
		);
	}
	.editor-tabs {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.4rem 0.3rem 0.65rem;
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 45%, transparent);
	}
	:global([data-mode="dark"]) .editor-tabs {
		border-block-end-color: color-mix(
			in oklab,
			var(--color-surface-700) 45%,
			transparent
		);
	}
	.editor-title {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .editor-title {
		color: var(--color-surface-200);
	}
	.editor-tablist {
		display: flex;
		gap: 0.15rem;
		margin-inline-start: 0.4rem;
		padding: 0.12rem;
		border-radius: 0.55rem;
		background: color-mix(in oklab, var(--color-surface-500) 12%, transparent);
	}
	.editor-tab {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.6rem;
		border-radius: 0.45rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-surface-600);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	:global([data-mode="dark"]) .editor-tab {
		color: var(--color-surface-400);
	}
	.editor-tab:hover {
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .editor-tab:hover {
		color: var(--color-surface-100);
	}
	.editor-tab.active {
		background: var(--color-surface-50);
		color: var(--color-primary-600);
		box-shadow: 0 1px 3px -1px rgba(0, 0, 0, 0.25);
	}
	:global([data-mode="dark"]) .editor-tab.active {
		background: var(--color-surface-800);
		color: var(--color-primary-400);
	}
	.editor-panel {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.9rem;
		padding: 0.5rem 0.65rem;
	}
	/* Style tab: the whole panel is one line pointing at the widgets themselves,
	   which is where the controls are. The segmented pack pickers that used to
	   sit above it went with the packs (ruled 2026-08-30). */
	.pack-hint {
		inline-size: 100%;
		font-size: 0.68rem;
		line-height: 1.45;
		color: var(--color-surface-500);
	}
	/* Widgets tip + Advanced note + row. */
	.palette-tip,
	.advanced-note {
		font-size: 0.68rem;
		color: var(--color-surface-500);
	}
	.presets-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* ── preset cards + their pictures ──────────────────────────────── */
	/* The card and its manage row are one column: the card stays the apply
	   control it always was (a button, which is why the actions cannot live
	   inside it), and rename/delete sit underneath. */
	.preset-item {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.2rem;
		/* The row centres its children, and the built-in card is shorter than a
		   card carrying a manage row — top-align so every picture still lines
		   up with every other. */
		align-self: flex-start;
	}
	.preset-actions {
		display: flex;
		justify-content: center;
		gap: 0.15rem;
	}
	.preset-action {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.3rem;
		border-radius: 0.35rem;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .preset-action {
		color: var(--color-surface-400);
	}
	.preset-action:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			transparent
		);
	}
	/* The card whose confirmation is open below, so the sentence and the bin it
	   came from are visibly the same thing. */
	.preset-action.armed {
		background: color-mix(in oklab, var(--color-error-500) 20%, transparent);
		color: var(--color-error-700, var(--color-error-500));
	}
	/* Both classes on purpose: `.preset-input`'s own width is declared further
	   down this sheet, so matching its specificity would lose on source order. */
	.preset-input.preset-rename {
		width: 6.5rem;
	}
	.preset-confirm {
		padding: 0.3rem 0.45rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, var(--color-error-500) 10%, transparent);
	}
	.preset-confirm-text {
		flex: 1 1 12rem;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .preset-confirm-text {
		color: var(--color-surface-200);
	}
	/* `.tool-btn:hover` is declared later in this sheet and would otherwise
	   repaint the destructive button in the primary tint on hover, so the hover
	   state is claimed here rather than left to source order. */
	.tool-btn.preset-danger,
	.tool-btn.preset-danger:hover {
		background: var(--color-error-500);
		color: var(--color-error-contrast-500, white);
	}
	.tool-btn.preset-danger:hover:not(:disabled) {
		background: var(--color-error-600, var(--color-error-500));
	}
	.preset-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		padding: 0.3rem;
		border-radius: 0.5rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-200) 60%,
			transparent
		);
	}
	.preset-card:hover {
		border-color: var(--color-primary-500);
	}
	.preset-card.active {
		border-color: var(--color-primary-500);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 16%,
			transparent
		);
	}
	.preset-name {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-surface-700);
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global([data-mode="dark"]) .preset-name {
		color: var(--color-surface-200);
	}
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

	/* The "name this layout" box. */
	.preset-save {
		display: flex;
	}
	.preset-input {
		padding: 0.28rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 0.72rem;
		width: 10rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-100) 80%,
			transparent
		);
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .preset-input {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
		color: var(--color-surface-100);
	}
	.tool-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.tool-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.28rem 0.55rem;
		border-radius: 0.5rem;
		font-size: 0.72rem;
		font-weight: 600;
		background: color-mix(
			in oklab,
			var(--color-surface-200) 80%,
			transparent
		);
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .tool-btn {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 80%,
			transparent
		);
		color: var(--color-surface-300);
	}
	.tool-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			transparent
		);
	}
	.tool-btn.primary {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
	}

	.palette {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		flex: 1 1 auto;
		padding: 0.35rem 0.45rem;
		border-radius: 0.5rem;
		border: 1px dashed
			color-mix(in oklab, var(--color-primary-500) 40%, transparent);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 5%,
			transparent
		);
	}
	.palette-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.68rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-surface-500);
	}
	.palette.drag-over {
		border-style: solid;
		background: color-mix(
			in oklab,
			var(--color-error-500) 10%,
			transparent
		);
	}
	.palette-tray {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 0.4rem;
		flex: 1 1 auto;
	}
	/* Toggleable widgets read as square cards, not pills. */
	.widget-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		inline-size: 4.6rem;
		min-block-size: 4rem;
		padding: 0.45rem 0.35rem;
		border-radius: 0.6rem;
		font-size: 0.68rem;
		font-weight: 600;
		text-align: center;
		cursor: grab;
		color: var(--color-surface-700);
		background: var(--color-surface-100);
		border: 1px solid
			color-mix(in oklab, var(--color-surface-300) 70%, transparent);
		transition:
			border-color 120ms ease,
			background 120ms ease,
			transform 120ms ease;
	}
	.widget-card:hover {
		transform: translateY(-1px);
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 45%,
			transparent
		);
	}
	.widget-card-label {
		inline-size: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		line-height: 1.15;
	}
	:global([data-mode="dark"]) .widget-card {
		color: var(--color-surface-200);
		background: var(--color-surface-900);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 70%,
			transparent
		);
	}
	.widget-card.armed {
		border-color: var(--color-primary-500);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 18%,
			transparent
		);
	}
	.palette-empty,
	.palette-hint {
		font-size: 0.7rem;
		color: var(--color-surface-500);
	}
	.palette-hint {
		color: var(--color-primary-600);
		font-weight: 600;
	}

	/* ── Move tab: the screen-size simulator's width picker ──────────────── */
	.move-sim {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 0 0 auto;
	}
	.move-sim-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .move-sim-label {
		color: var(--color-surface-300);
	}
	/* Wraps rather than clips: `overflow: hidden` is here for the rounded
	   corners, and with six presets (Actual + five widths) a narrow editor
	   toolbar would otherwise hide the widest one — the one preset you cannot
	   reach any other way. */
	.move-sim-seg {
		display: flex;
		flex-wrap: wrap;
		border-radius: 0.45rem;
		overflow: hidden;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
	}
	.move-sim-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-surface-600);
		background: transparent;
		border: 0;
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
		cursor: pointer;
		white-space: nowrap;
	}
	.move-sim-btn:first-child {
		border-inline-start: 0;
	}
	.move-sim-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 10%,
			transparent
		);
	}
	.move-sim-btn.active {
		color: var(--color-surface-50);
		background: var(--color-primary-500);
	}
	.move-sim-px {
		font-size: 0.62rem;
		font-weight: 500;
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}
	:global([data-mode="dark"]) .move-sim-btn {
		color: var(--color-surface-300);
	}
	:global([data-mode="dark"]) .move-sim-btn.active {
		color: var(--color-surface-50);
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
		font-size: 0.72rem;
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
		font-size: 0.68rem;
		font-weight: 600;
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
