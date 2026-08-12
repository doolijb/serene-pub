/**
 * Relationship data belongs in its own block, not in the instructions.
 *
 * It used to be handed to compilePrompt as `extraInstructions`, which the
 * builder splices into `instructions`, `postHistoryInstructions` AND
 * `promptPostHistoryInstructions` as the prose line
 * "Additional focus for this response: …". Three consequences: the payload was
 * duplicated three times per message; it read as an instruction rather than as
 * data; and one copy landed inside the post-history ```text fence at the most
 * recency-weighted point in the prompt, which had models closing their replies
 * with a stray ```.
 */
import { describe, expect, test } from "vitest"
import { PromptBuilder } from "./index"

const GRAPH = '{"yourRelationships":{"Kiran":[{"type":"admires"}]}}'

function makeBuilder() {
	return new PromptBuilder({
		connection: { id: 1, name: "c", type: "openai_chat" } as any,
		sampling: { id: 1, name: "s", contextTokens: 8192 } as any,
		contextConfig: { id: 1, template: "" } as any,
		promptConfig: { id: 1, systemPrompt: "Be a character." } as any,
		chat: {
			id: 1,
			chatType: "roleplay",
			chatCharacters: [],
			chatPersonas: [],
			chatMessages: []
		} as any,
		currentCharacterId: null,
		tokenCounter: { countTokens: (s: string) => s.length } as any,
		tokenLimit: 8192,
		contextThresholdPercent: 0.9
	})
}

describe("speakerRelationships is its own block", () => {
	test("is exposed on the builder for the template, not folded into instructions", async () => {
		const b = makeBuilder()
		await b.compilePrompt({ speakerRelationships: GRAPH } as any)

		// Rendered via the template variable…
		expect(b.speakerRelationships).toBe(GRAPH)
		// …and NOT smuggled into the instruction fields.
		expect(b.instructions ?? "").not.toContain(GRAPH)
		expect(b.postHistoryInstructions ?? "").not.toContain(GRAPH)
		expect(b.promptPostHistoryInstructions ?? "").not.toContain(GRAPH)
	})

	test("does not produce the 'Additional focus' prose line", async () => {
		const b = makeBuilder()
		await b.compilePrompt({ speakerRelationships: GRAPH } as any)
		for (const field of [
			b.instructions,
			b.postHistoryInstructions,
			b.promptPostHistoryInstructions
		]) {
			expect(field ?? "").not.toContain(
				"Additional focus for this response"
			)
		}
	})

	test("extraInstructions still works for its legitimate user", async () => {
		// The Narrator's per-trigger focus note genuinely IS an instruction and
		// must keep flowing through the old path.
		const b = makeBuilder()
		await b.compilePrompt({
			extraInstructions: "Focus on the storm."
		} as any)
		expect(b.instructions ?? "").toContain("Focus on the storm.")
		expect(b.speakerRelationships).toBeUndefined()
	})
})
