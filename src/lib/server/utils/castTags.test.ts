import { describe, expect, test } from "vitest"
import {
	castTag,
	castTagNumber,
	castTagsIn,
	importedCastTagNumber,
	importedCastTagsIn,
	rewriteCastTags,
	rewriteCastTagsDeep,
	rewriteImportedCastTagsDeep
} from "./castTags"

describe("cast tags", () => {
	test("only {{char:N}} is a tag", () => {
		expect(
			castTagsIn(
				"{{char:1}} and {char:2}, {{char:3} {char:4}}, {{roll:20}}"
			)
		).toEqual([1])
		expect(castTagNumber("{{roll:20}}")).toBeNull()
		expect(castTagNumber("{char:7}")).toBeNull()
		expect(castTagNumber("{{char:7}}")).toBe(7)
		expect(castTagNumber("{{char:0}}")).toBeNull()
		expect(castTagNumber("{{char:test-1}}")).toBeNull()
		expect(castTagNumber(" {{char:7}}")).toBeNull()
	})

	test("a number the counter cannot hold is not a tag", () => {
		expect(castTagNumber("{{char:2147483646}}")).toBe(2147483646)
		expect(castTagNumber("{{char:2147483647}}")).toBeNull()
		expect(castTagsIn("{{char:99999999999}}")).toEqual([])
	})

	test("one stored spelling", () => {
		expect(castTag(3)).toBe("{{char:3}}")
	})

	test("rewrites one member's tags and nothing else", () => {
		const out = rewriteCastTags(
			"{{char:2}} met {char:2}, {{char:12}} and {{roll:2}}.",
			(n) => (n === 2 ? "{{char:1}}" : null)
		)
		expect(out).toBe("{{char:1}} met {char:2}, {{char:12}} and {{roll:2}}.")
	})

	test("walks JSON values: strings, arrays, objects — never keys", () => {
		const value = {
			content: "Later {{char:2}} left.",
			keys: ["{{char:2}}", "x"],
			"{{char:2}}": 3,
			nested: { n: 1, on: true, s: null }
		}
		expect(
			rewriteCastTagsDeep(value, (n) => (n === 2 ? "Tam" : null))
		).toEqual({
			content: "Later Tam left.",
			keys: ["Tam", "x"],
			"{{char:2}}": 3,
			nested: { n: 1, on: true, s: null }
		})
	})
})

describe("a 0.5 file's cast tags (the import's reader)", () => {
	test("reads 0.5's spelling and the half-braced slips 0.5 read", () => {
		expect(importedCastTagNumber("{char:7}")).toBe(7)
		expect(importedCastTagNumber("{{char:7}}")).toBe(7)
		expect(importedCastTagNumber("{{roll:7}}")).toBeNull()
		expect(
			importedCastTagsIn({
				content: "{char:2} and {{char:9}}",
				keys: ["{{char:5}"]
			})
		).toEqual([2, 9, 5])
	})

	test("tells the spellings apart for a caller that asks", () => {
		const out = rewriteImportedCastTagsDeep(
			{ content: "{char:1} / {{char:1}}" },
			(n, written) => (written === "{char:1}" ? "{{char:5}}" : castTag(n))
		)
		expect(out).toEqual({ content: "{{char:5}} / {{char:1}}" })
	})
})
