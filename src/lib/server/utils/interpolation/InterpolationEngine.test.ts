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
		expect(engine.interpolateString("Setting: {{scene}}", context)).toBe(
			"Setting: a dark forest"
		)
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

describe("InterpolationEngine.interpolateString — Character Card V3 macros", () => {
	test("resolves {{random:...}} to one of the given values, alongside a plain {{char}} lookup", () => {
		const engine = new InterpolationEngine()
		const rendered = engine.interpolateString(
			"{{char}} says {{random:hi,hey,hello}}",
			makeContext()
		)
		expect(rendered).toMatch(/^Alice says (hi|hey|hello)$/)
	})

	test("resolves {{roll:d6}} to a number between 1 and 6", () => {
		const engine = new InterpolationEngine()
		const rendered = engine.interpolateString("{{roll:d6}}", makeContext())
		const n = Number(rendered)
		expect(n).toBeGreaterThanOrEqual(1)
		expect(n).toBeLessThanOrEqual(6)
	})

	test("resolves {{reverse:abc}} to the reversed string", () => {
		const engine = new InterpolationEngine()
		expect(engine.interpolateString("{{reverse:abc}}", makeContext())).toBe(
			"cba"
		)
	})

	test("{{comment: ...}}/{{// ...}}/{{hidden_key:...}} all render empty", () => {
		const engine = new InterpolationEngine()
		expect(
			engine.interpolateString("[{{comment: hidden}}]", makeContext())
		).toBe("[]")
		expect(engine.interpolateString("[{{// hidden}}]", makeContext())).toBe(
			"[]"
		)
		expect(
			engine.interpolateString("[{{hidden_key:hidden}}]", makeContext())
		).toBe("[]")
	})

	test("{{pick:...}} (not implemented) renders empty without breaking the rest of the field", () => {
		const engine = new InterpolationEngine()
		expect(
			engine.interpolateString(
				"{{char}} picks {{pick:a,b,c}} then leaves.",
				makeContext()
			)
		).toBe("Alice picks  then leaves.")
	})

	test("two separate InterpolationEngine instances don't error re-registering the same helpers", () => {
		expect(() => {
			const a = new InterpolationEngine()
			const b = new InterpolationEngine()
			a.interpolateString("{{roll:d4}}", makeContext())
			b.interpolateString("{{roll:d4}}", makeContext())
		}).not.toThrow()
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
