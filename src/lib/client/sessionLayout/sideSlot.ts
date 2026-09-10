/**
 * Where a side zone's ONE mount currently lives.
 *
 * The side zones used to be written twice in the live render — once as an
 * in-flow flex child, once inside the fixed margin layer — and the
 * `marginMode` flip swapped which `{#if}` was live. Two call sites means two
 * subtrees: Svelte destroyed one and built the other, so every iframe in a
 * side zone reloaded (the sample frame's "alive for" counter reset to 0) and
 * every native panel lost its local state. That is exactly what the no-reload
 * law forbids — the flyout, the mobile overlay and the tab groups all keep the
 * same element and only change where it is drawn.
 *
 * So the mount is written ONCE and this decides its container:
 *
 *   inline  — an in-flow child of `.layout-body` (`display: contents`, so the
 *             zones themselves stay the flex items they have always been).
 *   margin  — the `position: fixed` margin layer, reclaiming the space a
 *             closed sidebar reserves.
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
 * There is deliberately no "not rendered" value left: every state a side can be
 * in is a container, which is what makes the no-reload law hold by construction
 * rather than by remembering.
 */

/** A margin thinner than this is a sliver, not a rail. */
export const MIN_MARGIN_PX = 40

export type SideSlot = "inline" | "margin" | "stowed" | "overlay"

export interface SideSlotInput {
	/** Below the app's 1024px breakpoint (P6): sides take no layout space. */
	narrow: boolean
	/** The mobile overlay is currently showing THIS side. */
	overlayOwns: boolean
	/** Standard width on desktop: the sidebars' dead space is reclaimable. */
	marginMode: boolean
	/** This side's margin is not already taken by an open sidebar panel. */
	marginFree: boolean
	/** Measured width of this side's margin. */
	marginPx: number
}

export function sideSlot(o: SideSlotInput): SideSlot {
	if (o.overlayOwns) return "overlay"
	if (o.narrow) return "stowed"
	if (!o.marginMode) return "inline"
	return o.marginFree && o.marginPx > MIN_MARGIN_PX ? "margin" : "stowed"
}

/* ── how wide a side is in the `inline` slot ─────────────────────────────
 *
 * A side rendered from the saved arrangement is one proportional grid, and a
 * grid has no width of its own — `.live-side` was `inline-size: 100%`, which
 * as a flex child of `.layout-body` asked for the WHOLE body. Two of those
 * plus the centre overflowed, flexbox shrank all three by their basis, and at
 * 1838px each side took 903px while `.layout-center` was squeezed to 0: the
 * chat disappeared. (Margin mode never showed it — there the width comes from
 * the measured margin the wrapper sets.)
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
}

/**
 * What a side occupies in `.layout-body`'s row, by whichever path it draws.
 * Only the `inline` slot is in that row at all: a margin side is a fixed layer
 * sized to the measured margin, and a stowed or overlay one has no box in the
 * flow — neither may reserve width the centre would then not get.
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
