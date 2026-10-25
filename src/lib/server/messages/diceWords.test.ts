/**
 * 🚧 Outcome words (lane M2, 2026-10-22): an outcome block's result in words
 * with no number in it — the sentence every stored row reads for a die
 * against a target, and, for any other check method, how it was decided.
 */
import { describe, expect, test } from "vitest"
import { diceHidden, diceWordsOf, outcomeWordsOf } from "./diceWords"

describe("outcome words", () => {
	test("a die against a target reads as it always has; every other method says how it was decided", async () => {
		const blocks = [
			{ kind: "dice", stat: "Stealth", rolled: 15, against: 14, outcome: "Success" },
			{ kind: "dice", method: "die-target", stat: "Athletics", rolled: 4, against: 14, outcome: "Failure." },
			{ kind: "group", blocks: [{ kind: "dice", method: "dice-pool", stat: "Sneak", rolled: 2, pool: { size: 3, successes: 2 }, outcome: "Hit" }] },
			{ kind: "dice", method: "card-draw", stat: "Read", rolled: 14, cards: [{ label: "Queen of hearts" }], outcome: "Hit" },
			{ kind: "dice", method: "compare", stat: "Will", rolled: 4, against: 2, outcome: "Hit" },
			{ kind: "dice", method: "bid", stat: "Nerve", rolled: 2, outcome: "Hit" },
			{ kind: "dice", method: "none", stat: "Talk", outcome: "She talks her way in" },
			{ kind: "dice", method: "acme:tarot", stat: "Omen", outcome: "The Tower" },
			{ kind: "md", text: "not an outcome" }
		]
		expect(await outcomeWordsOf(null as never, blocks)).toBe(
			[
				"Stealth: Success.",
				"Athletics: Failure.",
				"Sneak, by a pool of dice: Hit.",
				"Read, by the cards: Hit.",
				"Will, by comparison: Hit.",
				"Nerve, by a spend: Hit.",
				"Talk, as judged: She talks her way in.",
				"Omen: The Tower."
			].join("\n")
		)
		// No number reaches the words.
		expect(await outcomeWordsOf(null as never, blocks)).not.toMatch(/\d/)
		expect(await outcomeWordsOf(null as never, [{ kind: "md", text: "x" }])).toBeNull()
		expect(diceWordsOf).toBe(outcomeWordsOf)
	})

	test("Show outcomes off — the field id kept", () => {
		expect(diceHidden({ showDice: false })).toBe(true)
		expect(diceHidden({ showDice: true })).toBe(false)
		expect(diceHidden(null)).toBe(false)
	})
})
