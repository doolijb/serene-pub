import { describe, expect, test } from "vitest"
import { sessionBackdropSrc } from "./backdropSrc"

describe("sessionBackdropSrc", () => {
	test("a positive integer id is the fitted by-id address", () => {
		expect(sessionBackdropSrc(12)).toBe("/media/12?v=fitted")
	})
	test("anything else is null", () => {
		for (const v of [null, undefined, 0, -3, 1.5, Number.NaN])
			expect(sessionBackdropSrc(v)).toBeNull()
	})
})
