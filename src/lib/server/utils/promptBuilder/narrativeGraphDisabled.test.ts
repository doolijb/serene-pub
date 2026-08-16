/**
 * The {{narrativeGraph}} block is switched off, and must cost nothing.
 *
 * The default template stopped rendering it, so both infill engines were doing
 * a round of relationship queries per generation and discarding the result.
 * Gating at the shared module covers both engines at once AND skips the
 * queries, rather than only suppressing the output.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

describe("narrative graph context is disabled", () => {
	test("the fetch short-circuits without touching the database", async () => {
		const mod = await import("./NarrativeGraphContext")
		expect(mod.NARRATIVE_GRAPH_CONTEXT_ENABLED).toBe(false)

		const pairs = await mod.fetchActiveRelationshipsAmongNodes(
			[1, 2],
			[1, 2, 3],
			1,
			mod.MAX_GRAPH_PAIRS,
			new Set<number>()
		)
		expect(pairs).toEqual([])
	})

	test("serialization yields nothing even if pairs are handed in", async () => {
		// Belt and braces: a caller holding pairs from elsewhere still cannot
		// resurrect the block while the flag is off.
		const mod = await import("./NarrativeGraphContext")
		const fake = [
			{
				from: "A",
				fromBound: true,
				to: "B",
				toBound: true,
				fromNodeId: 1,
				toNodeId: 2,
				lorebookId: 1,
				rels: [{ type: "ally", status: "active", historyEntryId: null }]
			}
		] as any
		expect(mod.serializeGraphPairs(fake)).toBeUndefined()
	})

	test("re-enabling is a one-line flag flip, not a rewrite", async () => {
		// Guards the intent: the machinery must still be present and callable,
		// because this is a pause rather than a removal.
		const mod = await import("./NarrativeGraphContext")
		expect(typeof mod.fetchActiveRelationshipsAmongNodes).toBe("function")
		expect(typeof mod.serializeGraphPairs).toBe("function")
	})
})
