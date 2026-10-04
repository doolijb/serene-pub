import { describe, expect, it } from "vitest"
import { genresFitting, pipelinesFitting, promptDeletion } from "./promptsAdmin"

const pipelines = [
	{ slug: "core:chat", name: "Chat", promptPools: ["core:node/reply#prompts"], genres: [{ id: "core:chat", name: "Chat" }] },
	{ slug: "core:adv", name: "Adventure", promptPools: ["core:node/reply#prompts", "core:node/narrate#prompts"], genres: [{ id: "core:adventure", name: "Adventure" }] },
	{ slug: "core:sum", name: "Summarize", promptPools: ["core:node/summarize#prompts"], genres: [] }
]
const reply = { id: 1, name: "Reply", poolId: "core:node/reply#prompts", isImmutable: true, usedBy: ["Chat"] }
const narrate = { id: 2, name: "Narrate", poolId: "core:node/narrate#prompts", isImmutable: false, usedBy: [] }

describe("prompt filters", () => {
	it("a prompt fits every pipeline with a step reading its pool", () => {
		expect(pipelinesFitting(reply, pipelines).map((p) => p.slug)).toEqual(["core:chat", "core:adv"])
		expect(pipelinesFitting(narrate, pipelines).map((p) => p.slug)).toEqual(["core:adv"])
	})
	it("genres come through the pipelines it fits — no cross-pipeline leakage", () => {
		expect(genresFitting(reply, pipelines).map((g) => g.id)).toEqual(["core:chat", "core:adventure"])
		expect(genresFitting(narrate, pipelines).map((g) => g.id)).toEqual(["core:adventure"])
	})
})

describe("promptDeletion", () => {
	it("keeps built-in and in-use prompts, deletes the rest", () => {
		const used = { ...narrate, id: 3, name: "Used", usedBy: ["Adventure"] }
		const d = promptDeletion([reply, narrate, used])
		expect(d.objects.map((o) => o.label)).toEqual(["Narrate"])
		expect(d.summary).toContain("Reply stays")
		expect(d.summary).toContain("Used stays: still picked by Adventure")
	})
})
