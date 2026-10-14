/**
 * The plain line the review modal and the cap pause open with
 * (PLAN-less-confusing D3): what is about to happen and what the buttons do,
 * never the step's internal name.
 */
import { describe, expect, it } from "vitest"
import { capPauseLine, reviewPlainLine } from "./reviewWording"

describe("reviewPlainLine", () => {
	it("an image render says so, and that the prompt may be changed", () => {
		expect(
			reviewPlainLine({ definitionId: "core:oracle/generate-image@1" })
		).toBe(
			"The AI wants to generate an image. Approve to make it, or change the prompt first."
		)
	})

	it("the reply's placeholder is a reply about to start, with nothing to change", () => {
		expect(
			reviewPlainLine({
				definitionId: "core:outlet/create-message@1",
				values: { generating: true }
			})
		).toBe("The AI is about to start a reply. Approve to let it write.")
		expect(
			reviewPlainLine({ definitionId: "core:outlet/create-message@1" })
		).toMatch(/post a new message/)
	})

	it("an unknown step gets the general sentence and never its own name", () => {
		const line = reviewPlainLine({
			definitionId: "acme:outlet/post-tweet@2"
		})
		expect(line).toMatch(/^The AI paused before acting/)
		expect(line).not.toMatch(/tweet|step|pipeline/i)
	})

	it("no line says 'pipeline' or carries an em-dash", () => {
		for (const id of [
			"core:oracle/generate-image@1",
			"core:outlet/create-message@1",
			"core:outlet/update-message@1",
			"core:outlet/attach-image@1",
			"x:y/z@1"
		]) {
			const line = reviewPlainLine({ definitionId: id })
			expect(line).not.toMatch(/pipeline/i)
			expect(line).not.toContain("—")
		}
	})
})

describe("capPauseLine", () => {
	it("counts the requests waiting and says what each button does", () => {
		expect(capPauseLine(3)).toBe(
			"The AI is about to make 3 more requests in a chain. Continue lets them run; Stop here keeps what is done."
		)
	})

	it("one request reads in the singular", () => {
		expect(capPauseLine(1)).toBe(
			"The AI is about to make 1 more request in a chain. Continue lets it run; Stop here keeps what is done."
		)
	})

	it("a pause always holds at least the run that reached it", () => {
		expect(capPauseLine(0)).toMatch(/1 more request /)
		expect(capPauseLine(Number.NaN)).toMatch(/1 more request /)
	})
})
