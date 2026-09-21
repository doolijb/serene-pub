/**
 * Pointer drag on a live CSS grid — the pure half of the layout-editor spike
 * (`~/.claude/plans/PLAN-session-layout-v2.md`, phase P0, editor §5.1).
 *
 * The question P0 exists to answer is whether a layout editor can be an
 * OVERLAY on the grid the session actually renders, rather than a second,
 * library-owned grid the person edits and the app then copies. The overlay
 * only works if everything geometric is decided HERE, from numbers the DOM
 * already knows: the zone's box, its resolved track lines, the units' rects
 * and the pointer. No element is moved while dragging, nothing is measured
 * twice, and the same functions answer a keyboard press.
 *
 * Everything in this module is pure and DOM-free so it can be tested without
 * a browser; `+page.svelte` in `src/routes/dev/layout-spike` is the throwaway
 * that wires it to real pointer events.
 *
 * ## Vocabulary (plan §2.1)
 *
 * A **zone** is one CSS grid. Its **tracks** are its rows and columns, each
 * sized by an **extent**. A **unit** is one placed thing, addressed by 1-based
 * grid LINES (`{ start, span }`), never by pixels. "12" is the share language:
 * a grow track's size is read in twelfths of the zone, which is what makes
 * "8 of 12" a sentence a person can act on and a number a grid can honour.
 *
 * ⚠ SPIKE DEVIATION — `{ grow: n }`. The plan's `Extent` union cannot express
 * "this row is 8 of 12 and that one is 4": `'grow'` is a bare 1fr and
 * `{ cells: n }` is a fixed multiple of the cell module. The join gesture the
 * plan asks for (§5.1, "join, equal share") therefore has nothing to write its
 * result into. This module adds a weighted grow — `{ grow: n }`, n twelfths,
 * emitted as `nfr` — and P1 should decide whether the contract gains it. It is
 * additive: a bare `'grow'` keeps meaning 1fr.
 */

/** How one track sizes. `{ grow: n }` is the spike addition, see above. */
export type Extent =
	| "grow"
	| "fit"
	| { cells: number }
	| { min?: number; max?: number }
	| { grow: number }

/** One placed thing in a zone, addressed by grid lines. */
export interface Unit {
	key: string
	/** What a person calls it; labels fall back to the key. */
	title?: string
	row: { start: number; span: number }
	col: { start: number; span: number }
}

/** One CSS grid: its tracks and what sits on them. */
export interface Zone {
	rows: Extent[]
	cols: Extent[]
	units: Unit[]
}

/** A DOMRect, reduced to the four numbers this module reads. */
export interface Rect {
	left: number
	top: number
	width: number
	height: number
}

export interface Point {
	x: number
	y: number
}

/**
 * What the caller measured this frame.
 *
 * `rowLines[i]` / `colLines[i]` are where grid line `i + 1` is drawn, in the
 * same coordinate space as `box` and `pointer` (the spike uses client
 * coordinates, so an overlay positioned `fixed` needs no conversion). They
 * come from `getComputedStyle(el).gridTemplateRows`, which resolves to used
 * pixel values — the browser's own solve, not a re-implementation of it.
 *
 * `units` is optional: a unit with no measured rect is derived from the lines,
 * which is exact enough for hit-testing and keeps tests free of a DOM.
 */
export interface ZoneRects {
	box: Rect
	rowLines: number[]
	colLines: number[]
	units?: Record<string, Rect>
}

/** The share language: a grow track is read in twelfths of its zone. */
export const TWELFTHS = 12

/**
 * How far from a zone the pointer must be before the tray beats every line in
 * it. A fixed distance rather than a real one: the tray is not a place on the
 * screen the pointer approaches, it is "none of these", and the nearest line
 * inside a zone is always closer than this while the pointer is anywhere over
 * that zone's neighbourhood.
 */
export const TRAY_DISTANCE = 96

/** Where a dragged unit would land. `guide` is the line or box to draw. */
export interface DropTargetBase {
	guide: Rect
	/** Distance from the pointer; `dropTargets` returns nearest first. */
	distance: number
	/** The sentence the line shows before release (§5.1). */
	label: string
}

export type DropTarget =
	| (DropTargetBase & {
			kind: "row-gap"
			/** The 1-based row line the new row is inserted at. */
			line: number
	  })
	| (DropTargetBase & {
			kind: "unit-edge"
			unit: string
			side: "start" | "end"
			/** Twelfths each side keeps once the row is shared. */
			share: { host: number; joiner: number }
	  })
	| (DropTargetBase & { kind: "empty-cell"; row: number; col: number })
	| (DropTargetBase & { kind: "tray" })

