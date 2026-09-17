/**
 * Eager promotion, over a real database.
 *
 * The case the ruling is about: content is scoped for embedding, its vectors
 * are missing, and the query that is about to search it would otherwise see
 * nothing — not a low-ranked row, *nothing*, because the candidate fetch joins
 * on a current vector. So the missing rows are promoted to the front of the
 * existing queue, indexed, and the query resumes.
 *
 * Three properties are worth a database rather than a fake:
 *
 *  1. **The scan and the fetch agree about scope.** `scopedMissingVectors` is
 *     only useful if it names exactly the rows `fetchScopedCandidates` would
 *     have wanted and could not see — same lorebooks, same `enabled` filter,
 *     same staleness identities. A fake would let those drift.
 *  2. **A stale vector and an absent one are both missing.** `sourceHash`-style
 *     staleness is what distinguishes them, and it only exists in SQL.
 *  3. **The bound really bounds.** A lorebook with more unembedded rows than
 *     the bound must leave the rest queued rather than indexing them all inside
 *     the turn.
 *
 * The embedding module is mocked, because none of this is about the model —
 * only about which rows are asked for and in what order.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

const MODEL = "test-embed-model"

/** Flipped by the degradation case — the whole subject of the last block. */
let modelReady = true
let embedCalls = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("./index", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./index")>()
	return {
		...actual,
		isModelReady: () => modelReady,
		isModelLoading: () => false,
		getLoadedModelId: () => (modelReady ? MODEL : null),
		getConfiguredModelId: async () => MODEL,
		getConfiguredEmbeddingTarget: async () => ({
			modelId: MODEL,
			mode: "local" as const,
			ttlMinutes: 11
		}),
		loadConfiguredEmbeddingModel: async () => {},
		embed: async () => {
			embedCalls++
			return [0.1, 0.2, 0.3]
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-eager-promotion-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb

	// The lane's own enabled check, and it is a real one: `isEnabled` reads
	// the `text->embedding` star on every promotion, so without it every case
	// below would report "switched off" and pass vacuously on the degradation
	// test while failing the rest. id is explicit for `createTestDb`'s
	// sequence-resync reason — see the peek-before-load suite.
	await testDb.insert(schema.systemSettings).values({
		id: 1
	})
	const [embeddingConn] = await testDb
		.insert(schema.connections)
		.values({
			name: "Eager Promotion Embeddings",
			modality: "embeddings",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	const [embeddingModel] = await testDb
		.insert(schema.connectionModels)
		.values({
			connectionId: embeddingConn.id,
			model: MODEL,
			name: MODEL
		})
		.returning()
	await testDb.insert(schema.connectionDefaults).values({
		input: "text",
		output: "embedding",
		connectionId: embeddingConn.id,
		connectionModelId: embeddingModel.id
	})
}, 60_000)

afterAll(async () => {
	const { stopVectorization } = await import("./vectorizationQueue")
	stopVectorization()
	await releaseDataDir(dataDir)
})

async function makeBook(name: string, entryCount: number) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `eager-${name}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId: user.id })
		.returning()
	const entries = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues(
				Array.from({ length: entryCount }, (_, i) => ({
					lorebookId: lorebook!.id,
					name: `${name} ${i}`,
					content: `content for ${name} ${i}`
				}))
			)
		)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook!.id
		})
		.returning()
	return { user, lorebook: lorebook!, entries, session: session! }
}

/** The context the vector arm builds, for the book under test. */
const contextFor = (sessionId: number, lorebookId: number) => ({
	sessionId,
	characterIds: [],
	personaIds: [],
	lorebookId,
	allLorebookIds: [lorebookId]
})

const vectorRow = async (entryId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntryVectors)
			.where(
				and(
					eq(schema.lorebookEntryVectors.entryId, entryId),
					eq(
						schema.lorebookEntryVectors.vectorName,
						DEFAULT_VECTOR_NAME
					)
				)
			)
	)[0]

describe("what the scan finds", () => {
	test("names in-scope rows the search could not have seen, and stops naming them once they are indexed", async () => {
		const { lorebook, entries, session } = await makeBook("scan", 3)
		const { scopedMissingVectors, promoteScopedVectors } = await import(
			"./vectorizationQueue"
		)
		const context = contextFor(session.id, lorebook.id)

		const before = await scopedMissingVectors(context, MODEL)
		expect(
			before
				.filter((r) => r.source === "worldLore")
				.map((r) => r.id)
				.sort((a, b) => a - b)
		).toEqual(entries.map((e) => e.id).sort((a, b) => a - b))

		const report = await promoteScopedVectors(context, MODEL)
		expect(report.processed).toBeGreaterThanOrEqual(3)
		expect(report.boundHit).toBe(false)

		for (const entry of entries) {
			const row = await vectorRow(entry.id)
			expect(row, `entry ${entry.id} was not indexed`).toBeTruthy()
			expect(row!.model).toBe(MODEL)
		}

		const after = await scopedMissingVectors(context, MODEL)
		expect(after.filter((r) => r.source === "worldLore")).toEqual([])
	}, 60_000)

	test("counts a vector from another model as missing, not as present", async () => {
		const { lorebook, entries, session } = await makeBook("stale", 1)
		const { scopedMissingVectors, promoteScopedVectors } = await import(
			"./vectorizationQueue"
		)
		const context = contextFor(session.id, lorebook.id)
		const entryId = entries[0]!.id

		// A vector written under a previous model. The candidate fetch joins on
		// `model = <loaded>`, so this row is exactly as invisible as one with no
		// vector at all — and the whole point of keying staleness on identity
		// rather than on presence is that the scan says so.
		await testDb.insert(schema.lorebookEntryVectors).values({
			entryId,
			vectorName: DEFAULT_VECTOR_NAME,
			chunkIndex: 0,
			model: "some-older-model",
			dims: 3,
			vector: [0.9, 0.9, 0.9],
			vectorizedAt: new Date()
		})

		const missing = await scopedMissingVectors(context, MODEL)
		expect(missing.some((r) => r.id === entryId)).toBe(true)

		await promoteScopedVectors(context, MODEL)
		expect((await vectorRow(entryId))!.model).toBe(MODEL)
	}, 60_000)

	test("ignores a disabled entry — the search would not have looked at it", async () => {
		const { lorebook, entries, session } = await makeBook("disabled", 2)
		const { scopedMissingVectors } = await import("./vectorizationQueue")
		await testDb
			.update(schema.lorebookEntries)
			.set({ enabled: false })
			.where(eq(schema.lorebookEntries.id, entries[0]!.id))

		const missing = await scopedMissingVectors(
			contextFor(session.id, lorebook.id),
			MODEL
		)
		expect(missing.some((r) => r.id === entries[0]!.id)).toBe(false)
		expect(missing.some((r) => r.id === entries[1]!.id)).toBe(true)
	}, 60_000)
})

describe("the bound", () => {
	test("indexes up to the bound, says the bound was hit, and leaves the rest queued", async () => {
		const { lorebook, entries, session } = await makeBook("bounded", 6)
		const { promoteScopedVectors } = await import("./vectorizationQueue")
		const context = contextFor(session.id, lorebook.id)

		const report = await promoteScopedVectors(context, MODEL, {
			maxItems: 2
		})

		expect(report.requested).toBeGreaterThanOrEqual(6)
		expect(report.processed).toBe(2)
		expect(report.remaining).toBe(report.requested - 2)
		expect(report.boundHit).toBe(true)
		// The sentence a person reads, not just the numbers.
		expect(report.reason).toMatch(/bounded/)

		// The rest are not lost — the same queue keeps going, which is the
		// difference between promoting into it and running beside it.
		const { embeddingLane } = await import("./vectorizationQueue")
		await embeddingLane.settled()
		for (const entry of entries)
			expect(
				await vectorRow(entry.id),
				`entry ${entry.id} never got indexed by the background sweep`
			).toBeTruthy()
	}, 60_000)
})

describe("a promotion that cannot complete", () => {
	test("degrades to a report with a reason, rather than throwing or hanging", async () => {
		const { lorebook, entries, session } = await makeBook("nomodel", 2)
		const { promoteScopedVectors } = await import("./vectorizationQueue")
		const context = contextFor(session.id, lorebook.id)

		modelReady = false
		const callsBefore = embedCalls
		try {
			const started = Date.now()
			const report = await promoteScopedVectors(context, MODEL, {
				timeoutMs: 30_000
			})
			const elapsed = Date.now() - started

			// The governing rule: an unavailable mechanism subtracts a signal.
			// It does not halt, it does not throw into the turn, and it does not
			// wait out its own deadline to find out.
			expect(report.processed).toBe(0)
			expect(report.reason).toMatch(/not resident yet/)
			expect(elapsed).toBeLessThan(5_000)
			expect(embedCalls).toBe(callsBefore)
		} finally {
			modelReady = true
		}

		for (const entry of entries)
			expect(await vectorRow(entry.id)).toBeFalsy()
		expect(lorebook.id).toBeGreaterThan(0)
	}, 60_000)

	test("reports nothing to do rather than a failure when the scope is already covered", async () => {
		const { lorebook, session } = await makeBook("covered", 1)
		const { promoteScopedVectors } = await import("./vectorizationQueue")
		const context = contextFor(session.id, lorebook.id)

		await promoteScopedVectors(context, MODEL)
		const second = await promoteScopedVectors(context, MODEL)

		expect(second.requested).toBe(0)
		expect(second.boundHit).toBe(false)
		expect(second.reason).toMatch(/already covered/)
	}, 60_000)
})

describe("the lane declares itself", () => {
	test("names the model it needs and the TTL it wants, without running", async () => {
		const { embeddingLane, refreshEmbeddingLaneTtl } = await import(
			"./vectorizationQueue"
		)
		await refreshEmbeddingLaneTtl()
		expect(embeddingLane.declaration.key).toBe("embedding")
		expect(embeddingLane.declaration.model.role).toBe("embedding")
		// Read from the stored config, not from a constant in the loop.
		expect(embeddingLane.declaration.model.ttlMinutes).toBe(11)
	})

	test("both lanes are registered, and each names its own kind of model", async () => {
		await import("./vectorizationQueue")
		await import("$lib/server/annotations/queue")
		const { listLanes } = await import("$lib/server/indexing/lane")
		const roles = Object.fromEntries(
			listLanes().map((l) => [l.key, l.declaration.model.role])
		)
		expect(roles).toMatchObject({
			embedding: "embedding",
			// ⚠ The role is what this lane's model WOULD be, not whether one is
			// configured. Its extractor is dictionary-based so the zero-setup
			// path keeps working with nothing starred, and the broker's `peek`
			// is what says so — a role that flipped with a setting would make
			// the lane's identity depend on one.
			annotation: "ner"
		})
	})
})
