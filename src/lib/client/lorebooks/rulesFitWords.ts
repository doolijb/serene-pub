/**
 * 🚧 (s22-V, ruling ★§22-3, owner 2026-11-05) The words for **how each enabled
 * genre rates a set of rules**, for the Rulesets view and Book settings:
 * "Story: Great · Lair: Good · Dungeon Crawler: Poor", each rating with its
 * one-line why on hover or expand. The rating and its reason arrive from the
 * server (`rulesetFitByGenre`); nothing here rates anything.
 */
import { BOOK_DEFAULT_RULES } from "$lib/shared/rulesets/rulesOffer"

/** One genre's word on one set of rules. */
export type RulesetGenreFit = NonNullable<
	Sockets.Rulesets.ListRow["rulesetFitByGenre"]
>[number]

/** The start form's words for a rating, plus _Not offered_ (a genre that plays only other rules). */
export const FIT_RATING_WORD: Record<RulesetGenreFit["rating"], string> = {
	incompatible: "Incompatible",
	poor: "Poor",
	ok: "Ok",
	good: "Good",
	great: "Great",
	perfect: "Perfect",
	"not-offered": "Not offered"
}

/** What a book on Freeform says: it brings no rules of its own. */
export const FREEFORM_BOOK_FIT = "Freeform — the session chooses the rules"

/** "Lair: Good". */
export const fitWords = (f: RulesetGenreFit): string =>
	`${f.genreName}: ${FIT_RATING_WORD[f.rating]}`

/** "Story: Great · Lair: Good"; empty when no genre rates these rules. */
export const rulesFitLine = (
	fits: readonly RulesetGenreFit[] | null | undefined
): string => (fits ?? []).map(fitWords).join(" · ")

/** "Lair: Good (a health-like number — told in words)". */
export const rulesFitWhy = (f: RulesetGenreFit): string =>
	`${fitWords(f)} (${f.reason})`

/** Every genre's why, one per line: the hover on the line. */
export const rulesFitTitle = (
	fits: readonly RulesetGenreFit[] | null | undefined
): string => (fits ?? []).map(rulesFitWhy).join("\n")

/** Whether a book's stored rules are Freeform (none stored reads the same). */
export const isFreeformBook = (
	primaryRuleset: string | null | undefined
): boolean => !primaryRuleset || primaryRuleset === BOOK_DEFAULT_RULES
