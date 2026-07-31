import { describe, expect, test } from "vitest"
import {
	buildCharacterExtractionPrompt,
	DEFAULT_CHARACTER_EXTRACTION_SYSTEM_PROMPT,
	type CastEntry
} from "./templates"

describe("buildCharacterExtractionPrompt", () => {
	test("with no knownCast at all, the output contract is name-only — no castId example to imitate", () => {
		const { userPrompt } = buildCharacterExtractionPrompt("A scene.")
		expect(userPrompt).not.toContain("castId")
		expect(userPrompt).toContain('{"name": "..."}')
		expect(userPrompt).not.toContain("Known characters in this story")
	})

	test("with an empty knownCast array, the output contract is still name-only", () => {
		const { userPrompt } = buildCharacterExtractionPrompt(
			"A scene.",
			null,
			[]
		)
		expect(userPrompt).not.toContain("castId")
		expect(userPrompt).not.toContain("Known characters in this story")
	})

	test("with a populated knownCast, the cast block and castId output contract both appear, ids included", () => {
		const knownCast: CastEntry[] = [
			{ name: "Bram", aliases: ["the Blacksmith"], id: 5 },
			{ name: "Aria", aliases: [], id: 12 }
		]
		const { userPrompt } = buildCharacterExtractionPrompt(
			"A scene.",
			null,
			knownCast
		)
		expect(userPrompt).toContain("Known characters in this story")
		expect(userPrompt).toContain("[id: 5] Bram (aliases: the Blacksmith)")
		expect(userPrompt).toContain("[id: 12] Aria")
		expect(userPrompt).toContain('{"castId": <id>}')
	})

	test("systemPromptOverride wins over the in-code default when provided", () => {
		const { systemPrompt } = buildCharacterExtractionPrompt(
			"A scene.",
			"Custom override prompt"
		)
		expect(systemPrompt).toBe("Custom override prompt")
	})

	test("falls back to the in-code default when no override is given", () => {
		const { systemPrompt } = buildCharacterExtractionPrompt("A scene.")
		expect(systemPrompt).toBe(DEFAULT_CHARACTER_EXTRACTION_SYSTEM_PROMPT)
	})

	test("a blank/whitespace-only override also falls back to the default", () => {
		const { systemPrompt } = buildCharacterExtractionPrompt(
			"A scene.",
			"   "
		)
		expect(systemPrompt).toBe(DEFAULT_CHARACTER_EXTRACTION_SYSTEM_PROMPT)
	})
})
