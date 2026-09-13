/**
 * Every place a vector is stored, and the two things a model switch does to
 * them: count them, then throw them away.
 *
 * ## Why clearing, rather than letting staleness handle it
 *
 * `rankBySimilarity` already drops a row whose `embedding_model` is not the
 * loaded one, so vectors from the previous encoder are inert the moment the star
 * moves — retrieval behaves identically either way. What differs is honesty and
 * arithmetic. The lorebook and cast screens read `embedding_model` to show a
 * "vectorized" badge, so a row still stamped with yesterday's model reads as
 * indexed while nothing can retrieve it; and the queue's own "N to do" would
 * disagree with the "N embedded" the confirmation just quoted.
 *
 * It is destructive and unrecoverable — starring the old connection back does
 * not bring the vectors with it — which is precisely why the client puts the
 * number in front of the person before it happens.
 *
 * ## What is in the list, and the two things deliberately left out
 *
 * The rule is **clear exactly what the queue will rebuild**. Clearing a vector
 * nothing re-computes is data loss with no recovery.
 *
 *   · `scenes` carries `embedding`/`embedding_model` and the embedding queue
 *     does NOT produce them — the graph builder does, on its own pass. Clearing
 *     them here would empty a store nothing refills.
 *   · `world_lore_entries`, `character_lore_entries` and `history_entries` are
 *     the legacy entry tables. Live entries are `lorebook_entries` with their
 *     vectors in `lorebook_entry_vectors`, which IS listed; the legacy columns
 *     are read by the deprecated path only and are not re-embedded.
 *
 * ⚠ There is a second enumeration of the live set — `countUnembedded` in
 * `vectorizationQueue.ts`, which counts the same stores with the opposite
 * predicate and cannot share this shape (entries are counted through a join, and
 * each table carries its own staleness condition). The two must name the same
 * stores; `vectors.int.test.ts` asserts they do.
 */

import { eq, isNotNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * One store of vectors.
 *
 * `kind` is the whole of the difference in how it is cleared: a `columns` store
 * keeps the row and nulls three columns, while a `rows` store IS the vector —
 * `lorebook_entry_vectors.vector` is NOT NULL, so "no vector" is the absence of
 * the row and not a zero-width array every reader would have to special-case.
 */
export interface EmbeddedStore {
	/** The SQL table name, for the list test and for a log line. */
	table: string
	kind: "columns" | "rows"
}

export const EMBEDDED_STORES: readonly EmbeddedStore[] = [
	{ table: "session_messages", kind: "columns" },
	{ table: "characters", kind: "columns" },
	{ table: "personas", kind: "columns" },
	{ table: "lorebook_bindings", kind: "columns" },
	{ table: "narrative_relationships", kind: "columns" },
	{ table: "lorebook_entry_vectors", kind: "rows" }
]

/** The five column-shaped stores, as drizzle tables. */
const COLUMN_STORES = [
	schema.sessionMessages,
	schema.characters,
	schema.personas,
	schema.lorebookBindings,
	schema.narrativeRelationships
] as const

/**
 * How many rows carry a vector right now.
 *
 * Deliberately MODEL-BLIND. The sentence it feeds is "every embedded row is
 * re-indexed against the new model", and a row embedded under some third model
 * is re-indexed too — counting only rows matching the current star would quote a
 * number smaller than the work about to happen, on the one screen whose entire
 * job is to state the cost accurately.
 */
export async function countEmbeddedRows(db: Db): Promise<number> {
	const counts = await Promise.all([
		...COLUMN_STORES.map((t) => db.$count(t, isNotNull(t.embedding))),
		db.$count(schema.lorebookEntryVectors)
	])
	return counts.reduce((sum, n) => sum + Number(n), 0)
}

/**
 * Throw every stored vector away. Returns how many rows were affected.
 *
 * ⚠ Destructive and not undoable. The only caller is the embedding star moving
 * to a different model, and the confirmation that precedes it is what makes that
 * legitimate.
 *
 * Nulls `embedding_model` and `vectorized_at` alongside the vector, not just the
 * vector: a row with a model stamp and no vector would read as "embedded by X"
 * to every badge in the app and as "needs work" to the queue, which is the exact
 * disagreement this exists to remove.
 */
export async function clearEmbeddedVectors(db: Db): Promise<number> {
	let cleared = 0
	for (const t of COLUMN_STORES) {
		const rows = await db
			.update(t)
			.set({ embedding: null, embeddingModel: null, vectorizedAt: null })
			.where(isNotNull(t.embedding))
			.returning({ id: t.id })
		cleared += rows.length
	}
	const dropped = await db
		.delete(schema.lorebookEntryVectors)
		.returning({ entryId: schema.lorebookEntryVectors.entryId })
	return cleared + dropped.length
}
