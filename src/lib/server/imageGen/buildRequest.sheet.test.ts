import { describe, expect, test } from "vitest"
import { applyOrientation, fitRequestToSheet } from "./buildRequest"
import { A1111_SHEET } from "$lib/server/imageAdapters/A1111Adapter"
import type { DrawingSheet } from "$lib/shared/imageGen/types"

/**
 * Size is the HOST's to fit (DESIGN-image-generation §4.1–4.2): orientation
 * turns the sampling's size, and the sheet's size rule fits it — once, so no
 * adapter computes it twice.
 */

const enumSheet: DrawingSheet = {
	...A1111_SHEET,
	size: { kind: "enum", sizes: ["1024x1024", "1024x1536", "1536x1024"] }
}
const aspectSheet: DrawingSheet = {
	...A1111_SHEET,
	size: { kind: "aspect", aspects: ["1:1", "2:3", "3:2", "9:16", "16:9"] }
}

describe("applyOrientation", () => {
	const req = { prompt: "p", width: 832, height: 1216 }

	test("free leaves the size as set", () => {
		expect(applyOrientation(req, "free")).toBe(req)
		expect(applyOrientation(req, null)).toBe(req)
	})

	test("landscape puts the longer edge on the width", () => {
		expect(applyOrientation(req, "landscape")).toMatchObject({ width: 1216, height: 832 })
	})

	test("portrait puts the longer edge on the height", () => {
		const wide = { prompt: "p", width: 1216, height: 832 }
		expect(applyOrientation(wide, "portrait")).toMatchObject({ width: 832, height: 1216 })
	})

	test("square takes the shorter edge for both", () => {
		expect(applyOrientation(req, "square")).toMatchObject({ width: 832, height: 832 })
	})

	test("with one edge missing there is nothing to turn", () => {
		const half = { prompt: "p", width: 832 }
		expect(applyOrientation(half, "landscape")).toBe(half)
	})
})

describe("fitRequestToSheet", () => {
	test("free: rounds to the step and clamps", () => {
		expect(
			fitRequestToSheet({ prompt: "p", width: 831, height: 4000 }, A1111_SHEET)
		).toMatchObject({ width: 832, height: 2048 })
	})

	test("enum: snaps to the nearest shape, then the nearest area", () => {
		expect(
			fitRequestToSheet({ prompt: "p", width: 832, height: 1216 }, enumSheet)
		).toMatchObject({ width: 1024, height: 1536 })
		expect(
			fitRequestToSheet({ prompt: "p", width: 512, height: 512 }, enumSheet)
		).toMatchObject({ width: 1024, height: 1024 })
	})

	test("aspect: derives the nearest listed ratio, keeping width and height", () => {
		const out = fitRequestToSheet({ prompt: "p", width: 832, height: 1216 }, aspectSheet)
		expect(out.aspect).toBe("2:3")
		expect(out.width).toBe(832)
		expect(
			fitRequestToSheet({ prompt: "p", width: 1920, height: 1080 }, aspectSheet).aspect
		).toBe("16:9")
	})

	test("aspect: an orientation with no size still means a shape", () => {
		expect(fitRequestToSheet({ prompt: "p" }, aspectSheet, "landscape").aspect).toBe("3:2")
		expect(fitRequestToSheet({ prompt: "p" }, aspectSheet, "square").aspect).toBe("1:1")
	})

	test("nothing to fit leaves the request alone", () => {
		const req = { prompt: "p" }
		expect(fitRequestToSheet(req, aspectSheet)).toBe(req)
		expect(fitRequestToSheet(req, enumSheet)).toBe(req)
	})
})
