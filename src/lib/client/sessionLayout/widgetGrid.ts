/**
 * The widget-grid layout model (PLAN 25). One model for the whole chat
 * surface: three zones (left/middle/right), each a responsive CSS grid, and
 * EVERYTHING is a widget — the conversation included.
 *
 * The engine is native CSS Grid: this module only turns a widget's declarative
 * constraints (anchor / grow / fixed / min-max cells) into the grid CSS the
 * browser then solves. There is no bespoke layout solver.
 *
 * MVP scope (staging §13.1): the zone grid is a stack of widgets in row order
 * (each widget a row) with an infinite `auto-fill` cell grid across columns —
 * enough to prove the normal chat (messages GROW into the whole middle) falls
 * out of the model. Side-by-side placement, tab groups, pinning and the drag
 * editor are later increments and deliberately not here yet.
 *
 * It is also where a widget's geometry becomes the `layout.v1` its ctx carries
 * (`placementOf` / `stackPlacements`) — the same cells the grid solves,
 * packaged for the data contract rather than re-derived by each renderer.
 */
import {
	RETIRED_WIDGET_IDS,
	ZONE_IDS,
	type GridSizeSpec,
	type GridWidget,
	type WidgetAnchor,
	type WidgetGridV1,
	type ZoneId
} from "@serene-pub/sdk"
import type { LayoutV1, PlacementInput } from "$lib/shared/widgets/context"
import type { WidgetTier } from "$lib/shared/widgets/types"
import { tierFor } from "$lib/client/surfaces/types"

/*
 * The `widgetGrid` slot's types are the SDK's (`WidgetGridV1`, its entries
 * `GridWidget`, their `GridSizeSpec` and `WidgetAnchor`), imported from
 * `@serene-pub/sdk` wherever they are used: the session layout is one format
 * a genre ships and this page draws. What stays here is the page's model of
 * it — membership edits, the reader that repairs a stored blob, and the grid
 * CSS it becomes.
 */

/** The cell module: a fixed floor so `auto-fill` gives a sane column count. */
export const DEFAULT_CELL = 44

/**
 * A measured pixel size → the nearest whole cell count (≥1). The inverse of
 * `trackFor`'s `{cells}` math, for the callers holding a measurement rather
 * than a constraint: a "fixed"/"grow" widget has no cell count of its own, so a
 * width the browser reported (a side zone's ladder width, `panelWidgets`) has
 * to be read back into the model's own unit.
 */
export function cellsFromPx(px: number, cell: number): number {
	return Math.max(1, Math.round(px / cell))
}

/**
 * Is this a widget id no reader should place? Widget ids that name nothing
 * this build places: a saved blob, a preset or an arrangement may still carry
 * one — all three are stored verbatim and nothing rewrites them — and every
 * reader drops it, so a layout arranged under an older build opens on the
 * widgets this build has.
 *
 * ONE list, the SDK's `RETIRED_WIDGET_IDS` (`sessionLayout.ts`): its id
 * readers and the validator a shipped layout goes through skip by it too, and
 * two lists would let them disagree with this page about what a stored layout
 * holds. It says why each id is there — `composer` (the conversation is one
 * widget) and `inventory` (R79 removed that widget for now). Admitting either
 * would put an empty card where it used to be.
 */
export function isRetiredWidget(id: string): boolean {
	return RETIRED_WIDGET_IDS.has(id)
}

/**
 * The normal chat, expressed purely as widgets: Messages GROW-anchored to all
 * four edges, filling the middle. This is the config a Chat genre ships —
 * nothing here is special-cased in the renderer. A genre that withholds the
 * conversation (R71) names the widget that stands there instead.
 *
 * It is also the **primary floor's** shape (./primaryFloor): a layout that
 * places no instance of the genre's primary widget anywhere gets this one
 * appended to its middle. Nothing else injects it — a saved grid is read as
 * saved (`loadChatLayout`), the conversation included, wherever it was put.
 */
export function defaultChatLayout(primaryId = "messages"): WidgetGridV1 {
	return {
		version: 1,
		cell: DEFAULT_CELL,
		widgets: [
			{
				id: primaryId,
				zone: "middle",
				order: 0,
				size: { w: "grow", h: "grow" },
				anchor: {
					top: true,
					bottom: true,
					left: true,
					right: true
				}
			}
		]
	}
}

/** A grid that places nothing — what an absent or unreadable blob reads as. */
export function emptyChatLayout(): WidgetGridV1 {
	return { version: 1, cell: DEFAULT_CELL, widgets: [] }
}

