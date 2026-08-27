/**
 * A node's parameters reaching the code that reads them.
 *
 * ⚠ This exists because they did not. `loreFor` called
 * `withDefaults(input.params)` with the node's flat `{scanDepth}`, while
 * `withDefaults` looks for `partial.retrieval.scanDepth` — so **`Scan Depth` on
 * both lore query nodes did nothing at all**. It rendered in the panel,
 * accepted a value, stored it, resolved through six scope layers, and was read
 * by a function that could not see it.
 *
 * Nothing caught it because every layer worked: the declaration was right, the
 * write was right, the resolve was right, and the consumer silently used a
 * default. The only assertion that can catch a seam like this is one that
 * starts at the node's parameters and ends at the observable behaviour, which
 * is what these are.
 */

import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

const messages = [
	{ id: 1, content: "the ashguard rode north" },
	{ id: 2, content: "rain, all week" },
	{ id: 3, content: "nothing much happened" }
]

const entries = [
	{
		id: 1,
		lorebookId: 1,
		name: "The Ashguard",
		keys: "ashguard",
		content: "An order of oathbound riders, led by Commander Vell.",
		enabled: true
	},
	{
		id: 2,
		lorebookId: 1,
		name: "Vell",
		keys: "vell",
		content: "A commander who never removes her helm.",
		enabled: true
	}
]

const ctx = {
	read: async (what: string) =>
		what === "lorebook_entries"
			? entries.map((e) => ({ ...e, source: "worldLore" }))
			: what === "session_messages"
				? messages
				: { available: false, reason: "no embedding model is loaded" }
}

const worldLore = (params: Record<string, unknown>) =>
	coreBindings()["core:query/world-lore@1"]!(
		{ scope: { sessionId: 1 }, params },
		ctx as any
	) as Promise<any>

describe("a lore node's parameters reach the scan", () => {
	it("scanDepth narrows the window", async () => {
		const deep = await worldLore({ scanDepth: 10 })
		const shallow = await worldLore({ scanDepth: 1 })

		expect(deep.value.diagnostics.scanDepth).toBe(10)
		expect(shallow.value.diagnostics.scanDepth).toBe(1)
		// The one that only read the last message cannot have seen "ashguard".
		expect(deep.value.hits.map((c: any) => c.id)).toEqual([1])
		expect(shallow.value.hits).toEqual([])
	})

	it("maxRecursionDepth turns recursion on", async () => {
		const off = await worldLore({ scanDepth: 10 })
		const on = await worldLore({ scanDepth: 10, maxRecursionDepth: 1 })

		expect(off.value.hits.map((c: any) => c.id)).toEqual([1])
		expect(on.value.hits.map((c: any) => c.id).sort()).toEqual([1, 2])
	})

	it("retrievalMode is the default for an entry that has not chosen", async () => {
		// No embedding model here, so `rag` falls back to keyword and both
		// modes find the entry — the difference has to be shown on an entry
		// the mode can actually exclude. `keyword` never becomes
		// vector-eligible, so the vector arm is where the two diverge.
		const asKeyword = await worldLore({
			scanDepth: 10,
			retrievalMode: "keyword"
		})
		expect(asKeyword.value.hits.map((c: any) => c.id)).toEqual([1])

		// An entry that stated its own strategy outranks the node's default.
		const stated = coreBindings()["core:query/world-lore@1"]!(
			{
				scope: { sessionId: 1 },
				params: { scanDepth: 10, retrievalMode: "keyword" }
			},
			{
				...ctx,
				read: async (what: string) =>
					what === "lorebook_entries"
						? [
								{
									...entries[0],
									source: "worldLore",
									retrievalStrategy: "rag"
								}
							]
						: what === "session_messages"
							? messages
							: { available: true, model: "test" }
			} as any
		) as Promise<any>
		const r = await stated
		expect(r.value.hits).toEqual([])
		expect(r.value.skipped[0].reason).toMatch(/set to rag/)
	})
})

