/**
 * Owner note 37 (2026-10-02): "Prompts need to be properly filtered by
 * pipeline across the app." A prompt picker offers the pipeline's share of
 * the step's pool — rows written for it, shipped for no pipeline in
 * particular, or written for none — and never another pipeline's row, unless
 * it is the one this option already holds.
 */
import { describe, expect, test } from "vitest"
import { promptsForPipeline, type ChoiceList } from "./choices"

const pool = [
	{ id: 1, label: "Chat reply", group: "usedHere" },
	{ id: 2, label: "Shared summary", group: "shipped" },
	{ id: 3, label: "Guide reply", group: "shipped", foreign: true },
	{ id: 4, label: "Mine, for the Lair", group: "alsoFits", foreign: true, description: "from Lair reply" },
	{ id: 5, label: "Mine, for no pipeline", group: "alsoFits" }
] as unknown as ChoiceList

describe("promptsForPipeline", () => {
	test("another pipeline's rows are not offered", () => {
		expect(promptsForPipeline(pool).map((c) => c.id)).toEqual([1, 2, 5])
	})
	test("the held value and the author default stay, whoever wrote them", () => {
		expect(promptsForPipeline(pool, [4, null]).map((c) => c.id)).toEqual([1, 2, 4, 5])
	})
	test("the internal mark never reaches the client", () => {
		for (const c of promptsForPipeline(pool, [3, 4]))
			expect("foreign" in c).toBe(false)
	})
})
