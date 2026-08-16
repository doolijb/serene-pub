/**
 * The bug these exist for: A→B and B→A rendered on top of each other.
 *
 * Bundling was already keyed on the unordered pair, so the reversed edge got a
 * different index and a mirrored offset — but the perpendicular was derived
 * from source → target, so it flipped sign too, and mirrored-offset ×
 * flipped-perpendicular is the SAME control point. The two curves coincided
 * exactly and their labels drew at identical coordinates, producing overstruck
 * text like "playfuleantagonism". Same-direction parallels were unaffected,
 * which is why it read as an intermittent cosmetic issue rather than a bug.
 */
import { describe, expect, test } from "vitest"
import {
	edgePath,
	edgeBundleKey,
	CURVE_SPACING,
	type EdgeEndpoint
} from "./edgeGeometry"

const A: EdgeEndpoint = { id: 1, x: 0, y: 0 }
const B: EdgeEndpoint = { id: 2, x: 200, y: 0 }

const dist = (a: { labelX: number; labelY: number }, b: typeof a) =>
	Math.hypot(a.labelX - b.labelX, a.labelY - b.labelY)

describe("edgeBundleKey", () => {
	test("is unordered, so both directions share one bundle", () => {
		expect(edgeBundleKey(1, 2)).toBe(edgeBundleKey(2, 1))
	})
})

describe("edgePath", () => {
	test("opposite directions of the same pair do not coincide", () => {
		// The regression itself. Pre-fix these were separated by exactly 0px.
		const ab = edgePath(A, B, 0, 2)
		const ba = edgePath(B, A, 1, 2)
		expect(dist(ab, ba)).toBeGreaterThan(CURVE_SPACING / 2)
		expect(ab.d).not.toBe(ba.d)
	})

	test("fan direction depends on the PAIR, not on which way an edge points", () => {
		// Same slot in the bundle => same side of the chord, whichever way the
		// edge is pointing. This is the property the fix restores.
		const ab = edgePath(A, B, 0, 2)
		const ba = edgePath(B, A, 0, 2)
		expect(ba.labelY).toBeCloseTo(ab.labelY, 6)
	})

	test("same-direction parallels still separate (never broken)", () => {
		const first = edgePath(A, B, 0, 2)
		const second = edgePath(A, B, 1, 2)
		expect(dist(first, second)).toBeGreaterThan(CURVE_SPACING / 2)
	})

	test("a lone edge runs straight down the chord", () => {
		const only = edgePath(A, B, 0, 1)
		expect(only.labelY).toBeCloseTo(0, 6)
		expect(only.labelX).toBeCloseTo(100, 6)
	})

	test("three edges fan to three distinct positions", () => {
		const [p0, p1, p2] = [0, 1, 2].map((i) => edgePath(A, B, i, 3))
		const ys = [p0.labelY, p1.labelY, p2.labelY]
		expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(3)
		expect(p1.labelY).toBeCloseTo(0, 6) // middle edge stays on the chord
	})

	test("holds for a diagonal pair, not just an axis-aligned one", () => {
		const C: EdgeEndpoint = { id: 7, x: -80, y: 140 }
		const D: EdgeEndpoint = { id: 9, x: 130, y: -60 }
		const cd = edgePath(C, D, 0, 2)
		const dc = edgePath(D, C, 1, 2)
		expect(dist(cd, dc)).toBeGreaterThan(CURVE_SPACING / 2)
	})

	test("coincident nodes degrade to a finite path rather than NaN", () => {
		const dup: EdgeEndpoint = { id: 3, x: 10, y: 10 }
		const g = edgePath(dup, { ...dup, id: 4 }, 0, 1)
		expect(Number.isFinite(g.labelX)).toBe(true)
		expect(Number.isFinite(g.labelY)).toBe(true)
		expect(g.d).not.toMatch(/NaN/)
	})
})
