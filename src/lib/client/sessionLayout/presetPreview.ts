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
 * Input is an untrusted preset layout, stored verbatim and forward-compatible.
 * It is read the way the page reads its own (C5, one layout reader): repaired
 * and floored (./primaryFloor `readStoredLayout`), then drawn by the SDK's
 * `resolveDrawn` — so which slot draws a zone, a retired widget drawing no
 * block, and the conversation the floor puts back are the page's answers,
 * never a second reading of the blob. Anything malformed degrades to the
 * picture of a layout that saved nothing — the conversation, filling the
 * middle — rather than throwing.
 */
import type { DrawnZone } from "@serene-pub/sdk"
import { drawnOf, readStoredLayout } from "./primaryFloor"

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

/** A zone drawn from its arrangement: the arranged cells, in that grid. */
function fromArrangement(
	z: DrawnZone,
	label: (id: string) => string
): PreviewZone {
	const cells: PreviewCell[] = z.instances.flatMap((i) =>
		i.cells ? [{ id: i.instanceId, label: label(i.instanceId), ...i.cells }] : []
	)
	return {
		cols: Math.max(1, z.arrangement?.cols ?? 1),
		rows: Math.max(1, z.arrangement?.rows ?? ROWS),
		cells
	}
}

/**
 * A zone drawn from a list — a side's zone lists, or the middle's grid — as a
 * stack, full width, top to bottom. A row each; in the middle a widget that
 * GROWS takes what the content-sized ones leave (the conversation under the
 * Adventure strip), shared when more than one grows.
 */
function fromList(z: DrawnZone, label: (id: string) => string): PreviewZone {
	const rows = Math.max(ROWS, z.instances.length)
	const grows = z.instances.map((i) => i.size?.h === "grow")
	const growing = grows.filter(Boolean).length
	const spare = rows - (z.instances.length - growing)
	let y = 0
	const cells = z.instances.map((i, n) => {
		const h = grows[n]
			? Math.floor(spare / growing) +
				(n === grows.lastIndexOf(true) ? spare % growing : 0)
			: 1
		const cell = { id: i.instanceId, label: label(i.instanceId), x: 0, y, w: SIDE_COLS, h }
		y += h
		return cell
	})
	return { cols: SIDE_COLS, rows, cells }
}

/**
 * Turn a preset's stored layout into the three-column picture the tab draws:
 * each zone as `resolveDrawn` says it is drawn — its arrangement where that
 * wins, else its list — after the page's own repair and primary floor.
 * `primaryId` is the genre's primary widget (the conversation unless an R71
 * genre withholds it), which the floor keeps on the picture as on the page.
 */
export function previewOf(
	layout: unknown,
	labelOf: (id: string) => string = (id) => id,
	primaryId = "messages"
): LayoutPreview {
	const drawn = drawnOf(readStoredLayout(layout, primaryId))
	const zone = (z: DrawnZone): PreviewZone =>
		z.drawnFrom === "arrangement" ? fromArrangement(z, labelOf) : fromList(z, labelOf)
	return { left: zone(drawn.left), middle: zone(drawn.middle), right: zone(drawn.right) }
}
