/**
 * The vector mechanism, and the merge that makes `both` mean something.
 *
 * Embedding is mocked — this is not testing the model, it is testing that the
 * three-node shape holds: a Provider embeds, a Query retrieves, a Task fuses.
 * The property worth protecting is the last one, because it is the one a naive
 * implementation gets wrong: fusing two orderings rather than averaging two
 * scores.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { roughTokens } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	characterLoreValues,
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"

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

/**
 * The candidate pool the index would return, swapped by the visibility block
 * at the end of this file — which needs sources the rest of it does not.
 */
let poolRows: any[] = []

vi.mock("$lib/server/embedding/ragContext", () => ({
	getSessionRagContext: async () => ({ lorebookId: 1 }),
	// The real one returns the pool alongside a per-source truncation
	// report; the pool here is never capped, so nothing is truncated.
	fetchScopedCandidates: async () => ({
		candidates: poolRows,
		truncated: []
	}),
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

/** What the index holds for every test but the visibility block. */
const WORLD_LORE_POOL = [
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
]
poolRows = WORLD_LORE_POOL

let db: TestDb
let sessionId: number
let userId: number
let lorebookId: number
let aria: number
let brannock: number

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
	lorebookId = lorebook.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				id: 1,
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "ashguard riders"
			},
			{
				id: 2,
				lorebookId: lorebook.id,
				name: "Silverwood",
				keys: "silverwood",
				content: "a forest"
			}
		])
	)

	// Two characters and one binding: character lore is private to whoever it
	// is bound to, so the rule under test needs someone it is *not* about.
	const cast = await db
		.insert(schema.characters)
		.values([
			{ userId, name: "Aria", description: "a rider" },
			{ userId, name: "Brannock", description: "a smith" }
		])
		.returning()
	aria = cast[0]!.id
	brannock = cast[1]!.id

	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: aria,
			binding: "{{char:1}}",
			name: "Aria"
		})
		.returning()

	await db.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				id: 10,
				lorebookId: lorebook.id,
				lorebookBindingId: binding.id,
				name: "Aria's orders",
				keys: "siege",
				// Nothing on this row can exclude it, so anything that does
				// excluded it for visibility — the mechanism's one remaining reason.
				content: "aria plans the siege alone"
			}
		])
	)

	await db.insert(schema.lorebookEntries).values(
		historyValues([
			{
				id: 20,
				lorebookId: lorebook.id,
				year: 812,
				keys: "siege",
				content: "the siege broke in autumn"
			}
		])
	)
}, 60_000)

const bindings = coreBindings()
const host = () => createHost(db, { sessionId, userId })

const ctxFor = (key: string, definitionId: string) => ({
	read: (table: string, q: unknown) =>
		host().read!(table, q, { key, definitionId, definitionVersion: 1, kind: "query" }),
	call: (payload: unknown) =>
		host().call!(
			payload,
			{
				key,
				definitionId,
				definitionVersion: 1,
				kind: "oracle"
			},
			{ dry: false }
		),
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {},
	// Endowed on every binding context by the executor, and read by the vector
	// mechanism when it costs a candidate. `roughTokens` is what a run with no
	// configured tokenizer gets, so this stub keeps saying what it always said.
	countTokens: roughTokens
})

describe("the embed provider", () => {
	/**
	 * ⚠ `enabled` was declared from the first version of this node and read by
	 * nothing — the dead-control family bugs 12 and 15 kept finding. It is live
	 * because the reply pipeline needs the middle value to mean something: most
	 * installs have no embedding model, and the host answers that by throwing.
	 */
	const embed = (params?: Record<string, unknown>) =>
		bindings["core:oracle/embed-text@1"]!(
			{ texts: ["tell me about the ashguard"], params },
			ctxFor("embed", "core:oracle/embed-text")
		) as any

	it("`off` returns no vectors without calling the model at all", async () => {
		const r = await embed({ enabled: "off" })
		expect(r.value.vectors).toEqual([])
		expect(r.value.vector).toBeNull()
	})

	it("`auto` reads an unavailable model as an absence, not a failure", async () => {
		modelReady = false
		try {
			const r = await embed({ enabled: "auto" })
			expect(r.kind).toBe("ok")
			expect(r.value.vectors).toEqual([])
		} finally {
			modelReady = true
		}
		// And the default is `auto`: a node whose params slot is unwired gets
		// `undefined` here and must behave the same way.
		modelReady = false
		try {
			expect((await embed()).kind).toBe("ok")
		} finally {
			modelReady = true
		}
	})

	it("`on` lets the failure be one, for somebody who asked for it", async () => {
		modelReady = false
		try {
			await expect(embed({ enabled: "on" })).rejects.toThrow(
				/no embedding model is loaded/
			)
		} finally {
			modelReady = true
		}
	})

	it("produces a vector through the host, not inside the query", async () => {
		// A Query may not reach a model (16 §1). Making the call a Provider also
		// puts it in the budget and the receipt, which it would not be if
		// retrieval quietly made it.
		const result: any = await bindings["core:oracle/embed-text@1"]!(
			{ text: "tell me about the ashguard" },
			ctxFor("embed", "core:oracle/embed-text")
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
					definitionId: "core:oracle/embed-text",
					definitionVersion: 1,
					kind: "oracle"
				},
				{ dry: false }
			)
		).rejects.toThrow(/no embedding model is loaded/)
		modelReady = true
	})
})

