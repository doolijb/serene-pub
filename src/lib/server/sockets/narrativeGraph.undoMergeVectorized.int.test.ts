/**
 * undoMerge crashed with `TypeError: value.toISOString is not a function`.
 *
 * bindingMergeLogs snapshots live in JSON columns, so every Date written into
 * one comes back out as an ISO *string*. The re-insert destructured `id`,
 * `createdAt` and `updatedAt` out of the snapshot for exactly that reason —
 * but `vectorizedAt` is a timestamp column too, and it was missed. Any row that
 * had ever been embedded therefore carried a string into a `timestamp` column,
 * and drizzle called `.toISOString()` on it.
 *
 * The fix drops vectorizedAt/embeddingModel instead of restoring them, which is
 * also the correct behaviour: the row returns under a NEW primary key, and
 * embeddings are keyed by row id, so a restored vectorizedAt would mark the row
 * as already-embedded and it would never be re-queued.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-undomerge-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

describe("undoMerge with an embedded (vectorized) snapshot", () => {
	test("restores the row instead of crashing on the ISO string", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "undomerge-vec-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "LB" })
			.returning()
		const [survivor] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				name: "Survivor",
				binding: "{{char:1}}"
			})
			.returning()

		// A snapshot as it comes back out of a JSON column: every timestamp is
		// a string, including vectorizedAt.
		const absorbedSnapshot = {
			id: 9999,
			lorebookId: lorebook.id,
			name: "Absorbed",
			binding: "{{char:2}}",
			createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
			updatedAt: new Date("2024-01-02T00:00:00.000Z").toISOString(),
			vectorizedAt: new Date("2024-01-03T00:00:00.000Z").toISOString(),
			embeddingModel: "some-embed-model"
		}

		const [log] = await testDb
			.insert(schema.bindingMergeLogs)
			.values({
				userId: user.id,
				lorebookId: lorebook.id,
				survivorId: survivor.id,
				absorbedSnapshot,
				relationshipRewrites: [],
				deletedRelationships: [],
				sceneSnapshots: [],
				reassignedCharacterLoreEntryIds: [],
				reassignedChildNodeIds: []
			} as any)
			.returning()

		const { narrativeGraphUndoMergeHandler } = await import(
			"./narrativeGraph"
		)
		await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log.id } as any,
			() => {}
		)

		const restored = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.name, "Absorbed")
		})
		expect(restored).toBeDefined()
		expect(restored!.binding).toBe("{{char:2}}")
		// Cleared, not carried over: the new primary key has no embedding, so
		// the row must be eligible for re-vectorization.
		expect(restored!.vectorizedAt).toBeNull()
		expect(restored!.embeddingModel).toBeNull()
	})
})
