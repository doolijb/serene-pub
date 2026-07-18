import { describe, expect, test } from "vitest"
import { InterpolationEngine } from "./InterpolationEngine"
import type { InterpolationContext } from "./InterpolationEngine"

function makeContext(
	overrides: Partial<InterpolationContext> = {}
): InterpolationContext {
	return {
		char: "Alice",
		character: "Alice",
		user: "Bob",
		persona: "Bob",
		...overrides
	}
}

describe("InterpolationEngine.interpolateString", () => {
	test("substitutes {{char}} and {{user}} variables from the context", () => {
		const engine = new InterpolationEngine()
		const context = makeContext()
		expect(
			engine.interpolateString("{{char}} greets {{user}}.", context)
		).toBe("Alice greets Bob.")
	})

	test("substitutes {{character}} and {{persona}} aliases the same as {{char}}/{{user}}", () => {
		const engine = new InterpolationEngine()
		const context = makeContext()
		expect(
			engine.interpolateString(
				"{{character}} and {{persona}} are aliases.",
				context
			)
		).toBe("Alice and Bob are aliases.")
	})

	test("substitutes additional context variables", () => {
		const engine = new InterpolationEngine()
		const context = makeContext({ scene: "a dark forest" })
		expect(
			engine.interpolateString("Setting: {{scene}}", context)
		).toBe("Setting: a dark forest")
	})

	test("returns undefined unchanged when template is undefined", () => {
		const engine = new InterpolationEngine()
		expect(
			engine.interpolateString(undefined, makeContext())
		).toBeUndefined()
	})

	test("returns an empty string unchanged (falsy short-circuit)", () => {
		const engine = new InterpolationEngine()
		expect(engine.interpolateString("", makeContext())).toBe("")
	})

	test("falls back to the raw template string on a compile error instead of throwing", () => {
		const engine = new InterpolationEngine()
		// Unbalanced/invalid Handlebars syntax - {{#if}} with no matching {{/if}}
		const malformed = "{{#if char}}Hello {{char}}"
		expect(() =>
			engine.interpolateString(malformed, makeContext())
		).not.toThrow()
		expect(engine.interpolateString(malformed, makeContext())).toBe(
			malformed
		)
	})
})

describe("InterpolationEngine.interpolateObject", () => {
	test("without a stringFields filter, interpolates every string value on the object", () => {
		const engine = new InterpolationEngine()
		const context = makeContext()
		const result = engine.interpolateObject(
			{
				greeting: "Hi {{user}}",
				title: "{{char}}'s story",
				count: 3
			},
			context
		)
		expect(result).toEqual({
			greeting: "Hi Bob",
			title: "Alice's story",
			count: 3
		})
	})

	test("with a stringFields filter, only interpolates the listed fields", () => {
		const engine = new InterpolationEngine()
		const context = makeContext()
		const result = engine.interpolateObject(
			{
				greeting: "Hi {{user}}",
				title: "{{char}}'s story",
				count: 3
			},
			context,
			["greeting"]
		)
		expect(result).toEqual({
			greeting: "Hi Bob",
			title: "{{char}}'s story", // left untouched - not in stringFields
			count: 3
		})
	})

	test("non-string fields are left untouched even without a filter", () => {
		const engine = new InterpolationEngine()
		const context = makeContext()
		const nested = { deep: true }
		const result = engine.interpolateObject(
			{ label: "{{char}}", nested, flag: false },
			context
		)
		expect(result.nested).toBe(nested)
		expect(result.flag).toBe(false)
		expect(result.label).toBe("Alice")
	})
})
