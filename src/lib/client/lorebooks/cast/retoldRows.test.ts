import { describe, expect, test } from "vitest"
import {
	cardValueOf,
	joinExampleDialogues,
	retoldRows,
	setRetold,
	takeFromCard,
	type RetoldDraft
} from "./retoldRows"

const card = {
	id: 9,
	description: "From the card.",
	personality: "",
	alternateGreetings: ["Hello.", "Well met."],
	exampleDialogues: ["{{user}}: Hi\n{{char}}: Hm.", "  "]
}

const blank: RetoldDraft = {
	description: "",
	personality: "",
	scenario: "",
	firstMessage: "",
	alternateGreetings: [],
	exampleDialogues: "",
	faceMediaId: null,
	retold: {}
}

describe("joinExampleDialogues", () => {
	test("opens each dialogue with <START>, dropping empties", () => {
		expect(joinExampleDialogues(card.exampleDialogues)).toBe(
			"<START>\n{{user}}: Hi\n{{char}}: Hm."
		)
	})
	test("an old card's string passes through", () => {
		expect(joinExampleDialogues("<START>\nA")).toBe("<START>\nA")
		expect(joinExampleDialogues(null)).toBe("")
	})
})

describe("retoldRows", () => {
	test("one row per prose field, in canonical order, reading the flags", () => {
		const rows = retoldRows({ ...blank, retold: { scenario: true } }, card)
		expect(rows.map((r) => r.field)).toEqual([
			"description",
			"personality",
			"scenario",
			"firstMessage",
			"alternateGreetings",
			"exampleDialogues"
		])
		expect(rows.find((r) => r.field === "scenario")?.retold).toBe(true)
		expect(rows.find((r) => r.field === "description")?.retold).toBe(false)
		expect(rows.find((r) => r.field === "alternateGreetings")?.shape).toBe(
			"list"
		)
		expect(rows.find((r) => r.field === "personality")?.cardHasText).toBe(
			false
		)
	})

	test("text kept while the card is read is said to be kept", () => {
		const rows = retoldRows(
			{ ...blank, description: "Mine.", scenario: "Also mine.", retold: { scenario: true } },
			card
		)
		expect(rows.find((r) => r.field === "description")?.kept).toBe(true)
		expect(rows.find((r) => r.field === "scenario")?.kept).toBe(false)
	})
})

describe("setRetold — the toggle's rules", () => {
	test("on with an empty member field copies the card's text first", () => {
		const next = setRetold(blank, "description", true, card)
		expect(next.retold.description).toBe(true)
		expect(next.description).toBe("From the card.")
	})

	test("on with the member's own text keeps it", () => {
		const next = setRetold(
			{ ...blank, description: "Mine." },
			"description",
			true,
			card
		)
		expect(next.description).toBe("Mine.")
	})

	test("on for greetings copies the card's list (a copy, not the card's array)", () => {
		const next = setRetold(blank, "alternateGreetings", true, card)
		expect(next.alternateGreetings).toEqual(["Hello.", "Well met."])
		expect(next.alternateGreetings).not.toBe(card.alternateGreetings)
	})

	test("off keeps the member's text — hidden, never discarded", () => {
		const on = { ...blank, description: "Mine.", retold: { description: true } }
		const off = setRetold(on, "description", false, card)
		expect(off.retold.description).toBe(false)
		expect(off.description).toBe("Mine.")
	})

	test("an untouched on-and-off drops the card's copy, so the form is clean again", () => {
		const on = setRetold(blank, "description", true, card, blank)
		const off = setRetold(on, "description", false, card, blank)
		expect(off.description).toBe(blank.description)
		expect(off.retold.description).toBe(false)
		// Greetings too: the copied list goes back to the saved (empty) one.
		const gOn = setRetold(blank, "alternateGreetings", true, card, blank)
		expect(setRetold(gOn, "alternateGreetings", false, card, blank).alternateGreetings).toEqual(
			blank.alternateGreetings
		)
	})

	test("off keeps the copy once it was edited, or when the member already had text saved", () => {
		const on = setRetold(blank, "description", true, card, blank)
		const edited = { ...on, description: "From the card, then mine." }
		expect(setRetold(edited, "description", false, card, blank).description).toBe(
			"From the card, then mine."
		)
		const saved = { ...blank, description: "Saved words." }
		const retyped: typeof saved = {
			...saved,
			description: "From the card.",
			retold: { description: true }
		}
		expect(setRetold(retyped, "description", false, card, saved).description).toBe(
			"From the card."
		)
	})

	test("the face flag touches no text", () => {
		const next = setRetold(blank, "face", true, card)
		expect(next).toEqual({ ...blank, retold: { face: true } })
	})
})

describe("takeFromCard", () => {
	test("replaces the member's text with the card's current value, flag untouched", () => {
		const next = takeFromCard(
			{ ...blank, description: "Mine.", retold: { description: true } },
			"description",
			card
		)
		expect(next.description).toBe("From the card.")
		expect(next.retold).toEqual({ description: true })
	})

	test("a missing card gives empty values", () => {
		expect(cardValueOf(null, "firstMessage")).toBe("")
		expect(cardValueOf(null, "alternateGreetings")).toEqual([])
	})
})
