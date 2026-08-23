/**
 * The vector arm, and the merge that makes `both` mean something.
 *
 * Embedding is mocked — this is not testing the model, it is testing that the
 * three-node shape holds: a Provider embeds, a Query retrieves, a Task fuses.
 * The property worth protecting is the last one, because it is the one a naive
 * implementation gets wrong: fusing two orderings rather than averaging two
 * scores.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import * as schema from "$lib/server/db/schema"

let modelReady = true

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => modelReady,
	getLoadedModelId: () => (modelReady ? "test-embed-model" : null),
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/** A toy embedding: three axes, so similarity is predictable and readable. */
function vectorFor(text: string): number[] {
	const t = text.toLowerCase()
	return [
		t.includes("ashguard") ? 1 : 0,
		t.includes("siege") ? 1 : 0,
		t.includes("forest") ? 1 : 0
	]
}

vi.mock("$lib/server/embedding/ragContext", () => ({
	getChatRagContext: async () => ({ lorebookId: 1 }),
	fetchScopedCandidates: async () => [
		{
			source: "worldLore",
			id: 1,
			name: "The Ashguard",
			content: "ashguard riders",
			embedding: vectorFor("ashguard riders"),
			lorebookId: 1
		},
		{
			source: "worldLore",
			id: 2,
			name: "Silverwood",
			content: "a forest",
			embedding: vectorFor("a forest"),
			lorebookId: 1
		}
	],
	rankScopedCandidates: (
		candidates: any[],
		query: number[],
		topK?: number
	) => {
		const dot = (a: number[], b: number[]) =>
			a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
		return candidates
			.map((c) => ({ ...c, score: dot(c.embedding, query) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK ?? candidates.length)
	}
}))

let db: TestDb
let chatId: number
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "vector-test", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Vector Lore", userId })
		.returning()

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	chatId = chat.id

	await db.insert(schema.worldLoreEntries).values([
		{
			id: 1,
			lorebookId: lorebook.id,
			name: "The Ashguard",
			keys: "ashguard",
			content: "ashguard riders",
			retrievalStrategy: "both"
		},
		{
			id: 2,
			lorebookId: lorebook.id,
			name: "Silverwood",
			keys: "silverwood",
			content: "a forest",
			retrievalStrategy: "keyword"
		}
	])
}, 60_000)

const bindings = coreBindings()
const host = () => createHost(db as any, { chatId, userId })

const ctxFor = (key: string, typeId: string) => ({
	read: (table: string, q: unknown) =>
		host().read!(table, q, { key, typeId, typeVersion: 1, kind: "query" }),
	call: (payload: unknown) =>
		host().call!(payload, {
			key,
			typeId,
			typeVersion: 1,
			kind: "provider"
		}),
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
})

describe("the embed provider", () => {
	it("produces a vector through the host, not inside the query", async () => {
		// A Query may not reach a model (16 §1). Making the call a Provider also
		// puts it in the budget and the receipt, which it would not be if
		// retrieval quietly made it.
		const result: any = await bindings["core:provider/embed-text@1"]!(
			{ text: "tell me about the ashguard" },
			ctxFor("embed", "core:provider/embed-text")
		)
		expect(result.kind).toBe("ok")
		expect(result.value.vector).toEqual([1, 0, 0])
	})

	it("refuses rather than returning a fake vector when no model is loaded", async () => {
		modelReady = false
		await expect(
			host().call!(
				{ text: "x" },
				{
					key: "embed",
					typeId: "core:provider/embed-text",
					typeVersion: 1,
					kind: "provider"
				}
			)
		).rejects.toThrow(/no embedding model is loaded/)
		modelReady = true
	})
})

