import { describe, expect, test } from "vitest"
import { LorebookMatcher, HistoryMatcher } from "./ContentMatchers"

// SelectWorldLoreEntry / SelectCharacterLoreEntry / SelectHistoryEntry are
// ambient global types (declared in src/lib/server/db/types.d.ts) inferred
// from the Drizzle schema, so fixtures below are plain objects with only the
// fields the matchers actually read (`keys`, `caseSensitive`, `useRegex`),
// cast via `as any`.

function loreEntry(overrides: Record<string, any> = {}) {
	return {
		keys: "foo",
		caseSensitive: false,
		useRegex: false,
		...overrides
	} as any
}

function historyEntry(overrides: Record<string, any> = {}) {
	return {
		keys: "foo",
		caseSensitive: false,
		useRegex: false,
		...overrides
	} as any
}

describe("LorebookMatcher", () => {
	const matcher = new LorebookMatcher()

	test("case-insensitive substring match (default): matches regardless of case", () => {
		const entry = loreEntry({ keys: "Dragon" })
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(true)
	})

	test("case-insensitive substring match: no match when key absent", () => {
		const entry = loreEntry({ keys: "Dragon" })
		expect(matcher.matches("A wizard cast a spell", entry)).toBe(false)
	})

	test("case-sensitive: requires exact case to match", () => {
		const entry = loreEntry({ keys: "Dragon", caseSensitive: true })
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(false)
		expect(matcher.matches("A Dragon flew overhead", entry)).toBe(true)
	})

	test("multiple comma-separated keys: matches if any key matches", () => {
		const entry = loreEntry({ keys: "dragon,griffin,phoenix" })
		expect(matcher.matches("A griffin soared past", entry)).toBe(true)
		expect(matcher.matches("A snail crawled by", entry)).toBe(false)
	})

	test("keys are trimmed of surrounding whitespace before matching", () => {
		// "foo, bar" splits into "foo" and " bar" (with a leading space) - the
		// matcher trims each key before comparing, so " bar" still matches
		// content with no leading space in front of "bar".
		const entry = loreEntry({ keys: "foo, bar" })
		expect(matcher.matches("barstool", entry)).toBe(true)
	})

	test("useRegex: matches using the key as a regex pattern", () => {
		const entry = loreEntry({ keys: "drag\\w+", useRegex: true })
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(true)
		expect(matcher.matches("A wizard cast a spell", entry)).toBe(false)
	})

	test("useRegex + caseSensitive: regex respects case sensitivity via content/key casing", () => {
		const entry = loreEntry({
			keys: "Dragon",
			useRegex: true,
			caseSensitive: true
		})
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(false)
		expect(matcher.matches("A Dragon flew overhead", entry)).toBe(true)
	})
})

describe("HistoryMatcher", () => {
	const matcher = new HistoryMatcher()

	test("case-insensitive substring match (default): matches regardless of case", () => {
		const entry = historyEntry({ keys: "Dragon" })
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(true)
	})

	test("case-sensitive: requires exact case to match", () => {
		const entry = historyEntry({ keys: "Dragon", caseSensitive: true })
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(false)
		expect(matcher.matches("A Dragon flew overhead", entry)).toBe(true)
	})

	test("multiple comma-separated keys: matches if any key matches", () => {
		const entry = historyEntry({ keys: "dragon,griffin,phoenix" })
		expect(matcher.matches("A griffin soared past", entry)).toBe(true)
		expect(matcher.matches("A snail crawled by", entry)).toBe(false)
	})

	test("unlike LorebookMatcher, keys are NOT trimmed - a leading space from splitting on ',' is preserved and can prevent a match", () => {
		// "foo, bar" splits into "foo" and " bar" (leading space kept as-is).
		// Content with no leading space directly in front of "bar" won't match.
		const entry = historyEntry({ keys: "foo, bar" })
		expect(matcher.matches("barstool", entry)).toBe(false)
		// But content that happens to have a space before "bar" still matches.
		expect(matcher.matches("a bar of soap", entry)).toBe(true)
	})

	test("useRegex: matches using the key as a regex pattern", () => {
		const entry = historyEntry({ keys: "drag\\w+", useRegex: true })
		expect(matcher.matches("A dragon flew overhead", entry)).toBe(true)
		expect(matcher.matches("A wizard cast a spell", entry)).toBe(false)
	})
})