export type DropKind = DropTarget["kind"]

export interface DropOptions {
	/** The unit being dragged: its own edges and cells are not targets. */
	dragging?: string
	/**
	 * The dragged widget's declared column share of twelve
	 * (`WidgetDecl.placement.span`, plan §2.3). Absent, a join splits the
	 * host's share equally, which is the plan's own default.
	 */
	span?: number
}

export interface DropOpts {
	/** Title for a unit arriving from another zone or from the tray. */
	title?: string
	/** The zone keeps at least this many units (the middle zone keeps one). */
	minUnits?: number
	/** How the zone is named in a refusal. */
	zoneLabel?: string
}

/** A pure op's answer: the input by reference, plus a reason, when refused. */
export interface DropResult {
	zone: Zone
	refused?: string
}

/** What a track handle did. `refused` when the extent cannot be dragged. */
export interface TrackChange {
	extent: Extent
	/** The resulting track size in pixels. */
	px: number
	/** The accessible name and the chip's text ("6 cells · 264px"). */
	label: string
	clampedTo?: "min" | "max"
	refused?: string
}

/** The adjoining widget's declared bounds, in cells (`WidgetDecl.cells`). */
export interface TrackBounds {
	minCells?: number
	maxCells?: number
}

/*
 * ---------------------------------------------------------------------------
 * Extents
 * ---------------------------------------------------------------------------
 */

export function isCells(e: Extent): e is { cells: number } {
	return typeof e === "object" && "cells" in e
}

export function isGrowShare(e: Extent): e is { grow: number } {
	return typeof e === "object" && "grow" in e
}

export function isMinMax(e: Extent): e is { min?: number; max?: number } {
	return typeof e === "object" && !isCells(e) && !isGrowShare(e)
}

/** Every grow-ish extent, bare or weighted. */
function growsWith(e: Extent): number | null {
	if (e === "grow") return TWELFTHS
	if (isGrowShare(e)) return e.grow
	return null
}

/** The CSS a track is drawn with. The browser solves; this only declares. */
export function trackCss(extent: Extent, cellPx: number): string {
	if (extent === "grow") return "minmax(0, 1fr)"
	if (extent === "fit") return "auto"
	if (isCells(extent)) return `${extent.cells * cellPx}px`
	if (isGrowShare(extent)) return `minmax(0, ${extent.grow}fr)`
	const min = extent.min ? `${extent.min * cellPx}px` : "0"
	const max = extent.max ? `${extent.max * cellPx}px` : "1fr"
	return `minmax(${min}, ${max})`
}

/** The chip's text for an extent, and the handle's accessible name. */
export function extentLabel(extent: Extent, px?: number): string {
	const size = px === undefined ? "" : ` · ${Math.round(px)}px`
	if (extent === "grow") return `grow${size}`
	if (extent === "fit") return `fit${size}`
	if (isGrowShare(extent)) return `${extent.grow} of ${TWELFTHS}${size}`
	if (isCells(extent)) return `${cells(extent.cells)}${size}`
	if (extent.min && extent.max)
		return `${extent.min}–${extent.max} cells${size}`
	if (extent.min) return `at least ${cells(extent.min)}${size}`
	if (extent.max) return `at most ${cells(extent.max)}${size}`
	return `grow${size}`
}

function cells(n: number): string {
	return n === 1 ? "1 cell" : `${n} cells`
}

/**
 * Give an extent that has no number of its own the number that is on screen.
 *
 * A bare `grow` row is however tall the browser made it; a `fit` row is its
 * content. Neither can absorb "+12 pixels", so the editor materialises the
 * extent on pointerdown and the first pixel of the drag then moves what the
 * person is looking at. Keeps `snapTrack` honest: it never has to guess a
 * current size.
 */
export function materializeExtent(
	extent: Extent,
	measuredPx: number,
	cellPx: number,
	zonePx: number
): Extent {
	if (extent === "grow") {
		const twelfth = zonePx / TWELFTHS
		const share = twelfth > 0 ? Math.round(measuredPx / twelfth) : TWELFTHS
		return { grow: clamp(share, 1, TWELFTHS) }
	}
	if (extent === "fit") {
		return { cells: Math.max(1, Math.round(measuredPx / cellPx)) }
	}
	return extent
}

