import { describe, expect, test } from "vitest"
import {
	aggregateEdgesByDirection,
	edgeCountColor,
	edgeCountWidth,
	EDGE_BASE_WIDTH,
	EDGE_COUNT_COLOR_RAMP
} from "./edgeGeometry"

const rel = (source: number, target: number, status = "active") => ({
	source,
	target,
	status
})

describe("aggregateEdgesByDirection", () => {
	test("collapses many relationships into one edge per direction", () => {
		const agg = aggregateEdgesByDirection([
			rel(1, 2),
			rel(1, 2),
			rel(1, 2),
			rel(2, 1)
		])
		expect(agg).toHaveLength(2)
		const forward = agg.find((a) => a.source === 1)!
		const back = agg.find((a) => a.source === 2)!
		expect(forward.liveCount).toBe(3)
		expect(back.liveCount).toBe(1)
	})

	test("keeps the two directions separate — the asymmetry is the point", () => {
		const agg = aggregateEdgesByDirection([rel(1, 2), rel(1, 2), rel(2, 1)])
		expect(agg.map((a) => `${a.source}->${a.target}`).sort()).toEqual([
			"1->2",
			"2->1"
		])
	})

	test("counts relationships still standing, but still reports the total", () => {
		const agg = aggregateEdgesByDirection([
			rel(1, 2, "active"),
			rel(1, 2, "resolved"),
			rel(1, 2, "broken")
		])
		expect(agg[0].liveCount).toBe(1)
		expect(agg[0].totalCount).toBe(3)
	})

	test("`evolved` is still standing — it changed, it did not end", () => {
		// The shipped bug: counting `status === "active"` meant a pair whose
		// relationships had all evolved rendered as a dotted line with no
		// count, despite being one of the busiest pairs in the graph.
		const agg = aggregateEdgesByDirection([
			rel(1, 2, "evolved"),
			rel(1, 2, "evolved"),
			rel(1, 2, "active")
		])
		expect(agg[0].liveCount).toBe(3)
	})

	test("an unknown or missing status counts as standing, not concluded", () => {
		// A status this code has not been taught about must not make an edge
		// silently vanish — that is how the `evolved` case escaped notice.
		const agg = aggregateEdgesByDirection([
			{ source: 1, target: 2, status: "some-future-status" },
			{ source: 1, target: 2, status: null },
			{ source: 1, target: 2 }
		])
		expect(agg[0].liveCount).toBe(3)
	})

	test("a fully concluded pair still yields an edge, with zero live", () => {
		// It should not silently disappear from the overview — the connection
		// existed, it just is not live.
		const agg = aggregateEdgesByDirection([
			rel(1, 2, "resolved"),
			rel(1, 2, "resolved")
		])
		expect(agg).toHaveLength(1)
		expect(agg[0].liveCount).toBe(0)
		expect(agg[0].totalCount).toBe(2)
	})

	test("no edges in, nothing out", () => {
		expect(aggregateEdgesByDirection([])).toEqual([])
	})
})

describe("edgeCountColor", () => {
	test("ramps through distinct theme colours as the count climbs", () => {
		const seen = [1, 2, 3, 4, 5, 6].map(edgeCountColor)
		expect(new Set(seen).size).toBe(EDGE_COUNT_COLOR_RAMP.length)
	})

	test("clamps above the last band rather than wrapping to the first", () => {
		const top = edgeCountColor(EDGE_COUNT_COLOR_RAMP.length)
		expect(edgeCountColor(99)).toBe(top)
		expect(edgeCountColor(99)).not.toBe(edgeCountColor(1))
	})

	test("zero live gets the concluded colour, not the first band", () => {
		expect(edgeCountColor(0)).not.toBe(edgeCountColor(1))
		expect(edgeCountColor(0)).toContain("surface")
	})

	test("returns themeable custom properties with a literal fallback", () => {
		expect(edgeCountColor(1)).toMatch(
			/^var\(--color-[a-z]+-500, #[0-9a-f]{6}\)$/
		)
	})
})

describe("edgeCountWidth", () => {
	test("thickens monotonically with the number of live relationships", () => {
		const widths = [1, 2, 3, 4, 5].map(edgeCountWidth)
		for (let i = 1; i < widths.length; i++) {
			expect(widths[i]).toBeGreaterThan(widths[i - 1])
		}
	})

	test("a single relationship draws at the ordinary weight", () => {
		expect(edgeCountWidth(1)).toBe(EDGE_BASE_WIDTH)
	})

	test("stays restrained — a dense pair is heavier, not a pipe", () => {
		expect(edgeCountWidth(99)).toBeLessThanOrEqual(EDGE_BASE_WIDTH * 3)
	})

	test("saturates with the colour ramp rather than growing past it", () => {
		expect(edgeCountWidth(EDGE_COUNT_COLOR_RAMP.length)).toBe(
			edgeCountWidth(99)
		)
	})

	test("nothing standing recedes below the base weight", () => {
		expect(edgeCountWidth(0)).toBeLessThan(EDGE_BASE_WIDTH)
	})
})
