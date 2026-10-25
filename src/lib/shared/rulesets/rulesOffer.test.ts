/**
 * 🚧 How strict follows the rules chosen (2026-10-18, the 100-turn walk #26:
 * the form allowed Story with stricter rules): a ruleset that decides
 * nothing by its rules plays Words only (🚧 2026-10-22: any check method but
 * `none` decides — dice or not).
 */
import { describe, expect, test } from "vitest"
import { freeformRuleset } from "@serene-pub/core-catalog"
import {
	adoptedBookRules,
	BOOK_DEFAULT_RULES,
	howStrictChoices,
	rigourFor,
	rigoursPlayed,
	rulesField,
	withRigoursPlayed
} from "./rulesOffer"
import { genreRulesOffer } from "$lib/server/rulesets/genreOffer"

const STORY = { id: "core:ruleset/freeform@1", name: { en: "Story" }, description: { en: "Words." } }
const VI = { id: "core:ruleset/vis-itineris@1", name: { en: "Vis Itineris" }, description: { en: "Dice." } }
const genre = { rulesets: { recommended: [VI.id], default: VI.id }, rigour: { options: ["prose", "mechanics", "scripts"], default: "scripts" } }
const rollsDice = (id: string) => id === VI.id

describe("🚧 what decides (M2, 2026-10-22)", () => {
	test("any check method but none — a diceless ruleset plays every rigour; Story none", async () => {
		await import("@serene-pub/core-catalog")
		const { getRuleset } = await import("@serene-pub/sdk")
		const { rulesetDecides } = await import("$lib/server/rulesets/methods")
		expect(rulesetDecides(getRuleset(STORY.id))).toBe(false)
		expect(rulesetDecides(getRuleset(VI.id))).toBe(true)
		const time = { unit: "scene" }
		expect(rulesetDecides({ conventions: { methods: { risk: { kind: "bid", resource: "nerve", costs: [] } }, time } } as never)).toBe(true)
		expect(rulesetDecides({ conventions: { methods: { judge: { kind: "none" } }, time } } as never)).toBe(false)
		expect(rulesetDecides(undefined)).toBe(false)
	})
})

describe("rules that decide nothing play Words only", () => {
	test("the offer says which How strict each choice plays", () => {
		expect(rigoursPlayed(false, genre.rigour.options)).toEqual(["prose"])
		expect(rigoursPlayed(true, genre.rigour.options)).toBeUndefined()
		expect(rigoursPlayed(false, ["prose"])).toBeUndefined()
		const offer = withRigoursPlayed(genreRulesOffer(genre, [STORY, VI] as any)!, rollsDice)
		expect(offer.choices.find((c) => c.id === STORY.id)?.rigours).toEqual(["prose"])
		expect(offer.choices.find((c) => c.id === VI.id)?.rigours).toBeUndefined()
	})
	test("the form's choices and the value follow the chosen rules", () => {
		const offer = withRigoursPlayed(genreRulesOffer(genre, [STORY, VI] as any)!, rollsDice)
		expect(howStrictChoices(offer, STORY.id).map((o) => o.id)).toEqual(["prose"])
		expect(howStrictChoices(offer, VI.id).map((o) => o.id)).toEqual(["prose", "mechanics", "scripts"])
		expect(rigourFor(offer, STORY.id, "scripts")).toBe("prose")
		expect(rigourFor(offer, VI.id, null)).toBe("scripts")
		expect(rigourFor(offer, VI.id, "mechanics")).toBe("mechanics")
	})
})

/**
 * fix7 (2026-10-23, owner: "In lair, I can't choose a ruleset"): a book on
 * Freeform, every book's default, brings no rules of its own; a book with its
 * own is adopted ("From the lorebook").
 */
describe("a book's rules, adopted only when it has its own (fix7)", () => {
	const offer = genreRulesOffer(genre, [VI, STORY])!

	test("every book's default is the catalogue's Freeform, spelled once", () => {
		expect(BOOK_DEFAULT_RULES).toBe(freeformRuleset.id)
	})

	test("adoptedBookRules: a book's own rules, else null", () => {
		expect(adoptedBookRules(VI.id)).toBe(VI.id)
		expect(adoptedBookRules(STORY.id)).toBeNull()
		expect(adoptedBookRules(null)).toBeNull()
		expect(adoptedBookRules(undefined)).toBeNull()
	})

	test("rulesField: a book on Freeform leaves the pick; a book with its own says where they come from", () => {
		expect(rulesField(offer, STORY.id, { primaryRuleset: STORY.id })).toEqual({ value: STORY.id, fromLorebook: null })
		expect(rulesField(offer, null, { primaryRuleset: STORY.id })).toEqual({ value: VI.id, fromLorebook: null })
		expect(rulesField(offer, STORY.id, { primaryRuleset: VI.id })).toEqual({
			value: VI.id,
			fromLorebook: "From the lorebook: Vis Itineris"
		})
	})
})
