/**
 * `bandsFromIntents` — the band table one run resolves from what the sources
 * said (R-7 P5), and the one seam where the index's spelling of a band has to
 * land on the budget group that pays for it.
 */
import { describe, it, expect } from "vitest"
import * as C from "@serene-pub/contracts"
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

describe("the defaults reproduce today's effective values", () => {
	/**
	 * The ranker's fallback table and the five definitions' declared defaults
	 * are ONE set. Disagreeing, a person who tuned nothing would see a
	 * different split depending on which of the two a run fell back to.
	 */
	const declared = (def: { descriptor: any }, field: string) =>
		def.descriptor.slots?.params?.schema?.[field]?.default
	const SOURCES = {
		messages: C.sessionHistory,
		worldLore: C.worldLore,
		characterLore: C.characterLore,
		history: C.historyEntries,
		relationships: C.relationshipSearch
	} as const

	it("declares on each source exactly what the ranker's map held", () => {
		for (const [band, def] of Object.entries(SOURCES)) {
			expect(declared(def, "share"), `${band} share`).toBe(
				DEFAULT_GROUPS.share[band as keyof typeof DEFAULT_GROUPS.share]
			)
			expect(declared(def, "maxEntries"), `${band} maxEntries`).toBe(
				DEFAULT_GROUPS.maxEntries[band as keyof typeof DEFAULT_GROUPS.maxEntries]
			)
			expect(declared(def, "priority"), `${band} priority`).toBe("normal")
		}
		// The one floor: the conversation's six; the lore lanes and the graph
		// declare none (R6).
		expect(declared(C.sessionHistory, "minEntries")).toBe(6)
		for (const def of [C.worldLore, C.characterLore, C.historyEntries, C.relationshipSearch])
			expect(declared(def, "minEntries")).toBeUndefined()
		expect(DEFAULT_GROUPS.share).toEqual({
			messages: 0.5,
			worldLore: 0.1667,
			characterLore: 0.1667,
			history: 0.1666,
			relationships: 0
		})
		expect(DEFAULT_GROUPS.minEntries.messages).toBe(6)
	})

	it("resolves the same table from no intents at all as from the declared ones", () => {
		const fromNothing = bandsFromIntents([]).groups
		const fromDeclared = bandsFromIntents(
			Object.entries(SOURCES).map(([band, def]) => ({
				band,
				intent: {
					share: declared(def, "share"),
					maxEntries: declared(def, "maxEntries"),
					minEntries: declared(def, "minEntries"),
					priority: declared(def, "priority")
				}
			}))
		).groups
		expect(fromDeclared).toEqual(fromNothing)
	})

	it("declares none of the three maps on the ranker any more", () => {
		const schema = C.rankHybrid.descriptor.slots?.params?.schema ?? {}
		for (const gone of ["share", "maxEntries", "minEntries"])
			expect(gone in schema, `${gone} still on rank-hybrid`).toBe(false)
	})
})
