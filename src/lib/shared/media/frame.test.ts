import { describe, expect, test } from "vitest"
import {
	MIN_FRAME_EDGE,
	clampFrame,
	defaultFrame,
	frameProblem,
	framesEqual
} from "./frame"

describe("the default frame", () => {
	test("a tall image keeps the top", () => {
		expect(defaultFrame(400, 1000)).toEqual({ x: 0, y: 0, w: 400, h: 400 })
	})

	test("a wide image is centred horizontally and still starts at the top", () => {
		expect(defaultFrame(1000, 400)).toEqual({
			x: 300,
			y: 0,
			w: 400,
			h: 400
		})
	})

	test("a square image is the whole image", () => {
		expect(defaultFrame(512, 512)).toEqual({ x: 0, y: 0, w: 512, h: 512 })
	})

	test("an odd overhang rounds to whole pixels and still fits", () => {
		const frame = defaultFrame(101, 40)
		expect(Number.isInteger(frame.x)).toBe(true)
		expect(frame.x + frame.w).toBeLessThanOrEqual(101)
		expect(frame.y).toBe(0)
	})
})

describe("clamping", () => {
	test("pulls a frame that runs off the right edge back inside", () => {
		expect(clampFrame({ x: 900, y: 0, w: 200, h: 200 }, 1000, 800)).toEqual(
			{
				x: 800,
				y: 0,
				w: 200,
				h: 200
			}
		)
	})

	test("pulls a negative origin back to zero", () => {
		expect(
			clampFrame({ x: -50, y: -10, w: 200, h: 200 }, 1000, 800)
		).toEqual({ x: 0, y: 0, w: 200, h: 200 })
	})

	test("shrinks a frame larger than the image", () => {
		expect(clampFrame({ x: 0, y: 0, w: 4000, h: 4000 }, 1000, 800)).toEqual(
			{
				x: 0,
				y: 0,
				w: 1000,
				h: 800
			}
		)
	})

	test("never returns an edge under the minimum", () => {
		const frame = clampFrame({ x: 5, y: 5, w: 1, h: 1 }, 1000, 800)
		expect(frame.w).toBe(MIN_FRAME_EDGE)
		expect(frame.h).toBe(MIN_FRAME_EDGE)
	})
})

describe("the frame a handler will accept", () => {
	test("takes a frame inside the image", () => {
		expect(
			frameProblem({ x: 10, y: 10, w: 100, h: 100 }, 1000, 800)
		).toBeNull()
	})

	test("refuses one that runs past an edge, in a sentence", () => {
		const problem = frameProblem(
			{ x: 950, y: 0, w: 100, h: 100 },
			1000,
			800
		)
		expect(problem).toMatch(/1000/)
		expect(problem).toMatch(/\.$/)
	})

	test("refuses an edge under the minimum", () => {
		expect(frameProblem({ x: 0, y: 0, w: 8, h: 100 }, 1000, 800)).toMatch(
			/16/
		)
	})

	test("refuses a fractional or non-finite value", () => {
		expect(
			frameProblem({ x: 0.5, y: 0, w: 100, h: 100 }, 1000, 800)
		).toMatch(/whole pixels/)
		expect(
			frameProblem({ x: 0, y: 0, w: Number.NaN, h: 100 }, 1000, 800)
		).toMatch(/whole pixels/)
	})

	test("refuses any frame when the image has no known size", () => {
		expect(
			frameProblem({ x: 0, y: 0, w: 100, h: 100 }, null, null)
		).toMatch(/dimensions/)
	})
})

describe("frame equality", () => {
	test("two identical frames are equal, and null equals null", () => {
		expect(
			framesEqual({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })
		).toBe(true)
		expect(framesEqual(null, null)).toBe(true)
	})

	test("a frame is never equal to no frame", () => {
		expect(framesEqual({ x: 1, y: 2, w: 3, h: 4 }, null)).toBe(false)
	})
})
