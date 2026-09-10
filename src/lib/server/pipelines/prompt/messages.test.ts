/**
 * The lines a template renders, and the one line it renders *open*.
 *
 * The seed is not a message among messages. On the completion path its
 * assistant block is the only one rendered with `includeClose: false`, so the
 * prompt ends mid-line and the model continues the string it was handed. That
 * makes edge whitespace on the seed's text a character *inside* the open block
 * — the mid-word continue case the 2026-09-08 ruling addresses — and Anthropic's
 * Messages API refuses a prefill ending in whitespace outright.
 *
 * Whitespace is trimmed at compile as well as at save because the two guards
 * cover different holes: the store cannot trim a mid-stream partial (the frames
 * split anywhere), and history predating the ruling is already stored padded.
 */

import { describe, it, expect } from "vitest"
import { processMessages, SEED_MESSAGE_ID } from "./messages"

const base = {
	cast: {},
	charName: "Alice",
	personaName: "Bob"
}

const seedOf = (r: ReturnType<typeof processMessages>) =>
	r.messages.find((m) => m.id === SEED_MESSAGE_ID)!

describe("the seed line", () => {
	it("carries no trailing whitespace from the continuation prefill", () => {
		const out = processMessages({
			...base,
			messages: [],
			continuationPrefill: "The rain had just "
		})
		expect(seedOf(out).message).toBe("The rain had just")
	})

	it("strips a trailing newline the same way", () => {
		const out = processMessages({
			...base,
			messages: [],
			continuationPrefill: "The rain had just\n"
		})
		expect(seedOf(out).message).toBe("The rain had just")
	})

	it("stays empty when this turn is not a continue", () => {
		const out = processMessages({ ...base, messages: [] })
		expect(seedOf(out).message).toBe("")
	})
})

describe("history lines", () => {
	it("are trimmed, so a padded row cannot open or close a line with space", () => {
		const out = processMessages({
			...base,
			messages: [
				{ id: 1, role: "user", content: "  Well met.  " },
				{ id: 2, role: "assistant", content: "And you.\n\n" }
			]
		})
		expect(out.messages.map((m) => m.message)).toEqual([
			"Well met.",
			"And you.",
			""
		])
		expect(out.includedIds).toEqual([1, 2])
	})

	it("keep whitespace that is interior to the body", () => {
		const out = processMessages({
			...base,
			messages: [
				{ id: 1, role: "assistant", content: "  One.\n\nTwo.  " }
			]
		})
		expect(out.messages[0].message).toBe("One.\n\nTwo.")
	})
})
