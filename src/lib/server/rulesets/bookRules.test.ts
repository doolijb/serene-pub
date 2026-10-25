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
			: id === "test:genre/open"
				? { name: "Open tale", rulesets: { recommended: ["test:ruleset/dice@1"], default: "test:ruleset/dice@1" } }
				: undefined,
	getRuleset: (id: string) =>
		({
			"test:ruleset/dice@1": { name: "Dice" },
			"test:ruleset/words@1": { name: { en: "Words" } }
		})[id]
}))

import { strictRulesRefusal } from "./bookRules"

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