/** The row chip cycles grow → fit → cells → grow (§5.1). */
export function cycleExtent(
	extent: Extent,
	measuredPx: number,
	cellPx: number
): Extent {
	if (growsWith(extent) !== null) return "fit"
	if (extent === "fit")
		return { cells: Math.max(1, Math.round(measuredPx / cellPx)) }
	return "grow"
}

/*
 * ---------------------------------------------------------------------------
 * Drop targets
 * ---------------------------------------------------------------------------
 */

const RANK: Record<DropKind, number> = {
	"row-gap": 0,
	"unit-edge": 1,
	"empty-cell": 2,
	tray: 3
}

/**
 * Every line a dragged unit could land on in this zone, nearest first.
 *
 * The caller asks each zone in turn and keeps the smallest `distance` across
 * all of them — which is the whole of cross-zone dragging, and why no zone
 * needs to know its own id here.
 */
export function dropTargets(
	zone: Zone,
	rects: ZoneRects,
	pointer: Point,
	opts: DropOptions = {}
): DropTarget[] {
	const targets: DropTarget[] = []
	const others = zone.units.filter((u) => u.key !== opts.dragging)

	// Between rows, and above the first and below the last: a new row.
	for (let i = 0; i <= zone.rows.length; i++) {
		const y = rects.rowLines[i] ?? rects.box.top
		const guide = {
			left: rects.box.left,
			top: y,
			width: rects.box.width,
			height: 0
		}
		targets.push({
			kind: "row-gap",
			line: i + 1,
			guide,
			distance: distanceToRect(pointer, guide),
			label: rowGapLabel(others, i + 1)
		})
	}

	// A unit's start or end edge: share its row.
	for (const unit of others) {
		const rect = unitRect(rects, unit)
		const total = rowShare(zone, unit)
		const joiner = clamp(
			opts.span ?? Math.floor(total / 2),
			1,
			Math.max(1, total - 1)
		)
		const share = { host: total - joiner, joiner }
		for (const side of ["start", "end"] as const) {
			const guide = {
				left: side === "start" ? rect.left : rect.left + rect.width,
				top: rect.top,
				width: 0,
				height: rect.height
			}
			targets.push({
				kind: "unit-edge",
				unit: unit.key,
				side,
				share,
				guide,
				distance: distanceToRect(pointer, guide),
				label: `Beside ${nameOf(unit)} · ${joiner} of ${TWELFTHS}`
			})
		}
	}

	// A track cell nothing covers: place it there.
	const covered = coverage(others)
	for (let row = 1; row <= zone.rows.length; row++) {
		for (let col = 1; col <= zone.cols.length; col++) {
			if (covered.has(cellId(row, col))) continue
			const guide = cellRect(rects, row, col)
			targets.push({
				kind: "empty-cell",
				row,
				col,
				guide,
				distance: distanceToRect(pointer, guide),
				label:
					zone.cols.length > 1
						? `Place in row ${row}, column ${col}`
						: `Place in row ${row}`
			})
		}
	}

	// Outside the zone: the tray.
	if (distanceToRect(pointer, rects.box) > 0) {
		targets.push({
			kind: "tray",
			guide: { left: pointer.x, top: pointer.y, width: 0, height: 0 },
			distance: TRAY_DISTANCE,
			label: "Remove from the layout"
		})
	}

	return targets.sort(
		(a, b) => a.distance - b.distance || RANK[a.kind] - RANK[b.kind]
	)
}

function rowGapLabel(units: Unit[], line: number): string {
	const above = units.find((u) => u.row.start + u.row.span === line)
	const below = units.find((u) => u.row.start === line)
	if (above && below)
		return `New row between ${nameOf(above)} and ${nameOf(below)} · fit`
	if (below) return `New row above ${nameOf(below)} · fit`
	if (above) return `New row below ${nameOf(above)} · fit`
	return "New row · fit"
}

/*
 * ---------------------------------------------------------------------------
 * Applying a drop
 * ---------------------------------------------------------------------------
 */

/**
 * The zone a drop would produce — or the zone unchanged, and why.
 *
 * Refusals are the interesting half: a layout op that "mostly works" leaves a
 * document that renders wrong, so every result is validated against the zone's
 * own track counts and overlap before it is returned (plan §2.6).
 *
 * A `key` that is not already in the zone is an arrival from another zone or
 * from the tray; the caller removes it from its source with a `tray` drop on
 * that zone, and commits both only if neither refuses.
 */
