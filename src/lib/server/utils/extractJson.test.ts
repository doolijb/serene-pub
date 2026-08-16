/**
 * The repo's JSON extractor, which spent its life module-private inside
 * graphBuilder.ts with no tests of its own while a weaker greedy regex did the
 * same job in the summarizer.
 */
import { describe, expect, test } from "vitest"
import { extractJson, hasJsonObject, JsonExtractionError } from "./extractJson"

/** What summarizer/index.ts used to do. Kept here purely to prove the difference. */
const greedy = (raw: string) => raw.match(/\{[\s\S]*\}/)?.[0]

describe("extractJson", () => {
	test("returns a plain object untouched", () => {
		expect(extractJson('{"a":1}')).toBe('{"a":1}')
	})

	test("strips markdown fences", () => {
		expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
		expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}')
	})

	test("handles nested braces", () => {
		const src = '{"a":{"b":{"c":[1,2]}}}'
		expect(JSON.parse(extractJson(src))).toEqual({
			a: { b: { c: [1, 2] } }
		})
	})

	test("a brace inside a string literal does not terminate the object", () => {
		const src = '{"note":"a } inside text","ok":true}'
		expect(JSON.parse(extractJson(src))).toEqual({
			note: "a } inside text",
			ok: true
		})
	})

	test("escaped quotes do not confuse the string tracker", () => {
		const src = '{"quote":"she said \\"} hello\\"","ok":true}'
		expect(JSON.parse(extractJson(src))).toEqual({
			quote: 'she said "} hello"',
			ok: true
		})
	})

	test("takes the FIRST object, ignoring anything after it", () => {
		expect(extractJson('{"a":1}\n{"b":2}')).toBe('{"a":1}')
	})

	describe("the greedy-regex regressions this replaces", () => {
		// summarizer/index.ts used `raw.match(/\{[\s\S]*\}/)`, which runs to the
		// LAST closing brace anywhere in the response. Both inputs below are
		// things a model actually does, and both broke it. Failures there
		// degrade silently to an empty cast, so nobody saw them.
		test("trailing commentary after the object", () => {
			const raw = '{"participants":["Aria"]}  Hope that helps! {shrug}'
			expect(() => JSON.parse(greedy(raw)!)).toThrow()
			expect(JSON.parse(extractJson(raw))).toEqual({
				participants: ["Aria"]
			})
		})

		test("a second object in the response", () => {
			const raw = '{"participants":["Aria"]}\n\n{"mentioned":["Bram"]}'
			expect(() => JSON.parse(greedy(raw)!)).toThrow()
			expect(JSON.parse(extractJson(raw))).toEqual({
				participants: ["Aria"]
			})
		})
	})

	test("prose with no object at all throws, and is not flagged truncated", () => {
		try {
			extractJson("The air smelled of ozone. I leaned against the table.")
			throw new Error("should have thrown")
		} catch (e) {
			expect(e).toBeInstanceOf(JsonExtractionError)
			expect((e as JsonExtractionError).truncated).toBe(false)
		}
	})

	test("an object cut off mid-way IS flagged truncated", () => {
		// Distinguishing this from "no JSON" matters: it usually means the
		// response hit the token limit, which is a different fix.
		try {
			extractJson('{"relationships":[{"to":"Aria"')
			throw new Error("should have thrown")
		} catch (e) {
			expect((e as JsonExtractionError).truncated).toBe(true)
		}
	})

	test("carries the raw text for diagnostics", () => {
		const raw = "no json here"
		try {
			extractJson(raw)
		} catch (e) {
			expect((e as JsonExtractionError).raw).toBe(raw)
		}
	})
})

describe("hasJsonObject", () => {
	test("true for a complete object, false for prose or a truncated one", () => {
		expect(hasJsonObject('{"a":1}')).toBe(true)
		expect(hasJsonObject("I leaned against the table.")).toBe(false)
		expect(hasJsonObject('{"a":')).toBe(false)
	})
})
