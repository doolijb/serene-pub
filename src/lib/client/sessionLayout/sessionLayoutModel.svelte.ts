/**
 * The session layout's MODEL: what the session draws right now, and every
 * decision the renderer and the editor both read. The composition root
 * (./SessionLayout) builds one per page.
 *
 * - **The stored layout, read once.** The manager courier's the three slots of
 *   the person's saved layout; this file is the one seam that reads them
 *   (`saved`, `savedGrid`, `storedArranged`), repairs them and applies the
 *   primary floor (./primaryFloor). Everything downstream reads the DRAWN
 *   layout — `drawn`, the SDK's `resolveDrawn` through `drawnOf` — never the
 *   slots. `layout` (the zone template, with the folds below) and `chatGrid`
 *   stay exposed for the two things that are not a reading: the editor writes
 *   them, and the width ladder presents an un-arranged side per zone.
 * - **Measured width, never the viewport** (`containerW`, written by the root's
 *   ResizeObserver), the breakpoint, and the root's offsets.
 * - **The screen-size simulator** and the editor's mode flags the live session
 *   reads (`placing`, `liveStowed`, the toolbar's height).
 * - **The sides**: the ladder's zones, the tuck, the flow widths, the slots,
 *   the stage — and **the side rail model** (the transient open state of each
 *   group, and the column layout over it) plus **the middle collapse**.
 *
 * A factory rather than a class so the code reads as it did in the component:
 * plain `$derived`s over each other, handed out through getters. Nothing here
 * touches the DOM; the components measure and write the measured fields.
 */
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import * as Icons from "@lucide/svelte"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import type { PanelInstance } from "$lib/client/surfaces/types"
import {
	normalizeZoneLayout,
	placedWidgetIds,
	resolveZone,
	withWidget,
	type ResolvedZone
} from "./schema"
import { loadChatLayout, widgetsInZone } from "./widgetGrid"
import { drawnOf, withPrimaryFloor } from "./primaryFloor"
import { primaryLogPick, stageOf, type StagePick } from "./placementRules"
import { zoneEntries, type ZoneEntry } from "./panelWidgets"
import { isRailFrame, loadArranged } from "./arrangedGeometry"
import {
	SIM_HEIGHT_PX,
	SIM_OPTIONS,
	mobileEditing,
	narrowWidth,
	simulatedGeometry,
	type SimGeometry,
	type SimTier
} from "./simulator"
import { arrangedItemsOf, unitsOf, type RenderUnit } from "./tabGroups"
import {
	dockedZoneWidths,
	MIN_CENTER_PX,
	emptyColumnPx,
	emptyColumnsPx,
	sideFlowPx,
	sidePopulated,
	middleIsOneColumn,
	sideSlot,
	type SideZoneFill
} from "./sideSlot"
import { createSideRailModel } from "./sideRailModel.svelte"
import { tuckedSidesOf } from "./tuckedSides"
import { primaryUnitKey, stageOnlyActive } from "./stageOnly"
import {
	channelClaims,
	channelsForCopy,
	pageIdsHolders,
	primaryLogOf
} from "./channelClaims"
import { mobileSidePanels } from "./mobileSidePanels.svelte"
import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
import { desktop } from "$lib/client/utils/breakpoint.svelte"
import {
	type ArrangedGridV1,
	type DrawnZone,
	drawnInstances,
	isInstanceOf,
	type WidgetGridV1,
	type ZoneLayoutV1
} from "@serene-pub/sdk"

/** `.layout-body`'s 0.5rem flex gap — one per side actually in the flow. */
export const BODY_GAP_PX = 8

/** The shell's panels context, as far as the session reads it. */
export type PanelsCtx = {
	leftPanel?: string | null
	rightPanel?: string | null
	stageOnly?: boolean
}

/** The editor's three tabs (PLAN 25 redesign). */
export type EditTab = "presets" | "settings" | "move"

export interface SessionLayoutModelInput {
	readonly manager: SurfaceManager
	/** The layout editor is open. */
	readonly editing: boolean
	/**
	 * The editor's working arrangement while it is open — what the live view
	 * draws then, so the Presets and Settings tabs preview the arrangement in
	 * progress. Emitted by the editor; null while it is closed.
	 */
	readonly working: ArrangedGridV1 | null
	readonly conversationDossier: ConversationDossierV1 | null
	readonly panelsCtx: PanelsCtx | undefined
	/** The editor grid's cell module (GridStackZone's `GS_CELL_PX`). */
	readonly cellPx: number
	/**
	 * A placed id's title (./widgetSettingsFlow `widgetLabel`). Read lazily: the
	 * flow reads this model too, so neither can be built inside the other.
	 */
	widgetLabel(id: string): string
}

