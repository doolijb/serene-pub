import { describe, expect, it } from "vitest"
import { namesTakenBesides, shippedNameFor } from "./shippedName"

describe("the name a shipped row takes", () => {
	it("is the catalog's name when nobody else holds it", () => {
		expect(shippedNameFor("Writer", new Set(["Mine"]))).toBe("Writer")
	})

	it("yields with (Built-in), then numbers, when the name is held", () => {
		expect(shippedNameFor("Writer", new Set(["Writer"]))).toBe(
			"Writer (Built-in)"
		)
		expect(
			shippedNameFor("Writer", new Set(["Writer", "Writer (Built-in)"]))
		).toBe("Writer (Built-in 2)")
	})

	it("compares exactly, as the unique indexes do", () => {
		expect(shippedNameFor("Writer", new Set(["writer", "Writer "]))).toBe(
			"Writer"
		)
	})

	it("never counts the shipped row's own name against it", () => {
		const rows = [
			{ id: 1, name: "Writer" },
			{ id: 2, name: "Other" }
		]
		expect(shippedNameFor("Writer", namesTakenBesides(rows, 1))).toBe(
			"Writer"
		)
		expect(shippedNameFor("Writer", namesTakenBesides(rows, null))).toBe(
			"Writer (Built-in)"
		)
	})
})
