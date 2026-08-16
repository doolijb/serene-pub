import { describe, expect, test } from "vitest"
import { joinWithAnd } from "./joinWithAnd"

describe("joinWithAnd", () => {
	test("empty array returns an empty string", () => {
		expect(joinWithAnd([])).toBe("")
	})

	test("single item returns the item unchanged", () => {
		expect(joinWithAnd(["A"])).toBe("A")
	})

	test("two items are joined with 'and', no comma", () => {
		expect(joinWithAnd(["A", "B"])).toBe("A and B")
	})

	test("three or more items use an Oxford comma", () => {
		expect(joinWithAnd(["A", "B", "C"])).toBe("A, B, and C")
		expect(joinWithAnd(["A", "B", "C", "D"])).toBe("A, B, C, and D")
	})

	test("falsy/empty/whitespace-only entries are filtered out before joining", () => {
		expect(joinWithAnd(["A", "", "B"])).toBe("A and B")
		expect(joinWithAnd(["A", "   ", "B"])).toBe("A and B")
		expect(joinWithAnd(["", "   ", ""])).toBe("")
		expect(joinWithAnd(["A", "", ""])).toBe("A")
	})

	test("filtering can reduce a 3+ item list down to the 2-item or 1-item phrasing", () => {
		expect(joinWithAnd(["A", "", "B", "  ", "C"])).toBe("A, B, and C")
		expect(joinWithAnd(["", "A", "B"])).toBe("A and B")
	})
})
