/**
 * The Arrange tab's SCREEN-SIZE SIMULATOR (P5, ruled 2026-08-30) — pure geometry.
 *
 * The layout editor draws its three zones as a ¼ | ½ | ¼ split of the width it
 * is given. This module is the ONE implementation of that split — the editor
 * calls it with the real viewport width, the simulator with a tier's width —
 * so a previewed tier can never drift from what the editor actually draws.
 *
 * What the simulator is NOT: a second arrangement, or a per-tier layout.
 * Picking a tier only changes how wide (and how tall) the zones are drawn;
 * a panel layout (PLAN-session-panels-2026-10-14) has no cells to clamp, so
 * looking at a tier never changes the layout and needs no guard.
 *
 * The SPLIT governs the frame; the side ladder (the SDK's
 * `DEFAULT_SIDE_RULES`) governs a rail's columns, reported as `sideColumns`.
 */
import { TIER_MIN_PX } from "../surfaces/types"
import { zoneRungAt } from "@serene-pub/sdk"
import type { WidgetTier } from "$lib/shared/widgets/types"

/**
 * The share of the width each side margin takes in the editor. Mirrors the app
 * shell's standard-width geometry (main = ½, a ¼ margin each side that the
 * closed sidebars reserve), which is what the side zones ride in.
 */
export const EDIT_SIDE_FRACTION = 0.25

/**
 * The width previewed for each tier. Cozy/roomy/wide preview at the width where
 * that tier BEGINS (`TIER_MIN_PX`) — the narrowest width the tier has to
 * survive, so it is the honest worst case for clamping. Compact begins at 0,
 * which previews nothing, so it gets the one hand-picked value in this file: a
 * 390px phone (the iPhone 14/15 logical width, and the narrowest screen worth
 * designing for).
 */
export const COMPACT_PREVIEW_PX = 390

/**
 * The width Ultrawide previews. Like Compact, the one other hand-picked value:
 * `wide` is the last container TIER (`TIER_MIN_PX` stops at 1440), but the side
 * rails branch once more above it — `DEFAULT_SIDE_RULES` turns them 2-column at
 * 2400 — and no preset showed that. 2560 is the first real monitor past the
 * branch: the 2560×1440 desktop, and half of a 5120-wide ultrawide.
 */
export const ULTRAWIDE_PREVIEW_PX = 2560

/**
 * What the preview control can be set to. Every `WidgetTier` is one, plus
 * `ultrawide` — which is NOT a tier: the widget context's tier ladder stops at
 * `wide`, and a 2560px screen is genuinely still `wide` to a widget. Widening
 * `WidgetTier` for it would put a fifth tier into the widget data contract that
 * nothing on the other side of it means, so the extra preset stays local to the
 * control that offers it.
 */
export type SimTier = WidgetTier | "ultrawide"

export const SIM_WIDTH_PX: Record<SimTier, number> = {
	compact: COMPACT_PREVIEW_PX,
	cozy: TIER_MIN_PX.cozy,
	roomy: TIER_MIN_PX.roomy,
	wide: TIER_MIN_PX.wide,
	ultrawide: ULTRAWIDE_PREVIEW_PX
}

/**
 * The HEIGHT each preset previews at.
 *
 * The split above is about WIDTH — a device's height is no part of the
 * ¼ | ½ | ¼ frame, and `simulatedGeometry` neither takes nor returns one. The
 * side column's rail model does (see ./sideRail): whether a group can expand
 * beside the pinned ones, or has to fly out over the session, is a question
 * about how tall the COLUMN is. Previewed against the real window's height,
 * all five presets would answer it with this monitor's number, and the one
 * behaviour the preview exists to show would never appear at any of them.
 *
 * Logical heights, paired with the widths above: the 390×844 phone, a 640-wide
 * tablet at 800, a 1024 laptop with about 640 of content left under its
 * browser chrome, a 1440 desktop at 900, and the 2560×1440 monitor. Like the
 * widths, they are what that device HAS, not a claim about any one window.
 */
export const SIM_HEIGHT_PX: Record<SimTier, number> = {
	compact: 844,
	cozy: 800,
	roomy: 640,
	wide: 900,
	ultrawide: 1440
}

/**
 * How many columns the LIVE layout runs a side rail at, for a container of
 * `width`.
 *
 * Read off the zone ladder through the SDK's `zoneRungAt` — the same walk the live
 * render does — rather than restated here, so editing `DEFAULT_SIDE_RULES`
 * moves the preview with it instead of leaving the two to disagree quietly. The
 * max of the two sides: the editor draws each margin as ONE box, so the honest
 * count for that box is whichever side asks for more.
 */
