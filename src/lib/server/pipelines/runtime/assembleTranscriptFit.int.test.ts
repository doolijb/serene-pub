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
const conversation = (n: number, from = 1) => [
	...Array.from({ length: n }, (_, i) => ({
		id: i + from,
		role: i % 2 ? "assistant" : "user",
		name: i % 2 ? "Aria" : "Jody",
		message: `Line ${i + from}: ` + "words ".repeat(15)
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

/** 🚧 *Earlier in the story*: scenes on the `earlierScenes` port. */
const scene = (name: string, firstLineId: number, summary = `${name} happened.`) => ({
	name,
	summary,
	firstLineId
})
const systemText = (value: any) =>
	value.context.messages
		.filter((m: any) => m.role === "system")
		.map((m: any) => m.content)
		.join("\n")
const earlierNote = (value: any) =>
	((value.context.notes ?? []) as string[]).find((n) => n.startsWith("earlier scenes:"))

describe("assemble — Earlier in the story, counted in the fit", () => {
	it("shows only scenes that start before the first line given, after history", async () => {
		const v = await assemble(conversation(10, 10), 100_000, {
			earlierScenes: {
				maxTokens: null,
				scenes: [scene("The Ford", 2), scene("The Inn", 9), scene("The Road", 10), scene("The Pass", 14)]
			}
		})
		const sys = systemText(v)
		expect(sys).toContain(
			'Earlier in the story:\n```json\n[{"name":"The Ford","summary":"The Ford happened."},{"name":"The Inn","summary":"The Inn happened."}]\n```'
		)

		expect(sys).toContain("Earlier in the story:")
		expect(sys).toContain("The Ford")
		expect(sys).toContain("The Inn")
		expect(sys).not.toContain("The Road")
		expect(sys).not.toContain("The Pass")
		expect(sys.indexOf("The Ford")).toBeLessThan(sys.indexOf("The Inn"))
		// Nothing was cut, so the transcript note is absent; the earlier-scenes one says why.
		expect(v.transcriptFit).toBeUndefined()
		expect(earlierNote(v)).toBe(
			"earlier scenes: the summaries of 2 scenes are in the prompt (The Ford, The Inn), because some of their lines are no longer in it. Leave Earlier in the story out under Prompt blocks to stop it."
		)
	}, 60_000)

	it("after a cut, a scene that lost only its opening line shows; scenes wholly in the kept lines do not", async () => {
		const scenes = [scene("S1", 1), scene("S10", 10), scene("S20", 20), scene("S39", 39), scene("S40", 40)]
		const v = await assemble(conversation(40), 600, {
			earlierScenes: { maxTokens: null, scenes }
		})
		const heldAt = v.transcriptFit.heldAt as number
		expect(heldAt).toBeGreaterThan(1)
		expect(heldAt).toBeLessThan(39)
		const sys = systemText(v)
		for (const sc of scenes)
			expect(sys.includes(`"name":"${sc.name}"`)).toBe(
				sc.firstLineId < heldAt
			)
		expect(v.transcriptFit.final).toBeLessThanOrEqual(600)
		expect(earlierNote(v)).toMatch(/^earlier scenes: the summar/)
	}, 60_000)

	it("one line of a scene lost still shows it", async () => {
		const v = await assemble(conversation(10, 10), 100_000, {
			earlierScenes: { maxTokens: null, scenes: [scene("Opener", 9)] }
		})
		expect(systemText(v)).toContain("Opener")
		expect(earlierNote(v)).toMatch(/the summary of 1 scene is in the prompt \(Opener\)/)
	}, 60_000)

	it("with a small share, the newest that fit show and the oldest are left out, and the receipt says so", async () => {
		const summary = "They rode on through the rain and the dark. ".repeat(2)
		const scenes = ["Oldest", "Older", "Newer", "Newest"].map((n, i) => scene(n, i + 1, summary))
		const v = await assemble(conversation(10, 10), 100_000, {
			earlierScenes: { maxTokens: 85, scenes }
		})
		const sys = systemText(v)
		expect(sys).toContain("Newest")
		expect(sys).toContain("Newer")
		expect(sys).not.toContain("Oldest")
		expect(sys).not.toContain("Older")
		expect(earlierNote(v)).toBe(
			"earlier scenes: the summaries of 2 scenes are in the prompt (Newer, Newest), because some of their lines are no longer in it. 2 older ones were left out to keep the block within its share of the window (85 tokens). Leave Earlier in the story out under Prompt blocks to stop it."
		)
	}, 60_000)

	it("says so when no summary fits the share", async () => {
		const v = await assemble(conversation(10, 10), 100_000, {
			earlierScenes: { maxTokens: 5, scenes: [scene("Only", 1)] }
		})
		expect(systemText(v)).not.toContain("Earlier in the story:")
		expect(earlierNote(v)).toBe(
			"earlier scenes: 1 scene lost lines from the prompt, but none of their summaries fit the block's share of the window (5 tokens). Leave Earlier in the story out under Prompt blocks to stop it."
		)
	}, 60_000)

	it("over turns in the band the prompt keeps the same first line, with the block counted", async () => {
		const scenes = [scene("Ford", 1), scene("Inn", 8), scene("Road", 16), scene("Pass", 24)].map((x) => ({
			...x,
			summary: "They rode on through the rain and the dark."
		}))
		const firsts: string[] = []
		for (let n = 40; n <= 48; n++) {
			const v = await assemble(conversation(n), 600, {
				earlierScenes: { maxTokens: 90, scenes }
			})
			firsts.push(firstLine(v))
			expect(v.transcriptFit).toBeDefined()
			expect(v.transcriptFit.final).toBeLessThanOrEqual(600)
		}
		expect(firsts).toHaveLength(9)
		const changes = firsts.filter((f, i) => i > 0 && f !== firsts[i - 1]).length
		expect(changes).toBeLessThanOrEqual(1)
	}, 120_000)

	it("keeps the first turn's cut on the second turn with the block in", async () => {
		const earlierScenes = { maxTokens: 90, scenes: [scene("Ford", 1), scene("Inn", 8)] }
		const turn1 = await assemble(conversation(40), 600, { earlierScenes })
		const turn2 = await assemble(conversation(42), 600, { earlierScenes })
		expect(turn2.transcriptFit.held).toBe(true)
		expect(firstLine(turn2)).toBe(firstLine(turn1))
		expect(systemText(turn2)).toContain("Ford")
	}, 60_000)

	it("with no budget (no fit) shows the scenes older than the first line given", async () => {
		const v = await assemble(conversation(6, 5), 0, {
			budget: undefined,
			earlierScenes: { maxTokens: null, scenes: [scene("Before", 2), scene("After", 8)] }
		})
		const sys = systemText(v)
		expect(sys).toContain("Before")
		expect(sys).not.toContain("After")
	}, 60_000)

	it("renders byte-identically with no port, an empty list, or no scenes", async () => {
		const bare = await assemble(conversation(40), 600)
		resetHeldCuts()
		const empty = await assemble(conversation(40), 600, {
			earlierScenes: { maxTokens: 90, scenes: [] }
		})
		resetHeldCuts()
		const none = await assemble(conversation(40), 600, { earlierScenes: undefined })
		resetHeldCuts()
		const malformed = await assemble(conversation(40), 600, { earlierScenes: { scenes: "x" } })
		expect(JSON.stringify(empty.context)).toBe(JSON.stringify(bare.context))
		expect(JSON.stringify(none.context)).toBe(JSON.stringify(bare.context))
		expect(JSON.stringify(malformed.context)).toBe(JSON.stringify(bare.context))
		expect(earlierNote(bare)).toBeUndefined()
		expect(systemText(bare)).not.toContain("Earlier in the story")
	}, 60_000)

	it("a template that does not place the block cuts exactly the lines it cut before, and says nothing", async () => {
		// A custom template, or a Prompt blocks list with the block switched
		// off: no block renders, so the cut must not make room for one.
		const source = SHIPPED_CONTEXT_TEMPLATE.replace(
			/\{\{#if earlierScenes\}\}[\s\S]*?\{\{\/if\}\}\n?/,
			""
		)
		expect(source).not.toContain("earlierScenes")
		const template = { source, engine: CORE_TEMPLATE_ENGINE }
		const scenes = [scene("S1", 1), scene("S10", 10), scene("S20", 20)]
		const without = await assemble(conversation(40), 600, { template })
		resetHeldCuts()
		const withPort = await assemble(conversation(40), 600, {
			template,
			earlierScenes: { maxTokens: 90, scenes }
		})
		expect(JSON.stringify(withPort.context)).toBe(JSON.stringify(without.context))
		expect(withPort.transcriptFit.heldAt).toBe(without.transcriptFit.heldAt)
		expect(earlierNote(withPort)).toBeUndefined()
	}, 60_000)
})
