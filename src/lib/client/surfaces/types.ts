/**
 * Surface-grid types (plan 21). The grid never branches on whether a panel is
 * native Svelte or a sandboxed frame — it speaks only this contract. A panel is
 * a *view onto channels*; the grid is *placement by CSS var only*; the tier is
 * chosen by the **content box** width, not the viewport.
 */
import type { PanelDecl } from "@serene-pub/sdk"

export type { PanelDecl }

/**
 * Container-width tiers (21 §3). The names, not pixels, are the contract; the
 * grid CSS owns the breakpoints and must agree with `TRACKS`.
 */
export type Tier = "compact" | "cozy" | "roomy" | "wide"

export const TIERS: Tier[] = ["compact", "cozy", "roomy", "wide"]

/** How many columns each tier offers. The single source of truth for both. */
export const TRACKS: Record<Tier, number> = {
	compact: 1,
	cozy: 2,
	roomy: 3,
	wide: 4
}

/** Container inline-size (px) at/above which each tier begins. Grid CSS mirrors. */
export const TIER_MIN_PX: Record<Tier, number> = {
	compact: 0,
	cozy: 640,
	roomy: 1024,
	wide: 1440
}

/** Pick the tier for a measured content-box width. */
export function tierFor(widthPx: number): Tier {
	if (widthPx >= TIER_MIN_PX.wide) return "wide"
	if (widthPx >= TIER_MIN_PX.roomy) return "roomy"
	if (widthPx >= TIER_MIN_PX.cozy) return "cozy"
	return "compact"
}

/**
 * A live panel: the mode's declaration plus this user's instance state. The
 * manager owns these; `pack()` reads them and never mutates.
 */
export interface PanelInstance {
	id: string
	title: string
	icon?: string
	role: "primary" | "secondary"
	surface: PanelDecl["surface"]
	/** Resolved frame document URL (frame surfaces only). */
	src?: string
	channels: string[]
	layout: {
		span: { ideal: number; min: number; max: number }
		minInline: number
		minBlock: number
		collapsible: boolean
		closable: boolean
		prefer: "grid" | "drawer"
	}
	/** Is this panel mounted at all? Inactive panels are addable, not shown. */
	active: boolean
	/** Collapsed to its title bar. */
	collapsed: boolean
	/** Pinned to the drawer rail rather than the grid. */
	drawered: boolean
	/** User ordering weight (lower = earlier / more prominent). */
	order: number
}

/** Where a single panel lands this tier. */
export interface PanelPlacement {
	id: string
	location: "grid" | "drawer"
	/** 1-based grid column start (grid only). */
	col: number
	/** Column span in tracks (grid only). */
	colSpan: number
	/** 1-based grid row start (grid only). */
	rowStart: number
	/** Row span (grid only; primary spans all rows). */
	rowSpan: number
	/** Visual order within the drawer rail (drawer only). */
	drawerOrder: number
}

export interface PackResult {
	tier: Tier
	tracks: number
	/** Total grid rows in use (≥ 1). Primary spans all of them. */
	rows: number
	placements: Map<string, PanelPlacement>
	/** Convenience: ids in the drawer, in rail order. */
	drawerIds: string[]
}

/** The persisted per-user layout blob (21 §10). Stored verbatim server-side. */
export interface LayoutBlob {
	/** Per-panel sticky state. Only panels the user has touched appear. */
	active?: Array<{
		id: string
		order?: number
		collapsed?: boolean
		drawered?: boolean
		/** Whether the user explicitly activated (true) or closed (false) it. */
		on?: boolean
	}>
	/** Sparse per-tier column fr weights, keyed by tier then panel/track. */
	tierSizeOverrides?: Partial<Record<Tier, number[]>>
	/**
	 * The modular zone layout (sessionLayout/schema.ts) — the free-form
	 * template the layout editor writes. Stored verbatim; typed as unknown
	 * here so the blob contract does not couple to the schema's evolution.
	 */
	zoneLayout?: unknown
	/**
	 * The chat widget grid (sessionLayout/widgetGrid.ts, PLAN 25) — the
	 * messages/composer widget config the layout editor writes. Stored verbatim
	 * for the same reason as zoneLayout; the manager is only its courier.
	 */
	widgetGrid?: unknown
	/**
	 * The captured gridstack geometry per zone (PLAN 25) — `{left?,middle?,right?}`
	 * each a `GsLayout` (cols/rows + per-item x/y/w/h). This is the drag editor's
	 * full arrangement, the ONE store that carries cell POSITIONS (widgetGrid and
	 * zoneLayout carry only membership/config). Persisting it is what lets the
	 * editor restore what you arranged and the live render survive a reload;
	 * stored verbatim, the manager is only its courier.
	 */
	arrangedGrid?: unknown
}

/** Normalize a raw `PanelDecl.layout` to the fully-defaulted instance shape. */
export function normalizeLayout(
	l: PanelDecl["layout"],
	role: "primary" | "secondary"
): PanelInstance["layout"] {
	const span = l?.span ?? {}
	const ideal = Math.max(1, span.ideal ?? 1)
	return {
		span: {
			ideal,
			min: Math.max(1, span.min ?? 1),
			max: Math.max(ideal, span.max ?? ideal)
		},
		// A conversation needs more room than a widget by default.
		minInline: l?.minInline ?? (role === "primary" ? 360 : 220),
		minBlock: l?.minBlock ?? 120,
		collapsible: l?.collapsible ?? role !== "primary",
		// Primary is never closable — the anchor guarantee (21 §5).
		closable: role === "primary" ? false : (l?.closable ?? true),
		prefer: l?.prefer ?? "grid"
	}
}
