/**
 * Geometry for narrative-graph edges.
 *
 * Extracted from GraphVisualization.svelte so it can be tested: it is pure
 * number-in/number-out, and it carried a bug that was invisible to reading and
 * only showed up as unreadable overlapping text on screen.
 */

export const NODE_RADIUS = 22
/** Perpendicular gap between parallel edges joining the same pair. */
export const CURVE_SPACING = 38

export interface EdgeEndpoint {
	id: number
	x: number
	y: number
}

export interface EdgeGeometry {
	/** SVG path data for a quadratic curve between the two nodes. */
	d: string
	labelX: number
	labelY: number
}

/**
 * Key used to bundle parallel edges. UNORDERED, so that A→B and B→A share one
 * bundle and fan out around each other instead of stacking.
 */
export function edgeBundleKey(sourceId: number, targetId: number): string {
	return Math.min(sourceId, targetId) + "-" + Math.max(sourceId, targetId)
}

/**
 * One edge of a bundle, as a curve plus the point its label sits on.
 *
 * `idx` is this edge's position within its bundle and `total` the bundle size;
 * together they fan the curves symmetrically about the straight chord.
 *
 * The perpendicular is taken along a CANONICAL direction — low id to high id —
 * rather than along source → target. That is the whole subtlety: bundling is
 * keyed on the unordered pair, so a reversed edge correctly gets a different
 * `idx` and therefore a mirrored `offset`; but deriving the perpendicular from
 * source → target ALSO flips its sign, and a mirrored offset against a flipped
 * perpendicular resolves to exactly the same control point. A→B and B→A landed
 * on top of each other with their labels at identical coordinates. Anchoring
 * the perpendicular to node id makes the fan direction a property of the pair,
 * not of the direction an edge happens to point.
 */
export function edgePath(
	src: EdgeEndpoint,
	tgt: EdgeEndpoint,
	idx: number,
	total: number
): EdgeGeometry {
	const offset = (idx - (total - 1) / 2) * CURVE_SPACING
	const midX = (src.x + tgt.x) / 2
	const midY = (src.y + tgt.y) / 2
	const flip = src.id > tgt.id ? -1 : 1
	const dx = tgt.x - src.x
	const dy = tgt.y - src.y
	const len = Math.sqrt(dx * dx + dy * dy) || 1
	const px = (-dy / len) * flip
	const py = (dx / len) * flip
	const cx = midX + px * offset
	const cy = midY + py * offset

	// Trim both ends back to the node rim so the curve meets the circle rather
	// than its centre, aiming each end at the control point.
	const stDx = cx - src.x
	const stDy = cy - src.y
	const stLen = Math.sqrt(stDx * stDx + stDy * stDy) || 1
	const x1 = src.x + (stDx / stLen) * NODE_RADIUS
	const y1 = src.y + (stDy / stLen) * NODE_RADIUS
	const etDx = tgt.x - cx
	const etDy = tgt.y - cy
	const etLen = Math.sqrt(etDx * etDx + etDy * etDy) || 1
	const x2 = tgt.x - (etDx / etLen) * NODE_RADIUS
	const y2 = tgt.y - (etDy / etLen) * NODE_RADIUS

	// Midpoint of the quadratic, i.e. B(0.5) = ¼P₀ + ½C + ¼P₂. Note this sits
	// only HALF as far off the chord as the control point does, so labels
	// separate by `offset`, not `2 × offset`.
	const labelX = 0.25 * x1 + 0.5 * cx + 0.25 * x2
	const labelY = 0.25 * y1 + 0.5 * cy + 0.25 * y2
	return { d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, labelX, labelY }
}

// ─── Zoomed-out aggregation ──────────────────────────────────────────────────

export interface AggregatableEdge {
	source: number
	target: number
	status?: string | null
}

export interface AggregatedEdge {
	source: number
	target: number
	/** Relationships in this direction that are still standing — see isLiveStatus. */
	liveCount: number
	/** All relationships in this direction, whatever their status. */
	totalCount: number
}

