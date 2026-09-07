/**
 * Round-11 audit fix (MEDIUM): every candidate query inside
 * scopedRankBySimilarity had no LIMIT — fetched every matching row,
 * scored all of them in JS, only sliced to topK after sorting the full
 * set. Separately, RagInfillEngine.ts re-ran the entire fetch-and-score up
 * to 5 times per generation turn (once per query-message embedding), even
 * though the candidate pool never changes within a turn. Fixed by
 * splitting fetchScopedCandidates() (DB-bound, cacheable) from
 * rankScopedCandidates() (pure, cheap, varies per query embedding) and
 * capping each source query at RAG_CANDIDATE_FETCH_CAP rows.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	seedEntries,
	seedEntryVectors,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-ragcontext-fetchscore-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

const MODEL_ID = "test-model"

describe("fetchScopedCandidates — per-source cap", () => {
	test("caps a single source at RAG_CANDIDATE_FETCH_CAP when more rows exist, and reports the truncation", async () => {
		const { fetchScopedCandidates, RAG_CANDIDATE_FETCH_CAP } = await import(
			"./ragContext"
		)
		const user = await makeUser("ragcontext-cap-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Big Lorebook", userId: user.id })
			.returning()

		// Bulk-insert well past the cap in one statement — fast regardless
		// of row count, unlike a one-row-at-a-time loop.
		const rowCount = RAG_CANDIDATE_FETCH_CAP + 50
		const ids = await seedEntries(
			testDb,
			worldLoreValues(
				Array.from({ length: rowCount }, (_, i) => ({
					lorebookId: lorebook.id,
					name: `Entry ${i}`,
					content: `Content ${i}`,
					enabled: true
				}))
			)
		)
		// The vector is a row of its own now, so seeding one is a second
		// insert rather than three more fields on the entry.
		await seedEntryVectors(testDb, ids, [1, 0, 0], MODEL_ID)

		const { candidates, truncated } = await fetchScopedCandidates(
			{
				sessionId: -1,
				characterIds: [],
				personaIds: [],
				lorebookId: lorebook.id,
				allLorebookIds: [lorebook.id]
			},
			{ modelId: MODEL_ID, sources: ["worldLore"] }
		)

		expect(candidates.length).toBe(RAG_CANDIDATE_FETCH_CAP)
		// The point of the report: `available` is the real total, so the
		// receipt can say what the cap cost rather than only that it bound.
		expect(truncated).toEqual([
			{
				source: "worldLore",
				fetched: RAG_CANDIDATE_FETCH_CAP,
				available: rowCount
			}
		])
	})

	test("reports nothing when a source has fewer rows than the cap", async () => {
		const { fetchScopedCandidates } = await import("./ragContext")
		const user = await makeUser("ragcontext-undercap-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Small Lorebook", userId: user.id })
			.returning()
		const ids = await seedEntries(
			testDb,
			worldLoreValues(
				Array.from({ length: 3 }, (_, i) => ({
					lorebookId: lorebook.id,
					name: `Entry ${i}`,
					content: `Content ${i}`,
					enabled: true
				}))
			)
		)
		await seedEntryVectors(testDb, ids, [1, 0, 0], MODEL_ID)

		const { candidates, truncated } = await fetchScopedCandidates(
			{
				sessionId: -1,
				characterIds: [],
				personaIds: [],
				lorebookId: lorebook.id,
				allLorebookIds: [lorebook.id]
			},
			{ modelId: MODEL_ID, sources: ["worldLore"] }
		)

		expect(candidates.length).toBe(3)
		// Asserted as empty rather than as "worldLore is absent": a report
		// that fires on an untruncated fetch is the same lie in the other
		// direction, and it would teach a reader to ignore the field.
		expect(truncated).toEqual([])
	})

	test("a truncated source doesn't mark an untruncated one as truncated", async () => {
		const { fetchScopedCandidates, RAG_CANDIDATE_FETCH_CAP } = await import(
			"./ragContext"
		)
		const user = await makeUser("ragcontext-mixed-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Lopsided Lorebook", userId: user.id })
			.returning()

		const worldCount = RAG_CANDIDATE_FETCH_CAP + 7
		const worldIds = await seedEntries(
			testDb,
			worldLoreValues(
				Array.from({ length: worldCount }, (_, i) => ({
					lorebookId: lorebook.id,
					name: `World ${i}`,
					content: `World content ${i}`,
					enabled: true
				}))
			)
		)
		const historyIds = await seedEntries(
			testDb,
			historyValues(
				Array.from({ length: 5 }, (_, i) => ({
					lorebookId: lorebook.id,
					content: `History content ${i}`,
					year: 1000 + i,
					enabled: true
				}))
			)
		)
		await seedEntryVectors(
			testDb,
			[...worldIds, ...historyIds],
			[1, 0, 0],
			MODEL_ID
		)

		const { truncated } = await fetchScopedCandidates(
			{
				sessionId: -1,
				characterIds: [],
				personaIds: [],
				lorebookId: lorebook.id,
				allLorebookIds: [lorebook.id]
			},
			{ modelId: MODEL_ID, sources: ["worldLore", "historyEntry"] }
		)

		expect(truncated).toEqual([
			{
				source: "worldLore",
				fetched: RAG_CANDIDATE_FETCH_CAP,
				available: worldCount
			}
		])
	})
})

describe("rankScopedCandidates — pure scoring over a shared candidate set", () => {
	test("scores, sorts descending, and slices to topK", async () => {
		const { rankScopedCandidates } = await import("./ragContext")

		const candidates = [
			{
				source: "worldLore" as const,
				lorebookId: 1,
				id: 1,
				name: "Orthogonal",
				content: "x",
				embedding: [0, 1, 0],
				embeddingModel: MODEL_ID
			},
			{
				source: "worldLore" as const,
				lorebookId: 1,
				id: 2,
				name: "Exact Match",
				content: "x",
				embedding: [1, 0, 0],
				embeddingModel: MODEL_ID
			},
			{
				source: "worldLore" as const,
				lorebookId: 1,
				id: 3,
				name: "Opposite",
				content: "x",
				embedding: [-1, 0, 0],
				embeddingModel: MODEL_ID
			}
		]

		const ranked = rankScopedCandidates(candidates, [1, 0, 0], 2)
		expect(ranked.length).toBe(2)
		expect(ranked[0].id).toBe(2) // cosine similarity 1.0 — best match
		expect(ranked[0].score).toBeCloseTo(1)
		expect(ranked[1].id).toBe(1) // cosine similarity 0.0 — second
	})

	test("re-scoring the same candidate array against a different query embedding doesn't mutate it (safe to reuse across multiple calls)", async () => {
		const { rankScopedCandidates } = await import("./ragContext")
		const candidates = [
			{
				source: "worldLore" as const,
				lorebookId: 1,
				id: 1,
				name: "A",
				content: "x",
				embedding: [1, 0, 0],
				embeddingModel: MODEL_ID
			},
			{
				source: "worldLore" as const,
				lorebookId: 1,
				id: 2,
				name: "B",
				content: "x",
				embedding: [0, 1, 0],
				embeddingModel: MODEL_ID
			}
		]

		const rankedForA = rankScopedCandidates(candidates, [1, 0, 0])
		const rankedForB = rankScopedCandidates(candidates, [0, 1, 0])

		expect(rankedForA[0].id).toBe(1)
		expect(rankedForB[0].id).toBe(2)
		// The original candidates array itself must be untouched — no
		// `score` field leaking onto the shared, reused candidate objects.
		expect((candidates[0] as any).score).toBeUndefined()
	})
})

describe("scopedRankBySimilarity — thin wrapper stays behaviorally identical", () => {
	test("fetch+rank in one call matches fetchScopedCandidates+rankScopedCandidates done separately", async () => {
		const {
			scopedRankBySimilarity,
			fetchScopedCandidates,
			rankScopedCandidates
		} = await import("./ragContext")
		const user = await makeUser("ragcontext-wrapper-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Wrapper Lorebook", userId: user.id })
			.returning()
		await testDb.insert(schema.lorebookEntries).values(
			// ⚠ No vector. `embedding`/`embeddingModel` used to be columns on
			// the entry row and were passed here; they are a row of their own
			// now (`seedEntryVectors`), so they have been inert on this fixture
			// since the tables merged and the two lists below are both empty.
			// Left as-is rather than repaired, because giving this entry a real
			// vector changes what the comparison compares.
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "Entry",
					content: "x",
					enabled: true
				}
			])
		)

		const context = {
			sessionId: -1,
			characterIds: [],
			personaIds: [],
			lorebookId: lorebook.id,
			allLorebookIds: [lorebook.id]
		}
		const opts = {
			modelId: MODEL_ID,
			sources: ["worldLore" as const],
			topK: 5
		}

		const viaWrapper = await scopedRankBySimilarity(
			[1, 0, 0],
			context,
			opts
		)
		const viaSplit = rankScopedCandidates(
			(await fetchScopedCandidates(context, opts)).candidates,
			[1, 0, 0],
			opts.topK
		)

		expect(viaWrapper).toEqual(viaSplit)
	})
})

/**
 * The request-side boundary between the two source vocabularies.
 *
 * `include()` tests the caller's `sources` against the *index's* eight names,
 * so a caller reaching for one of the ranker's five budget groups — `history`
 * rather than `historyEntry` — matched nothing and got an empty fetch that
 * reads exactly like a session with nothing indexed. Latent, because no shipped
 * spec sets `sources` at all; this is the guard that keeps it from becoming a
 * silent one.
 *
 * ⚠ The two vocabularies are **not** to be merged or renamed into agreement —
 * see `RAG_INDEX_SOURCES` and `VECTOR_SOURCE_ALIASES`. This asserts the
 * translation is demanded at the boundary, not that the boundary goes away.
 */
