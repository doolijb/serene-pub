/**
 * The continuation seam, pinned.
 *
 * Three call sites in `generateResponse.ts` write the continued row — mid-
 * stream, final-streamed, non-streamed — and all three used
 * `preservedContent + " " + generated` inline, which is a rule kept by review
 * rather than by construction. These are the cases that rule got wrong once the
 * model could actually SEE the prefill.
 */

import { describe, it, expect } from "vitest"
import { joinContinuation } from "./continuation"

describe("joinContinuation", () => {
	it("joins with exactly one space", () => {
		expect(joinContinuation("The rain had just", "started to fall.")).toBe(
			"The rain had just started to fall."
		)
	})

	it("does not double the space when the stored text already ends in one", () => {
		// ⚠ Was the common case: the row kept whatever the last stream frame
		// wrote, trailing space and all. Since the 2026-09-08 ruling the store
		// trims every committed body, so a padded prefill now reaches here only
		// from a pre-ruling row or an untrimmed mid-stream partial — rarer, and
		// still exactly as wrong to double.
		expect(joinContinuation("The rain had just ", "started.")).toBe(
			"The rain had just started."
		)
	})

	it("joins a mid-word continue with a space — the accepted limitation", () => {
		// Pinned deliberately, and NOT as a wish. The ruling of 2026-09-08 chose
		// a reliably clean prefill over guessing at the seam, so this stays
		// wrong on purpose; a test that asserted "thestore." would be asserting
		// a heuristic nobody agreed to.
		expect(joinContinuation("the sto", "re.")).toBe("the sto re.")
	})

	it("takes the model's own text when it echoed the prefill", () => {
		// Expected on both chat paths: the seed is a trailing assistant
		// *message* there, not an open turn. Splicing the tail onto the stored
		// prefill instead would put a space before the comma.
		expect(joinContinuation("Hello world", "Hello world, she said.")).toBe(
			"Hello world, she said."
		)
	})

	it("tolerates leading whitespace around an echo", () => {
		expect(joinContinuation("Hello world", "  Hello world again.")).toBe(
			"Hello world again."
		)
	})

	it("keeps the row unchanged when the model returned nothing", () => {
		expect(joinContinuation("The rain had just", "   ")).toBe(
			"The rain had just"
		)
	})

	it("passes the reply straight through when there is no prefill", () => {
		// Every turn that is not a continue.
		expect(joinContinuation("", "A fresh reply.")).toBe("A fresh reply.")
	})
})
