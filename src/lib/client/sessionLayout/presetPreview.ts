/**
 * A layout preset's PICTURE (PLAN 25 redesign, 2026-08-30).
 *
 * The Layouts tab shows each preset as a small schematic — three columns and
 * the boxes that sit in them — never as a live mount. That is a deliberate
 * limit, not a shortcut: mounting a second copy of the real widgets to preview
 * them would run their sockets, reload their frames, and double every panel's
 * state for the duration of a hover.
 *
 * So this is a pure blob → geometry translation with no DOM and no component
 * behind it, which also makes the one piece of Presets-tab logic worth testing
 * the piece that IS tested — the tab's own markup stays a thin renderer.
 *
 * Input is an untrusted preset layout, stored verbatim and forward-compatible.
 * It is read the way the page reads its own (C5, one layout reader): as
 * panels (./primaryFloor `readStoredLayout`: the floor only for a blob with
 * no stored `panels`), then drawn by the SDK's `resolveDrawn` — so a retired
 * widget drawing nothing, and a layout holding no conversation drawn as it
 * is, are the page's answers, never a second reading of the
 * blob. Anything malformed degrades to the picture of a layout that saved
 * nothing — the conversation, filling the middle — rather than throwing.
 *
 * Each zone is its PANELS stacked top to bottom (PLAN-session-panels
 * 2026-10-14), each box as tall as its height says: a `{ share }` its
 * twelfths, `fit` and a panel in the rail a small box, `fill` (and the
 * middle's primary panel) an equal share of what is left. A panel holding
 * more than one tab says how many (`tabs`).
 */
import type { DrawnPanel } from "@serene-pub/sdk"
import { drawnOf, readStoredLayout } from "./primaryFloor"

export interface PreviewCell {
	/** The panel's first tab — an instance is in one panel, so it names the box. */
	id: string
	/** The panel's key. */
	key: string
	/** Its tabs' titles, in order. */
	label: string
	x: number
	y: number
	w: number
	h: number
	/** How many tabs the panel holds. */
	tabs: number
	/** A side panel in the rail (not docked). */
	rail: boolean
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

/** The schematic's rows — twelve, so a `{ share }` is its own number of rows. */
const ROWS = 12
/** A content-sized box (`fit`, or a panel in the rail). */
const SMALL = 2

/** A zone's panels as a stack, full width, top to bottom. */
function stackOf(
	panels: readonly DrawnPanel[],
	label: (id: string) => string,
	fills: (p: DrawnPanel) => boolean
): PreviewZone {
	const fixed = panels.map((p) => {
		if (fills(p)) return null
		if (!p.pinned) return SMALL
		const h = p.height
		if (typeof h === "object") return Math.min(ROWS, Math.max(1, h.share))
		return h === "fit" ? SMALL : null
	})
	const growing = fixed.filter((f) => f === null).length
	const taken = fixed.reduce<number>((n, f) => n + (f ?? 0), 0)
	const spare = Math.max(growing, ROWS - taken)
	const rows = Math.max(ROWS, taken + growing)
	const last = fixed.lastIndexOf(null)
	let y = 0
	const cells = panels.map((p, n): PreviewCell => {
		const h =
			fixed[n] ??
			Math.floor(spare / growing) + (n === last ? spare % growing : 0)
		const cell: PreviewCell = {
			id: p.tabs[0]?.instanceId ?? p.key,
			key: p.key,
			label: p.tabs.map((t) => label(t.instanceId)).join(" · "),
			x: 0,
			y,
			w: 1,
			h,
			tabs: p.tabs.length,
			rail: !p.pinned
		}
		y += h
		return cell
	})
	return { cols: 1, rows: cells.length ? rows : ROWS, cells }
}

/**
 * Turn a preset's stored layout into the three-column picture the tab draws:
 * each zone's panels as `resolveDrawn` draws them, after the page's own
 * reading. `primaryId` is the genre's primary widget (the conversation
 * unless an R71 genre withholds it), which the floor puts in a converted
 * blob's middle on the picture as on the page.
 */
export function previewOf(
	layout: unknown,
	labelOf: (id: string) => string = (id) => id,
	primaryId = "messages"
): LayoutPreview {
	const drawn = drawnOf(readStoredLayout(layout, primaryId))
	const side = (panels: readonly DrawnPanel[]) =>
		stackOf(panels, labelOf, () => false)
	const primary = drawn.middle.primary
	return {
		left: side(drawn.left.panels),
		middle: stackOf(
			[...drawn.middle.above, primary, ...drawn.middle.below].filter(
				(p) => p.tabs.length > 0
			),
			labelOf,
			(p) => p === primary
		),
		right: side(drawn.right.panels)
	}
}
