/**
 * The widget-grid layout model (PLAN 25). One model for the whole chat
 * surface: three zones (left/middle/right), each a responsive CSS grid, and
 * EVERYTHING is a widget — including the chat messages and the composer.
 *
 * The engine is native CSS Grid: this module only turns a widget's declarative
 * constraints (anchor / grow / fixed / min-max cells) into the grid CSS the
 * browser then solves. There is no bespoke layout solver.
 *
 * MVP scope (staging §13.1): the zone grid is a stack of widgets in row order
 * (each widget a row) with an infinite `auto-fill` cell grid across columns —
 * enough to prove the normal chat (messages GROW + composer FIXED bottom)
 * falls out of the model. Side-by-side placement, tab groups, pinning and the
 * drag editor are later increments and deliberately not here yet.
 */

export type Zone = "left" | "middle" | "right"

/** How a widget sizes on one axis. */
export type SizeSpec =
	| "grow" // fills the remaining space (a 1fr track)
	| "fixed" // content-sized (an `auto` track)
	| { minCells?: number; maxCells?: number; cells?: number }

/** Which edges of its space a widget sticks to as the grid reflows. */
export interface Anchor {
	top?: boolean
	bottom?: boolean
	left?: boolean
	right?: boolean
}

export interface WidgetConfig {
	id: string
	zone: Zone
	/** Placement order within the zone (top→bottom in the MVP stack). */
	order: number
	/** Cells wide; omitted = span the full zone width. */
	colSpan?: number
	size: { w: SizeSpec; h: SizeSpec }
	anchor: Anchor
	/** Stays visible when the drawer is closed (§7); floats with a card (§8). */
	pinned?: boolean
	/** Only meaningful when pinned — the card background toggle (§8). */
	background?: boolean
	/** Tab-group membership (§5/§6). */
	group?: string
	/** Repositionable but not removable — the chat's anchor guarantee (§2). */
	required?: boolean
}

export interface GridLayout {
	version: 1
	/** The fixed cell module (px). "N cells" is a stable physical size (§3). */
	cell: number
	widgets: WidgetConfig[]
}

export const ZONES: Zone[] = ["left", "middle", "right"]

/** The cell module: a fixed floor so `auto-fill` gives a sane column count. */
export const DEFAULT_CELL = 44

/**
 * A measured pixel size → the nearest whole cell count (≥1). The inverse of
 * `trackFor`'s `{cells}` math — used to seed a drag-resize from a widget's
 * current on-screen size, since a "fixed"/"grow" widget has no cell count of
 * its own until the user starts resizing it.
 */
export function cellsFromPx(px: number, cell: number): number {
	return Math.max(1, Math.round(px / cell))
}

/**
 * The normal chat, expressed purely as widgets: Messages GROW-anchored to the
 * top edges, the Composer FIXED-height anchored to the bottom. Both required.
 * This is the config a Chat genre ships — nothing here is special-cased in the
 * renderer.
 */
export function defaultChatLayout(): GridLayout {
	return {
		version: 1,
		cell: DEFAULT_CELL,
		widgets: [
			{
				id: "messages",
				zone: "middle",
				order: 0,
				size: { w: "grow", h: "grow" },
				anchor: { top: true, left: true, right: true },
				required: true
			},
			{
				id: "composer",
				zone: "middle",
				order: 1,
				size: { w: "grow", h: "fixed" },
				anchor: { bottom: true, left: true, right: true },
				required: true
			}
		]
	}
}

/** Immutably patch one widget by id (identity fields aside). Returns a new layout. */
export function updateWidget(
	layout: GridLayout,
	id: string,
	patch: Partial<Omit<WidgetConfig, "id">>
): GridLayout {
	return {
		...layout,
		widgets: layout.widgets.map((w) =>
			w.id === id ? { ...w, ...patch } : w
		)
	}
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === "object" && !Array.isArray(x)
}
function isSizeSpec(x: unknown): x is SizeSpec {
	return (
		x === "grow" ||
		x === "fixed" ||
		(isPlainObject(x) &&
			["minCells", "maxCells", "cells"].some(
				(k) => typeof x[k] === "number"
			))
	)
}

/**
 * Rehydrate a persisted chat grid, defensively. The genre's default is the
 * floor: required widgets (messages/composer) always survive, so a truncated or
 * hand-corrupted blob can never strand a session without its composer. A saved
 * widget only overrides the fields the editor writes (size/anchor/order/colSpan)
 * and only when they pass a shape check — anything malformed falls back to the
 * default for that field. Unknown persisted ids are ignored (nothing renders
 * them yet). `saved` is `unknown` because the blob is stored verbatim server-side.
 */