export function applyDrop(
	zone: Zone,
	target: DropTarget,
	key: string,
	opts: DropOpts = {}
): DropResult {
	const existing = zone.units.find((u) => u.key === key)
	const rest = zone.units.filter((u) => u.key !== key)
	const title = existing?.title ?? opts.title
	const named = opts.zoneLabel ?? "This zone"

	if (target.kind === "tray") {
		if (!existing) return { zone }
		if (rest.length < (opts.minUnits ?? 0))
			return { zone, refused: `${named} keeps at least one widget.` }
		return { zone: tidy({ ...zone, units: rest }) }
	}

	if (target.kind === "row-gap") {
		const line = target.line
		if (line < 1 || line > zone.rows.length + 1)
			return { zone, refused: "That row is no longer there." }
		const rows = [...zone.rows]
		rows.splice(line - 1, 0, "fit")
		const units = rest.map((u) => ({ ...u, row: openRow(u.row, line) }))
		units.push({
			key,
			title,
			row: { start: line, span: 1 },
			col: { start: 1, span: zone.cols.length }
		})
		return settle(zone, { ...zone, rows, units }, named)
	}

	if (target.kind === "unit-edge") {
		const host = rest.find((u) => u.key === target.unit)
		if (!host) return { zone, refused: "That widget has moved." }
		const first = host.col.start
		const last = host.col.start + host.col.span - 1
		const total = rowShare(zone, host)
		if (total < 2)
			return {
				zone,
				refused: `${nameOf(host)} is already as narrow as it goes.`
			}
		const joiner = clamp(target.share.joiner, 1, total - 1)
		const [a, b] =
			target.side === "start"
				? [joiner, total - joiner]
				: [total - joiner, joiner]

		// The host's column range becomes exactly two tracks. Every other
		// unit's column LINES are mapped through the same replacement, so a
		// full-width neighbour stays full width and a unit after the split
		// keeps the tracks it had.
		const cols = [
			...zone.cols.slice(0, first - 1),
			{ grow: a },
			{ grow: b },
			...zone.cols.slice(last)
		]
		const delta = 2 - host.col.span
		const mapLine = (line: number) =>
			line <= first ? line : line >= last + 1 ? line + delta : first + 1
		const units = rest.map((u) => {
			if (u.key === host.key) return u
			const start = mapLine(u.col.start)
			const end = mapLine(u.col.start + u.col.span)
			return { ...u, col: { start, span: Math.max(1, end - start) } }
		})
		const hostCol = target.side === "start" ? first + 1 : first
		const joinCol = target.side === "start" ? first : first + 1
		const placed = units.map((u) =>
			u.key === host.key ? { ...u, col: { start: hostCol, span: 1 } } : u
		)
		placed.push({
			key,
			title,
			row: { ...host.row },
			col: { start: joinCol, span: 1 }
		})
		return settle(zone, { ...zone, cols, units: placed }, named)
	}

	const units = [
		...rest,
		{
			key,
			title,
			row: { start: target.row, span: 1 },
			col: { start: target.col, span: 1 }
		}
	]
	return settle(zone, { ...zone, units }, named)
}

/** A unit's row range once a new row opens at `line`. */
function openRow(
	row: { start: number; span: number },
	line: number
): { start: number; span: number } {
	if (row.start >= line) return { start: row.start + 1, span: row.span }
	if (row.start + row.span > line)
		return { start: row.start, span: row.span + 1 }
	return row
}

/** Validate, then tidy. The input is returned by reference when refused. */
function settle(input: Zone, next: Zone, named: string): DropResult {
	for (const u of next.units) {
		if (u.row.start < 1 || u.row.start + u.row.span - 1 > next.rows.length)
			return {
				zone: input,
				refused: `${nameOf(u)} does not fit in ${named.toLowerCase()}.`
			}
		if (u.col.start < 1 || u.col.start + u.col.span - 1 > next.cols.length)
			return {
				zone: input,
				refused: `${nameOf(u)} does not fit in ${named.toLowerCase()}.`
			}
	}
	const clash = firstOverlap(next.units)
	if (clash)
		return {
			zone: input,
			refused: `${nameOf(clash[0])} would overlap ${nameOf(clash[1])}.`
		}
	return { zone: tidy(next) }
}

