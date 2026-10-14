import { describe, expect, test } from "vitest"
import {
	buildBatchPrompt,
	buildCharacterExtractionPrompt,
	buildTranscriptBatchPrompt,
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

describe("buildTranscriptBatchPrompt (a batch that is text, live scenes §14)", () => {
	const transcript =
		'Scene: The Door\nPresent: Bram\n\nAda: We push the door open — it\'s "stuck" & cold.\n[image: door.png — an oak door]'

	test("the row's {{batch}} is the transcript, verbatim — no entity escaping, every placement filled", () => {
		const { systemPrompt, userPrompt } = buildTranscriptBatchPrompt({
			transcript,
			loreType: "scene",
			prompt: "Summarize.\n\nThe transcript:\n{{batch}}\n\nAgain: {{{ batch }}}"
		})
		expect(systemPrompt).toBe(
			`Summarize.\n\nThe transcript:\n${transcript}\n\nAgain: ${transcript}`
		)
		expect(systemPrompt).not.toContain("{{")
		expect(userPrompt).toBe(
			"Output ONLY in this exact format — no other text before or after:\n<content>\n[Scene summary paragraph(s)]\n</content>"
		)
	})

	test("a row with no {{batch}} keeps the transcript, appended under a heading", () => {
		const { systemPrompt } = buildTranscriptBatchPrompt({
			transcript,
			loreType: "scene",
			prompt: "You are a scene archivist."
		})
		expect(systemPrompt).toBe(
			`You are a scene archivist.\n\nThe transcript:\n${transcript}`
		)
	})

	test("no row falls back to the kind of entry's default, and the topic leads the user prompt", () => {
		const { systemPrompt, userPrompt } = buildTranscriptBatchPrompt({
			transcript,
			loreType: "history",
			topic: " the door ",
			prompt: "   "
		})
		const fallback = buildBatchPrompt({
			jsonMessages: "",
			loreType: "history"
		})
		expect(systemPrompt).toBe(
			`${fallback.systemPrompt}\n\nThe transcript:\n${transcript}`
		)
		expect(
			userPrompt.startsWith('Focus specifically on: "the door"\n\n')
		).toBe(true)
		expect(userPrompt).toContain("• [Key event or change]")
	})
})
