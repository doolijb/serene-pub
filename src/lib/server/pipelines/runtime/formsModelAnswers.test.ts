import { describe, expect, it } from "vitest"
import { genreModelAnswersForms } from "./runTurn"

describe("genreModelAnswersForms — the AI's form answer is opt-in", () => {
	it("absent shape, absent forms, false and a string are off", () => {
		expect(genreModelAnswersForms(undefined)).toBe(false)
		expect(genreModelAnswersForms(null)).toBe(false)
		expect(genreModelAnswersForms({})).toBe(false)
		expect(genreModelAnswersForms({ forms: {} })).toBe(false)
		expect(genreModelAnswersForms({ forms: { modelAnswers: false } })).toBe(false)
		expect(genreModelAnswersForms({ forms: { modelAnswers: "true" } })).toBe(false)
	})
	it("true is on", () => {
		expect(genreModelAnswersForms({ forms: { modelAnswers: true } })).toBe(true)
	})
})
