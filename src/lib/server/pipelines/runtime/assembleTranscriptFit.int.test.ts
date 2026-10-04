/**
 * The assemble node fits the conversation into the window (B2, 2026-10-03).
 *
 * Called on the binding directly with the shipped template, a run's counter
 * and a small budget: a prompt that fits is untouched, one that does not is
 * cut in a chunk, says so on the receipt, and keeps the same start on the
 * next turn — and the reminder is still placed among the lines that remain.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { SEED_MESSAGE_ID } from "$lib/server/pipelines/prompt/messages"
import { resetHeldCuts } from "$lib/server/pipelines/prompt/transcriptFit"

const count = (t: string) => Math.ceil(t.length / 4)
const ctx = { countTokens: count } as any

/** `n` lines of about 25 tokens each, alternating speakers, plus the seed. */
const conversation = (n: number) => [
	...Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		role: i % 2 ? "assistant" : "user",
		name: i % 2 ? "Aria" : "Jody",
		message: `Line ${i + 1}: ` + "words ".repeat(15)
	})),
	{ id: SEED_MESSAGE_ID, role: "assistant", name: "Aria", message: "" }
]

async function assemble(lines: unknown[], total: number, extra: Record<string, unknown> = {}) {
	const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
	const result: any = await coreBindings()["core:task/assemble@2"]!(
		{
			template: { source: SHIPPED_CONTEXT_TEMPLATE, engine: CORE_TEMPLATE_ENGINE },
			decisions: [],
			messages: lines,
			budget: { total },
			templateContext: { instructions: "You're Aria." },
			connection: { metadata: { wireMode: "chat", midSystem: "fold" } },
			...extra
		},
		ctx
	)
	expect(result.kind).toBe("ok")
	return result.value
}

const firstLine = (value: any) =>
	value.context.messages.find((m: any) => m.role !== "system")?.content as string

beforeEach(() => resetHeldCuts())

describe("assemble — the conversation fitted to the window", () => {
	it("leaves a prompt that fits exactly as rendered", async () => {
		const v = await assemble(conversation(6), 100_000)
		expect(v.transcriptFit).toBeUndefined()
		expect(v.context.notes).toBeUndefined()
		expect(firstLine(v)).toMatch(/^Jody: Line 1:/)
	}, 60_000)

	it("cuts the oldest lines in a chunk, and says so", async () => {
		const v = await assemble(conversation(40), 600)
		expect(v.transcriptFit).toMatchObject({ budget: 600, held: false })
		expect(v.transcriptFit.dropped).toBeGreaterThan(1)
		expect(v.transcriptFit.final).toBeLessThanOrEqual(600)
		expect(v.context.notes.join(" ")).toMatch(/the conversation was cut to fit/)
		// The newest line is always kept.
		expect(JSON.stringify(v.context.messages)).toContain("Line 40:")
	}, 60_000)

	it("keeps the same first line on the next turn while it still fits", async () => {
		const turn1 = await assemble(conversation(40), 600)
		const turn2 = await assemble(conversation(42), 600)
		expect(turn2.transcriptFit.held).toBe(true)
		expect(firstLine(turn2)).toBe(firstLine(turn1))
	}, 60_000)

	it("places the reminder among the lines that remain", async () => {
		const lines = conversation(40)
		const v = await assemble(lines, 700, {
			templateContext: {
				instructions: "You're Aria.",
				postHistory: {
					targetIndex: 0,
					instructions: "Stay in character.",
					hasContent: true
				}
			},
			params: { postHistoryDepth: 0, postHistoryTokenTrigger: 0 }
		})
		expect(v.transcriptFit).toBeDefined()
		// The conversation ends on Aria's own line 40, so the depth-0
		// reminder after it is a user message of its own, in that place.
		const [before, last] = v.context.messages.slice(-2)
		expect(before.content).toMatch(/^Aria: Line 40:/)
		expect(last.role).toBe("user")
		expect(last.content).toMatch(/^\[System note\][\s\S]*Stay in character\./)
	}, 60_000)
})
