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
	test("doesn't error and caps a single source at RAG_CANDIDATE_FETCH_CAP when more rows exist", async () => {
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
		await testDb.insert(schema.worldLoreEntries).values(
			Array.from({ length: rowCount }, (_, i) => ({
				lorebookId: lorebook.id,
				name: `Entry ${i}`,
				content: `Content ${i}`,
				enabled: true,
				embedding: [1, 0, 0],
				embeddingModel: MODEL_ID
			}))
		)

		const candidates = await fetchScopedCandidates(
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
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "Entry",
			content: "x",
			enabled: true,
			embedding: [1, 0, 0],
			embeddingModel: MODEL_ID
		})

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
			await fetchScopedCandidates(context, opts),
			[1, 0, 0],
			opts.topK
		)

		expect(viaWrapper).toEqual(viaSplit)
	})
})
