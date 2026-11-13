import { describe, expect, test } from "vitest"
import { cardUpdateButton, cardUpdateLine } from "./cardUpdateWords"

describe("the Update offer's words", () => {
	test("the line names both versions by their labels", () => {
		expect(
			cardUpdateLine(
				{ number: 1, label: "1.0" },
				{ number: 2, label: "1.1" }
			)
		).toBe("On card v1.0; the card is on v1.1.")
	})

	test("a version with no label reads as its number", () => {
		expect(
			cardUpdateLine(
				{ number: 1, label: null },
				{ number: 2, label: "Winter" }
			)
		).toBe("On card Version 1; the card is on Winter.")
	})

	test("the button says what happens, to whom", () => {
		expect(cardUpdateButton("Bianca", { number: 2, label: "1.1" })).toBe(
			"Update Bianca to card v1.1"
		)
	})
})
