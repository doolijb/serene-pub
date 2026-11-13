import { describe, expect, test } from "vitest"
import { middleEdgesPx } from "./stageBalance.svelte"

/**
 * The middle reaches over the body gap on an end with a side beside it
 * (`middleOverGap`), decided by `start > 0` / `end > 0`. Those must not move
 * when the reach is drawn, or the layout flips every frame.
 */
describe("middleEdgesPx", () => {
	const pad = 12

	test("no side in the flow: the body's padding is not a side, with or without the reach", () => {
		const body = { left: 0, right: 1000 }
		// Without the reach the middle starts inside the padding…
		expect(
			middleEdgesPx({
				body,
				center: { left: 12, right: 988 },
				padStart: pad,
				padEnd: pad
			})
		).toEqual({
			start: 0,
			end: 0,
			bodyPx: 976
		})
		// …and a drawn reach (-12px each end) still reads no side.
		expect(
			middleEdgesPx({
				body,
				center: { left: 0, right: 1000 },
				padStart: pad,
				padEnd: pad
			})
		).toMatchObject({
			start: 0,
			end: 0
		})
	})

	test("a side in the flow reads as one before and after the middle covers the gap", () => {
		const body = { left: 0, right: 1400 }
		// Left side 300px wide at 12..312, gap 12, middle from 324.
		const before = middleEdgesPx({
			body,
			center: { left: 324, right: 1388 },
			padStart: pad,
			padEnd: pad
		})
		const after = middleEdgesPx({
			body,
			center: { left: 312, right: 1388 },
			padStart: pad,
			padEnd: pad
		})
		expect(before.start > 0 && after.start > 0).toBe(true)
		expect(before.end).toBe(0)
		expect(after.end).toBe(0)
	})
})
