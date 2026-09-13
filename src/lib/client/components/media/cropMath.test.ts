import { describe, expect, test } from "vitest"
import { MIN_FRAME_EDGE, defaultFrame } from "$lib/shared/media/frame"
import {
	MAX_ZOOM,
	frameAtZoom,
	frameTransform,
	frameZoom,
	nudgeFrame,
	panFrame,
	savedFrame,
	sourceToViewport,
	viewportToSource,
	zoomBounds,
	zoomFrameAt
} from "./cropMath"

/** A landscape source with room to move in both axes once zoomed in. */
const IMG = { width: 1000, height: 800 }
const MASK = 400

describe("panning", () => {
	test("the source window follows the pointer", () => {
		const frame = { x: 400, y: 300, w: 200, h: 200 }
		// 200 source px across a 400px mask: one viewport px is half a source
		// px, and dragging the image right walks the window left.
		const panned = panFrame(frame, 40, 20, MASK, IMG.width, IMG.height)
		expect(panned).toEqual({ x: 380, y: 290, w: 200, h: 200 })
	})

	test("stops at the edge instead of leaving the image", () => {
		const frame = { x: 10, y: 10, w: 200, h: 200 }
		const panned = panFrame(frame, 9999, 9999, MASK, IMG.width, IMG.height)
		expect(panned.x).toBe(0)
		expect(panned.y).toBe(0)

		const other = panFrame(frame, -9999, -9999, MASK, IMG.width, IMG.height)
		expect(other.x).toBe(IMG.width - 200)
		expect(other.y).toBe(IMG.height - 200)
	})

	test("keyboard nudges move whole source pixels", () => {
		const frame = { x: 100, y: 100, w: 200, h: 200 }
		expect(nudgeFrame(frame, 1, 0, IMG.width, IMG.height).x).toBe(101)
		expect(nudgeFrame(frame, 0, -10, IMG.width, IMG.height).y).toBe(90)
		expect(nudgeFrame(frame, -9999, 0, IMG.width, IMG.height).x).toBe(0)
	})
})

describe("zooming about a point", () => {
	test("holds the source pixel under the anchor still", () => {
		const frame = { x: 200, y: 100, w: 400, h: 400 }
		const anchor = { x: 100, y: 300 }
		const before = viewportToSource(anchor, frame, MASK)
		const zoomed = zoomFrameAt(
			frame,
			2,
			anchor,
			MASK,
			IMG.width,
			IMG.height
		)
		const after = viewportToSource(anchor, zoomed, MASK)
		expect(after.x).toBeCloseTo(before.x, 0)
		expect(after.y).toBeCloseTo(before.y, 0)
		expect(zoomed.w).toBe(200)
	})

	test("zooming in stops at the smallest frame", () => {
		const frame = { x: 0, y: 0, w: 800, h: 800 }
		const { minEdge } = zoomBounds(IMG.width, IMG.height)
		const zoomed = zoomFrameAt(
			frame,
			1000,
			{ x: MASK / 2, y: MASK / 2 },
			MASK,
			IMG.width,
			IMG.height
		)
		expect(zoomed.w).toBe(minEdge)
		expect(zoomed.w).toBeGreaterThanOrEqual(MIN_FRAME_EDGE)
	})

	test("zooming out stops at the largest square that fits, still inside", () => {
		const frame = { x: 300, y: 200, w: 100, h: 100 }
		const zoomed = zoomFrameAt(
			frame,
			0.001,
			{ x: MASK / 2, y: MASK / 2 },
			MASK,
			IMG.width,
			IMG.height
		)
		expect(zoomed.w).toBe(800)
		expect(zoomed.h).toBe(800)
		expect(zoomed.x).toBeGreaterThanOrEqual(0)
		expect(zoomed.x + zoomed.w).toBeLessThanOrEqual(IMG.width)
		expect(zoomed.y).toBe(0)
	})
})

describe("the zoom slider", () => {
	test("reads 1 at the default frame and rises as the frame shrinks", () => {
		expect(frameZoom(defaultFrame(1000, 800), IMG.width, IMG.height)).toBe(
			1
		)
		expect(frameZoom({ x: 0, y: 0, w: 400, h: 400 }, 1000, 800)).toBe(2)
	})

	test("round-trips a zoom level back to a frame of that size", () => {
		const frame = { x: 100, y: 100, w: 400, h: 400 }
		const next = frameAtZoom(frame, 4, IMG.width, IMG.height)
		expect(next.w).toBe(200)
		expect(frameZoom(next, IMG.width, IMG.height)).toBe(4)
	})

	test("is bounded", () => {
		const frame = { x: 0, y: 0, w: 800, h: 800 }
		const deep = frameAtZoom(frame, MAX_ZOOM * 10, IMG.width, IMG.height)
		expect(deep.w).toBe(zoomBounds(IMG.width, IMG.height).minEdge)
	})
})

describe("viewport and source coordinates", () => {
	test("round-trip through the frame", () => {
		const frame = { x: 120, y: 340, w: 250, h: 250 }
		const point = { x: 37, y: 219 }
		const back = sourceToViewport(
			viewportToSource(point, frame, MASK),
			frame,
			MASK
		)
		expect(back.x).toBeCloseTo(point.x, 6)
		expect(back.y).toBeCloseTo(point.y, 6)
	})

	test("the mask's top-left is the frame's origin", () => {
		const frame = { x: 120, y: 340, w: 250, h: 250 }
		expect(viewportToSource({ x: 0, y: 0 }, frame, MASK)).toEqual({
			x: 120,
			y: 340
		})
	})

	test("places the image so the frame fills the mask", () => {
		const frame = { x: 120, y: 340, w: 250, h: 250 }
		const placed = frameTransform(frame, MASK)
		expect(placed.scale).toBeCloseTo(MASK / 250, 6)
		expect(placed.left).toBeCloseTo(-120 * placed.scale, 6)
		expect(placed.top).toBeCloseTo(-340 * placed.scale, 6)
	})
})

describe("what the editor hands back", () => {
	test("the default rule's own answer is null, not a copy of it", () => {
		const frame = defaultFrame(IMG.width, IMG.height)
		expect(savedFrame(frame, IMG.width, IMG.height)).toBeNull()
	})

	test("any other frame is stored as written", () => {
		const frame = { x: 120, y: 340, w: 250, h: 250 }
		expect(savedFrame(frame, IMG.width, IMG.height)).toEqual(frame)
	})

	test("a plain copy, so nothing of the editor's crosses the close", () => {
		const frame = { x: 120, y: 340, w: 250, h: 250 }
		const saved = savedFrame(frame, IMG.width, IMG.height)
		expect(saved).not.toBe(frame)
		frame.x = 999
		expect(saved!.x).toBe(120)
	})
})
