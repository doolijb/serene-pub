/**
 * 4a/4b: every vectorizationQueue pick* function's process() closure used to
 * do an unconditional UPDATE after embed() resolved, with no guard against
 * the row having changed (or the active embedding model having changed) in
 * the meantime. writeEmbeddingIfFresh() fixes both — but the fix itself has
 * a precision trap: updatedAt must be captured/compared as text, not as a
 * JS Date, because these timestamp columns store microsecond precision
 * while Drizzle's default "date" mode reads them back as a
 * millisecond-precision JS Date. A row inserted via the schema's
 * defaultNow()-equivalent default (never subsequently edited — the common
 * case, e.g. most content) is exactly the case a JS-Date-based comparison
 * would silently break: the round-trip truncation means it would never
 * match, and the embedding would never persist. This test exercises
 * exactly that — a freshly inserted, never-updated row — not a row whose
 * updatedAt was set from JS, which wouldn't catch the bug.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let getLoadedModelIdMock: ReturnType<typeof vi.fn>

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("./index", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./index")>()
	getLoadedModelIdMock = vi.fn(() => "test-model")
	return { ...actual, getLoadedModelId: getLoadedModelIdMock }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-write-embedding-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeLorebook(userId: number) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Write-Embedding Test Book", userId })
		.returning()
	return lorebook
}

async function rawUpdatedAt(id: number) {
	const [row] = await testDb
		.select({
			raw: sql<string>`${schema.worldLoreEntries.updatedAt}::text`
		})
		.from(schema.worldLoreEntries)
		.where(eq(schema.worldLoreEntries.id, id))
	return row.raw
}

describe("writeEmbeddingIfFresh (PGlite integration)", () => {
	test("persists the embedding for a freshly inserted, never-edited row", async () => {
		const { writeEmbeddingIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-fresh-user")
		const lorebook = await makeLorebook(user.id)

		// Deliberately don't set updatedAt — let the schema's own DB-side
		// default populate it, at full Postgres microsecond precision.
		const [entry] = await testDb
			.insert(schema.worldLoreEntries)
			.values({ lorebookId: lorebook.id, name: "Entry", content: "x" })
			.returning()

		// Mirrors exactly what a pick* function's SELECT does: capture
		// updatedAt as text, not as the Drizzle-parsed Date.
		const [selected] = await testDb
			.select({
				id: schema.worldLoreEntries.id,
				updatedAtRaw: sql<string>`${schema.worldLoreEntries.updatedAt}::text`
			})
			.from(schema.worldLoreEntries)
			.where(eq(schema.worldLoreEntries.id, entry.id))

		await writeEmbeddingIfFresh(
			schema.worldLoreEntries,
			schema.worldLoreEntries.id,
			schema.worldLoreEntries.updatedAt,
			entry.id,
			selected.updatedAtRaw,
			"test-model",
			[0.1, 0.2, 0.3]
		)

		const updated = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		expect(updated?.embedding).toEqual([0.1, 0.2, 0.3])
		expect(updated?.embeddingModel).toBe("test-model")
		expect(updated?.vectorizedAt).not.toBeNull()
	})

	test("does not count vectorizing as an edit, so the row stops being stale", async () => {
		const { writeEmbeddingIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-notanedit-user")
		const lorebook = await makeLorebook(user.id)
		const [entry] = await testDb
			.insert(schema.worldLoreEntries)
			.values({ lorebookId: lorebook.id, name: "Not An Edit", content: "x" })
			.returning()

		const before = await rawUpdatedAt(entry.id)

		await writeEmbeddingIfFresh(
			schema.worldLoreEntries,
			schema.worldLoreEntries.id,
			schema.worldLoreEntries.updatedAt,
			entry.id,
			before,
			"test-model",
			[0.1, 0.2, 0.3]
		)

		// `updatedAt` carries `$onUpdate(() => new Date())`, which drizzle
		// applies to any update on the row unless the statement sets the column
		// itself. When it fired here it stamped a *different* instant than the
		// `vectorizedAt` in the same statement, and about 1% of the time the two
		// straddled a millisecond — leaving `updated_at > vectorized_at`, which
		// is precisely `needsEmbedding`'s "edited since we vectorized" test. The
		// queue picked the row straight back up and paid for a second embedding.
		//
		// Asserted as an exact equality rather than by re-running the queue: the
		// bug only showed up in ~1 run in 100, so the observable it was found
		// through is far too weak to be the one guarding it.
		expect(await rawUpdatedAt(entry.id)).toBe(before)

		const [{ stale }] = await testDb
			.select({
				stale: sql<boolean>`${schema.worldLoreEntries.updatedAt} > ${schema.worldLoreEntries.vectorizedAt}`
			})
			.from(schema.worldLoreEntries)
			.where(eq(schema.worldLoreEntries.id, entry.id))
		expect(stale, "the row was stale the instant it was written").toBe(false)
	})

	test("skips the write when the row was edited after the capture (edit-during-embed race)", async () => {
		const { writeEmbeddingIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-race-user")
		const lorebook = await makeLorebook(user.id)

		const [entry] = await testDb
			.insert(schema.worldLoreEntries)
			.values({
				lorebookId: lorebook.id,
				name: "Entry",
				content: "original"
			})
			.returning()

		const [selected] = await testDb
			.select({
				updatedAtRaw: sql<string>`${schema.worldLoreEntries.updatedAt}::text`
			})
			.from(schema.worldLoreEntries)
			.where(eq(schema.worldLoreEntries.id, entry.id))

		// Simulate a concurrent edit landing while embed() was in flight.
		await testDb
			.update(schema.worldLoreEntries)
			.set({ content: "edited while embedding was in flight" })
			.where(eq(schema.worldLoreEntries.id, entry.id))

		await writeEmbeddingIfFresh(
			schema.worldLoreEntries,
			schema.worldLoreEntries.id,
			schema.worldLoreEntries.updatedAt,
			entry.id,
			selected.updatedAtRaw,
			"test-model",
			[0.9, 0.9, 0.9]
		)

		const updated = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		// The stale vector must never land — the row stays unembedded and
		// will correctly be re-picked (needsEmbedding() sees updatedAt >
		// vectorizedAt, which is still null here).
		expect(updated?.embedding).toBeNull()
		expect(updated?.content).toBe("edited while embedding was in flight")
	})

	test("skips the write when the active embedding model changed mid-flight", async () => {
		const { writeEmbeddingIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-model-switch-user")
		const lorebook = await makeLorebook(user.id)

		const [entry] = await testDb
			.insert(schema.worldLoreEntries)
			.values({ lorebookId: lorebook.id, name: "Entry", content: "x" })
			.returning()

		const [selected] = await testDb
			.select({
				updatedAtRaw: sql<string>`${schema.worldLoreEntries.updatedAt}::text`
			})
			.from(schema.worldLoreEntries)
			.where(eq(schema.worldLoreEntries.id, entry.id))

		// The item was picked under "model-a", but by the time embed()
		// resolves the loaded model has switched to "model-b".
		getLoadedModelIdMock.mockReturnValue("model-b")

		await writeEmbeddingIfFresh(
			schema.worldLoreEntries,
			schema.worldLoreEntries.id,
			schema.worldLoreEntries.updatedAt,
			entry.id,
			selected.updatedAtRaw,
			"model-a",
			[0.5, 0.5, 0.5]
		)

		const updated = await testDb.query.worldLoreEntries.findFirst({
			where: eq(schema.worldLoreEntries.id, entry.id)
		})
		expect(updated?.embedding).toBeNull()

		getLoadedModelIdMock.mockReturnValue("test-model")
	})
})
