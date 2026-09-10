/**
 * The one operator that decides which markers a prompt is wrapped in.
 *
 * `promptFormatOf` existed because the fallback was not obvious and the wrong
 * spelling was silent: `PromptBlockFormatter.makeBlock` switched on the format
 * string and its `default:` arm returned **ChatML**, while every caller that
 * ever wrote the fallback by hand wrote Vicuna. The two ways of writing "and if
 * there isn't one" disagreed on exactly one input — the empty string — and
 * `connections.prompt_format` was a nullable text column with no check
 * constraint, so a row could hold one.
 *
 * ⚠ **That arm is gone.** `makeBlock` resolves through `completionTemplateOf`
 * now, which answers `PromptFormats.DEFAULT` for absent, empty and unresolved
 * alike — the same answer this function gives. The two spellings agree by
 * construction rather than by coincidence, and the case below is rewritten
 * around that: what it pins is no longer "these differ, use the safe one" but
 * "these must not be allowed to differ again."
 */

import { describe, expect, it } from "vitest"
import { PromptFormats, promptFormatOf } from "./PromptFormats"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
import { DEFAULT_COMPLETION_TEMPLATE_KEY } from "./completionTemplates"

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
	 * `"" ?? "vicuna"` is `""`. A cleared format column is not a different
	 * intention from an unset one, and `??` is the operator that says it is.
	 */
	it("treats an empty format as absent", () => {
		expect(promptFormatOf("")).toBe(PromptFormats.VICUNA)
	})

	/**
	 * ⚠ The two spellings must not be allowed to disagree again.
	 *
	 * This used to assert the OPPOSITE of its second half — that `makeBlock("")`
	 * produced ChatML while `makeBlock(promptFormatOf(""))` produced Vicuna —
	 * because that was true, and stating a live inconsistency as bytes was the
	 * only guard there was. It is now stated as the invariant instead: routing
	 * an empty format through this function has to be a NO-OP on the rendered
	 * bytes, because the renderer already resolves it the same way.
	 *
	 * Kept as a rendered comparison rather than an equality on the two strings,
	 * because what went wrong was never about the strings — it was about what
	 * came out of the formatter at the end.
	 */
	it("renders identically whether or not the caller applies it", () => {
		for (const cleared of ["", null, undefined]) {
			const direct = PromptBlockFormatter.makeBlock({
				format: cleared,
				role: "system",
				content: "x"
			})
			const viaOperator = PromptBlockFormatter.makeBlock({
				format: promptFormatOf(cleared),
				role: "system",
				content: "x"
			})
			expect(direct).toBe(viaOperator)
			expect(direct).toContain(PromptBlockFormatter.VICUNA_OPEN)
			expect(direct).not.toContain(PromptBlockFormatter.CHATML_OPEN)
		}
	})

	it("names the same default the template layer does", () => {
		// One constant, read by both, so this cannot drift into a comparison
		// between two literals that happen to match today.
		expect(promptFormatOf(null)).toBe(PromptFormats.DEFAULT)
		expect(DEFAULT_COMPLETION_TEMPLATE_KEY).toBe(PromptFormats.DEFAULT)
	})
})
