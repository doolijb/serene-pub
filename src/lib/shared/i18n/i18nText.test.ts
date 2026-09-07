/**
 * Reading SDK `I18n` values in a language (R5).
 *
 * The fallback order is the whole behaviour, and getting it backwards would be
 * invisible on an English install — which is every install until somebody
 * changes a setting.
 */
import { describe, expect, test } from "vitest"
import { i18nTextIn } from "./i18nText"

describe("i18nTextIn", () => {
	test("a bare string is its own display text in every language", () => {
		// The `string` half of `I18n`, which is what most declarations use.
		expect(i18nTextIn("Scan Depth", "es")).toBe("Scan Depth")
	})

	test("prefers the requested language", () => {
		expect(i18nTextIn({ en: "Depth", es: "Profundidad" }, "es")).toBe(
			"Profundidad"
		)
	})

	test("falls back to English when the language is absent", () => {
		expect(i18nTextIn({ en: "Depth", fr: "Profondeur" }, "es")).toBe(
			"Depth"
		)
	})

	test("falls back to English when the entry is an empty string", () => {
		// A half-filled locale map is the normal state of a machine-translated
		// or partially-authored descriptor. An empty string must read as
		// "missing", not as a blank label on screen.
		expect(i18nTextIn({ en: "Depth", es: "" }, "es")).toBe("Depth")
	})

	test("defaults to English when no language is given", () => {
		// Every pre-R5 call site passes no language and must keep resolving
		// exactly the English it did before.
		expect(i18nTextIn({ en: "Depth", es: "Profundidad" })).toBe("Depth")
	})

	test("returns undefined for values that carry no text", () => {
		expect(i18nTextIn(undefined)).toBeUndefined()
		expect(i18nTextIn(null)).toBeUndefined()
		expect(i18nTextIn({}, "es")).toBeUndefined()
		expect(i18nTextIn({ es: "Profundidad" }, "fr")).toBeUndefined()
		expect(i18nTextIn(42)).toBeUndefined()
	})
})
