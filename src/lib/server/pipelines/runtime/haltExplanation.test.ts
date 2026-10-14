/**
 * `haltExplanation`: the sentence a failed or halted run shows a person
 * (PLAN-less-confusing D4, 2026-10-11). It used to end `(at 'render')`, the
 * spec's internal name for the step; that stays on the receipt for the run
 * inspector and leaves the user-facing sentence.
 */
import { describe, expect, it } from "vitest"
import { HALT_WITHOUT_REASON, haltExplanation } from "./haltExplanation"

describe("haltExplanation", () => {
	it("a run that finished has nothing to explain", () => {
		expect(haltExplanation({ outcome: "ok" })).toBeNull()
	})

	it("says the reason alone, never the step it stopped at", () => {
		const why =
			"No model is set for Images, and one is never picked automatically. An admin chooses it in Admin › Models › Loadouts."
		const said = haltExplanation({ outcome: "err", haltReason: why })
		expect(said).toBe(why)
		expect(said).not.toMatch(/\(at '/)
	})

	it("a halt reads the same way as an error", () => {
		expect(
			haltExplanation({ outcome: "halt", haltReason: "Rejected in review." })
		).toBe("Rejected in review.")
	})

	it("a stop with no reason gets a whole sentence, not an empty one", () => {
		expect(haltExplanation({ outcome: "err" })).toBe(HALT_WITHOUT_REASON)
		expect(haltExplanation({ outcome: "err", haltReason: "  " })).toBe(
			HALT_WITHOUT_REASON
		)
	})
})
