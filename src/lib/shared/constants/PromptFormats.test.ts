/**
 * The one operator that decides which markers a prompt is wrapped in.
 *
 * `promptFormatOf` exists because the fallback is not obvious and the wrong
 * spelling is silent: `PromptBlockFormatter.makeBlock` switches on the format
 * string and its `default:` arm is **ChatML**, while every caller that has ever
 * written the fallback by hand wrote Vicuna. So the two ways of writing "and if
 * there isn't one" disagree on exactly one input — the empty string — and
 * `connections.prompt_format` is a nullable text column with no check
 * constraint, so a row can hold one.
 */

import { describe, expect, it } from "vitest"
import { PromptFormats, promptFormatOf } from "./PromptFormats"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"

describe("promptFormatOf", () => {
	it("passes a real format through untouched", () => {
		expect(promptFormatOf("chatml")).toBe(PromptFormats.CHATML)
		expect(promptFormatOf(PromptFormats.SPLIT_CHAT)).toBe("split_session")
	})

	it("falls back to Vicuna for an absent value", () => {
		expect(promptFormatOf(undefined)).toBe(PromptFormats.VICUNA)
		expect(promptFormatOf(null)).toBe(PromptFormats.VICUNA)
	})

	/**
	 * The whole reason this is a function rather than an inline `??`.
	 *
	 * `"" ?? "vicuna"` is `""`, and an empty format reaching `makeBlock` takes
	 * the `default:` arm — so a connection whose format column was *cleared*
	 * rather than never set would have every block wrapped in ChatML markers,
	 * chosen by an operator rather than by a person.
	 */
	it("treats an empty format as absent, not as ChatML", () => {
		expect(promptFormatOf("")).toBe(PromptFormats.VICUNA)

		// Stated as the consequence rather than as a claim about the operator:
		// this is what the empty string would have produced downstream.
		const wrapped = PromptBlockFormatter.makeBlock({
			format: "",
			role: "system",
			content: "x"
		})
		expect(wrapped).toContain(PromptBlockFormatter.CHATML_OPEN)
		expect(
			PromptBlockFormatter.makeBlock({
				format: promptFormatOf(""),
				role: "system",
				content: "x"
			})
		).toContain(PromptBlockFormatter.VICUNA_OPEN)
	})
})
