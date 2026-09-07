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
 *
 * ⚠ **This file follows the lore-entry half of that write onto
 * `writeEntryVectorIfFresh`**, which is where it lives now that a vector is a
 * row in `lorebook_entry_vectors` rather than three columns on the entry. Every
 * property is the same one: the same text comparison, the same
 * model-changed-mid-flight refusal, and the same "vectorizing is not an edit"
 * — which the new shape gets structurally, because the statement never touches
 * the entry row at all. `writeEmbeddingIfFresh` itself is unchanged and still
 * carries messages, bindings, characters and personas.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
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

/** A world lore entry, left entirely to the column defaults it can be. */
async function makeEntry(lorebookId: number, name: string, content = "x") {
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(worldLoreValues([{ lorebookId, name, content }]))
		.returning()
	return entry
}

async function rawUpdatedAt(id: number) {
	const [row] = await testDb
		.select({
			raw: sql<string>`${schema.lorebookEntries.updatedAt}::text`
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
	return row.raw
}

/** The entry's default-space vector, or undefined when it has none. */
async function defaultVector(entryId: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookEntryVectors)
		.where(
			and(
				eq(schema.lorebookEntryVectors.entryId, entryId),
				eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME),
				eq(schema.lorebookEntryVectors.chunkIndex, 0)
			)
		)
	return row
}

describe("writeEntryVectorIfFresh (PGlite integration)", () => {
	test("persists the vector for a freshly inserted, never-edited row", async () => {
		const { writeEntryVectorIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-fresh-user")
		const lorebook = await makeLorebook(user.id)

		// Deliberately don't set updatedAt — let the schema's own DB-side
		// default populate it, at full Postgres microsecond precision.
		const entry = await makeEntry(lorebook.id, "Entry")

		// Mirrors exactly what the picker's SELECT does: capture updatedAt as
		// text, not as the Drizzle-parsed Date.
		await writeEntryVectorIfFresh(
			entry.id,
			await rawUpdatedAt(entry.id),
			"test-model",
			[0.1, 0.2, 0.3]
		)

		const vector = await defaultVector(entry.id)
		expect(vector?.vector).toEqual([0.1, 0.2, 0.3])
		expect(vector?.model).toBe("test-model")
		expect(vector?.dims).toBe(3)
		expect(vector?.vectorizedAt).not.toBeNull()
	})

	test("replaces the vector it already wrote rather than failing on the key", async () => {
		const { writeEntryVectorIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-replace-user")
		const lorebook = await makeLorebook(user.id)
		const entry = await makeEntry(lorebook.id, "Replaced")
		const raw = await rawUpdatedAt(entry.id)

		await writeEntryVectorIfFresh(entry.id, raw, "test-model", [1, 0, 0])
		await writeEntryVectorIfFresh(entry.id, raw, "test-model", [0, 1, 0])

		// `(entry, name, chunk)` IS the key — there is no second way to name
		// one of these rows, so a re-embed is an upsert and not a duplicate.
		expect((await defaultVector(entry.id))?.vector).toEqual([0, 1, 0])
	})

	test("does not count vectorizing as an edit, so the row stops being stale", async () => {
		const { writeEntryVectorIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-notanedit-user")
		const lorebook = await makeLorebook(user.id)
		const entry = await makeEntry(lorebook.id, "Not An Edit")

		const before = await rawUpdatedAt(entry.id)
		await writeEntryVectorIfFresh(
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
		// The vector living in its own table is what closes that structurally:
		// this statement does not write the entry row, so `$onUpdate` has
		// nothing to fire on. Asserted anyway, because the guarantee is what
		// matters and not the mechanism that currently provides it.
		expect(await rawUpdatedAt(entry.id)).toBe(before)

		const [{ stale }] = await testDb
			.select({
				stale: sql<boolean>`${schema.lorebookEntries.updatedAt} > ${schema.lorebookEntryVectors.vectorizedAt}`
			})
			.from(schema.lorebookEntries)
			.innerJoin(
				schema.lorebookEntryVectors,
				eq(
					schema.lorebookEntryVectors.entryId,
					schema.lorebookEntries.id
				)
			)
			.where(eq(schema.lorebookEntries.id, entry.id))
		expect(stale, "the row was stale the instant it was written").toBe(
			false
		)
	})

	test("skips the write when the row was edited after the capture (edit-during-embed race)", async () => {
		const { writeEntryVectorIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-race-user")
		const lorebook = await makeLorebook(user.id)
		const entry = await makeEntry(lorebook.id, "Entry", "original")
		const captured = await rawUpdatedAt(entry.id)

		// Simulate a concurrent edit landing while embed() was in flight.
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "edited while embedding was in flight" })
			.where(eq(schema.lorebookEntries.id, entry.id))

		await writeEntryVectorIfFresh(
			entry.id,
			captured,
			"test-model",
			[0.9, 0.9, 0.9]
		)

		// The stale vector must never land — the entry stays unembedded and
		// will correctly be re-picked, since it has no vector at all.
		expect(await defaultVector(entry.id)).toBeUndefined()
		const [row] = await testDb
			.select({ content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))
		expect(row.content).toBe("edited while embedding was in flight")
	})

	test("skips the write when the active embedding model changed mid-flight", async () => {
		const { writeEntryVectorIfFresh } = await import("./vectorizationQueue")

		const user = await makeUser("write-embedding-model-switch-user")
		const lorebook = await makeLorebook(user.id)
		const entry = await makeEntry(lorebook.id, "Entry")

		// The item was picked under "model-a", but by the time embed()
		// resolves the loaded model has switched to "model-b".
		getLoadedModelIdMock.mockReturnValue("model-b")

		await writeEntryVectorIfFresh(
			entry.id,
			await rawUpdatedAt(entry.id),
			"model-a",
			[0.5, 0.5, 0.5]
		)

		expect(await defaultVector(entry.id)).toBeUndefined()

		getLoadedModelIdMock.mockReturnValue("test-model")
	})
})
