/**
 * `bandsFromIntents` — the band table one run resolves from what the sources
 * said (R-7 P5), and the one seam where the index's spelling of a band has to
 * land on the budget group that pays for it.
 */
import { describe, it, expect } from "vitest"
import {
	BUDGET_GROUP_ALIASES,
	DEFAULT_GROUPS,
	bandsFromIntents
} from "$lib/server/pipelines/ranking/weights"

describe("bandsFromIntents", () => {
	it("resolves the fallback table from no intents at all", () => {
		expect(bandsFromIntents([]).groups).toEqual(DEFAULT_GROUPS)
		expect(bandsFromIntents([]).declared).toEqual([])
	})

	it("overlays a declared intent field by field and keeps the band's other defaults", () => {
		const { groups, declared } = bandsFromIntents([
			{ band: "worldLore", intent: { share: 0.4 } }
		])
		expect(declared).toEqual(["worldLore"])
		expect(groups.share.worldLore).toBe(0.4)
		expect(groups.maxEntries.worldLore).toBe(DEFAULT_GROUPS.maxEntries.worldLore)
		expect(groups.priority.worldLore).toBe("normal")
	})

	it("lands an intent spelled in the index's vocabulary on the budget group, as the candidates are (U3b S5)", () => {
		// A source publishing its items as `message` (the vector index's
		// spelling) and its intent under the same word: `toBudgetGroups`
		// re-spells the items `messages` at the ranker's in-port, and without
		// the same re-spelling here the intent would open a sixth band beside
		// the five while the items landed in `messages` on the fallback.
		expect(BUDGET_GROUP_ALIASES.message).toBe("messages")
		const { groups, declared } = bandsFromIntents([
			{ band: "message", intent: { share: 0.7, minEntries: 2 } }
		])
		expect(declared).toEqual(["messages"])
		expect("message" in groups.share).toBe(false)
		expect(groups.share.messages).toBe(0.7)
		expect(groups.minEntries.messages).toBe(2)
		// The other two aliases take the same road.
		const two = bandsFromIntents([
			{ band: "historyEntry", intent: { maxEntries: 3 } },
			{ band: "narrativeRelationship", intent: { share: 0.1 } }
		])
		expect(two.declared).toEqual(["history", "relationships"])
		expect(two.groups.maxEntries.history).toBe(3)
		expect(two.groups.share.relationships).toBe(0.1)
	})

	it("first intent per band wins, across spellings", () => {
		const { groups } = bandsFromIntents([
			{ band: "messages", intent: { share: 0.6 } },
			{ band: "message", intent: { share: 0.1 } }
		])
		expect(groups.share.messages).toBe(0.6)
	})

	it("a band nothing defaults arrives with what it declared and nothing else", () => {
		const { groups } = bandsFromIntents([
			{ band: "deep", intent: { share: 0.25, priority: "high" } }
		])
		expect(groups.share.deep).toBe(0.25)
		expect(groups.maxEntries.deep).toBeUndefined()
		expect(groups.minEntries.deep).toBe(0)
		expect(groups.priority.deep).toBe("high")
	})
})
