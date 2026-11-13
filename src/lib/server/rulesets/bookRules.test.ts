/**
 * `strictRulesRefusal` — a genre that plays only certain Rules refuses a book
 * told by others, with the sentence `sessions:create` says; any other genre,
 * or a book whose rules are among them, is not refused.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("@serene-pub/sdk", () => ({
	// Read by the shared rules module (`adoptedBookRules`'s home) at import.
	RIGOUR_LABELS: {},
	getGenre: (id: string) =>
		id === "test:genre/strict"
			? { name: "Strict crawl", rulesets: { only: ["test:ruleset/dice@1"] } }
			: id === "test:genre/dicey"
				? { name: "Dicey", uses: { verbs: "any", dice: "required" } }
			: id === "test:genre/plain"
				? { name: { en: "Plain" } }
			: id === "test:genre/strictdicey"
				? { name: "Strict dicey", uses: { verbs: "any", dice: "required" }, rulesets: { only: ["test:ruleset/dice@1"] } }
			: id === "test:genre/open"
				? { name: "Open tale", rulesets: { recommended: ["test:ruleset/dice@1"], default: "test:ruleset/dice@1" } }
				: undefined,
	getRuleset: (id: string) =>
		({
			"test:ruleset/dice@1": { name: "Dice" },
			"test:ruleset/words@1": { name: { en: "Words" } }
		})[id],
	// Stands in for the SDK's rating: the words ruleset has no dice, the dice one does.
	rulesetFit: (_genre: unknown, ruleset: { name: unknown }) =>
		ruleset.name === "Dice"
			? { rating: "good", reason: "dice told in words" }
			: { rating: "incompatible", reason: "missing dice with no fallback" }
}))

import { rulesetIncompatibleRefusal, strictRulesRefusal } from "./bookRules"

const words = { name: "Atlas", primaryRuleset: "test:ruleset/words@1" }
const dice = { name: "Atlas", primaryRuleset: "test:ruleset/dice@1" }

describe("strictRulesRefusal", () => {
	test("a genre that plays only other rules refuses the book, naming both", () => {
		expect(strictRulesRefusal("test:genre/strict", words)).toBe(
			"Strict crawl plays only by Dice rules, and the lorebook 'Atlas' uses Words rules. " +
				"Choose a lorebook that uses Dice, or another genre."
		)
	})

	test("rules the genre plays, a genre that only recommends, and no genre are all fine", () => {
		expect(strictRulesRefusal("test:genre/strict", dice)).toBeNull()
		expect(strictRulesRefusal("test:genre/open", words)).toBeNull()
		expect(strictRulesRefusal("test:genre/unknown", words)).toBeNull()
		expect(strictRulesRefusal(null, words)).toBeNull()
	})

	test("a book on Freeform, every book's default, brings no rules to refuse: the session plays its own (fix7)", () => {
		expect(
			strictRulesRefusal("test:genre/strict", { name: "Atlas", primaryRuleset: "core:ruleset/freeform@1" })
		).toBeNull()
	})
})

describe("Incompatible rules (owner 2026-11-05)", () => {
	const sentence = "Dicey can't play Words: missing dice with no fallback."

	test("rulesetIncompatibleRefusal alone: the genre's name, the rules' name and the SDK's own reason", () => {
		expect(rulesetIncompatibleRefusal("test:genre/dicey", "test:ruleset/words@1")).toBe(sentence)
		expect(rulesetIncompatibleRefusal("test:genre/dicey", "test:ruleset/dice@1")).toBeNull()
	})

	test("nothing to rate: no genre, a genre without `uses`, an unregistered ruleset", () => {
		expect(rulesetIncompatibleRefusal(null, "test:ruleset/words@1")).toBeNull()
		expect(rulesetIncompatibleRefusal("test:genre/unknown", "test:ruleset/words@1")).toBeNull()
		expect(rulesetIncompatibleRefusal("test:genre/plain", "test:ruleset/words@1")).toBeNull()
		expect(rulesetIncompatibleRefusal("test:genre/dicey", "test:ruleset/nope@1")).toBeNull()
	})

	test("a book on Incompatible rules is refused; a genre without `uses` never rates", () => {
		expect(strictRulesRefusal("test:genre/dicey", words)).toBe(sentence)
		expect(strictRulesRefusal("test:genre/plain", words)).toBeNull()
		expect(strictRulesRefusal("test:genre/dicey", dice)).toBeNull()
	})

	test("a book on Freeform brings no rules, so nothing to rate", () => {
		expect(
			strictRulesRefusal("test:genre/dicey", { name: "Atlas", primaryRuleset: "core:ruleset/freeform@1" })
		).toBeNull()
	})

	test("a starter lorebook says so in the `only` words", () => {
		expect(strictRulesRefusal("test:genre/strict", words, { starter: true })).toBe(
			"Strict crawl plays only by Dice rules, and the starter lorebook 'Atlas' uses Words rules. " +
				"Choose a starter lorebook that uses Dice, or another genre."
		)
	})

	test("a next chapter skips the rating, but an `only` refusal still stands", () => {
		expect(strictRulesRefusal("test:genre/dicey", words, { nextChapter: true })).toBeNull()
		expect(strictRulesRefusal("test:genre/strictdicey", words, { nextChapter: true })).toMatch(
			/^Strict dicey plays only by Dice rules/
		)
	})
})
