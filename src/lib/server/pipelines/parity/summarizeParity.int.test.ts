/**
 * The summarize bindings build the *same prompts* the legacy path builds.
 *
 * This is the parity claim for the four summarize namespaces, and it is checked
 * where parity can actually be checked: at the prompt. The model's answer varies
 * run to run, so comparing outputs proves nothing — but the prompt is a pure
 * function of the messages, the lore type and the configured system text, and if
 * that is byte-identical then any difference in behaviour is the model's, not
 * the migration's.
 *
 * What it is really protecting against is the failure that already nearly
 * happened here: an earlier draft of the host serialized the batch as bare JSON
 * and dropped the rules, the `<content>` contract and the per-lore-type wording
 * entirely. Every summary would still have *worked* — plausible prose, no error
 * anywhere — while quietly being a different feature.
 */

import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	buildBatchPrompt,
	buildNamePrompt,
	buildSynthesisPrompt,
	formatMessagesAsJson
} from "$lib/server/utils/summarizer/templates"

const MESSAGES = [
	{ senderName: "Mira", content: "The gate was sealed with old iron." },
	{ senderName: "Cade", content: "Then we go under it, not through it." }
]

/** Captures what the binding asked the substrate to send. */
function recordingCtx(text: string) {
	const calls: any[] = []
	return {
		calls,
		ctx: {
			call: async (payload: any) => {
				calls.push(payload)
				return { text, json: null }
			}
		} as any
	}
}

const LORE_TYPES = ["world", "character", "scene", "history"] as const

describe("phase 1 — the batch prompt", () => {
	for (const loreType of LORE_TYPES) {
		it(`matches the legacy builder for ${loreType}`, async () => {
			const binding = coreBindings()["core:provider/summarize-batch@1"]!
			const { ctx, calls } = recordingCtx("<content>• A thing.</content>")

			await binding({ batch: MESSAGES, loreType }, ctx)

			const expected = buildBatchPrompt({
				jsonMessages: formatMessagesAsJson(MESSAGES),
				loreType,
				systemPromptOverride: null
			})
			expect(calls[0].systemPrompt).toBe(expected.systemPrompt)
			expect(calls[0].userPrompt).toBe(expected.userPrompt)
		})
	}

	it("uses the configured system prompt when there is one", async () => {
		// The prompts slot, resolved through the scope chain — a user's own
		// wording has to reach the model or the whole config layer is decorative.
		const binding = coreBindings()["core:provider/summarize-batch@1"]!
		const { ctx, calls } = recordingCtx("<content>• A thing.</content>")

		await binding(
			{
				batch: MESSAGES,
				loreType: "world",
				prompts: { batch: "MY OWN ARCHIVIST VOICE" }
			},
			ctx
		)
		expect(calls[0].systemPrompt).toBe("MY OWN ARCHIVIST VOICE")
	})

	it("falls back to the template's default when the configured one is blank", async () => {
		// The legacy columns default to `""`, so an unconfigured step must fall
		// back rather than send an empty system prompt — which is the difference
		// between "archivist voice" and no instructions at all.
		const binding = coreBindings()["core:provider/summarize-batch@1"]!
		const { ctx, calls } = recordingCtx("<content>• A thing.</content>")

		await binding(
			{ batch: MESSAGES, loreType: "world", prompts: { batch: "   " } },
			ctx
		)
		const expected = buildBatchPrompt({
			jsonMessages: formatMessagesAsJson(MESSAGES),
			loreType: "world",
			systemPromptOverride: null
		})
		expect(calls[0].systemPrompt).toBe(expected.systemPrompt)
	})

	it("unwraps the content tag, so the tags never reach synthesis", async () => {
		const binding = coreBindings()["core:provider/summarize-batch@1"]!
		const { ctx } = recordingCtx(
			"<content>\n• The gate was sealed\n</content>"
		)
		const result: any = await binding(
			{ batch: MESSAGES, loreType: "world" },
			ctx
		)
		const draft = result.value?.draft ?? result.draft
		expect(draft).not.toContain("<content>")
		// The parser also normalizes bullet punctuation, and that is the legacy
		// behaviour rather than an accident of this test.
		expect(draft).toBe("• The gate was sealed.")
	})
})

describe("phase 2 — the synthesis prompt", () => {
	for (const loreType of LORE_TYPES) {
		it(`matches the legacy builder for ${loreType}`, async () => {
			const binding = coreBindings()["core:provider/summarize-synth@1"]!
			const { ctx, calls } = recordingCtx("<content>• Merged.</content>")

			const drafts = ["• first draft", "• second draft"]
			await binding({ drafts, loreType }, ctx)

			const expected = buildSynthesisPrompt({
				jsonDrafts: JSON.stringify(
					drafts.map((draft, i) => ({ part: i + 1, draft })),
					null,
					2
				),
				loreType,
				systemPromptOverride: null
			})
			expect(calls[0].systemPrompt).toBe(expected.systemPrompt)
			expect(calls[0].userPrompt).toBe(expected.userPrompt)
		})
	}

	it("numbers the drafts in order, because the merge preserves chronology", async () => {
		// The drafts are chronological slices and the synthesis prompt asks the
		// model to keep that order. Renumbering or reordering them here would
		// turn a narrative into a pile of events.
		const binding = coreBindings()["core:provider/summarize-synth@1"]!
		const { ctx, calls } = recordingCtx("<content>• Merged.</content>")

		await binding(
			{ drafts: ["alpha", "beta", "gamma"], loreType: "history" },
			ctx
		)
		const sent = JSON.parse(
			/Drafts:\n([\s\S]*?)\n\nOutput ONLY/.exec(calls[0].userPrompt)![1]
		)
		expect(sent.map((d: any) => d.part)).toEqual([1, 2, 3])
		expect(sent.map((d: any) => d.draft)).toEqual([
			"alpha",
			"beta",
			"gamma"
		])
	})
})

describe("the title step", () => {
	for (const loreType of LORE_TYPES) {
		it(`matches the legacy builder for ${loreType}`, async () => {
			const binding = coreBindings()["core:provider/name-entry@1"]!
			const { ctx, calls } = recordingCtx("The Sealed Gate")

			await binding({ content: "Some finished prose.", loreType }, ctx)

			const expected = buildNamePrompt({
				content: "Some finished prose.",
				loreType,
				systemPromptOverride: null
			})
			expect(calls[0].systemPrompt).toBe(expected.systemPrompt)
			expect(calls[0].userPrompt).toBe(expected.userPrompt)
		})
	}

	it("returns an entry even when the model gives it no title", async () => {
		// The content is the valuable part. Halting here would throw away a
		// finished summary over its name.
		const binding = coreBindings()["core:provider/name-entry@1"]!
		const { ctx } = recordingCtx("   ")
		const result: any = await binding(
			{ content: "prose", loreType: "world" },
			ctx
		)
		expect(result.ok).not.toBe(false)
		expect(result.value?.name ?? result.name).toBe("")
	})
})

describe("the cast extraction step", () => {
	it("asks for the scene summary and survives an unparseable answer", async () => {
		// The contract is a raw JSON object; models wrap it in prose often
		// enough that an unparseable answer has to mean "no cast" rather than a
		// crash mid-run.
		const binding = coreBindings()["core:provider/extract-cast@1"]!
		const { ctx, calls } = recordingCtx("I could not find any characters.")

		const result: any = await binding({ content: "A quiet room." }, ctx)
		expect(calls[0].userPrompt).toContain("A quiet room.")

		const cast = result.value?.cast ?? result.cast
		expect(cast.participants).toEqual([])
		expect(cast.mentioned).toEqual([])
	})
})