export function createSessionLayoutModel(input: SessionLayoutModelInput) {
	/* ── the stored layout (the one seam that reads the three slots) ────────
	 * The chat's widget grid: this user's saved widget blob (courier'd verbatim
	 * by the manager), read AS SAVED — the conversation stays in whichever zone
	 * it was put (brief 7a). What the editor changes about the middle is its
	 * ARRANGEMENT, which commits on Done.
	 *
	 * The genre's PRIMARY widget is the conversation, or — for a genre that
	 * withholds it (R71) — its own (Battleship's board). */
	let primaryId = $derived(
		input.manager.omitted.has("messages")
			? (input.manager.decls.find((p) => p.role === "primary")?.id ??
					"messages")
			: "messages"
	)
	let savedGrid = $derived<WidgetGridV1>(
		loadChatLayout(
			input.manager.widgetGrid,
			primaryId,
			input.manager.omitted
		)
	)
	/** The saved arrangement, before the floor (see `floored`). */
	let storedArranged = $derived<ArrangedGridV1>(
		loadArranged(input.manager.arrangedGrid)
	)
	// Seed: with no saved template, active secondaries land in the right zone.
	let activeSecondaryIds = $derived(
		input.manager.instances
			.filter((p) => p.role !== "primary" && p.active)
			.map((p) => p.id)
	)
	let saved = $derived(
		normalizeZoneLayout(input.manager.zoneLayout, activeSecondaryIds)
	)
	/**
	 * The layout with the PRIMARY FLOOR applied (./primaryFloor): handed back
	 * by reference when an instance of the primary is drawn anywhere — a side
	 * list, the grid or the arrangement — else with the bare primary appended
	 * to the middle, in the grid and in an arranged middle alike.
	 *
	 * Always asked of the SAVED layout, the editor's session included. The
	 * editor's working arrangement is its own zones' report, and the middle's
	 * cards come from this answer: asked of that report, the floor stopped
	 * adding the log as soon as the middle reported it, the middle re-seeded
	 * without it, reported it gone, and the floor added it again — for ever,
	 * on every layout that never saved a grid. What a drag does before Done
	 * is the editor's to keep (./editorSeed), and Done asks the floor of the
	 * layout it would commit (`commitArrangement`).
	 */
	let floored = $derived.by(() =>
		withPrimaryFloor(
			{ zones: saved, grid: savedGrid, arranged: storedArranged },
			primaryId
		)
	)
	let chatGrid = $derived<WidgetGridV1>(floored.grid)
	/**
	 * The ids the middle widget grid places. The zone template covers the sides
	 * and never names the middle, so every "is this widget placed?" question has
	 * to union the two or a middle-zone widget reads as unplaced and the tray
	 * offers it again.
	 */
	let middleGridIds = $derived(
		new Set<string>(widgetsInZone(chatGrid, "middle").map((w) => w.id))
	)
	// Widgets activated after the template was saved (channel intents, the old
	// grid menu) still need a home: append them to the first side zone. A widget
	// the MIDDLE grid places is already at home — the zone template does not name
	// the middle, so without this a preset's own strip lands in a side rail as
	// well and renders twice.
	//
	// A grid entry that names a SIDE zone (a preset's or a hand-written blob —
	// the editor never writes one; `loadChatLayout` keeps the zone it names,
	// the conversation's included) is folded into the side's first zone here,
	// after what the list already holds — the fold `resolveDrawn` makes, written
	// into the template the editor commits, so Done writes it into the list for
	// good (./donePlacement).
	//
	// Read off the FLOORED template: where the floor appends the log because
	// a list named it where the arrangement draws over it, the floor takes it
	// out of that list (./primaryFloor), so it is listed once.
	let layout = $derived.by((): ZoneLayoutV1 => {
		const base = floored.zones
		const sideZoneOf = (side: "left" | "right") =>
			Object.entries(base.zones).find(
				([, z]) =>
					z.kind === "side" &&
					(side === "left" ? z.side === "left" : z.side !== "left")
			)?.[0]
		let out = base
		for (const w of chatGrid.widgets) {
			if (w.zone === "middle" || placedWidgetIds(out).includes(w.id))
				continue
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

	/* ── measured width (never the viewport) ───────────────────────────────
	 * Written by the root: `containerW` off its ResizeObserver, the breakpoint
	 * off one matchMedia, the offsets off its own rect (`updateMargins`).
	 *
	 * `mLeft` IS the nav rail — 64px, or 208 while the rail is wide — plus any
	 * sidebar view open beside it, and `mRight` is 0. That is also why the side
	 * zones have no `margin` slot: there is no reserved dead space to lift them
	 * into (see ./sideSlot). `bLeft` / `bRight` are `.layout-body`'s own edges,
	 * for the flyout (`bodyEl`, bound by the renderer). */
	let containerW = $state(1024)
	let vw = $state(1024)
	let mLeft = $state(0)
	let mRight = $state(0)
	let mTop = $state(0)
	let bLeft = $state(0)
	let bRight = $state(0)
	let bodyEl = $state.raw<HTMLElement | null>(null)
	let isDesktop = $state(false)
	/**
	 * Below the app's 1024px breakpoint (P6, ruled 2026-08-30): side zones take
	 * NO layout space — no rails, no icon strips — and a populated side is
	 * reached only through the header's panels menu.
	 *
	 * `mounted` guards the pre-hydration frame: `isDesktop` starts optimistically
	 * false and is only told the truth on mount, so without it every desktop
	 * first paint would drop its side zones for a frame and snap them back.
	 */
	let mounted = $state(false)
	let isNarrow = $derived(mounted && !isDesktop)

	/* ── the screen-size simulator (P5, ruled 2026-08-30) ──────────────────
	 * `simTier` is the Move tab's width preset: null = Actual (the real
	 * viewport), otherwise a tier's width from ./simulator. BOTH go through
	 * `simulatedGeometry`, so a previewed tier can never drift from what the
	 * editor really draws. The simulator is a LENS, not a second layout:
	 * nothing about it is persisted, and the guard that keeps a look from
	 * becoming an edit is the editor's (it holds the arrangement).
	 *
	 * `SimTier`, not `WidgetTier`: Ultrawide is a preset, not a fifth tier. */
	let simTier = $state<SimTier | null>(null)
	let simWidth = $derived(
		SIM_OPTIONS.find((o) => o.tier === simTier)?.width ?? null
	)
	/**
	 * Move tab: while a phone width is previewed, draw the GRID rather than the
	 * row editor that width really gets. A desktop-only escape — a real narrow
	 * window has no zones to drag in (see `mobileEditing`).
	 */
	let simGrid = $state(false)
	/** Move tab: draw the side columns as rails instead of the editor's grids. */
	let railPreview = $state(false)
	// Editor tabs (PLAN 25 redesign):
	//   Presets — pick the genre default or one of your saved layouts, and save
	//             the current arrangement as a new one.
	//   Settings — per-widget settings and styling, a hover gesture on each
	//             widget in the live preview.
	//   Move    — drag + anchor/pin/group + the screen-size simulator.
	let editTab = $state<EditTab>("move")
	let placing = $derived(input.editing && editTab === "move")
	// The editor's zone widths, for the real viewport or a simulated tier.
	let editGeom: SimGeometry = $derived(
		simulatedGeometry(simWidth ?? vw, input.cellPx, {
			// Only a SIMULATED frame can be wider than the space it is drawn in
			// — the real viewport is by definition its own available width, so
			// Actual is never scaled. The frame is drawn inside the root, so
			// the root's measured width (less a gutter) is what it may occupy.
			available: simWidth == null ? undefined : containerW - 24
		})
	)
	/** Frame scale as a percent; 100 = drawn at true size. */
	let simPct = $derived(Math.round(editGeom.scale * 100))
	/**
	 * The previewed device's height. The tier table's, not the window's: the
	 * rail model is decided against the COLUMN's height (see SIM_HEIGHT_PX).
	 */
	let simHeight = $derived(simTier ? SIM_HEIGHT_PX[simTier] : 0)
	/** Is the previewed width below the app's breakpoint? */
	let simNarrow = $derived(narrowWidth(simWidth ?? vw))
	/** The editor draws rows, not a grid (the PHONE editor, ruled 2026-09-10). */
	let mobileEdit = $derived(
		mobileEditing({ narrow: isNarrow, simNarrow, grid: simGrid })
	)
	/**
	 * A canvas is up, so the live session is STOWED under it — mounted and
	 * `display: none`, never unmounted. Exactly the two branches that draw one:
	 * the grid editor, and the phone editor drawn in the simulator's frame from
	 * a desktop. A REAL narrow window's row editor is drawn over the live
	 * session instead, and is intentionally not one of them.
	 */
	let liveStowed = $derived(placing && (!mobileEdit || simWidth != null))
	/** The toolbar's measured height: its panel wraps, so it is never a constant. */
	let toolbarH = $state(0)
	/** The px the fixed toolbar takes above the root while it is up. */
	let editorTop = $derived(input.editing && !isNarrow ? toolbarH : 0)
	/**
	 * Where the LIVE view's viewport-pinned boxes start. With the editor open
	 * the header is unmounted, so `mTop` measures 0 and the toolbar is the whole
	 * of it; with it closed the toolbar is 0 and this is `mTop` unchanged.
	 */
	let liveTop = $derived(mTop + editorTop)

	/* ── the arrangement drawn, and the drawn layout ─────────────────────── */
	/**
	 * What the LIVE view draws: the working copy while the editor is open (so
	 * the preview under the Presets/Settings tabs shows the arrangement in
	 * progress), else the floored saved one. A load, a preset applied, or the
	 * active preset deleted all repaint on their own.
	 */
	let arranged = $derived<ArrangedGridV1>(
		input.editing && input.working ? input.working : floored.arranged
	)
	/**
	 * What this layout DRAWS, and where, at the measured width — the SDK's one
	 * reader (`resolveDrawn`, through ./primaryFloor `drawnOf`). Which path each
	 * zone takes (its arrangement, the grid, the ladder), its cells, its pins
	 * and its reading order are all read off this.
	 */
	let drawn = $derived(
		drawnOf(
			{ zones: layout, grid: chatGrid, arranged },
			{ inline: containerW }
		)
	)
	/** A zone's cell grid, when it is drawn from an arrangement. */
	function frameOf(z: DrawnZone): { cols: number; rows: number } | null {
		return z.drawnFrom === "arrangement" && z.arrangement
			? z.arrangement
			: null
	}
	/** Does this side draw its arrangement (an arrangement that places anything)? */
	function arrangedHere(side: "left" | "right"): boolean {
		return drawn[side].drawnFrom === "arrangement"
	}
	/**
	 * Is this side a RAIL ONLY (lane E1): drawn from an arrangement that pins
	 * none of its groups (./arrangedGeometry `isRailFrame`)? Then nothing in
	 * it is docked — every group is a rail icon until opened — so it is drawn
	 * the way a tucked side is (its rail, and the group asked for out over the
	 * session) and takes a rail's width in the flow, never the ladder's column
	 * (./sideSlot `sideFlowPx`). An un-arranged unpinned zone is the same
	 * thing spelled as a zone pin: the ladder draws it as an icon strip.
	 *
	 * Never the side holding the primary log: the log is what a session is
	 * read and written in, and it is never put behind a rail icon (the rule
	 * ./tuckedSides keeps for the width).
	 */
	function railOnlyAt(side: "left" | "right"): boolean {
		return (
			arrangedHere(side) &&
			logSide !== side &&
			isRailFrame({ items: drawn[side].instances })
		)
	}

	/* ── what a zone holds ───────────────────────────────────────────────── */
	function inst(id: string): PanelInstance | undefined {
		return input.manager.instances.find((p) => p.id === id)
	}
	/**
	 * Is this placed id drawn as the conversation — a `messages` instance, the
	 * bare id included (brief 7a: the log may sit in a side), or a copy
	 * (`messages#sanctum`, S1)? Never a panel instance, so `inst()` does not
	 * know it. A genre that withholds the conversation (R71) draws none.
	 */
	const isConversation = (id: string) =>
		isInstanceOf(id, "messages") && !input.manager.omitted.has("messages")
	/** Something this session can draw: a conversation or a panel instance. */
	const drawable = (id: string) => isConversation(id) || !!inst(id)
	/**
	 * What a zone draws, lists and counts, in the zone's own order — its
	 * panel instances and its conversations (./panelWidgets `zoneEntries`, the
	 * one reader for the rail, the icon strip, the editor's side lists, the
	 * side counts and the phone's panels menu).
	 */
	function zoneEntriesOf(z: ResolvedZone): ZoneEntry[] {
		return zoneEntries(
			z.def.widgets,
			input.manager.instances,
			isConversation,
			input.widgetLabel
		)
	}
	function middleWidgetLabel(id: string): string {
		return isInstanceOf(id, "messages") ? "Messages" : id
	}
	function middleWidgetIcon(_id: string) {
		return Icons.MessagesSquare
	}
	function iconOf(p: PanelInstance) {
		return (p.icon && (Icons as any)[p.icon]) || Icons.LayoutPanelTop
	}
	/** An entry's icon, as a component to draw with. */
	function entryIcon(e: ZoneEntry) {
		if (!e.panel) return middleWidgetIcon(e.id)
		return iconOf(e.panel)
	}
	/**
	 * A zone as ./sideSlot's populated test reads it: its mode and its entry
	 * count, conversations included — so the desktop's empty column and
	 * the phone's panels menu answer one question the same way.
	 */
	function zoneFill(z: ResolvedZone): SideZoneFill {
		return { mode: z.mode, entries: zoneEntriesOf(z).length }
	}
	function labelOf(z: ResolvedZone): string {
		return z.def.label ?? z.id
	}

	/* ── the ladder's zones ──────────────────────────────────────────────── */
	/**
	 * Every zone as the ladder resolves it at this width — the DOCKED answer.
	 * An un-arranged side presents its zones one by one (each its own rung), so
	 * this reads the template's zones; membership is the drawn layout's.
	 *
	 * On the desktop, the side zone holding the layout's primary log is a rail
	 * whatever its rung or pin says (brief 7a review): a drawer rung or an
	 * unpinned icon strip would put the log a person reads and writes in
	 * behind a button, and an outside click would put it away again. Only the
	 * rail path reads this — an arranged side ignores the zone's mode.
	 */
	let resolvedDocked = $derived(
		Object.entries(layout.zones).map(([id, def]) => {
			const z = resolveZone(id, def, containerW)
			return logSide &&
				def.kind === "side" &&
				(def.side === "left" ? "left" : "right") === logSide &&
				def.widgets.includes(logPick!.id)
				? dockedZone(z)
				: z
		})
	)
	/**
	 * What is drawn. While the sides are tucked (./tuckedSides) a docked rail
	 * is drawn as its icon strip, the same one an unpinned zone has always
	 * had; nothing is written, so untucking draws the rail again.
	 */
	let resolved = $derived(
		resolvedDocked.map((z) =>
			z.def.kind === "side" &&
			z.mode === "rail" &&
			tucked[z.def.side === "left" ? "left" : "right"]
				? { ...z, mode: "icons" as const }
				: z
		)
	)
	let leftZones = $derived(
		resolved.filter((z) => z.def.kind === "side" && z.def.side === "left")
	)
	let rightZones = $derived(
		resolved.filter((z) => z.def.kind === "side" && z.def.side !== "left")
	)
	let topStrips = $derived(
		resolved.filter(
			(z) => z.def.kind === "strip" && z.def.area !== "bottom"
		)
	)
	let bottomStrips = $derived(
		resolved.filter(
			(z) => z.def.kind === "strip" && z.def.area === "bottom"
		)
	)
	// The canonical side zones the editor targets (one per side). A saved
	// layout may still carry extra/legacy zones; the editor works the primary
	// left/right pair and leaves any others to the raw JSON escape hatch.
	let leftZoneId = $derived(leftZones[0]?.id ?? null)
	let rightZoneId = $derived(rightZones[0]?.id ?? null)
	/**
	 * Below the breakpoint a side takes no layout space, so there is no rail
	 * for an unpinned zone to collapse INTO: the icon strip has nothing to open
	 * and the sheet has to show the panels themselves. Same zone, docked — so
	 * the one mount is in the form the sheet needs BEFORE it is opened, and
	 * opening it changes the container and nothing else.
	 */
	function dockedZone(z: ResolvedZone): ResolvedZone {
		return z.mode === "hidden" || z.mode === "rail"
			? z
			: { ...z, mode: "rail" }
	}

	/* ── one mount per side, three places (the no-reload law) ───────────────
	 * The live render writes each side zone ONCE and moves the container
	 * around it; `sideSlot` is the whole decision (and its unit tests). See
	 * ./sideSlot for what each slot means and why "stowed" is a display:none
	 * rather than an unmount. */
	let mobileSide = $derived(isNarrow ? mobileSidePanels.open : null)
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
	/** Is this zone's side the phone's open sheet? Momentarily opened, so carded. */
	function inSheet(z: ResolvedZone): boolean {
		return (z.def.side === "left" ? leftSlot : rightSlot) === "overlay"
	}

	/* ── how wide a side is in the FLOW ─────────────────────────────────────
	 * An arranged side is one proportional grid, and a grid has no width of
	 * its own; the rail it replaces has always had a definite width — the
	 * ladder's answer at this container width — so the arranged side takes the
	 * same footprint and the centre takes the rest. Both paths report here and
	 * the body's reserve is computed ONCE (`sideFlowPx` + `inlineSideWidths`),
	 * whichever path each side takes. Only the `inline` slot needs any of this —
	 * a stowed side has no box in the flow at all, and the overlay's sheet has a
	 * width of its own. See ./sideSlot for the rule and its tests. */
	/** What the un-arranged rail would occupy: `width × columns`, per the ladder. */
	function ladderPx(zones: ResolvedZone[], side: "left" | "right"): number {
		// One arranged grid stands in for the whole side, so the widest zone's
		// footprint is the side's. An arrangement can also outlive the zones it
		// was captured from — fall back to the side's default ladder then.
		if (zones.length)
			return Math.max(...zones.map((z) => z.width * z.columns))
		return resolveZone(
			side,
			{ kind: "side", side, widgets: [] },
			containerW
		).width
	}
	/**
	 * The ladder footprint of each RAIL this side actually draws — `sideZone`'s
	 * own guard, so an empty or hidden zone reserves no rail. An icon strip is
	 * not a rail: it is a fixed 2.25rem the ladder never sized.
	 */
	function railLadderPx(zones: ResolvedZone[]): number[] {
		return zones
			.filter((z) => z.mode === "rail" && zoneEntriesOf(z).length > 0)
			.map((z) => z.width * z.columns)
	}
	/**
	 * Does this side hold anything — an arranged item, or a visible zone with
	 * an entry, conversation copies included (./sideSlot `sidePopulated`)? The
	 * phone's panels menu asks the same question, so a side holding only a
	 * Sanctum copy is populated on both. A side that is not keeps an EMPTY
	 * COLUMN (ruled 2026-09-29, `emptyColumns` below).
	 */
	function populatedHere(
		side: "left" | "right",
		zones: ResolvedZone[]
	): boolean {
		return sidePopulated({
			arranged: arrangedHere(side),
			zones: zones.map(zoneFill)
		})
	}

	/* ── tucked sides (ruled 2026-09-27; ./tuckedSides) ─────────────────────
	 * Decided from the session's own measured box (`containerW`), never the
	 * viewport — an open sidebar narrows the box and not the window. The
	 * threshold is the layout's own minimums: each side's DOCKED footprint plus
	 * a gap each, plus the stage's measure. Read off `resolvedDocked`, never the
	 * drawn zones, so tucking cannot free the room that would untuck it. Not
	 * below the breakpoint and not while the editor is open. */
	function dockedZonesOf(side: "left" | "right"): ResolvedZone[] {
		return resolvedDocked.filter(
			(z) =>
				z.def.kind === "side" &&
				(side === "left"
					? z.def.side === "left"
					: z.def.side !== "left")
		)
	}
	/** The rail-only sides (`railOnlyAt`). */
	let railOnly = $derived({
		left: railOnlyAt("left"),
		right: railOnlyAt("right")
	})
	let dockedFlow = $derived({
		left: sideFlowPx({
			slot: leftSlot,
			arranged: arrangedHere("left"),
			arrangedPx: ladderPx(dockedZonesOf("left"), "left"),
			railPx: railLadderPx(dockedZonesOf("left")),
			railOnly: railOnly.left
		}),
		right: sideFlowPx({
			slot: rightSlot,
			arranged: arrangedHere("right"),
			arrangedPx: ladderPx(dockedZonesOf("right"), "right"),
			railPx: railLadderPx(dockedZonesOf("right")),
			railOnly: railOnly.right
		})
	})
	/**
	 * Which sides the WIDTH tucks (./tuckedSides `tuckedSidesOf`): the side
	 * holding the primary log never is (`logSide`, brief 7a review) and the
	 * other side tucks once the body cannot hold both docked sides and the
	 * middle's own reserve.
	 */
	let tuckedByWidth = $derived.by((): { left: boolean; right: boolean } =>
		mounted && !isNarrow && !input.editing
			? tuckedSidesOf({
					leftPx: dockedFlow.left,
					rightPx: dockedFlow.right,
					gapPx: BODY_GAP_PX,
					bodyPx: containerW,
					logSide,
					middleMinPx: MIN_CENTER_PX
				})
			: { left: false, right: false }
	)
	/**
	 * Which sides are DRAWN tucked — their icon rail, one panel at a time out
	 * over the session: the ones the width tucks, and a rail-only side
	 * (`railOnly`) at any width, which has nothing docked to draw. Below the
	 * breakpoint a side is stowed or a sheet, and neither has a rail.
	 */
	let tucked = $derived({
		left: tuckedByWidth.left || (railOnly.left && !isNarrow),
		right: tuckedByWidth.right || (railOnly.right && !isNarrow)
	})
	/** Is either side tucked by the WIDTH — for what the whole body does about it. */
	let sidesAreTucked = $derived(tuckedByWidth.left || tuckedByWidth.right)
	/**
	 * The MIDDLE grows with the window; a docked side keeps its ladder width
	 * (ruled 2026-09-28; ./sideSlot `dockedZoneWidths`). Only a one-column
	 * middle has one column to centre on the session.
	 */
	let middleOneColumn = $derived(
		middleIsOneColumn(arrangedItemsOf(drawn.middle))
	)
	/** What each side DRAWS in the row — 0 for an empty side. */
	let drawnFlow = $derived({
		left: sideFlowPx({
			slot: leftSlot,
			arranged: arrangedHere("left"),
			arrangedPx: ladderPx(leftZones, "left"),
			railPx: railLadderPx(leftZones),
			tucked: tucked.left
		}),
		right: sideFlowPx({
			slot: rightSlot,
			arranged: arrangedHere("right"),
			arrangedPx: ladderPx(rightZones, "right"),
			railPx: railLadderPx(rightZones),
			tucked: tucked.right
		})
	})
	/**
	 * An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
	 * `emptyColumnPx` / `emptyColumnsPx`): every declared side that docks at
	 * this width asks for the width its first widget will have, read off the
	 * DOCKED zones. The ask is soft: granted only from room the populated sides
	 * and the stage's measure do not need, so it gives way before any populated
	 * side tucks. Tucked, stowed or in the sheet it asks nothing.
	 */
	let emptyColumns = $derived(
		emptyColumnsPx({
			hardLeftPx: drawnFlow.left,
			hardRightPx: drawnFlow.right,
			emptyLeftPx: emptyColumnPx({
				slot: leftSlot,
				tucked: tucked.left,
				populated: populatedHere("left", leftZones),
				zones: dockedZonesOf("left")
			}),
			emptyRightPx: emptyColumnPx({
				slot: rightSlot,
				tucked: tucked.right,
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

	/* ── reading order, the channel claims, the primary log ──────────────── */
	/** A side's drawable ids as the side draws them, in reading order. */
	function sideReading(z: DrawnZone): string[] {
		const ids = z.instances.map((i) => i.instanceId)
		return z.drawnFrom === "arrangement" ? ids : ids.filter(drawable)
	}
	/**
	 * Every zone's placed ids in reading order — middle, left, right, and the
	 * strips (top, then bottom) the stage never draws but the claims count —
	 * read off the drawn layout (an arranged zone by row, then column; a list
	 * in its order).
	 */
	let readingOrder = $derived({
		middle: drawn.middle.instances.map((i) => i.instanceId),
		left: sideReading(drawn.left),
		right: sideReading(drawn.right),
		strips: [...drawn.strips]
			.sort(
				(a, b) =>
					Number(a.area === "bottom") - Number(b.area === "bottom")
			)
			.flatMap((s) => s.instances.map((i) => i.instanceId))
			.filter(drawable)
	})
	/**
	 * Every id this layout places, anywhere: what it draws, plus what its zone
	 * lists and its middle grid still name (a list entry an arrangement draws
	 * over is named, not drawn, and is still counted here as it always was).
	 * The one list the channel claims (S1), the titles and the copies'
	 * declarations read.
	 */
	let placedIds = $derived(
		new Set<string>([
			...placedWidgetIds(layout),
			...middleGridIds,
			...drawnInstances(drawn).map((i) => i.instanceId)
		])
	)
	/**
	 * Which placed conversation copy claims which channel (S1): a copy with a
	 * `channel` setting shows that channel alone; the others share the rest.
	 */
	let claims = $derived(
		channelClaims(placedIds, (id) => widgetSettingValues(id))
	)
	let readingIds = $derived([
		...readingOrder.middle,
		...readingOrder.left,
		...readingOrder.right,
		// The strips too: `claims` counts a copy placed there, so a primary log
		// picked without them would hand the claiming copy the rest while the
		// strip's unclaimed copy showed it as well — the same rows twice.
		...readingOrder.strips
	])
	/**
	 * The layout's primary log (./channelClaims `primaryLogOf`): the first
	 * unclaimed Messages in reading order, else the first Messages. When it
	 * claims a channel — no unclaimed copy is placed — it also shows what no
	 * copy claims, so `main` never leaves the session with the log it was in.
	 */
	let primaryLog = $derived.by(() => primaryLogOf(readingIds, claims))
	/**
	 * The conversation mounts that hold the page's message ids
	 * (./channelClaims `pageIdsHolders`, brief 7b review): the primary log, then
	 * every other copy in reading order whose channels share none with a mount
	 * already holding them — so every row drawn keeps one `#message-<id>` a
	 * link or j/k can land on.
	 */
	let pageIdsHeld = $derived.by(() =>
		pageIdsHolders(
			readingIds,
			claims,
			input.conversationDossier?.composer.channels ?? []
		)
	)
	/**
	 * The dossier one conversation copy is handed: the page's, with its
	 * composer told only this copy's channels — the rows it draws and the
	 * lanes its strip offers. The page's own object when nothing narrows it.
	 */
	function dossierFor(id: string): ConversationDossierV1 | null {
		const d = input.conversationDossier
		if (!d) return d
		const all = d.composer.channels
		const mine = channelsForCopy(all, claims, id, primaryLog)
		if (mine.length === all.length && mine.every((c, i) => c === all[i]))
			return d
		return { ...d, composer: { ...d.composer, channels: mine } }
	}

	/* ── the stage (QE, ./placementRules; brief 7a) ─────────────────────────
	 * Placement is free, so the conversation may sit in a side. Stage only
	 * and the phone draw ONE widget as the stage — `stagePick`, the layout's
	 * primary log, in whichever zone holds it. In a side that side's mount
	 * becomes the stage (./sideSlot's `stage` slot); the middle is hidden with
	 * the rest, and on the phone its widgets join the panels menu as "Middle".
	 * Marks and containers only — nothing unmounts, and nothing is written. */
	/**
	 * Stage only (the shell's Ctrl/⌘ + ., ./stageOnly): marks only, never
	 * while the editor is open — the editor needs the whole layout.
	 */
	let stageOnly = $derived(
		!input.editing && stageOnlyActive(input.panelsCtx, desktop.matches)
	)
	let stagePick = $derived<StagePick | null>(
		stageOf({ ...readingOrder, claims, primaryId })
	)
	/** Where the layout's primary log IS, whatever QE draws (./placementRules). */
	let logPick = $derived<StagePick | null>(
		primaryLogPick({ ...readingOrder, claims, primaryId })
	)
	/**
	 * The side holding the primary log on the DESKTOP, or null when the middle
	 * holds it (brief 7a review). That side never tucks and, on the rail path,
	 * its zone holding the log is a rail whatever its rung or pin. Not below
	 * the breakpoint and not while editing.
	 */
	let logSide = $derived<"left" | "right" | null>(
		mounted &&
			!isNarrow &&
			!input.editing &&
			logPick &&
			logPick.zone !== "middle"
			? logPick.zone
			: null
	)
	/**
	 * The side drawn as the stage right now, or null: on the phone, and in
	 * Stage only, while the stage sits in a side. Never while editing.
	 */
	let stageSide = $derived<"left" | "right" | null>(
		!input.editing &&
			(isNarrow || stageOnly) &&
			stagePick &&
			stagePick.zone !== "middle"
			? stagePick.zone
			: null
	)
	/**
	 * The middle on the phone while a side is the stage: stowed (mounted,
	 * `display: none`), or opened from the panels menu as a sheet of its own.
	 * `flow` everywhere else — Stage only hides it with a mark instead. Also
	 * `flow` while the STAGE side's own sheet is open: the middle stands
	 * behind it, as the log stands behind any sheet when the middle holds it.
	 */
	let centerSlot = $derived<"flow" | "stowed" | "overlay">(
		stageSide && isNarrow
			? mobileSide === "middle"
				? "overlay"
				: mobileSide === stageSide
					? "flow"
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
		if (slot === "overlay" && isNarrow && !input.editing)
			return new Set([id])
		return undefined
	}
	/** The same, for an arranged side's render units, by unit key. */
	function stageUnitKey(
		side: "left" | "right",
		units: RenderUnit[]
	): string | null {
		const id = stagePick?.zone === side ? stagePick.id : null
		if (!id) return null
		return (
			units.find((u) => u.members.some((m) => m.id === id))?.key ?? null
		)
	}
	/** The middle's stage while Stage only draws it there, else null. */
	let stageMiddleId = $derived(
		stageOnly && stagePick?.zone === "middle" ? stagePick.id : null
	)
	/** The arranged middle's units, in its own reading order. */
	let middleUnits = $derived(
		frameOf(drawn.middle) ? unitsOf(drawn.middle) : []
	)
	/** The arranged middle's stage unit while stage-only is on, else null. */
	let stagePrimaryKey = $derived(
		stageMiddleId && frameOf(drawn.middle)
			? primaryUnitKey(
					middleUnits.map((u) => ({
						key: u.key,
						memberIds: u.members.map((m) => m.id)
					})),
					stageMiddleId
				)
			: null
	)
	/** What the un-arranged middle (`WidgetZone`) hides while stage-only is on. */
	let stageHiddenMiddleIds = $derived.by(() => {
		if (!stageMiddleId || frameOf(drawn.middle)) return undefined
		const ids = drawn.middle.instances.map((i) => i.instanceId)
		return ids.includes(stageMiddleId)
			? new Set(ids.filter((id) => id !== stageMiddleId))
			: undefined
	})

	/* ── the side rail model (ruled 2026-09-10; ./sideRailModel) ──────────── */
	const rail = createSideRailModel({
		inst,
		iconOf,
		middleWidgetIcon,
		widgetLabel: (id) => input.widgetLabel(id)
	})
	const columnUnits = rail.columnUnits
	function zonePinned(side: "left" | "right"): boolean {
		const id = side === "left" ? leftZoneId : rightZoneId
		return id ? layout.zones[id]?.pinned !== false : true
	}
	/** A side's drawn arrangement as column units, or none for a listed side. */
	let leftUnits = $derived(
		arrangedHere("left") ? columnUnits(drawn.left) : []
	)
	let rightUnits = $derived(
		arrangedHere("right") ? columnUnits(drawn.right) : []
	)
	/** The middle's collapse at its measured width (./sideRailModel). */
	function middleCollapse(widthPx: number) {
		return rail.middleCollapse(
			frameOf(drawn.middle) ? drawn.middle : [],
			widthPx,
			isNarrow
		)
	}

	return {
		// the stored layout
		get primaryId() {
			return primaryId
		},
		get savedGrid() {
			return savedGrid
		},
		get storedArranged() {
			return storedArranged
		},
		get activeSecondaryIds() {
			return activeSecondaryIds
		},
		get floored() {
			return floored
		},
		get chatGrid() {
			return chatGrid
		},
		get middleGridIds() {
			return middleGridIds
		},
		get layout() {
			return layout
		},
		// measured
		get containerW() {
			return containerW
		},
		set containerW(v: number) {
			containerW = v
		},
		get vw() {
			return vw
		},
		set vw(v: number) {
			vw = v
		},
		get mLeft() {
			return mLeft
		},
		set mLeft(v: number) {
			mLeft = v
		},
		get mRight() {
			return mRight
		},
		set mRight(v: number) {
			mRight = v
		},
		get mTop() {
			return mTop
		},
		set mTop(v: number) {
			mTop = v
		},
		get bLeft() {
			return bLeft
		},
		set bLeft(v: number) {
			bLeft = v
		},
		get bRight() {
			return bRight
		},
		set bRight(v: number) {
			bRight = v
		},
		get bodyEl() {
			return bodyEl
		},
		set bodyEl(v: HTMLElement | null) {
			bodyEl = v
		},
		get isDesktop() {
			return isDesktop
		},
		set isDesktop(v: boolean) {
			isDesktop = v
		},
		get mounted() {
			return mounted
		},
		set mounted(v: boolean) {
			mounted = v
		},
		get isNarrow() {
			return isNarrow
		},
		// the simulator and the editor's mode flags
		get editing() {
			return input.editing
		},
		get simTier() {
			return simTier
		},
		set simTier(v: SimTier | null) {
			simTier = v
		},
		get simWidth() {
			return simWidth
		},
		get simGrid() {
			return simGrid
		},
		set simGrid(v: boolean) {
			simGrid = v
		},
		get railPreview() {
			return railPreview
		},
		set railPreview(v: boolean) {
			railPreview = v
		},
		get editTab() {
			return editTab
		},
		set editTab(v: EditTab) {
			editTab = v
		},
		get placing() {
			return placing
		},
		get editGeom() {
			return editGeom
		},
		get simPct() {
			return simPct
		},
		get simHeight() {
			return simHeight
		},
		get simNarrow() {
			return simNarrow
		},
		get mobileEdit() {
			return mobileEdit
		},
		get liveStowed() {
			return liveStowed
		},
		get toolbarH() {
			return toolbarH
		},
		set toolbarH(v: number) {
			toolbarH = v
		},
		get editorTop() {
			return editorTop
		},
		get liveTop() {
			return liveTop
		},
		// the drawn layout
		get arranged() {
			return arranged
		},
		get drawn() {
			return drawn
		},
		frameOf,
		arrangedHere,
		// what a zone holds
		inst,
		isConversation,
		zoneEntriesOf,
		middleWidgetLabel,
		middleWidgetIcon,
		iconOf,
		entryIcon,
		zoneFill,
		labelOf,
		// the ladder's zones
		get resolved() {
			return resolved
		},
		get leftZones() {
			return leftZones
		},
		get rightZones() {
			return rightZones
		},
		get topStrips() {
			return topStrips
		},
		get bottomStrips() {
			return bottomStrips
		},
		get leftZoneId() {
			return leftZoneId
		},
		get rightZoneId() {
			return rightZoneId
		},
		dockedZone,
		// flows, tuck, slots
		get tucked() {
			return tucked
		},
		get sidesAreTucked() {
			return sidesAreTucked
		},
		get middleOneColumn() {
			return middleOneColumn
		},
		get emptyColumns() {
			return emptyColumns
		},
		get sideWidths() {
			return sideWidths
		},
		get mobileSide() {
			return mobileSide
		},
		get leftSlot() {
			return leftSlot
		},
		get rightSlot() {
			return rightSlot
		},
		inSheet,
		// reading order, claims, stage
		get placedIds() {
			return placedIds
		},
		get pageIdsHeld() {
			return pageIdsHeld
		},
		dossierFor,
		get stageOnly() {
			return stageOnly
		},
		get stagePick() {
			return stagePick
		},
		get stageSide() {
			return stageSide
		},
		get centerSlot() {
			return centerSlot
		},
		stageHiddenIn,
		stageUnitKey,
		get middleUnits() {
			return middleUnits
		},
		get stagePrimaryKey() {
			return stagePrimaryKey
		},
		get stageHiddenMiddleIds() {
			return stageHiddenMiddleIds
		},
		unitPlacement: rail.unitPlacement,
		anchorCellStyle: rail.anchorCellStyle,
		// the side rail model
		rail,
		zonePinned,
		get leftUnits() {
			return leftUnits
		},
		get rightUnits() {
			return rightUnits
		},
		middleCollapse
	}
}

export type SessionLayoutModel = ReturnType<typeof createSessionLayoutModel>