/**
 * Drop the tracks nothing is on any more.
 *
 * A move leaves the row it came from empty; a `fit` row collapses to nothing
 * but a `grow` one keeps its share of the zone, so the hole is visible. Rows
 * go when no unit covers them; columns go only when the split they were made
 * for is gone entirely — every unit spanning the whole width means nobody is
 * using the division.
 */
function tidy(zone: Zone): Zone {
	let { rows, cols, units } = zone

	const usedRows = new Set<number>()
	for (const u of units)
		for (let r = u.row.start; r < u.row.start + u.row.span; r++)
			usedRows.add(r)
	if (usedRows.size && usedRows.size < rows.length) {
		const keep = rows.map((_, i) => usedRows.has(i + 1))
		const line = lineMap(keep)
		rows = rows.filter((_, i) => keep[i])
		units = units.map((u) => {
			const start = line[u.row.start]
			const end = line[u.row.start + u.row.span]
			return { ...u, row: { start, span: Math.max(1, end - start) } }
		})
	}

	// A unit left alone in its row band reclaims the width: a column split
	// only ever exists because two units share a row, so when one of them
	// leaves the other should not be left beside a hole. The inverse of the
	// join gesture, and the only way a unit's span shrinks in the first place.
	units = units.map((u) =>
		units.some((o) => o.key !== u.key && sharesRows(o, u))
			? u
			: { ...u, col: { start: 1, span: cols.length } }
	)

	const full = units.every(
		(u) => u.col.start === 1 && u.col.span === cols.length
	)
	if (cols.length > 1 && full) {
		cols = ["grow"]
		units = units.map((u) => ({ ...u, col: { start: 1, span: 1 } }))
	}

	return { rows, cols, units }
}

/** Old grid line → new grid line, when `keep[i]` says which tracks survive. */
function lineMap(keep: boolean[]): number[] {
	const map: number[] = []
	let next = 1
	for (let i = 0; i <= keep.length; i++) {
		map[i + 1] = next
		if (keep[i]) next++
	}
	return map
}

function sharesRows(a: Unit, b: Unit): boolean {
	return (
		a.row.start < b.row.start + b.row.span &&
		b.row.start < a.row.start + a.row.span
	)
}

function firstOverlap(units: Unit[]): [Unit, Unit] | null {
	for (let i = 0; i < units.length; i++)
		for (let j = i + 1; j < units.length; j++) {
			const a = units[i]
			const b = units[j]
			const rows =
				a.row.start < b.row.start + b.row.span &&
				b.row.start < a.row.start + a.row.span
			const cols =
				a.col.start < b.col.start + b.col.span &&
				b.col.start < a.col.start + a.col.span
			if (rows && cols) return [a, b]
		}
	return null
}

/*
 * ---------------------------------------------------------------------------
 * Track handles
 * ---------------------------------------------------------------------------
 */

/**
 * The extent a dragged track handle lands on.
 *
 * Two units, one gesture: a grow track snaps in twelfths of its zone, because
 * that is the language its share is written in, and a fixed track snaps to the
 * cell module, because that is what "6 cells" means. `bounds` is the adjoining
 * widget's declared minimum and maximum in cells — the drag stops there rather
 * than producing a layout `resolve` would have to fold (§5.1).
 *
 * `extent` must already carry a number: a bare `grow` or a `fit` has no size
 * of its own, so the editor calls `materializeExtent` on pointerdown.
 */
export function snapTrack(
	extent: Extent,
	deltaPx: number,
	cellPx: number,
	zonePx: number,
	bounds: TrackBounds = {}
): TrackChange {
	if (extent === "fit")
		return {
			extent,
			px: 0,
			label: "fit",
			refused: "A fit track is sized by its content."
		}

	const share = growsWith(extent)
	if (share !== null) {
		const twelfth = zonePx > 0 ? zonePx / TWELFTHS : cellPx
		const lo = bounds.minCells
			? clamp(
					Math.ceil((bounds.minCells * cellPx) / twelfth),
					1,
					TWELFTHS
				)
			: 1
		const hi = bounds.maxCells
			? clamp(
					Math.floor((bounds.maxCells * cellPx) / twelfth),
					lo,
					TWELFTHS
				)
			: TWELFTHS
		const wanted = Math.round((share * twelfth + deltaPx) / twelfth)
		const next = clamp(wanted, lo, hi)
		const px = next * twelfth
		return {
			extent: { grow: next },
			px,
			label: extentLabel({ grow: next }, px),
			clampedTo: clampedTo(wanted, lo, hi)
		}
	}

	// Everything grow-ish returned above; what is left is measured in cells.
	// Narrowed by hand because the guard was a function call, not a predicate.
	const fixed = extent as { cells: number } | { min?: number; max?: number }
	const current = isCells(fixed) ? fixed.cells : (fixed.min ?? 1)
	const lo = bounds.minCells ?? 1
	const hi = Math.max(
		lo,
		bounds.maxCells ?? Math.max(1, Math.floor(zonePx / cellPx))
	)
	const wanted = Math.round((current * cellPx + deltaPx) / cellPx)
	const next = clamp(wanted, lo, hi)
	const px = next * cellPx
	const result: Extent = isCells(fixed)
		? { cells: next }
		: { ...fixed, min: next }
	return {
		extent: result,
		px,
		label: extentLabel(result, px),
		clampedTo: clampedTo(wanted, lo, hi)
	}
}

