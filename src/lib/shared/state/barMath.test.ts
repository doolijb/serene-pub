/**
 * A bar is drawn from the configuration in force, and only when that
 * configuration actually describes one.
 */
import { describe, expect, test } from "vitest"
import { barView, clampToBounds, formatSlotValue } from "./barMath"

describe("barView", () => {
	test("a bounded integer is a percentage and a label", () => {
		expect(barView(14, { min: 0, max: 20 })).toEqual({
			min: 0,
			max: 20,
			value: 14,
			percent: 70,
			label: "14/20"
		})
	})

	test("a floor that is not zero is where the bar starts", () => {
		expect(barView(5, { min: 5, max: 25 })?.percent).toBe(0)
		expect(barView(15, { min: 5, max: 25 })?.percent).toBe(50)
	})

	test("only the drawing is clamped; the label keeps the real number", () => {
		expect(barView(35, { min: 0, max: 20 })).toMatchObject({
			percent: 100,
			label: "35/20"
		})
		expect(barView(-3, { min: 0, max: 20 })).toMatchObject({
			percent: 0,
			label: "-3/20"
		})
	})

	test("a slot with one bound, no bounds, or no number is not a bar", () => {
		expect(barView(14, { min: 0 })).toBeNull()
		expect(barView(14, { max: 20 })).toBeNull()
		expect(barView(14, {})).toBeNull()
		expect(barView("wary", { min: 0, max: 20 })).toBeNull()
		expect(barView(null, { min: 0, max: 20 })).toBeNull()
		expect(barView(undefined, { min: 0, max: 20 })).toBeNull()
	})

	test("a ceiling that is not above the floor is not a bar", () => {
		expect(barView(3, { min: 5, max: 5 })).toBeNull()
		expect(barView(3, { min: 9, max: 4 })).toBeNull()
	})
})

describe("clampToBounds", () => {
	test("holds a value inside whichever bounds are declared", () => {
		expect(clampToBounds(25, { min: 0, max: 20 })).toBe(20)
		expect(clampToBounds(-1, { min: 0, max: 20 })).toBe(0)
		expect(clampToBounds(-1, { max: 20 })).toBe(-1)
		expect(clampToBounds(99, { min: 0 })).toBe(99)
	})
})

describe("formatSlotValue", () => {
	test("a boolean reads as a state, not as a word from another language", () => {
		expect(formatSlotValue(true)).toBe("on")
		expect(formatSlotValue(false)).toBe("off")
	})

	test("everything else is itself", () => {
		expect(formatSlotValue(14)).toBe("14")
		expect(formatSlotValue("wary")).toBe("wary")
	})

	test("cleared and absent are said in words, never as a zero", () => {
		expect(formatSlotValue(null)).toBe("cleared")
		expect(formatSlotValue(undefined)).toBe("")
	})
})
