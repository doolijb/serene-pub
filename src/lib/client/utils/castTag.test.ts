import { describe, expect, test } from "vitest"
import { castTagKind, castTagLabel, castTagTitle } from "./castTag"

const rows = [
	{
		binding: "{{char:1}}",
		name: "Aria",
		characterId: 10,
		character: { name: "Aria Vale", nickname: "Ari", isPersona: false }
	},
	{
		binding: "{{char:2}}",
		name: "Me",
		characterId: 11,
		character: { name: "Reader", nickname: null, isPersona: true }
	},
	{ binding: "{{char:3}}", name: "The innkeeper", characterId: null }
]

describe("cast tag label and kind", () => {
	test("a card's nickname, then its name", () => {
		expect(castTagLabel(rows, "{{char:1}}")).toBe("Ari")
		expect(castTagLabel(rows, "{{char:2}}")).toBe("Reader")
	})

	test("a background member reads by its own name, not the raw tag", () => {
		expect(castTagLabel(rows, "{{char:3}}")).toBe("The innkeeper")
		expect(castTagKind(rows, "{{char:3}}")).toBe("background")
		expect(castTagTitle("background", "The innkeeper")).toBe(
			"Cast member: The innkeeper"
		)
	})

	test("only a tag with no row is unknown, and it never says Unbound", () => {
		expect(castTagKind(rows, "{{char:99}}")).toBe("unknown")
		expect(castTagLabel(rows, "{{char:99}}")).toBe("{{char:99}}")
		expect(castTagTitle("unknown", "x")).toBe("No cast member for this tag")
	})

	test("card kinds", () => {
		expect(castTagKind(rows, "{{char:1}}")).toBe("character")
		expect(castTagKind(rows, "{{char:2}}")).toBe("persona")
	})
})
