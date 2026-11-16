/**
 * 🚧 The knowledge exclusions through eligibility: every copy of a left-out
 * entry is ineligible whichever mechanism brought it, and nothing else is.
 */
import { describe, expect, test } from "vitest"
import { applyEligibility } from "./eligibility"
import { knowledgeExclusions } from "$lib/server/lorebooks/entryKnowledge"

const LEFT = 7
const OTHER = 8
// What the lore lanes publish (an author's own selective logic), in the nested form specs wire.
const loreLaneExclusions = [
	{ source: "worldLore", id: 99, reason: "Its own conditions rule it out here." }
]

const candidates = () => [
	{ id: LEFT, source: "worldLore", text: "keyword", pinned: false },
	{ id: LEFT, source: "characterLore", text: "character", pinned: false },
	{ id: LEFT, source: "history", text: "history", pinned: false },
	{ id: LEFT, source: "historyEntry", text: "vector" },
	{
		id: LEFT,
		source: "worldLore",
		text: "entity",
		payload: { foundBy: "entity-search" }
	},
	{ id: LEFT, source: "worldLore", text: "pinned", pinned: true },
	{ id: OTHER, source: "worldLore", text: "other", pinned: false }
]

describe("knowledge exclusions in eligibility", () => {
	test("every copy of a left-out entry is ineligible; another entry is untouched", () => {
		const out = applyEligibility({
			candidates: candidates(),
			exclusions: [
				loreLaneExclusions,
				knowledgeExclusions(
					[{ entryId: LEFT, cause: "not-known" }],
					"Mira"
				)
			]
		}).candidates as any[]
		for (const c of out.filter((x) => x.id === LEFT))
			expect(c.ineligible, c.text).toEqual({ reason: "Not known by Mira." })
		const other = out.find((x) => x.id === OTHER)
		expect(other.ineligible).toBeUndefined()
		expect(other).toEqual(candidates().find((x) => x.id === OTHER))
	})

	test("a kept-from entry carries its own sentence", () => {
		const out = applyEligibility({
			candidates: candidates(),
			exclusions: [
				knowledgeExclusions([{ entryId: LEFT, cause: "kept-from" }], "Mira")
			]
		}).candidates as any[]
		expect(out.find((x) => x.text === "pinned").ineligible).toEqual({
			reason: "Kept from Mira."
		})
	})

	test("with nothing to filter the candidates are unchanged", () => {
		const input = candidates()
		const out = applyEligibility({
			candidates: input,
			exclusions: [loreLaneExclusions, knowledgeExclusions([], "Mira")]
		})
		expect(out.candidates).toEqual(candidates())
		expect(out.diagnostics.excluded).toBe(0)
	})
})