/**
 * Statuses that mean a relationship is OVER.
 *
 * The four statuses are active | resolved | broken | evolved, and only two of
 * them end anything: `evolved` means the dynamic changed, not that it stopped,
 * so an evolved relationship is still standing between those two characters.
 *
 * Counting `status === "active"` instead of this is a bug that was shipped
 * once: real graphs are full of `evolved` edges, so pairs with plenty of live
 * history rendered as a dotted line with no count at all.
 */
const CONCLUDED_STATUSES = new Set(["resolved", "broken"])

/**
 * Anything not explicitly concluded counts as live, INCLUDING an unrecognised
 * or missing status. That direction is deliberate: a status this code has not
 * been taught about should show up as a connection, not silently disappear
 * from the overview, which is exactly how the `evolved` case went unnoticed.
 */
export function isLiveStatus(status?: string | null): boolean {
	return !CONCLUDED_STATUSES.has(status ?? "")
}

/**
 * Collapse every relationship into ONE edge per direction.
 *
 * A pair that holds six dynamics draws six curves, and at low zoom that is
 * noise — six labels no reader can separate, over a shape that already says
 * everything the overview needs: these two are connected, and heavily. So
 * zoomed out the graph shows one arrow each way carrying a count, and the
 * individual types are recovered by zooming in or focusing a node.
 *
 * Direction is preserved (source → target is NOT canonicalised here, unlike
 * the bundling key) because "Maren holds four things about Corb" and "Corb
 * holds one about Maren" are different facts and the asymmetry is the
 * interesting part.
 *
 * `liveCount` drives what is displayed; `totalCount` is kept so a pair whose
 * relationships have all concluded still renders as a connection that existed
 * rather than silently vanishing from the overview.
 */
export function aggregateEdgesByDirection<T extends AggregatableEdge>(
	edges: T[]
): AggregatedEdge[] {
	const byDirection = new Map<string, AggregatedEdge>()
	for (const e of edges) {
		const key = `${e.source}->${e.target}`
		let agg = byDirection.get(key)
		if (!agg) {
			agg = {
				source: e.source,
				target: e.target,
				liveCount: 0,
				totalCount: 0
			}
			byDirection.set(key, agg)
		}
		agg.totalCount++
		if (isLiveStatus(e.status)) agg.liveCount++
	}
	return [...byDirection.values()]
}

/**
 * Skeleton theme colour for an aggregated edge, ramped by how many active
 * relationships it carries.
 *
 * Deliberately a plain ordered list so the ramp can be re-ordered to taste in
 * one place. It reads as intensity — how much is going on between these two —
 * and NOT as judgement: `error` at the top means "a great deal", not "bad".
 * Anything above the last band clamps to it rather than wrapping.
 *
 * Returns a CSS custom property, so it follows the user's active theme
 * (including custom themes) instead of hardcoding hexes the way the node-state
 * colours above still do.
 */
export const EDGE_COUNT_COLOR_RAMP = [
	"--color-primary-500",
	"--color-secondary-500",
	"--color-tertiary-500",
	"--color-success-500",
	"--color-warning-500",
	"--color-error-500"
] as const

/** Colour for an edge whose relationships have all concluded. */
export const EDGE_INACTIVE_COLOR = "--color-surface-500"

export function edgeCountColor(liveCount: number): string {
	if (liveCount <= 0) return `var(${EDGE_INACTIVE_COLOR}, #6b7280)`
	const band = Math.min(liveCount, EDGE_COUNT_COLOR_RAMP.length) - 1
	return `var(${EDGE_COUNT_COLOR_RAMP[band]}, #6366f1)`
}

/** Stroke width used for an ordinary, un-aggregated edge. */
export const EDGE_BASE_WIDTH = 1.5

/**
 * Stroke width for an aggregated edge, so weight reads as connection strength
 * before any label is legible — at low zoom the thickness is doing the work the
 * count cannot.
 *
 * Restrained on purpose: a dense pair should read as heavier, not as a pipe.
 * The ramp caps at the same band count as the colour ramp so the two signals
 * saturate together rather than one continuing past the other, and a direction
 * with nothing active is drawn THINNER than the base so it recedes.
 */
export function edgeCountWidth(liveCount: number): number {
	if (liveCount <= 0) return 1
	const steps = Math.min(liveCount, EDGE_COUNT_COLOR_RAMP.length) - 1
	return EDGE_BASE_WIDTH + steps * 0.5
}