/**
 * The signal-weight matrix reaching the scorer (migration 0146).
 *
 * The descriptor declares it transposed — nine `perMember` fields, one control
 * row per signal — while `withDefaults` demands one complete set per source,
 * with no deep merge. `signalsFrom` in `bindings.ts` is the seam that
 * transposes back and constructs the completeness, and this is the
 * start-at-the-params, end-at-the-selection assertion that catches it dying
 * the way `scanDepth` once did.
 */
describe("the ranker's signal weights reach the scorer", () => {
	const rank = (params: Record<string, unknown>) =>
		coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					// A scores 0.35 under the defaults (keyword, worldLore);
					// B scores 0 — density does not apply to lore today.
					{
						id: "A",
						source: "worldLore",
						tokens: 100,
						signals: { keyword: 1 }
					},
					{
						id: "B",
						source: "worldLore",
						tokens: 100,
						signals: { density: 1 }
					}
				],
				// Room for exactly one, so the order is observable as survival.
				budget: { remaining: 100 },
				params
			},
			{} as any
		) as Promise<any>

	it("a raised weight changes who survives the budget", async () => {
		const byDefault = await rank({})
		expect(byDefault.value.candidates.map((c: any) => c.id)).toEqual(["A"])

		const densityHeavy = await rank({
			signalDensity: {
				messages: 0.1,
				worldLore: 2,
				characterLore: 0,
				history: 0,
				relationships: 0
			}
		})
		expect(densityHeavy.value.candidates.map((c: any) => c.id)).toEqual([
			"B"
		])
	})

	it("an untouched signal keeps its default rather than zeroing", async () => {
		// Only `signalDensity` is named. If the transposition replaced the
		// whole per-source set, `keyword` would silently become 0 and B (0.2)
		// would beat A — the exact "I set one weight and everything else
		// stopped working" failure the per-field fallback exists to prevent.
		const partial = await rank({
			signalDensity: {
				messages: 0.1,
				worldLore: 0.2,
				characterLore: 0,
				history: 0,
				relationships: 0
			}
		})
		expect(partial.value.candidates.map((c: any) => c.id)).toEqual(["A"])
	})

	it("the declared defaults are the shipped constants", async () => {
		// The descriptor's transposed defaults, exactly as `contracts`
		// declares them. Handing them over must select identically to handing
		// nothing — which is what makes declaring the matrix
		// behaviour-preserving for every untouched spec.
		const declaredDefaults = {
			signalKeyword: { messages: 0, worldLore: 0.35, characterLore: 0.35, history: 0.35, relationships: 0 },
			signalNameMatch: { messages: 0, worldLore: 0.25, characterLore: 0.25, history: 0, relationships: 0 },
			signalEntityCooccurrence: { messages: 0, worldLore: 0.2, characterLore: 0.2, history: 0, relationships: 0 },
			signalTfidf: { messages: 0.1, worldLore: 0.1, characterLore: 0.1, history: 0.1, relationships: 0 },
			signalLastRefRecency: { messages: 0, worldLore: 0.1, characterLore: 0.1, history: 0.1, relationships: 0 },
			signalRecency: { messages: 0.3, worldLore: 0, characterLore: 0, history: 0.2, relationships: 0 },
			signalSceneAffinity: { messages: 0.15, worldLore: 0, characterLore: 0, history: 0.1, relationships: 0 },
			signalDensity: { messages: 0.1, worldLore: 0, characterLore: 0, history: 0, relationships: 0 },
			signalPriorityBonus: { messages: 0, worldLore: 0.15, characterLore: 0.15, history: 0, relationships: 0 }
		}
		const declared = await rank(declaredDefaults)
		const untouched = await rank({})
		expect(declared.value.decisions.map((d: any) => [d.candidate.id, d.score]))
			.toEqual(untouched.value.decisions.map((d: any) => [d.candidate.id, d.score]))
	})
})
