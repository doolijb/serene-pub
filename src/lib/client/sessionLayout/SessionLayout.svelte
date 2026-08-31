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
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Panel from "$lib/client/components/surfaces/Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import {
		COMPOSER_LAYOUTS,
		MESSAGE_LAYOUTS,
		normalizeZoneLayout,
		placedWidgetIds,
		resolveMessageCap,
		resolveStyles,
		resolveZone,
		withStyles,
		withWidget,
		withoutWidget,
		type ResolvedZone,
		type ZoneLayout
	} from "./schema"
	// The message + composer style packs (skins over the one SessionMessage /
	// SessionComposer). Imported here as a plain global sheet so it lands
	// outside Tailwind's cascade layers and wins over the components' utility
	// classes. See messageLayouts.css.
	import "./messageLayouts.css"
	import { navHover } from "./navHover.svelte"
	// PLAN 25: the chat middle is a widget grid. Messages (GROW) + Composer
	// (FIXED, bottom) are two required widgets that fall out of the model — no
	// bespoke center layout. The surrounding zones stay the interim system for
	// now; this proves the normal chat in the new model first.
	import WidgetZone from "./WidgetZone.svelte"
	import {
		cellsFromPx,
		DEFAULT_CELL,
		loadChatLayout,
		updateWidget,
		widgetsInZone,
		type GridLayout,
		type SizeSpec,
		type WidgetConfig,
		type Zone
	} from "./widgetGrid"
	// PLAN 25: the docked-rail case (the common one — a pinned, single-column
	// side zone) also now runs on the widget-grid engine, via this pure
	// translation of the panel/zone system. See panelWidgets.ts's module doc
	// for exactly what it does and doesn't cover.
	import { widgetsFromSideZones } from "./panelWidgets"
	// The editor's grid is gridstack (free 2D drag / resize / snap). See
	// GridStackZone — gridstack owns its DOM, Svelte owns only the host.
	import GridStackZone, {
		type GsAnchor,
		type GsItem,
		type GsLayout,
		type GsPos
	} from "./GridStackZone.svelte"
	import { unitsOf, type RenderUnit } from "./tabGroups"

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
		onFrameAction
	}: Props = $props()

	// The chat's widget grid: the genre's default Chat layout merged with this
	// user's saved widget blob (courier'd verbatim by the manager). Editing
	// commits back through the manager, which debounce-persists it.
	let chatGrid = $derived<GridLayout>(loadChatLayout(manager.widgetGrid))
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
	let editSideW = $derived(Math.round(vw * 0.25))

	/* ── measured width (never the viewport) ───────────────────────── */
	let rootEl: HTMLDivElement | null = $state(null)
	let containerW = $state(1024)
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
	let saved = $derived(normalizeZoneLayout(manager.zoneLayout, activeSecondaryIds))
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
	// The active style packs — drive the data-attributes on .chat-core that the
	// global skin sheet keys off (feature parity: same components, only CSS).
	let styles = $derived(resolveStyles(layout))
	function setStyle(patch: { chat?: string; composer?: string }) {
		commit(withStyles(layout, patch))
	}

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
	// The gridstack editor reports each zone's arrangement (cell dims + item
	// cells) as you edit (arranged.*). It is SEEDED FROM PERSISTENCE so a saved
	// arrangement survives a reload and drives the live render immediately (the
	// render treats a present arranged zone as authoritative), and re-opening the
	// editor restores it. Written while editing, persisted on Done. A malformed or
	// absent blob yields {} — the pre-edit default render. (Declared here, above
	// the GsItems that read it, so the derived seeding is in scope.)
	type Arranged = { left?: GsLayout; middle?: GsLayout; right?: GsLayout }
	let arranged = $state<Arranged>(loadArranged(manager.arrangedGrid))

	// Each list carries its default placement (place/h); `withGeometry` overlays
	// any saved x/y/w/h from `arranged` so re-opening the editor restores what was
	// arranged rather than re-laying-out from defaults (the reset-to-defaults bug).
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
			arranged.middle
		)
	)
	let leftGsItems = $derived<GsItem[]>(
		withGeometry(
			editorLeftPanels.map((p) => ({ id: p.id, title: p.title, h: 3 })),
			arranged.left
		)
	)
	let rightGsItems = $derived<GsItem[]>(
		withGeometry(
			editorRightPanels.map((p) => ({ id: p.id, title: p.title, h: 3 })),
			arranged.right
		)
	)
	function gsKey(items: GsItem[]): string {
		return items.map((i) => i.id).join(",")
	}

	function isGsPos(i: unknown): i is GsPos {
		return (
			!!i &&
			typeof i === "object" &&
			typeof (i as any).id === "string" &&
			["x", "y", "w", "h"].every(
				(k) => typeof (i as any)[k] === "number"
			)
		)
	}
	function isGsLayout(z: unknown): z is GsLayout {
		return (
			!!z &&
			typeof z === "object" &&
			typeof (z as any).cols === "number" &&
			typeof (z as any).rows === "number" &&
			Array.isArray((z as any).items)
		)
	}
	/** Defensively rehydrate the persisted per-zone geometry (verbatim blob). */
	function loadArranged(saved: unknown): Arranged {
		if (!saved || typeof saved !== "object") return {}
		const out: Arranged = {}
		for (const key of ["left", "middle", "right"] as const) {
			const z = (saved as any)[key]
			if (isGsLayout(z))
				out[key] = {
					cols: z.cols,
					rows: z.rows,
					items: z.items.filter(isGsPos)
				}
		}
		return out
	}
	/**
	 * Merge captured x/y/w/h from a persisted zone layout onto the editor's
	 * id-keyed GsItems, so re-opening the editor restores the arrangement instead
	 * of re-laying-out from defaults. An item with no saved geometry keeps its
	 * default `place`/`h`. gsKey is ids-only, so this never re-instantiates the
	 * grid (geometry is read once at mount).
	 */
	function withGeometry(items: GsItem[], zone: GsLayout | undefined): GsItem[] {
		if (!zone) return items
		const pos = new Map(zone.items.map((i) => [i.id, i]))
		return items.map((it) => {
			const p = pos.get(it.id)
			return p
				? {
						...it,
						x: p.x,
						y: p.y,
						w: p.w,
						h: p.h,
						...(p.anchor ? { anchor: p.anchor } : {}),
						...(p.group ? { group: p.group } : {})
					}
				: it
		})
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

	/**
	 * Commit editor arrangement on Done: side-zone membership → zoneLayout (for
	 * the palette/active logic), and the full per-zone geometry → arrangedGrid
	 * (positions + anchors + groups — what makes the arrangement survive a reload
	 * and restore into the editor).
	 */
	function commitArrangement() {
		let next = layout
		for (const [key, zid] of [
			["left", leftZoneId],
			["right", rightZoneId]
		] as const) {
			const a = arranged[key]
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
		manager.setArrangedGrid($state.snapshot(arranged))
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

	function setPinned(zoneId: string, pinned: boolean) {
		const def = layout.zones[zoneId]
		if (!def) return
		commit({
			...layout,
			zones: { ...layout.zones, [zoneId]: { ...def, pinned } }
		})
		if (pinned && popId === zoneId) popId = null
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
	let editing = $state(false)
	// The editor is tabbed: Style (pack pickers) · Widgets (place/drag) ·
	// Advanced (JSON/reset). Widget-placement affordances (zone outlines,
	// drag, remove) only light up in the Widgets tab, so Style stays a clean
	// live preview.
	// Editor tabs (PLAN 25 redesign): Presets (pick a default/saved layout) ·
	// Settings (per-widget style) · Move (drag + anchor/pin/group + the
	// screen-size simulator). Only Move lights up the structural drag affordances.
	let editTab = $state<"presets" | "settings" | "move">("move")
	let placing = $derived(editing && editTab === "move")
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

	function place(zoneId: string, widgetId: string, beforeId?: string) {
		manager.activate(widgetId)
		commit(withWidget(layout, zoneId, widgetId, beforeId))
		armedId = null
	}
	function removeWidget(widgetId: string) {
		commit(withoutWidget(layout, widgetId))
		manager.close(widgetId)
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

	function resetLayout() {
		manager.setZoneLayout(undefined)
		manager.setWidgetGrid(undefined)
		manager.setArrangedGrid(undefined)
		arranged = {}
		popId = null
	}
</script>

<!-- Unified live widget renderer: turns a widget id into its real content, so
     ANY widget renders correctly in ANY zone (a panel dragged into the middle,
     or chat dragged into a side, no longer vanishes). Used by the middle grid
     AND the side connector. -->
{#snippet middleWidget({ id, bare = false }: { id: string; bare?: boolean })}
	{#if id === "messages"}
		{@render messagesChildren?.()}
	{:else if id === "composer"}
		{@render composerChildren?.()}
	{:else}
		{@const p = inst(id)}
		{#if p && p.role !== "primary"}
			<Panel
				instance={p}
				{manager}
				{sessionId}
				{session}
				chrome="zone"
				hideHeader={bare}
				{onFrameAction}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet railPanelInner(p: PanelInstance, z: ResolvedZone)}
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
		{#snippet railPanel({ id }: { id: string })}
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
					{@render railPanelInner(p, z)}
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
					<button
						class="icon-btn"
						class:active={popId === z.id}
						class:edit-item={placing}
						draggable={placing}
						title={placing ? "Drag to move {p.title}" : p.title}
						aria-label={placing
							? "Move {p.title}"
							: "Open {p.title}"}
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
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<section
		class="zgrid"
		class:zgrid-middle={isMiddle}
		class:drag-over={!!zoneId && dragOverZone === zoneId}
		data-pop-keep
		ondragover={(e) => zoneId && onZoneDragOver(e, zoneId)}
		ondragleave={() => (dragOverZone = null)}
		ondrop={(e) => zoneId && onZoneDrop(e, zoneId)}
	>
		<header class="zgrid-head">
			<HeadIcon size={13} />
			{label}
		</header>
		<div class="zgrid-body">
			{#key gsKey(gsItems)}
				<GridStackZone
					items={gsItems}
					{onChange}
					onRemove={(id) => removeWidget(id)}
				/>
			{/key}
		</div>
	</section>
{/snippet}

<!-- Live render of a side zone FROM THE EDITOR ARRANGEMENT (connector): the
     real panels placed at the cells you arranged, via a proportional grid so it
     maps to the margin's actual size. Replaces the interim rail/icons whenever
     an arrangement for that side exists. -->
<!-- A tab group in the live view: grouped widgets share one footprint, one tab
     per member, all members mounted (shown/hidden) so their state survives a
     switch. Used by both the middle connector and the side connector. -->
{#snippet tabGroup(u: RenderUnit)}
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
		<div class="wtabs-body">
			{#each u.members as m (m.id)}
				<div class="wtab-pane" class:wtab-hidden={m.id !== active}>
					{@render middleWidget({ id: m.id, bare: true })}
				</div>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet arrangedSide(side: "left" | "right")}
	{@const arr = side === "left" ? arranged.left : arranged.right}
	{#if arr}
		<div
			class="live-side"
			style="grid-template-columns:repeat({arr.cols},1fr); grid-template-rows:repeat({arr.rows},1fr);"
		>
			{#each unitsOf(arr.items) as u (u.key)}
				<div
					class="live-side-cell"
					style="grid-column:{u.box.x + 1} / span {u.box
						.w}; grid-row:{u.box.y + 1} / span {u.box.h};{u.members
						.length === 1
						? anchorCellStyle(u.members[0].anchor)
						: ''}"
				>
					{#if u.members.length === 1}
						{@render middleWidget({ id: u.members[0].id })}
					{:else}
						{@render tabGroup(u)}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
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
				// into the grid instead of resetting to defaults.
				arranged = loadArranged(manager.arrangedGrid)
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
		<!-- The layout editor: a tabbed toolbar over the chat. Style picks the
		     message/composer packs (live preview); Widgets places panels into
		     the zones; Advanced is the JSON / reset escape hatch. -->
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
						class:active={editTab === "settings"}
						role="tab"
						aria-selected={editTab === "settings"}
						onclick={() => (editTab = "settings")}
					>
						<Icons.Palette size={13} />
						Settings
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
						commitArrangement()
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
					<div class="presets-row">
						<button
							class="tool-btn"
							onclick={resetLayout}
							title="Reset to the default layout"
						>
							<Icons.RotateCcw size={14} />
							<span>Reset to default</span>
						</button>
						<span class="advanced-note">
							Default &amp; saved layouts (per genre) — coming soon.
						</span>
					</div>
				{:else if editTab === "settings"}
					<div class="pack-row">
						<span class="pack-label">
							<Icons.MessagesSquare size={13} />
							Messages
						</span>
						<div
							class="segmented"
							role="group"
							aria-label="Message style"
						>
							{#each MESSAGE_LAYOUTS as o (o.id)}
								<button
									class="seg"
									class:active={styles.chat === o.id}
									title={o.description}
									onclick={() => setStyle({ chat: o.id })}
								>
									{o.label}
								</button>
							{/each}
						</div>
					</div>
					<div class="pack-row">
						<span class="pack-label">
							<Icons.PanelBottom size={13} />
							Composer
						</span>
						<div
							class="segmented"
							role="group"
							aria-label="Composer style"
						>
							{#each COMPOSER_LAYOUTS as o (o.id)}
								<button
									class="seg"
									class:active={styles.composer === o.id}
									title={o.description}
									onclick={() =>
										setStyle({ composer: o.id })}
								>
									{o.label}
								</button>
							{/each}
						</div>
					</div>
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
		<div class="layout-body edit-grid-body">
			<!-- Middle editor, constrained to the centre half of the viewport and
			     centred, so it lines up with the side quarters in BOTH width modes
			     (in full-width the main is 100vw, so we cap it here). -->
			<div class="layout-center edit-center">
				{@render editZonePanel(
					null,
					"Middle",
					Icons.MessageSquare,
					middleGsItems,
					true,
					(l) => (arranged.middle = l)
				)}
			</div>
		</div>
		{#if leftZoneId}
			<div
				class="edit-margin edit-margin-left"
				style="inset-block-start:{mTop}px; inline-size:{editSideW}px;"
			>
				{@render editZonePanel(
					leftZoneId,
					"Left",
					Icons.PanelLeft,
					leftGsItems,
					false,
					(l) => (arranged.left = l)
				)}
			</div>
		{/if}
		{#if rightZoneId}
			<div
				class="edit-margin edit-margin-right"
				style="inset-block-start:{mTop}px; inline-size:{editSideW}px;"
			>
				{@render editZonePanel(
					rightZoneId,
					"Right",
					Icons.PanelRight,
					rightGsItems,
					false,
					(l) => (arranged.right = l)
				)}
			</div>
		{/if}
	{:else}
	<div class="layout-body" class:margin-mode={marginMode}>
		{#if !marginMode}
			{#if arranged.left}
				{@render arrangedSide("left")}
			{:else}
				{#each leftZones as z (z.id)}
					{@render sideZone(z)}
				{/each}
			{/if}
		{/if}

		<div class="layout-center">
			{#each topStrips as z (z.id)}
				{@render stripZone(z)}
			{/each}
			<div
				class="chat-core"
				data-msg-layout={styles.chat}
				data-composer-layout={styles.composer}
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
							<div
								class="chat-arranged-cell"
								style="grid-column:{u.box.x + 1} / span {u.box
									.w}; grid-row:{u.box.y + 1} / span {u.box
									.h};{u.members.length === 1
									? anchorCellStyle(u.members[0].anchor)
									: ''}"
							>
								{#if u.members.length === 1}
									{@render middleWidget({ id: u.members[0].id })}
								{:else}
									{@render tabGroup(u)}
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

		{#if !marginMode}
			{#if arranged.right}
				{@render arrangedSide("right")}
			{:else}
				{#each rightZones as z (z.id)}
					{@render sideZone(z)}
				{/each}
			{/if}
		{/if}

		<!-- Margin mode: the side zones live in the viewport margins (fixed
		     layers), reclaiming the space the closed sidebars reserve. -->
		{#if leftMarginFree && mLeft > 40}
			<div
				class="margin-rail margin-left"
				style="inset-block-start:{mTop}px; inline-size:{mLeft}px;"
			>
				{#if arranged.left}
					{@render arrangedSide("left")}
				{:else}
					{#each leftZones as z (z.id)}
						{@render sideZone(z)}
					{/each}
				{/if}
			</div>
		{/if}
		{#if rightMarginFree && mRight > 40}
			<div
				class="margin-rail margin-right"
				style="inset-block-start:{mTop}px; inline-size:{mRight}px;"
			>
				{#if arranged.right}
					{@render arrangedSide("right")}
				{:else}
					{#each rightZones as z (z.id)}
						{@render sideZone(z)}
					{/each}
				{/if}
			</div>
		{/if}

		<!-- The pop-over: an unpinned/narrow zone slid over the chat. -->
		{#if popZone && popZone.mode !== "rail"}
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
	   the margin, panels placed at their cells. */
	.live-side {
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
		display: grid;
		gap: 0.4rem;
	}
	.live-side-cell {
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

	/* ── middle-zone widget structural control (edit mode) ───────────── */
	/* Straddles the boundary between the messages widget and the composer
	   (gap:0 in the chat grid, so top:0 of the composer item IS that seam). */
	.wg-resize-handle {
		position: absolute;
		z-index: 21;
		inset-block-start: 0;
		inset-inline: 0;
		block-size: 0.7rem;
		margin-block-start: -0.35rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-surface-500);
		cursor: ns-resize;
		touch-action: none;
		border-radius: 0.3rem;
	}
	.wg-resize-handle:hover,
	.wg-resize-handle.dragging {
		color: var(--color-primary-600);
	}
	.wg-resize-handle:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 1px;
	}
	:global([data-mode="dark"]) .wg-resize-handle {
		color: var(--color-surface-500);
	}
	.wg-ctrl {
		position: absolute;
		z-index: 20;
		inset-block-start: 0.3rem;
		inset-inline-end: 0.3rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.35rem;
		border-radius: 0.55rem;
		background: var(--color-surface-100);
		border: 1px solid
			color-mix(in oklab, var(--color-primary-500) 40%, transparent);
		box-shadow: 0 6px 18px -10px rgba(0, 0, 0, 0.5);
	}
	:global([data-mode="dark"]) .wg-ctrl {
		background: var(--color-surface-900);
	}
	.wg-ctrl-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.66rem;
		font-weight: 650;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .wg-ctrl-label {
		color: var(--color-surface-300);
	}
	.wg-seg {
		display: inline-flex;
		gap: 0.1rem;
		padding: 0.1rem;
		border-radius: 0.45rem;
		background: color-mix(in oklab, var(--color-surface-500) 12%, transparent);
	}
	.wg-seg-btn {
		min-inline-size: 1.4rem;
		padding: 0.15rem 0.4rem;
		border-radius: 0.35rem;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .wg-seg-btn {
		color: var(--color-surface-400);
	}
	.wg-seg-btn:hover {
		color: var(--color-surface-900);
	}
	:global([data-mode="dark"]) .wg-seg-btn:hover {
		color: var(--color-surface-100);
	}
	.wg-seg-btn.active {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
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
	/* Cap the middle editor to the centre half of the viewport and centre it, so
	   the ¼|½|¼ editor layout is identical whether full-width is on or off (in
	   full-width the main is 100vw, so without this the middle would fill it). */
	.edit-center {
		max-inline-size: 50vw;
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
	/* Empty-zone hint, overlaid on the cell guides. */
	.zgrid-empty {
		position: absolute;
		inset: 0.4rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: var(--color-surface-500);
		text-align: center;
		pointer-events: none;
	}

	/* ── zones ─────────────────────────────────────────────────────── */
	.zone-rail {
		display: flex;
		flex-direction: column;
		flex: none;
		min-block-size: 0;
		gap: 0.35rem;
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
	/* Style tab: segmented pack pickers. */
	.pack-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.pack-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-inline-size: 5rem;
		font-size: 0.7rem;
		font-weight: 650;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .pack-label {
		color: var(--color-surface-300);
	}
	.segmented {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.15rem;
		padding: 0.12rem;
		border-radius: 0.55rem;
		background: color-mix(in oklab, var(--color-surface-500) 10%, transparent);
	}
	.seg {
		padding: 0.24rem 0.62rem;
		border-radius: 0.42rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-surface-600);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	:global([data-mode="dark"]) .seg {
		color: var(--color-surface-400);
	}
	.seg:hover {
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .seg:hover {
		color: var(--color-surface-100);
	}
	.seg.active {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
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
	}
</style>
