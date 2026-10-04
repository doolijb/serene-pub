/**
 * Where a side zone's ONE mount currently lives.
 *
 * The side zones used to be written twice in the live render — once as an
 * in-flow flex child, once inside a fixed layer — and a flag swapped which
 * `{#if}` was live. Two call sites means two subtrees: Svelte destroyed one and
 * built the other, so every iframe in a side zone reloaded (the sample frame's
 * "alive for" counter reset to 0) and every native panel lost its local state.
 * That is exactly what the no-reload law forbids — the flyout, the mobile
 * overlay and the tab groups all keep the same element and only change where it
 * is drawn.
 *
 * So the mount is written ONCE and this decides its container:
 *
 *   inline  — an in-flow child of `.layout-body` (`display: contents`, so the
 *             zones themselves stay the flex items they have always been).
 *   stowed  — mounted, `display: none`: no layout space, no tab stop, no
 *             a11y tree — but the iframes keep running and the panels keep
 *             their state. This is the state that used to be an unmount.
 *   overlay — below the breakpoint, this side's sheet is open: the mount's own
 *             wrapper wears `.zone-flyout.mobile` and IS the dialog. This slot
 *             used to be "none" — the overlay rendered the side a SECOND time
 *             (`panelStack`), so the one mount had to stand down or the same
 *             panel would be live twice, and opening the sheet reloaded every
 *             iframe in it. The sheet's chrome (header, close, backdrop, focus
 *             trap) is unchanged; it just wraps the one mount now.
 *
 * There was a fourth container, `margin`: a fixed layer a side was lifted into
 * to reclaim the dead space a closed sidebar still reserved in the two-sidebar
 * shell. The one-rail shell (2026-09-15) reserves no such space — `<main>`
 * spans everything right of the nav rail, and what was measured as the left
 * margin is the rail itself — so there was no margin left to lift a side into
 * and the slot was retired 2026-09-17. The no-reload law is unchanged: still
 * one mount, still this function choosing the container around it.
 *
 *   stage   — this side holds the conversation the phone and Stage only draw
 *             as the stage (QE, ./placementRules `stageOf`; brief 7a free
 *             placement): the mount fills the body, showing that one widget,
 *             and its other widgets are `display: none` around their mounts.
 *             On the phone they are still reached from the panels menu, which
 *             opens the same mount as the `overlay` sheet (the stage widget
 *             hidden inside it).
 *
 * There is deliberately no "not rendered" value left: every state a side can be
 * in is a container, which is what makes the no-reload law hold by construction
 * rather than by remembering.
 */

import { RAIL_PX } from "./sideRail"
import { STAGE_MEASURE_PX } from "./tuckedSides"
import type { SideMode, StripMode } from "./schema"

export type SideSlot = "inline" | "stowed" | "overlay" | "stage"

export interface SideSlotInput {
	/** Below the app's 1024px breakpoint (P6): sides take no layout space. */
	narrow: boolean
	/** The mobile overlay is currently showing THIS side. */
	overlayOwns: boolean
	/**
	 * This side holds the stage — the conversation the phone or Stage only
	 * draws full width, wherever the desktop placed it (QE). Absent = no.
	 */
	stage?: boolean
}

export function sideSlot(o: SideSlotInput): SideSlot {
	if (o.overlayOwns) return "overlay"
	if (o.stage) return "stage"
	if (o.narrow) return "stowed"
	return "inline"
}

