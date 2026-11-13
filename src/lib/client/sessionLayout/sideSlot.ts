/**
 * Where a side zone's ONE mount currently lives.
 *
 * The side zones used to be written twice in the live render — once as an
 * in-flow flex child, once inside a fixed layer — and a flag swapped which
 * `{#if}` was live. Two call sites means two subtrees: Svelte destroyed one and
 * built the other, so every iframe in a side zone reloaded and every native
 * panel lost its local state. That is exactly what the no-reload law forbids —
 * a side keeps the same element and only changes where it is drawn.
 *
 * So the mount is written ONCE and this decides its container:
 *
 *   inline  — an in-flow child of `.layout-body` (`display: contents`, so the
 *             zones themselves stay the flex items they have always been).
 *   stowed  — mounted, `display: none`: no layout space, no tab stop, no
 *             a11y tree — but the iframes keep running and the panels keep
 *             their state. This is the state that used to be an unmount.
 *   solo    — the zone switch (./sessionZones) or full screen shows THIS side
 *             alone: the mount fills the body, and the other zones are
 *             `stowed`.
 *
 * There is deliberately no "not rendered" value: every state a side can be in
 * is a container, which is what makes the no-reload law hold by construction
 * rather than by remembering.
 */

import type { ZoneId } from "./sessionZones.svelte"
import { STAGE_MEASURE_PX } from "./tuckedSides"

export type SideSlot = "inline" | "stowed" | "solo"

export interface SideSlotInput {
	/** Below the app's 1024px breakpoint (P6): sides take no layout space. */
	narrow: boolean
	/** The zone the switch (or full screen) shows alone; null = all zones. */
	shown: ZoneId | null
	/** Which side this is. */
	side: "left" | "right"
}

export function sideSlot(o: SideSlotInput): SideSlot {
	if (o.shown === o.side) return "solo"
	if (o.shown !== null) return "stowed"
	return o.narrow ? "stowed" : "inline"
}

/* ── how wide a side is in the `inline` slot ─────────────────────────────
 *
 * A side column of panels is a stack, and a stack has no width of its own: as
 * a flex child of `.layout-body` it would ask for the WHOLE body, and two of
 * those plus the centre squeezed the chat to 0. So a side takes the width of
 * its container (`sideWidthPx`: today's docked widths, one column) and the
 * centre takes the rest.
 *
 * The one refinement is the tight case. Two sides plus the centre can exceed a
 * narrow desktop, and there the CENTRE wins: the sides shrink proportionally
 * so `.layout-center` keeps `minCenterPx` (`inlineSideWidths`).
 */

/** A side's width at a body this many px wide — no ladder is drawn, one column. */
export function sideWidthPx(bodyPx: number): number {
	if (bodyPx >= 2400) return 344
	if (bodyPx >= 1900) return 300
	if (bodyPx >= 1440) return 264
	return 248
}

export interface SideFlowInput {
	/** Where this side's one mount currently lives. */
	slot: SideSlot
	/** The side draws at least one panel (`sidePopulated`). */
	populated: boolean
	/** Its footprint (`sideWidthPx`). */
	widthPx: number
}

/**
 * What a side occupies in `.layout-body`'s row. Only the `inline` slot is in
 * that row at all: a stowed side has no box in the flow and a solo one fills
 * the body — neither may reserve width the centre would then not get.
 *
 * An EMPTY side draws nothing, so it is 0 here. Its column (ruled 2026-09-29)
 * is not a footprint but a softer ask made separately — `emptyColumnPx` /
 * `emptyColumnsPx`, below — so it never raises the zone switch's threshold,
 * which is read off this function.
 */
export function sideFlowPx(o: SideFlowInput): number {
	if (o.slot !== "inline" || !o.populated) return 0
	return Math.max(0, o.widthPx)
}

/** What `.layout-center` keeps when the sides would otherwise take it all. */
export const MIN_CENTER_PX = 360

export interface InlineSideWidthsInput {
	/** Left side's footprint (`sideWidthPx`), or 0 if it isn't in the flow. */
	left: number
	/** Right side's footprint, or 0. */
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
 * A side is its width (`sideWidthPx`) and nothing more; the MIDDLE takes
 * every pixel the window adds. This
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
 * scroll region, so the wheel works across it. The only time a side is
 * narrower than `sideWidthPx` is the tight case `inlineSideWidths` already
 * handles.
 *
 * An EMPTY side is one of the inline sides here whenever its column was
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
 * Every side that is `inline` keeps an EMPTY COLUMN while it holds nothing:
 * a quiet box at the width its first widget will have (`sideWidthPx`), so
 * adding that widget moves nothing. A side that is stowed or solo asks for
 * nothing.
 *
 * The column is SOFT. It is not a footprint (`sideFlowPx` above stays 0 for
 * it), so it never raises the zone switch's threshold: it takes only room the
 * populated sides and the stage's measure do not need, and gives way to 0
 * BEFORE the switch would turn on. Two empty sides are kept together or not
 * at all, so the stage stays centred.
 */

export interface SidePopulatedInput {
	/**
	 * What it draws that a person can open: its panels holding something this
	 * session can draw, conversation copies included.
	 */
	panels: number
}

/** Does this side hold anything — at least one panel? */
export function sidePopulated(o: SidePopulatedInput): boolean {
	return o.panels > 0
}

export interface EmptyColumnInput {
	/** Where this side's one mount currently lives; only `inline` has a row. */
	slot: SideSlot
	/** `sidePopulated`: a populated side takes its own footprint instead. */
	populated: boolean
	/** The side's footprint (`sideWidthPx`). */
	widthPx: number
}

/**
 * What an empty side ASKS for: its width when it is empty and in the row, or
 * 0 when it is not empty or not in the row. Whether it gets it is
 * `emptyColumnsPx`.
 */
export function emptyColumnPx(o: EmptyColumnInput): number {
	if (o.slot !== "inline" || o.populated) return 0
	return Math.max(0, o.widthPx)
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
	/** The stage's measure; defaults to `STAGE_MEASURE_PX`, as the zone switch does. */
	stagePx?: number
}

/**
 * The empty columns the session can afford: every one asked for when the
 * populated sides, their gaps, the stage's measure AND the empty columns with
 * a gap each fit in the body; none otherwise. An unmeasured body keeps them,
 * like every first-frame decision in this layout (`switchOn`).
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