describe("fetchScopedCandidates — the two source vocabularies", () => {
	test("a ranker budget-group name is refused, naming both vocabularies", async () => {
		const { assertIndexSources } = await import("./ragContext")
		// The ranker's spelling of the same idea. Fetching nothing for it is
		// the failure this replaces.
		expect(() => assertIndexSources(["history"])).toThrow(/'history'/)
		expect(() => assertIndexSources(["history"])).toThrow(/historyEntry/)
		expect(() => assertIndexSources(["messages"])).toThrow(/budget groups/)
	})

	test("every index name passes, including the two the vocabularies share", async () => {
		const { assertIndexSources, RAG_INDEX_SOURCES } = await import(
			"./ragContext"
		)
		expect(() => assertIndexSources([...RAG_INDEX_SOURCES])).not.toThrow()
		expect(() =>
			assertIndexSources(["worldLore", "characterLore"])
		).not.toThrow()
	})

	test("an unknown source reaches the caller instead of an empty result", async () => {
		const { fetchScopedCandidates } = await import("./ragContext")
		const context = {
			sessionId: -1,
			characterIds: [],
			personaIds: [],
			lorebookId: null,
			allLorebookIds: []
		}
		await expect(
			fetchScopedCandidates(context as any, {
				modelId: MODEL_ID,
				sources: ["history" as any]
			})
		).rejects.toThrow(/unknown source/)
	})
})