/* ── how wide a side is in the `inline` slot ─────────────────────────────
 *
 * A side rendered from the saved arrangement is one proportional grid, and a
 * grid has no width of its own — `.live-side` was `inline-size: 100%`, which
 * as a flex child of `.layout-body` asked for the WHOLE body. Two of those
 * plus the centre overflowed, flexbox shrank all three by their basis, and at
 * 1838px each side took 903px while `.layout-center` was squeezed to 0: the
 * chat disappeared.
 *
 * The un-arranged rail has always had a definite width for this: the ladder's
 * answer at the current container width, `z.width * z.columns` (see
 * `resolveZone` / `DEFAULT_SIDE_RULES`, and `.zone-rail`'s `flex: none`). An
 * arranged side takes exactly the same footprint — arranging widgets inside a
 * rail should not change how much room the rail occupies — and the centre
 * takes the rest.
 *
 * The one refinement is the tight case. Two ladder rails plus the centre can
 * exceed a narrow desktop, and there the CENTRE wins: the sides shrink
 * proportionally so `.layout-center` keeps `minCenterPx`. There is no existing
 * `.chat-core` minimum to borrow, so the default below is a stated choice, not
 * a measured one.
 *
 * The UN-arranged rail had exactly the same starvation waiting in it, one step
 * later: `.zone-rail` is `flex: none` at that definite ladder width and
 * `.layout-center` is `min-inline-size: 0`, so two rails wider than the body
 * squeeze the chat to 0 the same way — it just takes a narrower desktop to
 * reach. So both paths report their footprint through `sideFlowPx` below and
 * the reserve is computed ONCE for the body, whichever path each side takes.
 */

export interface SideFlowInput {
	/** Where this side's one mount currently lives. */
	slot: SideSlot
	/** This side is drawn from the saved arrangement (one proportional grid). */
	arranged: boolean
	/** The arranged grid's ladder footprint (`width × columns`). */
	arrangedPx: number
	/** The ladder footprints of the RAILS this side actually draws. */
	railPx: number[]
	/**
	 * The sides are TUCKED (./tuckedSides): an arranged side draws only its
	 * icon rail, and an un-arranged side's rails are drawn as icon strips,
	 * which — like every icon strip — are not counted.
	 */
	tucked?: boolean
}

/**
 * What a side occupies in `.layout-body`'s row, by whichever path it draws.
 * Only the `inline` slot is in that row at all: a stowed side has no box in the
 * flow and an overlay one is a fixed sheet — neither may reserve width the
 * centre would then not get.
 *
 * An EMPTY side draws nothing, so it is 0 here. Its column (ruled 2026-09-29)
 * is not a footprint but a softer ask made separately — `emptyColumnPx` /
 * `emptyColumnsPx`, below — so it never raises the tuck threshold, which is
 * read off this function.
 *
 * Two deliberate omissions. An icon strip is not counted: it is a fixed
 * 2.25rem that the ladder does not size and the clamp does not touch. And a
 * side with more than one rail reports its WIDEST rather than their sum,
 * because the clamp reaches a rail as a per-rail cap (`--side-flow-px`) and
 * because the arranged path already models a side as one footprint — PLAN 25's
 * shape is one zone per side.
 */
export function sideFlowPx(o: SideFlowInput): number {
	if (o.slot !== "inline") return 0
	if (o.tucked) return o.arranged ? RAIL_PX : 0
	if (o.arranged) return o.arrangedPx
	return o.railPx.length ? Math.max(...o.railPx) : 0
}

/** What `.layout-center` keeps when the sides would otherwise take it all. */
export const MIN_CENTER_PX = 360

export interface InlineSideWidthsInput {
	/** Left side's ladder footprint (`width × columns`), or 0 if it isn't an in-flow arranged grid. */
	left: number
	/** Right side's ladder footprint, or 0. */
	right: number
	/** Measured width of the row the sides and the centre share (`.layout-body`). */
	bodyPx: number
	/** That row's flex gap — one per side actually in the flow. */
	gapPx: number
	/** Override the centre's reserve; defaults to `MIN_CENTER_PX`. */
	minCenterPx?: number
}

export interface InlineSideWidths {
	left: number
	right: number
}

export function inlineSideWidths(o: InlineSideWidthsInput): InlineSideWidths {
	const asked = o.left + o.right
	if (asked <= 0) return { left: 0, right: 0 }
	const gaps = (o.left > 0 ? o.gapPx : 0) + (o.right > 0 ? o.gapPx : 0)
	const room = Math.max(
		0,
		o.bodyPx - gaps - (o.minCenterPx ?? MIN_CENTER_PX)
	)
	if (asked <= room) return { left: o.left, right: o.right }
	// Too tight: shrink both by the same ratio rather than starve the centre.
	const scale = room / asked
	return {
		left: Math.floor(o.left * scale),
		right: Math.floor(o.right * scale)
	}
}

