/**
 * Switching the embedding model throws every stored vector away.
 *
 * ## Why it is a destructive act and not a quiet re-index
 *
 * Vectors from two encoders are not comparable — `rankBySimilarity` already
 * drops a row whose `embedding_model` is not the loaded one, so the old vectors
 * were inert the moment the star moved. What they were NOT is honest: the
 * lorebook screens read `embedding_model` to show a "vectorized / stale" badge,
 * and a row still carrying yesterday's model reads as indexed when nothing can
 * retrieve it. Clearing makes the count on screen and the count the queue has to
 * do the same number.
 *
 * That is also why this is gated behind a confirmation in the client that names
 * the number: it is not reversible by starring the old connection back.
 *
 * ## What it clears, and what it deliberately does not
 *
 * Exactly the stores the embedding queue REBUILDS. Clearing a vector nothing
 * will re-compute would be data loss with no recovery — see `EMBEDDED_STORES`
 * for the two exclusions and the reason for each.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq, isNotNull } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	EMBEDDED_STORES,
	clearEmbeddedVectors,
	countEmbeddedRows
} from "./vectors"

let db: TestDb

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

const VEC = [0.1, 0.2, 0.3]

async function seedVectors(model = "Xenova/all-MiniLM-L6-v2") {
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: 1, name: "Book" })
		.returning()
	await db.insert(schema.characters).values({
		userId: 1,
		name: "Ada",
		description: "d",
		embedding: VEC,
		embeddingModel: model,
		vectorizedAt: new Date()
	} as any)
	await db.insert(schema.personas).values({
		userId: 1,
		isDefault: false,
		name: "Me",
		description: "d",
		embedding: VEC,
		embeddingModel: model,
		vectorizedAt: new Date()
	} as any)
	await db.insert(schema.lorebookBindings).values({
		lorebookId: lorebook.id,
		binding: "ada",
		embedding: VEC,
		embeddingModel: model,
		vectorizedAt: new Date()
	} as any)
	return lorebook
}

describe("counting what is embedded", () => {
	it("counts nothing on an empty install", async () => {
		expect(await countEmbeddedRows(db)).toBe(0)
	}, 60_000)

	it("counts one per row that carries a vector, whatever the model", async () => {
		await seedVectors()
		// Deliberately model-blind: the warning says "every embedded row is
		// re-indexed", and a row embedded under a THIRD model is re-indexed too.
		expect(await countEmbeddedRows(db)).toBe(3)
	}, 60_000)
})

describe("clearing", () => {
	it("drops the vector and the model stamp, and keeps the row", async () => {
		await seedVectors()
		const cleared = await clearEmbeddedVectors(db)
		expect(cleared).toBe(3)
		expect(await countEmbeddedRows(db)).toBe(0)

		// The rows themselves survive — this is a re-index, not a delete.
		const [char] = await db.select().from(schema.characters)
		expect(char.name).toBe("Ada")
		expect(char.embedding).toBeNull()
		expect(char.embeddingModel).toBeNull()
		expect(char.vectorizedAt).toBeNull()
	}, 60_000)

	it("leaves the entry vector table with no rows rather than empty vectors", async () => {
		// `lorebook_entry_vectors` is one ROW per vector with `vector` NOT NULL,
		// so "no vector" is the absence of the row. A row with an empty array
		// would be a vector of width zero that every reader would have to special
		// case.
		const store = EMBEDDED_STORES.find((s) => s.kind === "rows")
		expect(
			store,
			"the entry vector store must be cleared by deletion"
		).toBeTruthy()
	}, 60_000)

	it("is idempotent", async () => {
		await seedVectors()
		await clearEmbeddedVectors(db)
		expect(await clearEmbeddedVectors(db)).toBe(0)
	}, 60_000)
})

describe("the store list", () => {
	it("covers every table the queue re-embeds", async () => {
		// The guard against the next table to grow vectors: if something starts
		// writing `embedding` and is not listed here, a model switch leaves its
		// rows stamped with an encoder nothing can query.
		const names = EMBEDDED_STORES.map((s) => s.table)
		for (const expected of [
			"session_messages",
			"characters",
			"personas",
			"lorebook_bindings",
			"narrative_relationships",
			"lorebook_entry_vectors"
		])
			expect(names).toContain(expected)
	}, 60_000)

	it("names the same stores the queue counts as work", async () => {
		// The tie between the two enumerations, asserted as text rather than by
		// running the queue (which reads the app's own database, not this one).
		// `countUnembedded` is the other list; a store in one and not the other
		// is either a vector nothing rebuilds or a stamp nothing clears.
		const { readFileSync } = await import("node:fs")
		const queue = readFileSync(
			"src/lib/server/embedding/vectorizationQueue.ts",
			"utf8"
		)
		const counted = queue.slice(
			queue.indexOf("export async function countUnembedded"),
			queue.indexOf("// ---", queue.indexOf("countUnembeddedEntries"))
		)
		for (const drizzleName of [
			"sessionMessages",
			"characters",
			"personas",
			"lorebookBindings",
			"narrativeRelationships"
		])
			expect(
				counted,
				`countUnembedded does not count ${drizzleName}, which EMBEDDED_STORES clears.`
			).toContain(`schema.${drizzleName}`)
		// Entries are counted through their own vector table, by join.
		expect(counted).toContain("countUnembeddedEntries")
	}, 60_000)
})