/** Immutably patch one widget by id (identity fields aside). Returns a new layout. */
export function updateWidget(
	layout: WidgetGridV1,
	id: string,
	patch: Partial<Omit<GridWidget, "id">>
): WidgetGridV1 {
	return {
		...layout,
		widgets: layout.widgets.map((w) =>
			w.id === id ? { ...w, ...patch } : w
		)
	}
}

/* ── zone membership (the middle's, which no zone template holds) ────────
 *
 * The side zones' membership lives in the zone template (`./schema`'s
 * `withWidget` / `withoutWidget`); the MIDDLE's lives here, because the middle
 * is this grid and the template never names it. The editor needs both halves
 * or a widget dropped on the middle is arranged into cells nothing declares it
 * in, and comes back offered in the tray on the next open.
 *
 * Named for the model they edit rather than merged with the template's pair:
 * two vocabularies at a boundary are reconciled, never merged.
 */

/**
 * The grid with `id` placed in `zone`, appended after what is already there
 * (the order `withWidget` appends a side panel in). A widget already in the
 * grid MOVES rather than doubling.
 *
 * The declaration is the one a layout's own strip uses — full width, content
 * height, anchored to the top and both sides (see `ADVENTURE_LAYOUT`'s
 * world-state above its messages).
 */
export function withGridWidget(
	layout: WidgetGridV1,
	id: string,
	zone: ZoneId
): WidgetGridV1 {
	const others = layout.widgets.filter((w) => w.id !== id)
	const order =
		others
			.filter((w) => w.zone === zone)
			.reduce((n, w) => Math.max(n, w.order), -1) + 1
	return {
		...layout,
		widgets: [
			...others,
			{
				id,
				zone,
				order,
				size: { w: "grow", h: "fixed" },
				anchor: { top: true, left: true, right: true }
			}
		]
	}
}

/**
 * The grid without `id` — the conversation included. Whether a removal may
 * happen at all is the primary floor's question (./primaryFloor), asked over
 * the whole layout by the editor before it gets here; this model only sees the
 * middle, and a conversation leaving it may be going to a side.
 */
export function withoutGridWidget(layout: WidgetGridV1, id: string): WidgetGridV1 {
	const widgets = layout.widgets.filter((w) => w.id !== id)
	return widgets.length === layout.widgets.length
		? layout
		: { ...layout, widgets }
}

/**
 * One zone's membership, reconciled against the arrangement that zone reported.
 *
 * The editor's gridstack zones are the only thing that knows a card was dragged
 * from one zone into another, and for the SIDES the commit reads that answer
 * straight into the zone template: a reported frame replaces that zone's widget
 * list wholesale. The middle has no such list — it is this grid — so the same
 * reading has to happen one model over, or a card dragged OUT of the middle
 * stays in the grid and renders in two zones, and one dragged IN is arranged
 * into cells nothing declares it in and is gone by the next open.
 *
 * `ids` is that zone's frame, as ids. **Absent (null/undefined) means NO
 * OPINION**, never "the zone is empty": a zone that is still a faithful restore
 * reports nothing at all, and taking that silence as authoritative would strip
 * the conversation out of the grid on Done. A present frame IS authoritative —
 * for membership only; the cells are the arrangement's and the order here is
 * left as the grid has it, newcomers appended.
 *
 * Deduplication is the caller's, done first: by the time a frame reaches here
 * an id is in at most one of them, so the tie-break that decided which zone a
 * card that reported itself in two belongs to has already been applied and this
 * reads the answer rather than re-deciding it.
 *
 * Every widget obeys the frame, the conversation included: placement is free
 * (the floor is a rule about the whole layout, never about a zone). Returns
 * the layout BY REFERENCE when the membership it describes is the one already
 * there.
 */