/* ── the middle grows, the sides keep their width (ruled 2026-09-28) ─────
 *
 * A docked side is its ladder width (`DEFAULT_SIDE_RULES`, `width × columns`)
 * and nothing more; the MIDDLE takes every pixel the window adds. This
 * reverses the 2026-09-27 fill rule (`sideFillPx`, retired), under which the
 * sides took half of what the stage's measure left and the middle stayed the
 * conversation's measure: widening the window widened the panels and left the
 * middle fixed, which the owner ruled wrong ("the side panels grow, which is
 * wrong").
 *
 * The conversation fills that wider middle (Line width: Full, the default,
 * ruled 2026-09-29); under Line width: Comfortable its column keeps its
 * measure inside it, centred on the session by the middle's balance
 * (./tuckedSides rule (1)), and the rest of the middle is the conversation's
 * scroll region, so the wheel works across it. The only time a side is narrower than its ladder is the tight case
 * `inlineSideWidths` already handles.
 *
 * An EMPTY side is one of the docked sides here whenever its column was
 * granted (`emptyColumnsPx`, below, ruled 2026-09-29): the caller passes that
 * width in the side's place, so the middle takes what is left after the empty
 * columns too, and never grows into one.
 */
export interface DockedZoneWidths extends InlineSideWidths {
	/** What the middle gets: the body less the docked sides and their gaps. */
	middle: number
}

export function dockedZoneWidths(o: InlineSideWidthsInput): DockedZoneWidths {
	const sides = inlineSideWidths(o)
	const gaps = (sides.left > 0 ? o.gapPx : 0) + (sides.right > 0 ? o.gapPx : 0)
	return {
		...sides,
		middle: Math.max(0, o.bodyPx - sides.left - sides.right - gaps)
	}
}

/* ── an empty side keeps its column (ruled 2026-09-29) ───────────────────
 *
 * "The columns shouldn't disappear if the pane is empty." The editor always
 * draws a side's track, so the session a person gets on Done keeps that
 * side too, even with nothing in it: the middle never takes an empty side's
 * room while there is room to spare.
 *
 * Every declared side that DOCKS at this width — a pinned rail, or a
 * shipped-unpinned icon strip like the default Left — keeps an EMPTY COLUMN
 * while it holds nothing: a quiet box at the width its first widget will have
 * (the ladder's `width × columns`, the arranged footprint), so adding that
 * widget moves nothing. A HIDDEN zone, a side on its drawer rung, and a side
 * with no zone at all ask for nothing: there is nothing docked to keep.
 *
 * The column is SOFT. It is not a footprint (`sideFlowPx` above stays 0 for
 * it), so it never raises the tuck threshold: it takes only room the
 * populated sides and the stage's measure do not need, and gives way to 0
 * BEFORE any populated side would tuck. Two empty sides are kept together or
 * not at all, so the stage stays centred. Tucked, an empty side is nothing —
 * no column and no icon rail, because a rail with no icon has no panel to
 * open.
 */

/** One of a side's zones, as far as whether the side holds anything. */
export interface SideZoneFill {
	/** The zone's resolved mode (./schema `resolveZone`). */
	mode: SideMode | StripMode
	/**
	 * What it holds that a person can open: its panel instances AND its
	 * conversations (any `messages` instance, the bare log included) —
	 * `zoneEntries`' count (./panelWidgets), the one the rail draws and the
	 * phone's panels menu lists.
	 */
	entries: number
}

/** A zone that shows something: not hidden, and holding at least one entry. */
export function zonePopulated(z: SideZoneFill): boolean {
	return z.mode !== "hidden" && z.entries > 0
}

export interface SidePopulatedInput {
	/** The side's saved arrangement places at least one widget. */
	arranged: boolean
	/** Every zone on this side. */
	zones: ReadonlyArray<SideZoneFill>
}

