/**
 * A failed press is said once (PLAN-less-confusing D4): on the progress card when
 * the run ran, as a toast only when no card is showing it.
 */
import { describe, expect, it } from "vitest"
import { failureOnProgressCard } from "./fireFailure"

const why = "No model is set for Images."

describe("failureOnProgressCard", () => {
	it("a run's failure the card just drew is the card's to say", () => {
		expect(
			failureOnProgressCard(
				{ error: why, runId: "r1" },
				{ runId: "r1", error: why }
			)
		).toBe(true)
	})

	it("a press refused before any run started has no card: it is toasted", () => {
		expect(failureOnProgressCard({ error: why }, undefined)).toBe(false)
		expect(
			failureOnProgressCard({ error: why }, { runId: "r0", error: "older" })
		).toBe(false)
	})

	it("a card that was dismissed, or shows another run, says nothing about this one", () => {
		expect(failureOnProgressCard({ error: why, runId: "r1" }, undefined)).toBe(
			false
		)
		expect(
			failureOnProgressCard(
				{ error: why, runId: "r1" },
				{ runId: "r2", error: why }
			)
		).toBe(false)
	})

	it("a card that ended without a reason is not saying it", () => {
		expect(
			failureOnProgressCard({ error: why, runId: "r1" }, { runId: "r1" })
		).toBe(false)
	})

	it("an answer with no error is never a failure", () => {
		expect(
			failureOnProgressCard({ runId: "r1" }, { runId: "r1", error: why })
		).toBe(false)
	})
})
