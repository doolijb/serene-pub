/**
 * 🚧 How strict follows the rules chosen (2026-10-18, the 100-turn walk #26:
 * the form allowed Story with Rules and dice): a ruleset that rolls no dice
 * plays Words only.
 */
import { describe, expect, test } from "vitest"
import { howStrictChoices, rigourFor, rigoursPlayed, withRigoursPlayed } from "./rulesOffer"
import { genreRulesOffer } from "$lib/server/rulesets/genreOffer"

const STORY = { id: "core:ruleset/freeform@1", name: { en: "Story" }, description: { en: "Words." } }
const VI = { id: "core:ruleset/vis-itineris@1", name: { en: "Vis Itineris" }, description: { en: "Dice." } }
const genre = { rulesets: { recommended: [VI.id], default: VI.id }, rigour: { options: ["prose", "mechanics", "scripts"], default: "scripts" } }
const rollsDice = (id: string) => id === VI.id

describe("rules that roll no dice play Words only", () => {
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
