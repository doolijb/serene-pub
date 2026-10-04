/**
 * A layout preset's PICTURE (PLAN 25 redesign, 2026-08-30).
 *
 * The Presets tab shows each preset as a small schematic — three columns and
 * the blocks that sit in them — never as a live mount. That is a deliberate
 * limit, not a shortcut: mounting a second copy of the real widgets to preview
 * them would run their sockets, reload their frames, and double every panel's
 * state for the duration of a hover.
 *
 * So this is a pure blob → geometry translation with no DOM and no component
 * behind it, which also makes the one piece of Presets-tab logic worth testing
 * the piece that IS tested — the tab's own markup stays a thin renderer.
 *
 * Input is an untrusted preset `layout` blob (`{ zoneLayout?, widgetGrid?,
 * arrangedGrid? }`, stored verbatim, forward-compatible). Anything malformed
 * degrades to the built-in default picture rather than throwing, and a widget
 * id this build has retired draws no block — the picture has to show what the
 * preset will actually produce.
 */
import type { ZoneId } from "@serene-pub/sdk"
import { isRetiredWidget } from "./widgetGrid"

export interface PreviewCell {
	id: string
	label: string
	x: number
	y: number
	w: number
	h: number
}

export interface PreviewZone {
	cols: number
	rows: number
	cells: PreviewCell[]
}

export interface LayoutPreview {
	left: PreviewZone
	middle: PreviewZone
	right: PreviewZone
}

/** The schematic's grid — small enough to read at thumbnail size. */
const ROWS = 6
const SIDE_COLS = 1

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v)
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

/** The chat middle as it renders with nothing saved: the conversation, filling it. */
function defaultMiddle(label: (id: string) => string): PreviewZone {
	return {
		cols: 1,
		rows: ROWS,
		cells: [
			{
				id: "messages",
				label: label("messages"),
				x: 0,
				y: 0,
				w: 1,
				h: ROWS
			}
		]
	}
}

/** An arranged zone (the editor's captured geometry) read defensively. */
function fromArranged(
	raw: unknown,
	label: (id: string) => string
): PreviewZone | null {
	if (!isPlainObject(raw)) return null
	const items = raw.items
	if (!Array.isArray(items)) return null
	const cells: PreviewCell[] = []
	for (const it of items) {
		if (!isPlainObject(it) || typeof it.id !== "string") continue
		if (isRetiredWidget(it.id)) continue
		cells.push({
			id: it.id,
			label: label(it.id),
			x: num(it.x, 0),
			y: num(it.y, cells.length),
			w: Math.max(1, num(it.w, 1)),
			h: Math.max(1, num(it.h, 1))
		})
	}
	if (!cells.length) return null
	// Size the frame to whatever it actually has to hold, so a preset arranged
	// on a wider grid is not clipped by the schematic's own defaults.
	const cols = Math.max(num(raw.cols, 1), ...cells.map((c) => c.x + c.w))
	const rows = Math.max(num(raw.rows, ROWS), ...cells.map((c) => c.y + c.h))
	return { cols, rows, cells }
}

/** A side zone's widget list, stacked full-width top to bottom. */
function fromZoneList(
	widgets: unknown,
	label: (id: string) => string
): PreviewZone {
	const ids = Array.isArray(widgets)
		? widgets.filter(
				(w): w is string =>
					typeof w === "string" && !isRetiredWidget(w)
			)
		: []
	return {
		cols: SIDE_COLS,
		rows: ROWS,
		cells: ids.map((id, i) => ({
			id,
			label: label(id),
			x: 0,
			y: i,
			w: SIDE_COLS,
			h: 1
		}))
	}
}

/** The side zone a `zoneLayout` declares for this edge, if any. */
function sideWidgets(zoneLayout: unknown, side: "left" | "right"): unknown {
	if (!isPlainObject(zoneLayout)) return undefined
	const zones = zoneLayout.zones
	if (!isPlainObject(zones)) return undefined
	for (const def of Object.values(zones)) {
		if (!isPlainObject(def)) continue
		if (def.kind === "strip") continue
		// `side` defaults to right, matching the live resolver's split.
		const edge = def.side === "left" ? "left" : "right"
		if (edge === side) return def.widgets
	}
	return undefined
}

/**
 * Turn a preset's stored layout into the three-column picture the tab draws.
 *
 * `arrangedGrid` wins where it exists — it is the editor's own captured
 * geometry, so the picture matches what the preset will actually produce.
 * Otherwise the side zones fall back to their declared widget lists and the
 * middle to the built-in chat arrangement, which is exactly what an empty
 * preset (the shipped per-genre default) renders.
 */
export function previewOf(
	layout: unknown,
	labelOf: (id: string) => string = (id) => id
): LayoutPreview {
	const blob = isPlainObject(layout) ? layout : {}
	const arranged = isPlainObject(blob.arrangedGrid) ? blob.arrangedGrid : {}
	const zoneLayout = blob.zoneLayout

	const zone = (key: ZoneId): PreviewZone => {
		const fromEditor = fromArranged(arranged[key], labelOf)
		if (fromEditor) return fromEditor
		if (key === "middle") return defaultMiddle(labelOf)
		return fromZoneList(sideWidgets(zoneLayout, key), labelOf)
	}

	return { left: zone("left"), middle: zone("middle"), right: zone("right") }
}
