/**
 * The layout engine (plan 21 §5): a pure, deterministic function from
 *   (tier, panels, ...) → placement map.
 *
 * Rules, in order:
 *   1. The **primary** panel is placed first and spans the full grid height. It
 *      is never sent to the drawer — the anchor guarantee.
 *   2. A secondary panel goes to the drawer if the user pinned it there
 *      (`drawered`), or if there is simply no room for it at this tier.
 *   3. Remaining secondaries fill the columns to the right of primary,
 *      left-to-right then top-to-bottom, honoring each panel's column span
 *      (clamped to the available secondary width).
 *
 * No side effects, no DOM, no time — unit-tested in isolation. The grid
 * component turns this map into CSS `grid-column`/`grid-row` vars; nothing here
 * knows or cares whether a panel is native or a frame.
 */
import {
	TRACKS,
	type PackResult,
	type PanelInstance,
	type PanelPlacement,
	type Tier
} from "./types"

/**
 * Choose how many columns the primary panel occupies at a tier. Grows with room
 * so the conversation stays prominent on wide screens, but always leaves at
 * least one secondary column when secondary panels want the grid.
 */
function primarySpanFor(
	tier: Tier,
	tracks: number,
	primary: PanelInstance | undefined,
	hasGridSecondaries: boolean
): number {
	if (!primary) return 0
	// Alone on the grid, the conversation fills the whole width — no empty
	// tracks beside it.
	if (!hasGridSecondaries) return tracks
	// The conversation stays prominent: one column, plus one extra at `wide`.
	// This `auto` is a floor, so a primary keeps its prominence unless it
	// explicitly asks for even more room.
	const auto = tier === "wide" ? 2 : 1
	let span = Math.min(Math.max(auto, primary.layout.span.ideal), tracks)
	if (span < 1) span = 1
	// Never starve the secondary region when something wants it.
	if (span >= tracks) span = tracks - 1
	return Math.max(1, span)
}

export function pack(tier: Tier, panels: PanelInstance[]): PackResult {
	const tracks = TRACKS[tier]
	const placements = new Map<string, PanelPlacement>()
	const drawerIds: string[] = []

	const active = panels.filter((p) => p.active)
	const primary = active.find((p) => p.role === "primary")

	// Ordered secondaries (stable: order, then id).
	const secondaries = active
		.filter((p) => p.role !== "primary")
		.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))

	// Which secondaries even want the grid (vs pinned to the drawer)?
	const gridWanting = secondaries.filter((p) => !p.drawered)
	const primarySpan = primarySpanFor(
		tier,
		tracks,
		primary,
		gridWanting.length > 0
	)
	const secWidth = Math.max(0, tracks - primarySpan)

	// Lay secondaries into a `secWidth`-wide sub-grid, row by row.
	let cursorCol = 0 // 0-based within the secondary region
	let cursorRow = 0
	let maxRow = 0
	const drawered: PanelInstance[] = []

	for (const p of secondaries) {
		if (p.drawered || secWidth === 0) {
			drawered.push(p)
			continue
		}
		let span = Math.min(
			Math.max(p.layout.span.min, p.layout.span.ideal),
			secWidth
		)
		if (span < 1) span = 1
		// Wrap to the next row if this panel won't fit on the current one.
		if (cursorCol + span > secWidth) {
			cursorCol = 0
			cursorRow += 1
		}
		placements.set(p.id, {
			id: p.id,
			location: "grid",
			col: primarySpan + cursorCol + 1, // 1-based, right of primary
			colSpan: span,
			rowStart: cursorRow + 1,
			rowSpan: 1,
			drawerOrder: 0
		})
		cursorCol += span
		maxRow = Math.max(maxRow, cursorRow)
	}

	const rows = Math.max(1, maxRow + 1)

	// Primary spans the whole height, the leftmost `primarySpan` columns.
	if (primary) {
		placements.set(primary.id, {
			id: primary.id,
			location: "grid",
			col: 1,
			colSpan: primarySpan,
			rowStart: 1,
			rowSpan: rows,
			drawerOrder: 0
		})
	}

	// Drawer, in stable order.
	drawered.forEach((p, i) => {
		placements.set(p.id, {
			id: p.id,
			location: "drawer",
			col: 0,
			colSpan: 0,
			rowStart: 0,
			rowSpan: 0,
			drawerOrder: i
		})
		drawerIds.push(p.id)
	})

	return { tier, tracks, rows, placements, drawerIds }
}
