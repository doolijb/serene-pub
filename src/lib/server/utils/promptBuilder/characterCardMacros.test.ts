import { describe, expect, test } from "vitest"
import Handlebars from "handlebars"
import {
	registerCardMacroHelpers,
	translateCardMacros
} from "./characterCardMacros"

function render(template: string, context: Record<string, unknown> = {}) {
	const hb = Handlebars.create()
	registerCardMacroHelpers(hb)
	return hb.compile(translateCardMacros(template))(context)
}

describe("translateCardMacros", () => {
	test("{{char}}/{{user}} pass through untouched (plain Handlebars lookup)", () => {
		expect(translateCardMacros("Hello {{char}} and {{user}}")).toBe(
			"Hello {{char}} and {{user}}"
		)
	})

	test("rewrites {{random:A,B,C}} into a cardRandom helper call", () => {
		expect(translateCardMacros("{{random:A,B,C}}")).toBe(
			'{{cardRandom "A" "B" "C"}}'
		)
	})

	test("splits random/pick args on unescaped commas, unescaping \\,", () => {
		expect(translateCardMacros("{{random:A\\,1,B,C}}")).toBe(
			'{{cardRandom "A,1" "B" "C"}}'
		)
	})

	test("rewrites {{roll:d6}} and {{roll:20}} into cardRoll helper calls", () => {
		expect(translateCardMacros("{{roll:d6}}")).toBe('{{cardRoll "d6"}}')
		expect(translateCardMacros("{{roll:20}}")).toBe('{{cardRoll "20"}}')
	})

	test("rewrites {{reverse:abc}}, {{comment: hi}}, {{hidden_key:x}}, {{// hi}}", () => {
		expect(translateCardMacros("{{reverse:abc}}")).toBe(
			'{{cardReverse "abc"}}'
		)
		expect(translateCardMacros("{{comment: hi}}")).toBe(
			'{{cardComment "hi"}}'
		)
		expect(translateCardMacros("{{hidden_key:x}}")).toBe(
			'{{cardHiddenKey "x"}}'
		)
		expect(translateCardMacros("{{// hi}}")).toBe('{{cardHidden "hi"}}')
	})

	test("recognizes {{pick:...}} as a macro (so it doesn't corrupt Handlebars compilation)", () => {
		expect(translateCardMacros("{{pick:A,B,C}}")).toBe(
			'{{cardPick "A" "B" "C"}}'
		)
	})

	test("is case-insensitive", () => {
		expect(translateCardMacros("{{RANDOM:A,B}}")).toBe(
			'{{cardRandom "A" "B"}}'
		)
	})
})

describe("registerCardMacroHelpers — end-to-end render", () => {
	test("cardRandom picks one of the given values", () => {
		const rendered = render("{{random:A,B,C}}")
		expect(["A", "B", "C"]).toContain(rendered)
	})

	test("cardRoll produces a number within [1, N]", () => {
		for (let i = 0; i < 20; i++) {
			const rendered = Number(render("{{roll:d6}}"))
			expect(rendered).toBeGreaterThanOrEqual(1)
			expect(rendered).toBeLessThanOrEqual(6)
		}
	})

	test("cardReverse reverses the string", () => {
		expect(render("{{reverse:abc}}")).toBe("cba")
	})

	test("cardComment, cardHidden, cardHiddenKey all render empty", () => {
		expect(render("[{{comment: hi}}]")).toBe("[]")
		expect(render("[{{// hi}}]")).toBe("[]")
		expect(render("[{{hidden_key:hi}}]")).toBe("[]")
	})

	test("{{pick:...}} renders empty (not implemented) without throwing or blanking the whole field", () => {
		expect(render("Hello {{char}}, {{pick:A,B,C}} end.", { char: "Alice" })).toBe(
			"Hello Alice,  end."
		)
	})

	test("unsupported macro syntax doesn't crash compilation of an otherwise-valid field", () => {
		expect(() =>
			render("Hello {{char}}! {{random:A,B}}", { char: "Alice" })
		).not.toThrow()
	})
})
