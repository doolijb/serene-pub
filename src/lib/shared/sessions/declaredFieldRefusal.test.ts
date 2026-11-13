import { describe, expect, it } from "vitest"
import { declaredFieldRefusal } from "./declaredFieldRefusal"

describe("declaredFieldRefusal", () => {
	it("lets absent and declared fields through", () => {
		expect(declaredFieldRefusal(undefined, ["a"], "g")).toBeNull()
		expect(declaredFieldRefusal({}, ["a"], "g")).toBeNull()
		expect(declaredFieldRefusal({ a: 1 }, ["a", "b"], "g")).toBeNull()
	})
	it("refuses a non-object", () => {
		for (const v of [null, 3, "x", [1]])
			expect(declaredFieldRefusal(v, ["a"], "g")).toBe(
				"The fields are an object of values."
			)
	})
	it("refuses an undeclared key, or an unregistered genre", () => {
		expect(declaredFieldRefusal({ z: 1 }, ["a"], "story")).toBe(
			"'z' is not a field of the genre 'story'."
		)
		expect(declaredFieldRefusal({ a: 1 }, null, "story")).toBe(
			"'a' is not a field of the genre 'story'."
		)
	})
})
