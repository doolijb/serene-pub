/**
 * Runaway patterns (plan lorebooks-consolidation S3): what the write side
 * refuses, and — as important — the ordinary regex keys it must not.
 */

import { describe, it, expect } from "vitest"
import {
	PATTERN_MAX_LENGTH,
	readsAsRegex,
	runawayPatternOf,
	runawayRefusal
} from "$lib/shared/entries/runawayPattern"

describe("runaway patterns", () => {
	it.each([
		["(a+)+$", "nestedRepeat"],
		["(a*)*", "nestedRepeat"],
		["^(\\w+\\s?)*$", "nestedRepeat"],
		["(\\d+)*x", "nestedRepeat"],
		["(.*,)+", "nestedRepeat"],
		["(x+x+)+y", "nestedRepeat"],
		["((ab)*)+c", "nestedRepeat"],
		["(?:a+|b)+c", "nestedRepeat"],
		["(?:\\s*\\w+)+$", "nestedRepeat"],
		["(a{1,30}){1,30}$", "nestedRepeat"],
		["(?<word>\\w+\\s?)+!", "nestedRepeat"],
		["(a|a)*b", "overlappingAlternatives"],
		["(a|aa)+b", "overlappingAlternatives"],
		["(\\w|\\d)+!", "overlappingAlternatives"],
		["(\\s|.)*x", "overlappingAlternatives"]
	])("refuses %s (%s)", (pattern, rule) => {
		expect(runawayPatternOf(pattern)?.rule).toBe(rule)
	})

	it.each([
		"\\bdragons?\\b",
		"(?:ash|ember)guard",
		"\\b(?:alice|bob|carol|dave)\\b",
		"(\\w+\\s)+end",
		"(\\d{1,3}\\.){3}\\d{1,3}",
		"(?:cat|car)s+",
		"((?:cat|car)s)+",
		"(?:a\\d|a\\s)+",
		"(.|\\n)*x",
		"(?:[^,]+,)*",
		"\\b(?:\\w+\\s+){0,3}dragon\\b",
		"(?:x+y+)+",
		"^The .* of .*$",
		"(?<![\\p{L}\\p{N}_])ash(?![\\p{L}\\p{N}_])",
		"(ab){2,3}",
		"\\Bing",
		"[a-z]+\\d+"
	])("lets %s through", (pattern) => {
		expect(runawayPatternOf(pattern)).toBeNull()
	})

	it("refuses a pattern past the length cap, and not one at it", () => {
		expect(runawayPatternOf("a".repeat(PATTERN_MAX_LENGTH + 1))?.rule).toBe("tooLong")
		expect(runawayPatternOf("a".repeat(PATTERN_MAX_LENGTH))).toBeNull()
	})

	it("calls an invalid pattern nothing: it never compiles, and falls back to substring", () => {
		expect(runawayPatternOf("(unclosed")).toBeNull()
		expect(runawayPatternOf("ember(")).toBeNull()
	})

	describe("what the security review got past it", () => {
		it.each([
			// An inline modifier group stopped the parser, and "cannot read"
			// was read as "safe".
			["(?i:)(a+)+$", "nestedRepeat"],
			["(?i:(a+)+)$", "nestedRepeat"],
			["(?-i:\\w+\\s?)+$", "nestedRepeat"],
			// Under `s`, `.` takes a line break, so `.|\n` overlaps.
			["(?s:.|\\n)*x", "overlappingAlternatives"],
			// Bounded, but 16¹⁶ ways to divide a run: the product of the
			// counts (256) is not the number of ways.
			["(?:a{1,16}){1,16}$", "nestedRepeat"],
			["(?:a{1,8}){1,32}$", "nestedRepeat"],
			// Letters V8 folds together under `i`, by upper case.
			["(?:µ|μ)*x", "overlappingAlternatives"],
			["(?:σ|ς)+x", "overlappingAlternatives"],
			["(?:[µ]|[μ])+x", "overlappingAlternatives"],
			// Sets whose characters the probe sample never held.
			["(?:[λ]|[λμ])+!", "overlappingAlternatives"],
			["(?:[α-γ]|[β-δ])+x", "overlappingAlternatives"],
			["(?:[\\b]|\\x08)+x", "overlappingAlternatives"],
			["(?:[\\u4e00-\\u4e10]|[\\u4e08])*z", "overlappingAlternatives"]
		])("refuses %s (%s)", (pattern, rule) => {
			expect(runawayPatternOf(pattern)?.rule).toBe(rule)
		})

		it.each([
			"(?i:dragon)s?",
			"(?-i:Ash)guard",
			"(?i:alice|bob)+",
			"(\\d{1,3}){3}",
			"(?:a{1,2}){1,4}$",
			"(?:[α-γ]|[δ-ζ])+x",
			"\\k<a",
			"(?<n>a)\\k<n>"
		])("still lets %s through", (pattern) => {
			expect(runawayPatternOf(pattern)).toBeNull()
		})

		it("refuses a pattern too intricate to judge, in bounded time", () => {
			// Five hundred single letters, every pair compared under a repeat.
			const letters = Array.from({ length: 500 }, (_, i) => String.fromCharCode(0x4e00 + i))
			const pattern = `(?:${letters.join("|")})+`
			expect(pattern.length).toBeLessThanOrEqual(PATTERN_MAX_LENGTH)
			const started = performance.now()
			expect(runawayPatternOf(pattern)?.rule).toBe("tooIntricate")
			expect(performance.now() - started).toBeLessThan(100)
		})
	})

	it("names the key and the reason in the refusal", () => {
		const found = runawayPatternOf("(a+)+$")!
		const line = runawayRefusal("(a+)+$", found)
		expect(line).toContain("“(a+)+$”")
		expect(line).toContain("repeats a group that already repeats")
	})

	it("reads the mode the way the matcher does: matchMode first, then useRegex", () => {
		expect(readsAsRegex({ matchMode: "regex" })).toBe(true)
		expect(readsAsRegex({ useRegex: true })).toBe(true)
		expect(readsAsRegex({ matchMode: "word", useRegex: true })).toBe(false)
		expect(readsAsRegex({ matchMode: "bogus", useRegex: true })).toBe(true)
		expect(readsAsRegex({})).toBe(false)
	})
})