export function loadChatLayout(saved: unknown): GridLayout {
	const base = defaultChatLayout()
	if (
		!isPlainObject(saved) ||
		saved.version !== 1 ||
		!Array.isArray(saved.widgets)
	) {
		return base
	}
	const savedById = new Map<string, Record<string, unknown>>()
	for (const w of saved.widgets) {
		if (isPlainObject(w) && typeof w.id === "string") savedById.set(w.id, w)
	}
	const widgets = base.widgets.map((b): WidgetConfig => {
		const s = savedById.get(b.id)
		if (!s) return b
		const size =
			isPlainObject(s.size) &&
			isSizeSpec(s.size.w) &&
			isSizeSpec(s.size.h)
				? { w: s.size.w as SizeSpec, h: s.size.h as SizeSpec }
				: b.size
		return {
			...b,
			size,
			anchor: isPlainObject(s.anchor) ? { ...(s.anchor as Anchor) } : b.anchor,
			order: typeof s.order === "number" ? s.order : b.order,
			colSpan: typeof s.colSpan === "number" ? s.colSpan : b.colSpan
		}
	})
	const cell =
		typeof saved.cell === "number" && saved.cell > 0 ? saved.cell : base.cell
	return { version: 1, cell, widgets }
}

/** Widgets in one zone, in placement order. */
export function widgetsInZone(
	layout: GridLayout,
	zone: Zone
): WidgetConfig[] {
	return layout.widgets
		.filter((w) => w.zone === zone)
		.sort((a, b) => a.order - b.order)
}

/** One axis of a widget's size → a grid track size for its row/column. */
export function trackFor(size: SizeSpec, cell: number): string {
	if (size === "grow") return "1fr"
	if (size === "fixed") return "auto"
	const min = size.minCells != null ? `${size.minCells * cell}px` : "auto"
	if (size.cells != null) return `${size.cells * cell}px`
	const max = size.maxCells != null ? `${size.maxCells * cell}px` : "auto"
	return `minmax(${min}, ${max})`
}

/**
 * The zone container's grid CSS. Columns are the infinite `auto-fill` cell
 * grid; rows are derived from the stacked widgets' height specs (grow → 1fr,
 * fixed → auto) so the browser solves the vertical fill.
 */
export function zoneGridStyle(widgets: WidgetConfig[], cell: number): string {
	const cols = `repeat(auto-fill, minmax(${cell}px, 1fr))`
	const rows = widgets.length
		? widgets.map((w) => trackFor(w.size.h, cell)).join(" ")
		: "1fr"
	return (
		`display:grid;` +
		`grid-template-columns:${cols};` +
		`grid-template-rows:${rows};` +
		`min-block-size:0;`
	)
}

/**
 * Like `zoneGridStyle`, but columns are the FIXED cell module (`Npx`, not the
 * stretchy `minmax(cell,1fr)`), centred so any sub-cell remainder splits evenly.
 * This makes every column exactly one square cell, so a cell-guide overlay drawn
 * at the same module lines up perfectly — used by the visual editor, where
 * seeing the real grid of cells matters more than filling the last few px. Rows
 * still come from the widgets' height specs, so grow/fixed/anchor render exactly
 * as the live `zoneGridStyle` would.
 */
export function cellsGridStyle(widgets: WidgetConfig[], cell: number): string {
	const rows = widgets.length
		? widgets.map((w) => trackFor(w.size.h, cell)).join(" ")
		: "1fr"
	return (
		`display:grid;` +
		`grid-template-columns:repeat(auto-fill, ${cell}px);` +
		`grid-template-rows:${rows};` +
		`justify-content:center;` +
		`min-block-size:0;`
	)
}

/** An anchor pair → a grid self-alignment value. */
function selfAlign(near?: boolean, far?: boolean): string {
	if (near && far) return "stretch"
	if (near) return "start"
	if (far) return "end"
	return "stretch"
}

/**
 * A widget's grid-item CSS: anchoring (align/justify-self), column span, and
 * any min/max cell bounds. Row placement is left to auto-flow (the widgets
 * render in `order`, so they land in successive rows).
 */
export function widgetItemStyle(w: WidgetConfig, cell: number): string {
	// A GROW axis always stretches to fill its (1fr) track; the anchor only
	// positions a fixed / bounded widget within a larger space.
	const jself =
		w.size.w === "grow" ? "stretch" : selfAlign(w.anchor.left, w.anchor.right)
	const aself =
		w.size.h === "grow" ? "stretch" : selfAlign(w.anchor.top, w.anchor.bottom)
	const decls: string[] = [
		`justify-self:${jself}`,
		`align-self:${aself}`,
		`grid-column:${w.colSpan ? `span ${w.colSpan}` : "1 / -1"}`,
		`min-inline-size:0`,
		`min-block-size:0`
	]
	if (typeof w.size.w === "object") {
		if (w.size.w.minCells != null)
			decls.push(`min-inline-size:${w.size.w.minCells * cell}px`)
		if (w.size.w.maxCells != null)
			decls.push(`max-inline-size:${w.size.w.maxCells * cell}px`)
		if (w.size.w.cells != null)
			decls.push(`inline-size:${w.size.w.cells * cell}px`)
	}
	if (typeof w.size.h === "object") {
		if (w.size.h.minCells != null)
			decls.push(`min-block-size:${w.size.h.minCells * cell}px`)
		if (w.size.h.maxCells != null)
			decls.push(`max-block-size:${w.size.h.maxCells * cell}px`)
	}
	return decls.join(";")
}
