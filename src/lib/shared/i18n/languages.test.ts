/**
 * The language table's invariants (R5).
 *
 * These are asserted rather than trusted because the table is read by two very
 * different consumers with no overlap in what they'd notice: a dropdown, where
 * a wrong entry looks like a typo, and the lexical retrieval mechanism, where a wrong
 * `features` flag silently changes what a query matches. Nothing in between
 * would fail.
 */
import { describe, expect, test } from "vitest"
import {
	DEFAULT_LANGUAGE,
	DEFAULT_LANGUAGE_DEFINITION,
	LANGUAGES,
	isSupportedLanguage,
	languageDefinition,
	languageSupports
} from "./languages"

describe("the language table", () => {
	test("English is present and is the default", () => {
		// `DEFAULT_LANGUAGE_DEFINITION` is a non-null assertion at module load;
		// this is what makes that assertion true rather than hopeful.
		expect(DEFAULT_LANGUAGE).toBe("en")
		expect(DEFAULT_LANGUAGE_DEFINITION.code).toBe("en")
		expect(LANGUAGES[0].code).toBe("en")
	})

	test("every code is a distinct ISO 639-1 two-letter code", () => {
		// Two-letter is not cosmetic: the translation library validates
		// `from`/`to` against ISO 639-1 and throws on anything else, so a
		// regional subtag sneaking in here breaks translation at runtime for
		// exactly the users who selected it.
		const codes = LANGUAGES.map((l) => l.code)
		expect(new Set(codes).size).toBe(codes.length)
		for (const code of codes) expect(code).toMatch(/^[a-z]{2}$/)
	})

	test("every entry carries display text and a direction", () => {
		for (const l of LANGUAGES) {
			expect(l.name.length).toBeGreaterThan(0)
			expect(l.endonym.length).toBeGreaterThan(0)
			expect(["ltr", "rtl"]).toContain(l.direction)
		}
	})
})

describe("languageSupports — the R5 gate", () => {
	test("English stems", () => {
		expect(languageSupports("en", "stemming")).toBe(true)
	})

	test("a language with no Snowball stemmer reports false", () => {
		// The whole point of the flag: these are real languages with real
		// users, and they take the trigram path rather than being unsupported.
		for (const code of ["pl", "uk", "cs", "ja", "zh", "th", "ko", "vi"]) {
			expect(languageSupports(code, "stemming")).toBe(false)
		}
	})

	test("the languages without word spacing are marked as such", () => {
		for (const code of ["ja", "zh", "th"]) {
			expect(languageSupports(code, "whitespaceDelimited")).toBe(false)
		}
		// Korean writes spaces between eojeol, so only the stemmer is missing.
		expect(languageSupports("ko", "whitespaceDelimited")).toBe(true)
	})

	test("an unknown language answers as English rather than throwing", () => {
		// The downgrade path: an install that lost a language keeps working.
		// It must not throw, because a settings read is on the critical path of
		// every page load.
		expect(languageSupports("kl", "stemming")).toBe(true)
		expect(languageSupports(null, "stemming")).toBe(true)
		expect(languageSupports(undefined, "stemming")).toBe(true)
	})
})

describe("isSupportedLanguage", () => {
	test("accepts a listed code and refuses everything else", () => {
		expect(isSupportedLanguage("es")).toBe(true)
		expect(isSupportedLanguage("kl")).toBe(false)
		expect(isSupportedLanguage("")).toBe(false)
		expect(isSupportedLanguage(null)).toBe(false)
		// Regional subtags are refused rather than truncated: the writers use
		// this as their guard, and quietly accepting `pt-BR` would store a code
		// the translate engine then rejects.
		expect(isSupportedLanguage("pt-BR")).toBe(false)
	})
})

describe("languageDefinition", () => {
	test("collapses an unknown code onto English", () => {
		expect(languageDefinition("kl").code).toBe("en")
		expect(languageDefinition("es").code).toBe("es")
	})
})
