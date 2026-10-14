/**
 * Less-confusing plan F1 (2026-10-11): the line under a character's name is
 * something written to be read, never the raw card sheet.
 */
import { describe, expect, test } from "vitest"
import { characterSummary, proseLead } from "./characterSummary"

/** The card that showed "Name: Brix Gender: Female (Designate) Role: …". */
const BRIX = [
	"Name: Brix",
	"Gender: Female (Designate)",
	"Role: Synthetic Lifeform, Station Crew Support",
	"Age: Unit activated 5 years ago.",
	"Appearance: |",
	"Brix presents as a human female, standing at a precise five-foot-nine with a slender, efficient build. Her features are placid and symmetrical.",
	"Background: |",
	"Brix is a support unit aboard the station."
].join("\n")

const ADA =
	"Ada keeps the lighthouse on Gull Rock. She has not spoken to anyone in years, and likes it that way."

describe("characterSummary", () => {
	test("a sheet-style description reads as its first prose sentence", () => {
		expect(characterSummary({ name: "Brix", description: BRIX })).toBe(
			"Brix presents as a human female, standing at a precise five-foot-nine with a slender, efficient build."
		)
	})

	test("a plain prose description reads as its first sentence", () => {
		expect(characterSummary({ name: "Ada", description: ADA })).toBe(
			"Ada keeps the lighthouse on Gull Rock."
		)
	})

	test("the card's own Summary wins, as written", () => {
		expect(
			characterSummary({
				name: "Brix",
				summary: "  The station's synthetic crew support.  ",
				creatorNotes: "Made for the jam.",
				description: BRIX
			})
		).toBe("The station's synthetic crew support.")
	})

	test("creator notes come before the description, cleaned", () => {
		expect(
			characterSummary({
				name: "Brix",
				creatorNotes:
					'<p><img src="x.png"> A <b>calm</b> android for [space](https://example.com) stories. Thanks for 1k!</p>',
				description: BRIX
			})
		).toBe("A calm android for space stories.")
	})

	test("empty notes and summary fall through to the description", () => {
		expect(
			characterSummary({
				name: "Ada",
				summary: "",
				creatorNotes: "   ",
				description: ADA
			})
		).toBe("Ada keeps the lighthouse on Gull Rock.")
	})

	test("a sheet line whose value is prose is read as that prose", () => {
		expect(
			proseLead(
				"Name: Vell\nDescription: Vell is a smuggler. She owes everyone money."
			)
		).toBe("Vell is a smuggler.")
	})

	test("{{char}} reads as the name, {{user}} as you", () => {
		expect(
			characterSummary({
				name: "Brannoc",
				description: "{{char}} guards the gate for {{user}}. He is tired."
			})
		).toBe("Brannoc guards the gate for you.")
	})

	test("a colon inside a sentence does not make it a sheet line", () => {
		expect(proseLead("Ada has one rule: never leave the light. Ever.")).toBe(
			"Ada has one rule: never leave the light."
		)
	})

	test("W++ and PList blocks are skipped", () => {
		const wpp = '[character("Brix")\n{\nSpecies("Android")\n}]\nBrix hums while she works. Always.'
		expect(proseLead(wpp)).toBe("Brix hums while she works.")
		expect(proseLead("[Brix: synthetic, calm]\nBrix hums. Always.")).toBe(
			"Brix hums."
		)
	})

	test("abbreviations and initials do not end the sentence", () => {
		expect(proseLead("Dr. J. Hale runs the clinic. Nobody likes him.")).toBe(
			"Dr. J. Hale runs the clinic."
		)
	})

	test("nothing but sheet lines gives no line at all", () => {
		expect(
			characterSummary({ description: "Name: Brix\nGender: Female\nAge: 5" })
		).toBe("")
		expect(characterSummary({})).toBe("")
		expect(characterSummary(null)).toBe("")
	})

	test("a long sentence is clipped at a word", () => {
		const long = `${"word ".repeat(80).trim()}.`
		const out = characterSummary({ description: long }, { maxLength: 40 })
		expect(Array.from(out).length).toBeLessThanOrEqual(41)
		expect(out.endsWith("…")).toBe(true)
		expect(out).not.toMatch(/\s…$/)
	})
})
