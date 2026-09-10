/**
 * The Move tab's SCREEN-SIZE SIMULATOR (P5, ruled 2026-08-30) — pure geometry.
 *
 * The layout editor draws its three zones as a ¼ | ½ | ¼ split of the width it
 * is given, deliberately identical in both width modes (see the `.edit-center`
 * / `.edit-margin` comments in SessionLayout: "This keeps the edit screen
 * identical in both modes"). This module is the ONE implementation of that
 * split — the editor calls it with the real viewport width, the simulator calls
 * it with a tier's width — so a previewed tier can never drift from what the
 * editor actually draws.
 *
 * What the simulator is NOT: a second arrangement, or a per-tier layout.
 * Picking a tier only changes how wide each zone is drawn, which changes each
 * zone's column count, which is exactly how the SAME saved arrangement clamps
 * on that device. Nothing here is persisted and there is no per-tier storage:
 * a layout arranged at a narrow tier is the same `arrangedGrid` as one arranged
 * at a wide tier, and it will be clamped down (or spread out) on every other
 * tier — that is the point of previewing it.
 *
 * ## The split and the ladder are two different things
 *
 * The live side zones resolve their width and their COLUMN COUNT from a rule
 * ladder (`DEFAULT_SIDE_RULES` in ./schema) — and from 2400px up that ladder
 * turns each rail into a 344px TWO-column grid. The editor's ¼ | ½ | ¼ does not
 * follow it, and deliberately: `.edit-margin` is the app shell's own reclaimed
 * margin ("Left/Right zones ride in the site's reclaimed margins … same
 * geometry as the live margin rails"), i.e. the box a rail rides IN, not the
 * rail. Widening it to the ladder's footprint would draw an edit margin wider
 * than the margin the shell actually reserves, and at a real ultrawide the
 * fixed `.edit-margin` would then sit on top of the chat.
 *
 * So: the SPLIT governs the frame, the LADDER governs the columns. That is why
 * `sideColumns` is reported here (read off the ladder through `resolveZone`,
 * never restated) and why the too-narrow cull counts a whole cell PER rail
 * column — a 2-column rail drawn one cell wide is not the rail that device
 * shows, it is a sliver pretending to be one.
 */
import { TIER_MIN_PX } from "../surfaces/types"
import { resolveZone } from "./schema"
import type { WidgetTier } from "$lib/shared/widgets/types"

/**
 * The share of the width each side margin takes in the editor. Mirrors the app
 * shell's standard-width geometry (main = ½, a ¼ margin each side that the
 * closed sidebars reserve), which is what the side zones ride in.
 */
export const EDIT_SIDE_FRACTION = 0.25

/**
 * Non-grid pixels inside one editor zone box, both edges summed: the
 * `.edit-margin` padding (0.4rem × 2), the `.zgrid` border (1.5px × 2) and the
 * `.zgrid-body` padding (0.4rem × 2). Only used to answer "can this margin hold
 * a single cell at all?" — the exact column count is still derived by
 * `GridStackZone` from its own measured box.
 */
export const EDIT_ZONE_CHROME_PX = 29

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
 * How many columns the LIVE layout runs a side rail at, for a container of
 * `width`.
 *
 * Read off the zone ladder through `resolveZone` — the same walk the live
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
				resolveZone(side, { kind: "side", side, widgets: [] }, w)
					.columns
		)
	)
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
	/** Whole cells a side margin must fit to be worth drawing. Default 1. */
	minSideCells?: number
}

export interface SimGeometry {
	/** Left margin width, px (0 = too narrow to hold a widget; don't draw it). */
	left: number
	/** Centre column width, px. Absorbs the rounding, and any culled margin. */
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
 *
 * `cell` is the editor's square cell module. It does not size the zones — it
 * only decides whether a margin is wide enough to hold one whole cell; a
 * narrower margin holds no widget at all, so it is culled to 0 and its space
 * goes back to the centre (which is what a phone does: no rails, just chat).
 */
export function simulatedGeometry(
	width: number,
	cell: number,
	rules: SimRules = {}
): SimGeometry {
	const frac = rules.sideFraction ?? EDIT_SIDE_FRACTION
	const minCells = rules.minSideCells ?? 1
	const w = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0

	// The ladder's column count for this width — the split does not follow it
	// (see the module doc), but the cull below has to: a rail is only a rail if
	// it can hold a whole cell in each of its columns.
	const sideColumns = railColumns(w)

	let side = Math.max(0, Math.round(w * frac))
	// Cull a margin that cannot host a single cell — a sliver of a rail is
	// worse than no rail, and it is not what the device would show either.
	if (side - EDIT_ZONE_CHROME_PX < minCells * sideColumns * cell) side = 0
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

/** What leaving a simulated tier decides. */
export interface SimExit<T> {
	/** The arrangement to keep — the snapshot, or the simulated one. */
	arranged: T
	/** True when the snapshot was put back (i.e. the preview was discarded). */
	restored: boolean
}

/**
 * Leave a simulated tier without letting the preview eat the real layout.
 *
 * Previewing re-measures every zone, so gridstack clamps the arrangement into
 * the previewed column count and reports it back as if the user had done it —
 * which would make LOOKING at a phone width silently rewrite a desktop layout,
 * unrecoverably (returning to Actual re-spreads nothing). So the editor
 * snapshots the arrangement on the way in and asks this on the way out.
 *
 * The one thing that earns the simulated arrangement its place is a real user
 * gesture while it was showing (`dirty`): a drag, resize, drop, anchor, group,
 * add or remove. There is only ever ONE arrangement — the simulator is a lens,
 * not a per-tier layout — so an edit made at a narrow tier is an edit to the
 * layout at every size, and keeping it is the only honest reading.
 *
 * Pure: it picks between the two arrangements it was handed and copies neither.
 */
export function simulationExit<T>(
	snapshot: T | null | undefined,
	current: T,
	dirty: boolean
): SimExit<T> {
	// No snapshot means simulation never properly started — never invent one.
	if (dirty || snapshot == null) return { arranged: current, restored: false }
	return { arranged: snapshot, restored: true }
}