export function railColumns(width: number): number {
	// Normalised first: `resolveZone` walks `width < rule.min`, and every such
	// comparison against NaN is false — an unguarded NaN would apply the whole
	// ladder and report the widest branch for a width that is not a width.
	const w = Number.isFinite(width) ? Math.max(0, width) : 0
	return Math.max(
		...(["left", "right"] as const).map(
			(side) =>
				zoneRungAt({ kind: "side", side, widgets: [] }, w).columns
		)
	)
}

/**
 * The width the app stops giving the side zones any layout space at, and so
 * the width the desktop editor hands over to the phone's row editor. Read off
 * the tier ladder rather than restated, because it is the same threshold
 * `.zone-rail` docks at and a session's `matchMedia` reads.
 */
export const MOBILE_EDIT_PX = TIER_MIN_PX.roomy

/** Is this width below the breakpoint — a phone, or a window the size of one? */
export function narrowWidth(width: number): boolean {
	return !(width >= MOBILE_EDIT_PX)
}

/** Which editor a viewport gets. */
export interface MobileEditInput {
	/** The real window is below the breakpoint. */
	narrow: boolean
	/** The width being drawn — a previewed tier's, or the real one — is. */
	simNarrow: boolean
}

/**
 * Does the editor draw the phone's row editor instead of the Arrange canvas?
 * A real narrow window always does, and so does a desktop PREVIEWING a phone
 * width — which is what lets the row editor be checked without a phone.
 */
export function mobileEditing(o: MobileEditInput): boolean {
	return o.narrow || o.simNarrow
}

export interface SimOption {
	tier: SimTier
	/** The tier's own name — the segmented control shows it with the width. */
	label: string
	width: number
	/** What that width is, for the button's tooltip. */
	hint: string
}

/** The simulator's choices, narrowest first. "Actual" is the absence of one. */
export const SIM_OPTIONS: SimOption[] = [
	{
		tier: "compact",
		label: "Compact",
		width: SIM_WIDTH_PX.compact,
		hint: "Phone — one column, side rails all but gone"
	},
	{
		tier: "cozy",
		label: "Cozy",
		width: SIM_WIDTH_PX.cozy,
		hint: "Small tablet / split window"
	},
	{
		tier: "roomy",
		label: "Roomy",
		width: SIM_WIDTH_PX.roomy,
		hint: "Laptop — where the side rails start to dock"
	},
	{
		tier: "wide",
		label: "Wide",
		width: SIM_WIDTH_PX.wide,
		hint: "Desktop and above"
	},
	{
		tier: "ultrawide",
		label: "Ultrawide",
		width: SIM_WIDTH_PX.ultrawide,
		hint: "Ultrawide — side rails go 2-column from 2400px up"
	}
]

/** Extra inputs to the split; every one has a sane default. */
export interface SimRules {
	/** Share of the width each side margin takes. Default `EDIT_SIDE_FRACTION`. */
	sideFraction?: number
	/**
	 * Real pixels the frame may occupy. Only affects `scale` — the zone widths
	 * are always the simulated ones. Omit (or pass a non-positive value) for no
	 * scaling.
	 */
	available?: number
}

export interface SimGeometry {
	/** Left margin width, px (0 = no room for a side at all; don't draw it). */
	left: number
	/** Centre column width, px. Absorbs the rounding. */
	centre: number
	/** Right margin width, px. */
	right: number
	/** Visual down-scale for the whole frame, in (0, 1]. Never scales up. */
	scale: number
	/**
	 * Columns the LIVE side rail runs at this width (`DEFAULT_SIDE_RULES`, via
	 * `railColumns`). 1 everywhere below 2400px; 2 from there up, which is the
	 * branch the Ultrawide preset exists to show.
	 */
	sideColumns: number
}

/**
 * Split `width` into the editor's three zones, and say how far the result has
 * to shrink to fit `rules.available`.
 */
export function simulatedGeometry(
	width: number,
	rules: SimRules = {}
): SimGeometry {
	const frac = rules.sideFraction ?? EDIT_SIDE_FRACTION
	const w = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0
	const sideColumns = railColumns(w)
	let side = Math.max(0, Math.round(w * frac))
	if (side * 2 > w) side = 0

	const available = rules.available
	const scale =
		typeof available === "number" &&
		Number.isFinite(available) &&
		available > 0 &&
		w > available
			? available / w
			: 1

	return {
		left: side,
		centre: w - side * 2,
		right: side,
		scale,
		sideColumns
	}
}