/**
 * Does this side hold anything? The one question the desktop (an empty column
 * or not) and the phone (listed in the panels menu or not) both ask, so the
 * two cannot disagree about a side holding only a conversation.
 */
export function sidePopulated(o: SidePopulatedInput): boolean {
	return o.arranged || o.zones.some(zonePopulated)
}

export interface EmptyColumnInput {
	/** Where this side's one mount currently lives; only `inline` has a row. */
	slot: SideSlot
	/** The sides are tucked (./tuckedSides): an empty side is then nothing. */
	tucked?: boolean
	/** `sidePopulated`: a populated side takes its own footprint instead. */
	populated: boolean
	/** The side's zones as the ladder resolves them DOCKED (before tucking). */
	zones: ReadonlyArray<{ mode: SideMode | StripMode; width: number; columns: number }>
}

/**
 * What an empty side ASKS for: the widest docked zone's `width × columns`, or
 * 0 when it is not empty, not in the row, tucked, or has nothing that docks
 * (hidden, drawer, no zone). Whether it gets it is `emptyColumnsPx`.
 */
export function emptyColumnPx(o: EmptyColumnInput): number {
	if (o.slot !== "inline" || o.tucked || o.populated) return 0
	let px = 0
	for (const z of o.zones)
		if (z.mode === "rail" || z.mode === "icons")
			px = Math.max(px, z.width * z.columns)
	return px
}

export interface EmptyColumnsInput {
	/** What each side DRAWS (`sideFlowPx`) — 0 for an empty side. */
	hardLeftPx: number
	hardRightPx: number
	/** What each empty side asks for (`emptyColumnPx`). */
	emptyLeftPx: number
	emptyRightPx: number
	/** Measured width of `.layout-body`. 0 = not measured yet. */
	bodyPx: number
	/** The body's flex gap — one per side in the flow. */
	gapPx: number
	/** The stage's measure; defaults to `STAGE_MEASURE_PX`, as the tuck does. */
	stagePx?: number
}

/**
 * The empty columns the session can afford: every one asked for when the
 * populated sides, their gaps, the stage's measure AND the empty columns with
 * a gap each fit in the body; none otherwise. An unmeasured body keeps them,
 * like every first-frame decision in this layout (`sidesTucked`).
 */
export function emptyColumnsPx(o: EmptyColumnsInput): InlineSideWidths {
	const hardL = Math.max(0, o.hardLeftPx)
	const hardR = Math.max(0, o.hardRightPx)
	// A side that draws something takes its own footprint, never a column.
	const left = hardL > 0 ? 0 : Math.max(0, o.emptyLeftPx)
	const right = hardR > 0 ? 0 : Math.max(0, o.emptyRightPx)
	if (left + right <= 0) return { left: 0, right: 0 }
	if (!(o.bodyPx > 0)) return { left, right }
	const hardGaps = (hardL > 0 ? o.gapPx : 0) + (hardR > 0 ? o.gapPx : 0)
	const spare =
		o.bodyPx - hardL - hardR - hardGaps - (o.stagePx ?? STAGE_MEASURE_PX)
	const cost = (left > 0 ? left + o.gapPx : 0) + (right > 0 ? right + o.gapPx : 0)
	return spare >= cost ? { left, right } : { left: 0, right: 0 }
}

/**
 * Is the middle one column — every widget in it stacked, none beside another?
 * Only a one-column middle has one column to centre on the session, so only it
 * carries the balance (./tuckedSides rule (1)); a middle arranged across takes
 * its whole width unbalanced.
 */
export function middleIsOneColumn(
	items: ReadonlyArray<{ x: number; y: number; w: number; h: number }>
): boolean {
	for (let i = 0; i < items.length; i++)
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i]
			const b = items[j]
			const rows = a.y < b.y + b.h && b.y < a.y + a.h
			const cols = a.x < b.x + b.w && b.x < a.x + a.w
			if (rows && !cols) return false
		}
	return true
}