describe("the vector query", () => {
	/**
	 * ⚠ `maxEntries` on every call, because **0 is off and 0 is the shipped
	 * default**.
	 *
	 * The mechanism's switch (design phase 2) returns before any read when nobody has
	 * asked for entries, so a test that omits it measures the switch rather than
	 * the mechanism. Its own test is `the mechanism's own switch` at the end of this file.
	 */
	// On the declared `vectors` port — a list, one query vector per window. The
	// binding reads no singular alias (R-12 swept `input.vector`).
	const runQuery = (vector: number[]) =>
		bindings["core:query/vector-search@1"]!(
			{
				vectors: [vector],
				scope: { sessionId },
				params: { maxEntries: 50 }
			},
			ctxFor("vsearch", "core:query/vector-search")
		) as any

	it("returns the nearest candidates, scored", async () => {
		const r = await runQuery([1, 0, 0])
		expect(r.value.hits[0].payload.name).toBe("The Ashguard")
		// ⚠ **On `signals.semantic`, and no longer on `presetScore`.** The
		// cosine used to be stamped where `select`'s `scoreOf` reads *before*
		// the weighted sum, so a mechanism wired straight into `rank-hybrid` ordered
		// the whole pool by cosine with every signal weight inert. As a signal
		// it adds to whatever else found the entry instead — see the binding.
		expect(r.value.hits[0].signals.semantic).toBe(1)
		expect(r.value.hits[0].presetScore).toBeUndefined()
	})

	/**
	 * ⚠ A behaviour change at the shipped default, and the only one the curve
	 * makes there.
	 *
	 * A negative cosine — two opposed directions — used to reach
	 * `signals.semantic` intact, where the weighted sum turned it into a
	 * *penalty*: an entry ranked lower for having been looked at by a mechanism.
	 * That is the one thing the governing rule forbids a mechanism to do, so it
	 * reads as 0 now, which is what "this mechanism has nothing to say about
	 * this entry" means everywhere else.
	 *
	 * Asserted with an inverted query rather than a contrived score, because the
	 * point is that the *index* can produce this and no test could see it.
	 */
	it("reads an opposed direction as nothing to say, never as a penalty", async () => {
		const r = await runQuery([-1, 0, 0])
		const ashguard = r.value.hits.find((h: any) => h.id === 1)
		expect(ashguard, "the entry left the pool").toBeTruthy()
		expect(ashguard.signals.semantic).toBe(0)
		for (const hit of r.value.hits)
			expect(hit.signals.semantic).toBeGreaterThanOrEqual(0)
	})

	it("never carries embeddings into the pipeline's values", async () => {
		// A vector is a few hundred floats. Letting one travel an edge would put
		// it in every downstream input and in the receipt.
		const r = await runQuery([1, 0, 0])
		expect(JSON.stringify(r.value.hits)).not.toContain("embedding")
	})

	it("skips nothing when every hit has a lore row", async () => {
		// ⚠ **This asserted the opposite until migration 0204.** Entry 2 was
		// seeded `retrievalStrategy: "keyword"` and the mechanism declined it —
		// "handled by the keyword scan" — with an embedding model loaded and a
		// perfect cosine. That is a mechanism switched off for a candidate,
		// which is what the plan's second governing rule forbids however small
		// the scope, so the column and the check went together.
		//
		// Visibility is the mechanism's one remaining exclusion, and it has its own
		// block below. Here there is nothing to withhold, so the skip list is
		// empty rather than explanatory.
		const r = await runQuery([0, 0, 1])
		expect(r.value.hits.map((h: any) => h.id)).toContain(2)
		expect(r.value.skipped).toEqual([])
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

describe("several queries, one mechanism", () => {
	const runQuery = (vectors: number[][]) =>
		bindings["core:query/vector-search@1"]!(
			{ vectors, scope: { sessionId }, params: { maxEntries: 50 } },
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

describe("merging the mechanisms", () => {
	const merge = (sources: any[][]) =>
		bindings["core:task/merge-candidates@1"]!({ sources }, {} as any) as any

	it("an entry both mechanisms found outranks one either found alone", async () => {
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

	it("records which mechanism found it, and at what rank", async () => {
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
		// Re-scoring a fused result would undo the fusion: the mechanisms' raw numbers
		// are not comparable, which is why rank fusion was chosen.
		const r = await merge([
			[{ id: 10, source: "worldLore", signals: { keyword: 1 } }]
		])
		expect(r.value.candidates[0].presetScore).toBeGreaterThan(0)
	})

	it("one empty mechanism degrades to the other's ordering rather than failing", async () => {
		const r = await merge([[{ id: 1, source: "worldLore" }], []])
		expect(r.value.candidates.map((c: any) => c.id)).toEqual([1])
	})

	it("says so on the receipt when the orderings it was given are disjoint", async () => {
		// The signature of the misuse this node was put to for nine spec
		// versions: three lore lanes, no entry in common, so nothing to fuse and
		// every "fused" score is one list position. Reported rather than
		// refused — a halt would take down a plugin's spec mid-turn over a
		// wiring choice that still produces candidates, and the receipt is where
		// a wiring question belongs.
		const r = await merge([
			[{ id: 1, source: "worldLore" }],
			[{ id: 2, source: "characterLore" }],
			[{ id: 3, source: "history" }]
		])
		expect(r.value.diagnostics.disjoint).toBe(true)
		expect(r.value.diagnostics.agreed).toBe(0)
		expect(r.value.diagnostics.warning).toMatch(
			/core:task\/concat-candidates@1/
		)
	})

	it("keeps quiet when the mechanisms actually agree about something", async () => {
		const r = await merge([
			[{ id: 1, source: "worldLore" }],
			[
				{ id: 2, source: "worldLore" },
				{ id: 1, source: "worldLore" }
			]
		])
		expect(r.value.diagnostics.disjoint).toBe(false)
		expect(r.value.diagnostics.agreed).toBe(1)
		expect(r.value.diagnostics.warning).toBeUndefined()
	})

	it("keeps quiet when only one mechanism returned anything", async () => {
		// No embedding model, or no keyword match: an ordinary turn, and a
		// complaint here would be one the reader learns to ignore.
		const r = await merge([[{ id: 1, source: "worldLore" }], []])
		expect(r.value.diagnostics.disjoint).toBe(false)
		expect(r.value.diagnostics.warning).toBeUndefined()
	})
})

/**
 * Concatenation, which is deliberately **not** fusion.
 *
 * ⚠ The reason this node exists: `core:spec/respond` wired its three lore lanes
 * into the merge above, and the merge stamps a reciprocal-rank `presetScore` on
 * everything it passes through. `select`'s `scoreOf` reads `presetScore` before
 * it computes anything, so with three disjoint lists every entry ranked by its
 * position in its own list — database row order, since `keywordQuery` does not
 * sort — and `score()`, all nine signal weights and the priority bonus were
 * inert on the shipped reply path. The parity fixture
 * `session/entity-cooccurrence` is the one that could see it.
 */
describe("concatenating lanes", () => {
	const concat = (sources: any[][]) =>
		bindings["core:task/concat-candidates@1"]!(
			{ sources },
			{} as any
		) as any

	it("stamps no score, so the ranker still has something to rank", async () => {
		const r = await concat([
			[{ id: 1, source: "worldLore", signals: { keyword: 1 } }],
			[{ id: 2, source: "history", signals: { keyword: 0.5 } }]
		])
		for (const c of r.value.candidates)
			expect(c.presetScore).toBeUndefined()
		// And the signals it was handed reach the ranker untouched, which is
		// the whole point of not scoring here.
		expect(r.value.candidates[0].signals).toEqual({ keyword: 1 })
	})

	it("preserves each lane's order, and the order the lanes were wired in", async () => {
		const r = await concat([
			[
				{ id: 1, source: "worldLore" },
				{ id: 2, source: "worldLore" }
			],
			[{ id: 3, source: "history" }]
		])
		expect(r.value.candidates.map((c: any) => c.id)).toEqual([1, 2, 3])
	})

	it("drops a repeat, first occurrence winning", async () => {
		const r = await concat([
			[{ id: 1, source: "worldLore", payload: { name: "first" } }],
			[{ id: 1, source: "worldLore", payload: { name: "second" } }]
		])
		expect(r.value.candidates).toHaveLength(1)
		expect(r.value.candidates[0].payload.name).toBe("first")
		expect(r.value.diagnostics.duplicates).toBe(1)
	})

	/**
	 * ⚠ **The repeat drops; its measurements do not.**
	 *
	 * This is what makes several mechanisms into one score. The keyword scan and the
	 * semantic mechanism measure different things about the same entry — *its keys
	 * fired* and *it is about what is being discussed* — so dropping the second
	 * copy whole would throw the second measurement away, and an entry two
	 * independent mechanisms found would score exactly as if only the first had.
	 * The retrieval plan asks for the opposite: *agreement across mechanisms
	 * compounds by addition and needs no fusion step.*
	 */
	it("merges a repeat's signals for keys the kept copy does not carry", async () => {
		const r = await concat([
			[
				{
					id: 1,
					source: "worldLore",
					signals: { keyword: 1, tfidf: 0.2 }
				}
			],
			[{ id: 1, source: "worldLore", signals: { semantic: 0.8 } }]
		])
		expect(r.value.candidates[0].signals).toEqual({
			keyword: 1,
			tfidf: 0.2,
			semantic: 0.8
		})
		expect(r.value.diagnostics.enriched).toBe(1)
	})

	it("first-wins holds per signal too, so lane order still decides a shared key", async () => {
		// The entity mechanism sizes `entityCooccurrence` against its own weight
		// (§13.10) and the keyword scan has already answered the same question
		// against the band's. Its lane position said this before the merge
		// existed; now the rule says it rather than the ordering implying it.
		const r = await concat([
			[
				{
					id: 1,
					source: "worldLore",
					signals: { entityCooccurrence: 0 }
				}
			],
			[{ id: 1, source: "worldLore", signals: { entityCooccurrence: 1 } }]
		])
		expect(r.value.candidates[0].signals.entityCooccurrence).toBe(0)
		expect(r.value.diagnostics.enriched).toBe(0)
	})

	it("does not write back into the list a mechanism is still holding", async () => {
		// The vector mechanism hands the same objects out on `main`, `hits` and
		// `lists`; merging in place would edit its own published output.
		const kept = { id: 1, source: "worldLore", signals: { keyword: 1 } }
		await concat([
			[kept],
			[{ id: 1, source: "worldLore", signals: { semantic: 1 } }]
		])
		expect(kept.signals).toEqual({ keyword: 1 })
	})

	it("keys on source and id, so two tables' row 1 are two entries", async () => {
		// The three lore tables have independent identity sequences, so a young
		// lorebook holding id 1 in each is the normal case.
		const r = await concat([
			[{ id: 1, source: "worldLore" }],
			[{ id: 1, source: "history" }]
		])
		expect(r.value.candidates).toHaveLength(2)
	})

	it("degrades to nothing rather than failing when handed nothing", async () => {
		expect((await concat([])).value.candidates).toEqual([])
	})
})

/**
 * What the semantic mechanism's nine stages are allowed to decide.
 *
 * ⚠ They decided nothing, latently, for as long as the chain existed.
 * `core:query/vector-search@1` builds each candidate with
 * `presetScore: hit.score` — the raw cosine — so a merge downstream has an
 * ordering to fuse. `core:task/rank-semantic@1` then runs rrf, normalise,
 * recency, priority, threshold, MMR and the per-source cap and writes the
 * result to `score`… which `select`'s `scoreOf` never reads, because it prefers
 * `presetScore`. So `vector-search → rank-semantic → rank-hybrid` — the shape
 * the SDK documents as the canonical semantic mechanism — ran the whole stack and
 * then re-sorted the survivors by raw cosine.
 *
 * The binding writes the computed score back onto `presetScore` now. These
 * fixtures are built so the two orderings genuinely disagree; a fixture where
 * they happened to agree would pass either way and prove nothing.
 */
describe("the semantic mechanism's ordering, after the stages have run", () => {
	const rank = (windows: any[]) =>
		bindings["core:task/rank-semantic@1"]!(
			{ windows, messages: [] },
			{} as any
		) as any

	/** What `toCandidate` in the vector mechanism emits: a cosine on `presetScore`. */
	const hit = (id: number, cosine: number) => ({
		id,
		source: "worldLore",
		tokens: 4,
		signals: {},
		presetScore: cosine,
		priority: 1,
		payload: { id, name: `entry ${id}` }
	})

	// Two query embeddings, ranking the same three entries differently, so rank
	// fusion has something to say. Raw cosine would order them 1, 3, 2; the
	// fused ranks order them 2, 1, 3.
	const windows = () => [
		{
			lists: [
				[hit(1, 0.99), hit(2, 0.1), hit(3, 0.5)],
				[hit(2, 0.1), hit(3, 0.5), hit(1, 0.99)]
			]
		}
	]

	it("publishes the computed score as the score `select` will read", async () => {
		const r = await rank(windows())
		for (const c of r.value.candidates) expect(c.presetScore).toBe(c.score)
	})

	it("survives to the ranker instead of being re-sorted by raw cosine", async () => {
		const r = await rank(windows())
		const bySelect = [...r.value.candidates].sort(
			(a: any, b: any) => b.presetScore - a.presetScore
		)
		expect(bySelect.map((c: any) => c.id)).toEqual([2, 1, 3])

		// The counterfactual, and the reason this fixture is not just "a run
		// where the numbers happen to line up": ordering the same candidates by
		// the cosine they arrived with gives a different answer.
		const byCosine = [0.99, 0.1, 0.5]
		expect(
			[1, 2, 3]
				.map((id, i) => ({ id, cosine: byCosine[i]! }))
				.sort((a, b) => b.cosine - a.cosine)
				.map((c) => c.id)
		).toEqual([1, 3, 2])
	})
})

/**
 * Who the mechanism may answer to.
 *
 * The vector index carries no bindings and no strategy column, so the only
 * place the two can be honoured is against the `lorebook_entries` read — which
 * is already visibility-filtered. Reading a hit's *absence* from that read as
 * "not a lore row, nothing to honour" is how private character lore reached the
 * prompt through this mechanism on every turn.
 *
 * ⚠ A second symptom of the same bug is gone rather than fixed: a keyword-only
 * history entry used to come back through the mechanism its author had excluded,
 * because the source-spelling drift made it skip the strategy check. Migration
 * 0204 dropped that check, so what remains here is the visibility half — the
 * one exclusion this mechanism may still make.
 */
describe("what the index returns and the lorebook read does not", () => {
	const SPEAKER_POOL = [
		...WORLD_LORE_POOL,
		{
			source: "characterLore",
			id: 10,
			name: "Aria's orders",
			content: "aria plans the siege alone",
			embedding: vectorFor("aria plans the siege alone"),
			lorebookId: 1
		},
		{
			// The index's spelling, and `lorebook_entries` says `history` —
			// the drift that let this source skip the check entirely.
			source: "historyEntry",
			id: 20,
			name: "",
			content: "the siege broke in autumn",
			embedding: vectorFor("the siege broke in autumn"),
			lorebookId: 1
		},
		{
			source: "message",
			id: 30,
			content: "we were talking about the siege",
			embedding: vectorFor("we were talking about the siege"),
			sessionId: 1
		},
		{
			source: "narrativeNode",
			id: 40,
			name: "The siege",
			summary: "the siege, as a node",
			embedding: vectorFor("the siege"),
			lorebookId: 1
		}
	]

	beforeAll(() => {
		poolRows = SPEAKER_POOL
	})
	afterAll(() => {
		poolRows = WORLD_LORE_POOL
	})

	const runQuery = (currentCharacterId: number | null) =>
		bindings["core:query/vector-search@1"]!(
			{
				vectors: [[0, 1, 0]],
				scope: { sessionId, currentCharacterId },
				params: { maxEntries: 50 }
			},
			ctxFor("vsearch", "core:query/vector-search")
		) as any

	const keys = (r: any) => r.value.hits.map((h: any) => `${h.source}:${h.id}`)

	it("keeps a character's private lore out of another character's turn", async () => {
		// The leak this block exists for. `isCharacterLoreEntryVisible` had
		// already withheld the entry from the lore read; the mechanism published it
		// anyway because it could not tell "withheld" from "not lore".
		const r = await runQuery(brannock)
		expect(keys(r)).not.toContain("characterLore:10")
		expect(r.value.skipped.find((s: any) => s.id === 10)?.reason).toMatch(
			/not visible to the current speaker/
		)
	})

	it("returns it on that character's own turn", async () => {
		// The other half: excluding it always would be the same bug wearing the
		// opposite symptom, and character lore is the speaker's own knowledge.
		const r = await runQuery(aria)
		expect(keys(r)).toContain("characterLore:10")
		expect(r.value.skipped.map((s: any) => s.id)).not.toContain(10)
	})

	it("excludes nothing else — visibility is the only reason left", async () => {
		// ⚠ **This was "honours a history entry set to keyword only".** Entry 20
		// was seeded `keyword`, and the case it caught was the source-spelling
		// drift: `historyEntry` in the index against `history` in
		// `lorebook_entries`, which let history skip the strategy check
		// altogether. Migration 0204 dropped the column, so the entry comes back
		// and that particular symptom is gone with the check.
		//
		// The drift itself is not: `VECTOR_SOURCE_ALIASES` still reconciles the
		// two vocabularies, and it is what will decide whether a *withheld*
		// history row is honoured once anything withholds one — phase 7's
		// clairvoyance filter excludes on knowledge, for every source. Today
		// only character lore is withheld, which the two cases above cover.
		//
		// What is asserted here is the shape that replaces the old one: on a
		// turn where nothing is withheld, the mechanism declines nobody.
		const r = await runQuery(aria)
		expect(keys(r)).toContain("historyEntry:20")
		expect(r.value.skipped).toEqual([])
	})

	it("still passes a message and a graph node through untouched", async () => {
		// Neither has a lore row anywhere, so absence really does mean "nothing
		// to honour" for them — the case the always-eligible branch is for.
		const r = await runQuery(aria)
		expect(keys(r)).toContain("message:30")
		expect(keys(r)).toContain("narrativeNode:40")
		expect(r.value.skipped.map((s: any) => s.id)).not.toContain(30)
		expect(r.value.skipped.map((s: any) => s.id)).not.toContain(40)
	})
})

/**
 * The text a hit carries out of the host.
 *
 * Not every source keeps its text in `content`: a graph node keeps it in
 * `summary` and a relationship in `description` (`ScopedRagItem`). Projecting
 * `content` alone handed those hits an empty string, which the mechanism then costed
 * at zero tokens — a result slot occupied by nothing, and a ranker with no text
 * to weigh.
 */
describe("the text a hit carries", () => {
	const GRAPH_POOL = [
		{
			source: "narrativeNode",
			id: 40,
			name: "The siege",
			summary: "the keep fell in the siege",
			embedding: vectorFor("the keep fell in the siege"),
			lorebookId: 1
		},
		{
			source: "narrativeRelationship",
			id: 41,
			fromNodeId: 40,
			toNodeId: 42,
			relationshipType: "besieged",
			description: "aria held the walls through the siege",
			status: "active",
			reason: null,
			embedding: vectorFor("aria held the walls through the siege"),
			lorebookId: 1
		}
	]

	beforeAll(() => {
		poolRows = GRAPH_POOL
	})
	afterAll(() => {
		poolRows = WORLD_LORE_POOL
	})

	const runQuery = () =>
		bindings["core:query/vector-search@1"]!(
			{
				vectors: [[0, 1, 0]],
				scope: { sessionId },
				params: { maxEntries: 50 }
			},
			ctxFor("vsearch", "core:query/vector-search")
		) as any

	const hitOf = (r: any, source: string) =>
		r.value.hits.find((h: any) => h.source === source)

	it("publishes a graph node's summary as its text, costed", async () => {
		const r = await runQuery()
		const hit = hitOf(r, "narrativeNode")
		expect(hit.payload.content).toBe("the keep fell in the siege")
		expect(hit.tokens).toBeGreaterThan(0)
	})

	it("publishes a relationship's description as its text, costed", async () => {
		const r = await runQuery()
		const hit = hitOf(r, "narrativeRelationship")
		expect(hit.payload.content).toBe(
			"aria held the walls through the siege"
		)
		expect(hit.tokens).toBeGreaterThan(0)
	})
})
