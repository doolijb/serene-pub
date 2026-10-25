/**
 * 🚧 A16: a requirement's version range, as a package author writes it.
 */
import { describe, expect, it } from "vitest"
import { parseVersion, satisfiesRange } from "./versionRange"

describe("satisfiesRange (A16)", () => {
	it("reads versions, missing parts as 0", () => {
		expect(parseVersion("1.2")).toEqual({ major: 1, minor: 2, patch: 0, pre: null })
		expect(parseVersion("0.6.0-pr-5")).toEqual({ major: 0, minor: 6, patch: 0, pre: "pr-5" })
		expect(parseVersion("nope")).toBeNull()
	})

	it("caret keeps the leftmost non-zero part", () => {
		expect(satisfiesRange("1.4.2", "^1.2")).toBe(true)
		expect(satisfiesRange("2.0.0", "^1.2")).toBe(false)
		expect(satisfiesRange("1.1.9", "^1.2")).toBe(false)
		expect(satisfiesRange("0.3.9", "^0.3.1")).toBe(true)
		expect(satisfiesRange("0.4.0", "^0.3.1")).toBe(false)
		expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false)
	})

	it("tilde, exact, partial and wildcards", () => {
		expect(satisfiesRange("1.2.9", "~1.2.3")).toBe(true)
		expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false)
		expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true)
		expect(satisfiesRange("1.2.4", "=1.2.3")).toBe(false)
		expect(satisfiesRange("1.9.0", "1.x")).toBe(true)
		expect(satisfiesRange("2.0.0", "1")).toBe(false)
		expect(satisfiesRange("1.2.7", "1.2.*")).toBe(true)
		expect(satisfiesRange("9.9.9", "*")).toBe(true)
	})

	it("comparator sets and alternatives", () => {
		expect(satisfiesRange("1.5.0", ">=1.2 <2")).toBe(true)
		expect(satisfiesRange("2.0.0", ">=1.2 <2")).toBe(false)
		expect(satisfiesRange("3.1.0", "^1 || ^3")).toBe(true)
		expect(satisfiesRange("2.1.0", "^1 || ^3")).toBe(false)
	})

	it("a prerelease sits before its release; an unreadable range is unmet", () => {
		expect(satisfiesRange("1.2.0-pr.1", "^1.2.0")).toBe(false)
		expect(satisfiesRange("1.2.0-pr.1", ">=1.2.0-pr.0")).toBe(true)
		expect(satisfiesRange("1.2.0", "banana")).toBe(false)
		expect(satisfiesRange("nope", "^1")).toBe(false)
	})
})
