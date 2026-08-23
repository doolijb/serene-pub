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
			: what === "chat_messages"
				? messages
				: { available: false, reason: "no embedding model is loaded" }
}

const worldLore = (params: Record<string, unknown>) =>
	coreBindings()["core:query/world-lore@1"]!(
		{ scope: { chatId: 1 }, params },
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
				scope: { chatId: 1 },
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
						: what === "chat_messages"
							? messages
							: { available: true, model: "test" }
			} as any
		) as Promise<any>
		const r = await stated
		expect(r.value.hits).toEqual([])
		expect(r.value.skipped[0].reason).toMatch(/set to rag/)
	})
})