export function withGridMembership(
	layout: WidgetGridV1,
	zone: ZoneId,
	ids: readonly string[] | null | undefined
): WidgetGridV1 {
	if (!ids) return layout
	const wanted = new Set(ids)
	let next = layout
	// Out: what this zone holds and the frame does not name.
	for (const w of widgetsInZone(layout, zone))
		if (!wanted.has(w.id)) next = withoutGridWidget(next, w.id)
	// In: what the frame names and this zone does not hold — a card dragged in
	// from another zone, or from nowhere this model can see.
	const held = new Set(widgetsInZone(next, zone).map((w) => w.id))
	for (const id of ids)
		if (!held.has(id)) next = withGridWidget(next, id, zone)
	return next
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === "object" && !Array.isArray(x)
}
function isZone(x: unknown): x is ZoneId {
	return (ZONE_IDS as readonly unknown[]).includes(x)
}
function isSizeSpec(x: unknown): x is GridSizeSpec {
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
 * Rehydrate a persisted chat grid, defensively, AS SAVED: every widget keeps
 * the zone it was saved in — the conversation included — and nothing is put
 * back that the blob does not name. Whether the layout still places its
 * primary widget somewhere is a question about the whole layout (the side
 * lists and the arrangement too), which this model cannot see; the floor asks
 * it one level up (./primaryFloor `withPrimaryFloor`).
 *
 * An absent, junk or wrong-version blob reads as a grid that places nothing,
 * and the floor then seats the conversation exactly where it always was.
 *
 * A saved widget is admitted when it names a real zone and a usable size. The
 * one exception is the genre's primary widget (`primaryId`): a malformed field
 * of its entry falls back to the floor's shape (`defaultChatLayout`) for that
 * field, zone included, so a hand-damaged entry still draws the conversation
 * rather than dropping it.
 *
 * An id the genre default does not carry is ADMITTED rather than dropped: a
 * preset's own widget (the Adventure strip above the messages) and a plugin's
 * panel both arrive that way, and the renderer resolves a widget id to its own
 * content, so an id this function declines to place is a placement that
 * silently disappears. The one exception is a RETIRED id, which names nothing
 * this build can render. `saved` is `unknown` because the blob is stored
 * verbatim server-side.
 */
export function loadChatLayout(
	saved: unknown,
	primaryId = "messages",
	omit: ReadonlySet<string> = new Set()
): WidgetGridV1 {
	if (
		!isPlainObject(saved) ||
		saved.version !== 1 ||
		!Array.isArray(saved.widgets)
	) {
		return emptyChatLayout()
	}
	const floor = defaultChatLayout(primaryId).widgets[0]
	const seen = new Set<string>()
	const widgets: GridWidget[] = []
	for (const s of saved.widgets) {
		if (!isPlainObject(s) || typeof s.id !== "string") continue
		const id = s.id
		// A widget the genre withholds (R71) is not placed, whatever was saved.
		if (isRetiredWidget(id) || omit.has(id) || seen.has(id)) continue
		const sizeOk =
			isPlainObject(s.size) && isSizeSpec(s.size.w) && isSizeSpec(s.size.h)
		const size = sizeOk
			? {
					w: (s.size as Record<string, unknown>).w as GridSizeSpec,
					h: (s.size as Record<string, unknown>).h as GridSizeSpec
				}
			: null
		if (id === primaryId) {
			seen.add(id)
			widgets.push({
				id,
				zone: isZone(s.zone) ? s.zone : floor.zone,
				order: typeof s.order === "number" ? s.order : floor.order,
				size: size ?? floor.size,
				anchor: isPlainObject(s.anchor)
					? { ...(s.anchor as WidgetAnchor) }
					: floor.anchor,
				...(typeof s.colSpan === "number" ? { colSpan: s.colSpan } : {})
			})
			continue
		}
		if (!isZone(s.zone) || !size) continue
		seen.add(id)
		widgets.push({
			id,
			zone: s.zone,
			order: typeof s.order === "number" ? s.order : widgets.length,
			size,
			anchor: isPlainObject(s.anchor) ? { ...(s.anchor as WidgetAnchor) } : {},
			...(typeof s.colSpan === "number" ? { colSpan: s.colSpan } : {})
		})
	}
	const cell =
		typeof saved.cell === "number" && saved.cell > 0 ? saved.cell : DEFAULT_CELL
	return { version: 1, cell, widgets }
}

// ─── Placement → the widget data contract (PLAN 25) ──────────────────────────

/** A widget's cells in its zone: 0-based origin + span, the arranged ArrangedItem shape. */
export interface CellBox {
	x: number
	y: number
	w: number
	h: number
}

export interface PlacementOpts {
	/** The zone's own cell grid, as measured/arranged now. */
	zone: { cols: number; rows: number }
	box: CellBox
	/** The widget box's measured inline size, for its tier. 0 = not yet measured. */
	widthPx: number
	/**
	 * The widget box's measured block size, when the zone measures one.
	 *
	 * Omitted where a zone measures width alone, and that absence travels: the
	 * contract's `box.px` reports BOTH or neither, because a widget fitting
	 * itself to a box cannot use half of one — and a 0 standing in for "not
	 * measured" is the failure mode `tier` already has to work around.
	 */
	heightPx?: number
	/**
	 * The cell height to REPORT, when it differs from the rows the box occupies.
	 * `null` is the contract's "grows / is unbounded" (a `1fr` or `auto` track);
	 * omitted means `box.h`, which is right wherever a zone's rows are uniform
	 * cells (every arranged zone). The MVP stack is the exception — there a row
	 * IS a widget, so its occupancy and its cell height are different numbers.
	 */
	rows?: number | null
	pinned?: boolean
	collapsed?: boolean
	drawered?: boolean
	chrome?: Partial<LayoutV1["chrome"]>
}

/**
 * The width class of a widget's OWN box.
 *
 * The same breakpoints the surface grid uses for the whole content box, applied
 * one level down — which is the point of the field: a widget in a 240px rail is
 * `compact` however wide the window is, and that is what it should reflow
 * against. Sharing `tierFor` keeps the two from drifting apart.
 */
export function widgetTier(widthPx: number): WidgetTier {
	return tierFor(widthPx)
}

/**
 * A widget's cells → the `PlacementInput` its ctx is projected from.
 *
 * `zone` carries the grid's dims AND this widget's 1-based start cell, so
 * `zone.column`/`zone.row` with `box.cols`/`box.rows` is the whole geometry —
 * the same numbers the renderer put in `grid-column` / `grid-row`.
 *
 * `edges` is computed here rather than declared: "does this box touch that edge
 * of its zone" is a fact about the two, and a widget asking it (to drop a
 * border, to round only the outer corners) must not have to recompute it from
 * numbers the host already holds. `>=` rather than `===` on the far edges
 * because a restored arrangement can overhang the zone it lands in — a box the
 * grid clamps to the edge is touching it, not floating short of it.
 */
export function placementOf(o: PlacementOpts): PlacementInput {
	const { cols, rows } = o.zone
	const { x, y, w, h } = o.box
	return {
		zone: { columns: cols, column: x + 1, rows, row: y + 1 },
		box: {
			cols: w,
			rows: o.rows === undefined ? h : o.rows,
			edges: {
				top: y <= 0,
				left: x <= 0,
				right: x + w >= cols,
				bottom: y + h >= rows
			},
			// Reported only when the zone measured BOTH axes — see `heightPx`.
			// A zero is "not measured yet", never a measurement: the contract
			// spells that absence, so the rule lives here rather than in each
			// renderer that binds a box.
			...(o.widthPx > 0 && o.heightPx && o.heightPx > 0
				? { px: { width: o.widthPx, height: o.heightPx } }
				: {})
		},
		tier: widgetTier(o.widthPx),
		pinned: o.pinned ?? false,
		collapsed: o.collapsed ?? false,
		drawered: o.drawered ?? false,
		...(o.chrome ? { chrome: o.chrome } : {})
	}
}

/**
 * A height spec → its cell count, or `null` when the track is unbounded.
 *
 * `grow` (a `1fr` track) and `fixed` (an `auto` track) are both "however tall
 * the content and the leftover space make it", which the contract spells
 * `rows: null`. Only a cell-bounded spec has a number worth reporting, and the
 * floor (`cells`, else `minCells`) is the one the grid actually reserves.
 */
export function cellRowsOf(size: GridSizeSpec): number | null {
	if (size === "grow" || size === "fixed") return null
	return size.cells ?? size.minCells ?? null
}

/**
 * Placements for one zone's stack — the MVP zone grid (§13.1), where widgets
 * are rows in `order` and every widget spans the zone's full width.
 *
 * `columns` is the zone's live `auto-fill` column count (the renderer measures
 * it); `widthPx` is the widget box's measured width, which in a full-span stack
 * is the zone's own. A widget with a `colSpan` reports that span but still
 * starts at column 1 — auto-flow places it, and this model gives each widget a
 * row of its own, so column 1 is where it lands.
 *
 * A widget OCCUPIES exactly one row here (that is what the stack is), so the
 * edges come out of its index — first touches the top, last the bottom — while
 * `box.rows` reports the cell floor its height spec reserves, or null when the
 * track grows. Conflating the two would make a 3-cell strip in a 2-widget
 * stack claim the bottom edge from the middle of the zone.
 */
export function stackPlacements(
	widgets: GridWidget[],
	measured: { columns: number; widthPx: number }
): PlacementInput[] {
	const cols = Math.max(1, measured.columns)
	const rows = Math.max(1, widgets.length)
	return widgets.map((w, i) =>
		placementOf({
			zone: { cols, rows },
			box: { x: 0, y: i, w: Math.min(w.colSpan ?? cols, cols), h: 1 },
			rows: cellRowsOf(w.size.h),
			widthPx: measured.widthPx,
			pinned: w.pinned
		})
	)
}

/** Widgets in one zone, in placement order. */
export function widgetsInZone(
	layout: WidgetGridV1,
	zone: ZoneId
): GridWidget[] {
	return layout.widgets
		.filter((w) => w.zone === zone)
		.sort((a, b) => a.order - b.order)
}

/** One axis of a widget's size → a grid track size for its row/column. */
export function trackFor(size: GridSizeSpec, cell: number): string {
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
export function zoneGridStyle(widgets: GridWidget[], cell: number): string {
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
export function cellsGridStyle(widgets: GridWidget[], cell: number): string {
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
export function widgetItemStyle(w: GridWidget, cell: number): string {
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