describe("the vector query", () => {
	const runQuery = (vector: number[]) =>
		bindings["core:query/vector-search@1"]!(
			{ vector, scope: { chatId } },
			ctxFor("vsearch", "core:query/vector-search")
		) as any

	it("returns the nearest candidates, scored", async () => {
		const r = await runQuery([1, 0, 0])
		expect(r.value.hits[0].payload.name).toBe("The Ashguard")
		expect(r.value.hits[0].presetScore).toBe(1)
	})

	it("never carries embeddings into the pipeline's values", async () => {
		// A vector is a few hundred floats. Letting one travel an edge would put
		// it in every downstream input and in the receipt.
		const r = await runQuery([1, 0, 0])
		expect(JSON.stringify(r.value.hits)).not.toContain("embedding")
	})

	it("skips an entry whose strategy excludes this arm, and says so", async () => {
		const r = await runQuery([0, 0, 1])
		expect(r.value.hits.map((h: any) => h.id)).not.toContain(2)
		expect(r.value.skipped[0].reason).toMatch(/keyword scan/)
	})

	it("returns nothing, with a reason, when there is no model", async () => {
		modelReady = false
		const r = await runQuery([1, 0, 0])
		expect(r.value.hits).toEqual([])
		expect(r.value.diagnostics.vectorSearch).toMatch(
			/no embedding model is loaded/
		)
		modelReady = true
	})
})

describe("several queries, one arm", () => {
	const runQuery = (vectors: number[][]) =>
		bindings["core:query/vector-search@1"]!(
			{ vectors, scope: { chatId } },
			ctxFor("vsearch", "core:query/vector-search")
		) as any

	it("returns one ranked list per query vector", async () => {
		// "What is being said now" and "what was being said just before" are
		// different questions. One blended embedding answers neither, which is
		// why the legacy engine runs two queries and fuses their ranks.
		const r = await runQuery([
			[1, 0, 0],
			[0, 0, 1]
		])
		expect(r.value.lists).toHaveLength(2)
		expect(r.value.lists[0][0].payload.name).toBe("The Ashguard")
	})

	it("carries a similarity matrix, and never the embeddings behind it", async () => {
		// MMR needs to know which candidates resemble each other. It gets that
		// as derived cosines — bounded, and not reversible into a vector — so
		// no embedding travels a data edge or lands in the receipt.
		const r = await runQuery([[1, 0, 0]])
		const n = r.value.hits.length
		expect(r.value.similarity).toHaveLength(n)
		expect(r.value.similarity[0]).toHaveLength(n)
		expect(r.value.similarity[0][0]).toBe(1)
		expect(JSON.stringify(r.value)).not.toContain("embedding")
	})

	it("lines the matrix up with the candidates it publishes", async () => {
		// The two are indexed together by contract. A Task that had to guess
		// the pairing would be one transposition away from silently diversifying
		// against the wrong candidates.
		const r = await runQuery([
			[1, 0, 0],
			[0, 0, 1]
		])
		expect(r.value.similarity).toHaveLength(r.value.hits.length)
	})

	it("returns nothing, rather than failing, when asked with no vector", async () => {
		const r = await runQuery([])
		expect(r.value.hits).toEqual([])
		expect(r.value.lists).toEqual([])
	})
})

describe("merging the arms", () => {
	const merge = (sources: any[][]) =>
		bindings["core:task/merge-candidates@1"]!({ sources }, {} as any) as any

	it("an entry both arms found outranks one either found alone", async () => {
		// The property `both` is asking for, and the one an average would lose.
		const keyword = [
			{ id: 10, source: "worldLore" },
			{ id: 11, source: "worldLore" }
		]
		const vector = [
			{ id: 12, source: "worldLore" },
			{ id: 11, source: "worldLore" }
		]
		const r = await merge([keyword, vector])
		expect(r.value.candidates[0].id).toBe(11)
	})

	it("records which arm found it, and at what rank", async () => {
		const r = await merge([
			[{ id: 10, source: "worldLore" }],
			[
				{ id: 11, source: "worldLore" },
				{ id: 10, source: "worldLore" }
			]
		])
		const both = r.value.candidates.find((c: any) => c.id === 10)
		expect(both.payload.foundBy).toEqual(["arm0#1", "arm1#2"])
	})

	it("a fused score overrides the weighted sum downstream", async () => {
		// Re-scoring a fused result would undo the fusion: the arms' raw numbers
		// are not comparable, which is why rank fusion was chosen.
		const r = await merge([
			[{ id: 10, source: "worldLore", signals: { keyword: 1 } }]
		])
		expect(r.value.candidates[0].presetScore).toBeGreaterThan(0)
	})

	it("one empty arm degrades to the other's ordering rather than failing", async () => {
		const r = await merge([[{ id: 1, source: "worldLore" }], []])
		expect(r.value.candidates.map((c: any) => c.id)).toEqual([1])
	})
})