/**
 * Keyboard parity: one cell, or one twelfth, in `dir`.
 *
 * Delegated to `snapTrack` rather than written twice — a handle that resizes
 * differently under the arrow keys than under the pointer is the bug this
 * exists to not have. Home and End are the same call with a delta past the
 * bounds, which clamp.
 */
export function nudgeTrack(
	extent: Extent,
	dir: -1 | 1,
	cellPx: number,
	zonePx: number,
	bounds: TrackBounds = {}
): TrackChange {
	const step =
		growsWith(extent) !== null && zonePx > 0 ? zonePx / TWELFTHS : cellPx
	return snapTrack(extent, dir * step, cellPx, zonePx, bounds)
}

/*
 * ---------------------------------------------------------------------------
 * Small shared arithmetic
 * ---------------------------------------------------------------------------
 */

export function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n))
}

function clampedTo(
	wanted: number,
	lo: number,
	hi: number
): "min" | "max" | undefined {
	if (wanted < lo) return "min"
	if (wanted > hi) return "max"
	return undefined
}

export function nameOf(unit: Unit): string {
	return unit.title ?? unit.key
}

/**
 * Each column track's share of the zone, in twelfths.
 *
 * Bare `grow` tracks divide what the weighted ones have not claimed; `fit` and
 * `cells` tracks take their size from elsewhere and so hold no share. An
 * approximation on a mixed grid, and deliberately so: shares are what the
 * editor's sentences are written in, not what the browser lays out with.
 */
export function growShares(cols: Extent[]): number[] {
	const declared = cols.map((c) =>
		c === "grow" ? null : (growsWith(c) ?? 0)
	)
	const claimed = declared.reduce<number>((sum, v) => sum + (v ?? 0), 0)
	const bare = declared.filter((v) => v === null).length
	const each = bare ? Math.max(1, Math.floor((TWELFTHS - claimed) / bare)) : 0
	return declared.map((v) => (v === null ? each : v))
}

/** The twelfths a unit's column range covers. */
function rowShare(zone: Zone, unit: Unit): number {
	const shares = growShares(zone.cols)
	let total = 0
	for (let c = unit.col.start; c < unit.col.start + unit.col.span; c++)
		total += shares[c - 1] ?? 0
	return total
}

function distanceToRect(p: Point, r: Rect): number {
	const dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width))
	const dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height))
	return Math.hypot(dx, dy)
}

function cellId(row: number, col: number): string {
	return `${row}:${col}`
}

function coverage(units: Unit[]): Set<string> {
	const covered = new Set<string>()
	for (const u of units)
		for (let r = u.row.start; r < u.row.start + u.row.span; r++)
			for (let c = u.col.start; c < u.col.start + u.col.span; c++)
				covered.add(cellId(r, c))
	return covered
}

/** A cell's box, from the measured lines. */
export function cellRect(
	rects: ZoneRects,
	row: number,
	col: number,
	rowSpan = 1,
	colSpan = 1
): Rect {
	const top = rects.rowLines[row - 1] ?? rects.box.top
	const bottom =
		rects.rowLines[row - 1 + rowSpan] ?? rects.box.top + rects.box.height
	const left = rects.colLines[col - 1] ?? rects.box.left
	const right =
		rects.colLines[col - 1 + colSpan] ?? rects.box.left + rects.box.width
	return { left, top, width: right - left, height: bottom - top }
}

function unitRect(rects: ZoneRects, unit: Unit): Rect {
	return (
		rects.units?.[unit.key] ??
		cellRect(
			rects,
			unit.row.start,
			unit.col.start,
			unit.row.span,
			unit.col.span
		)
	)
}
