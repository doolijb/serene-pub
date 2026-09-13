/**
 * The post-history decision, and the record it leaves.
 *
 * The block is one unit. `postHistoryTokenTrigger` is the reader's ceiling on
 * reminders of every kind, not a gate on the config's text alone: below it the
 * whole block stays out — the config's reminder, the card's reminder and the
 * card's example dialogue together — and at or above it all three render at
 * `targetIndex`.
 *
 * The diagnostics are asserted as hard as the text is, because they are what a
 * receipt says happened. "Suppressed, 278 tokens is below the 100000 trigger"
 * is only worth reading if the numbers on it are the numbers the decision used
 * and the prompt carries what the verdict claims.
 */

import { describe, expect, it } from "vitest"
import { resolvePostHistoryContext } from "$lib/server/pipelines/prompt/postHistory"

/** One token per character, so a length in the test is a count in the code. */
const tokenCounter = { countTokens: (text: string) => text.length }

/** Oldest-first, with the seed placeholder (`id: -2`) last. */
const messages = (...bodies: string[]) => [
	...bodies.map((message, i) => ({ id: i + 1, message }) as any),
	{ id: -2, message: "" } as any
]

const resolve = (over: Record<string, unknown> = {}) =>
	resolvePostHistoryContext({
		renderMessages: messages("a".repeat(100), "b".repeat(100)),
		instructions: "Write one reply only.",
		charInstructions: undefined,
		exampleDialogue: undefined,
		postHistoryDepth: 0,
		postHistoryTokenTrigger: 0,
		tokenCounter,
		...(over as any)
	})

describe("the post-history reminder", () => {
	it("is included, and says where it landed, when no trigger is set", async () => {
		const { postHistory, diagnostics } = await resolve()
		expect(postHistory.instructions).toBe("Write one reply only.")
		expect(postHistory.hasContent).toBe(true)
		expect(diagnostics).toMatchObject({
			included: true,
			reason: "included",
			trigger: 0,
			depth: 0,
			targetIndex: 2
		})
		// Nothing measured the history: a trigger of 0 admits every session, so
		// paying for a token count would buy a number nothing reads.
		expect(diagnostics.historyTokens).toBeUndefined()
	})

	it("is suppressed below the trigger, with the two numbers that decided it", async () => {
		const { postHistory, diagnostics } = await resolve({
			postHistoryTokenTrigger: 100000
		})
		expect(postHistory.instructions).toBeUndefined()
		expect(postHistory.hasContent).toBe(false)
		expect(diagnostics).toMatchObject({
			included: false,
			reason: "below_token_trigger",
			// The two bodies and the newline between them. The seed placeholder
			// is not history and is not counted.
			historyTokens: 201,
			trigger: 100000
		})
	})

	it("is included once the history is at least the trigger", async () => {
		const { postHistory, diagnostics } = await resolve({
			postHistoryTokenTrigger: 201
		})
		expect(postHistory.instructions).toBe("Write one reply only.")
		expect(diagnostics).toMatchObject({
			included: true,
			reason: "included",
			historyTokens: 201,
			trigger: 201
		})
	})

	it("reports the depth's position rather than recomputing it downstream", async () => {
		const { postHistory, diagnostics } = await resolve({
			postHistoryDepth: 2
		})
		expect(postHistory.targetIndex).toBe(0)
		expect(diagnostics).toMatchObject({ depth: 2, targetIndex: 0 })
	})

	it("takes the card's reminder and examples down with it below the trigger", async () => {
		const { postHistory, diagnostics } = await resolve({
			postHistoryTokenTrigger: 100000,
			charInstructions: "Marrow never lies.",
			exampleDialogue: "Wren: I know the fog roads."
		})
		expect(postHistory.instructions).toBeUndefined()
		expect(postHistory.charInstructions).toBeUndefined()
		expect(postHistory.exampleDialogue).toBeUndefined()
		expect(postHistory.hasContent).toBe(false)
		// The two flags are facts about what the block would carry, so a reader
		// knows what the trigger held back rather than only that it held.
		expect(diagnostics).toMatchObject({
			included: false,
			reason: "below_token_trigger",
			hasCharInstructions: true,
			hasExampleDialogue: true
		})
	})

	it("stays out below the trigger when the card's examples are the only text", async () => {
		const { postHistory, diagnostics } = await resolve({
			instructions: undefined,
			postHistoryTokenTrigger: 100000,
			exampleDialogue: "Wren: I know the fog roads."
		})
		expect(postHistory.exampleDialogue).toBeUndefined()
		expect(postHistory.hasContent).toBe(false)
		expect(diagnostics).toMatchObject({
			included: false,
			reason: "below_token_trigger",
			historyTokens: 201,
			hasExampleDialogue: true
		})
	})

	it("renders all three together once the history is at least the trigger", async () => {
		const { postHistory, diagnostics } = await resolve({
			postHistoryTokenTrigger: 201,
			charInstructions: "Marrow never lies.",
			exampleDialogue: "Wren: I know the fog roads."
		})
		expect(postHistory.instructions).toBe("Write one reply only.")
		expect(postHistory.charInstructions).toBe("Marrow never lies.")
		expect(postHistory.exampleDialogue).toBe("Wren: I know the fog roads.")
		expect(postHistory.hasContent).toBe(true)
		expect(diagnostics).toMatchObject({
			included: true,
			reason: "included",
			hasCharInstructions: true,
			hasExampleDialogue: true
		})
	})

	it("admits a block the card alone fills when no trigger is set", async () => {
		const { postHistory, diagnostics } = await resolve({
			instructions: undefined,
			charInstructions: "Marrow never lies."
		})
		expect(postHistory.charInstructions).toBe("Marrow never lies.")
		expect(postHistory.hasContent).toBe(true)
		expect(diagnostics).toMatchObject({
			included: true,
			reason: "included",
			hasCharInstructions: true
		})
		// A trigger of 0 admits every session, so nothing was measured.
		expect(diagnostics.historyTokens).toBeUndefined()
	})

	it("says the block carries nothing rather than calling it suppressed", async () => {
		const { postHistory, diagnostics } = await resolve({
			instructions: undefined,
			postHistoryTokenTrigger: 100000
		})
		expect(postHistory.hasContent).toBe(false)
		expect(diagnostics).toMatchObject({
			included: false,
			reason: "empty",
			hasCharInstructions: false,
			hasExampleDialogue: false
		})
		// An empty block is empty at any length: nothing measured the history.
		expect(diagnostics.historyTokens).toBeUndefined()
	})
})
