import { describe, expect, test } from "vitest"
import { BOOK_DEFAULT_RULES } from "$lib/shared/rulesets/rulesOffer"
import {
	FIT_RATING_WORD,
	FREEFORM_BOOK_FIT,
	fitWords,
	isFreeformBook,
	rulesFitLine,
	rulesFitTitle,
	rulesFitWhy,
	type RulesetGenreFit
} from "./rulesFitWords"

const fit = (
	genreName: string,
	rating: RulesetGenreFit["rating"],
	reason: string
): RulesetGenreFit => ({
	genreId: genreName.toLowerCase(),
	genreName,
	rating,
	reason
})

const FITS = [
	fit("Story", "great", "everything it plays best with is here"),
	fit("Lair", "good", "a health-like number — told in words"),
	fit("Dungeon Crawler", "poor", "most of what it plays best with is missing")
]

describe("the fit words", () => {
	test("each rating has the start form's word, and Not offered", () => {
		expect(FIT_RATING_WORD).toEqual({
			incompatible: "Incompatible",
			poor: "Poor",
			ok: "Ok",
			good: "Good",
			great: "Great",
			perfect: "Perfect",
			"not-offered": "Not offered"
		})
	})

	test("one genre reads 'Genre: Rating'", () => {
		expect(fitWords(FITS[1]!)).toBe("Lair: Good")
		expect(fitWords(fit("Mundi", "not-offered", "x"))).toBe(
			"Mundi: Not offered"
		)
	})

	test("the line joins the genres with ' · ' and is empty when none rate", () => {
		expect(rulesFitLine(FITS)).toBe(
			"Story: Great · Lair: Good · Dungeon Crawler: Poor"
		)
		expect(rulesFitLine([])).toBe("")
		expect(rulesFitLine(undefined)).toBe("")
		expect(rulesFitLine(null)).toBe("")
	})

	test("a why carries its reason; the title holds one per line", () => {
		expect(rulesFitWhy(FITS[1]!)).toBe(
			"Lair: Good (a health-like number — told in words)"
		)
		expect(rulesFitTitle(FITS)).toBe(
			[
				"Story: Great (everything it plays best with is here)",
				"Lair: Good (a health-like number — told in words)",
				"Dungeon Crawler: Poor (most of what it plays best with is missing)"
			].join("\n")
		)
		expect(rulesFitTitle(undefined)).toBe("")
	})

	test("Freeform is none stored or the default rules; anything else is not", () => {
		expect(isFreeformBook(null)).toBe(true)
		expect(isFreeformBook(undefined)).toBe(true)
		expect(isFreeformBook("")).toBe(true)
		expect(isFreeformBook(BOOK_DEFAULT_RULES)).toBe(true)
		expect(isFreeformBook("core:ruleset/vis-itineris@1")).toBe(false)
		expect(FREEFORM_BOOK_FIT).toBe(
			"Freeform — the session chooses the rules"
		)
	})
})
