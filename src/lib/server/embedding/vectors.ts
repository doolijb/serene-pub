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
	// One `characters` store, not two: a persona is a character.
	{ table: "characters", kind: "columns" },
	{ table: "lorebook_bindings", kind: "columns" },
	{ table: "narrative_relationships", kind: "columns" },
	{ table: "lorebook_entry_vectors", kind: "rows" }
]

/** The four column-shaped stores, as drizzle tables. */
const COLUMN_STORES = [
	schema.sessionMessages,
	schema.characters,
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

/**
 * The same rows `countEmbeddedRows` counts, by WHAT they are — plus the two
 * scope counts a confirmation sentence needs.
 *
 * ## ⚠ The breakdown decomposes `countEmbeddedRows` exactly
 *
 * It sums to `rows` and never exceeds it, because the screen it feeds says what
 * a destructive re-index will cost. Which means the stores listed here are
 * `EMBEDDED_STORES` and nothing else — in particular:
 *
 *   · **`scenes`** carries `embedding`/`embedding_model` and is excluded. The
 *     graph builder produces those on its own pass and the embedding queue
 *     does not rebuild them, so quoting them as part of a re-index overstates
 *     the work AND names rows `clearEmbeddedVectors` never touches.
 *   · **`world_lore_entries`, `character_lore_entries`, `history_entries`** are
 *     the legacy entry tables, read by the deprecated path only. Live entries
 *     are `lorebook_entries` with their vectors in `lorebook_entry_vectors`,
 *     which IS counted, under `lorebookEntries`.
 *
 * A `history` kind therefore never appears while entries live in one table; if
 * history becomes its own retrieval unit again, it decomposes out of
 * `lorebookEntries` here rather than out of a legacy table.
 *
 * A kind with zero rows is omitted, so a fresh instance answers `{}` rather
 * than seven zeroes.
 */
export async function embeddedBreakdown(db: Db): Promise<{
	byKind: Record<string, number>
	lorebooks: number
	sessions: number
}> {
	const [messages, characters, relationships, bindings, entryVectors] =
		await Promise.all([
			db.$count(
				schema.sessionMessages,
				isNotNull(schema.sessionMessages.embedding)
			),
			db.$count(
				schema.characters,
				isNotNull(schema.characters.embedding)
			),
			db.$count(
				schema.narrativeRelationships,
				isNotNull(schema.narrativeRelationships.embedding)
			),
			db.$count(
				schema.lorebookBindings,
				isNotNull(schema.lorebookBindings.embedding)
			),
			db.$count(schema.lorebookEntryVectors)
		])

	const byKind: Record<string, number> = {}
	const put = (kind: string, n: number) => {
		if (Number(n) > 0) byKind[kind] = Number(n)
	}
	put("messages", messages)
	put("characters", characters)
	put("relationships", relationships)
	// One kind, two stores. A binding is a lorebook's row and is re-embedded by
	// the same pass as the entries beside it, so splitting them would put a
	// word on the confirmation screen ("cast members") that the sentence it is
	// building does not use.
	put("lorebookEntries", Number(bindings) + Number(entryVectors))

	// ⚠ Distinct ids, unioned in JS across the two lorebook-shaped stores. The
	// table is small and the alternative is a UNION query whose two halves would
	// have to be kept in step with the store list above by hand.
	const [entryOwners, bindingOwners, sessionOwners] = await Promise.all([
		db
			.selectDistinct({ id: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntryVectors)
			.innerJoin(
				schema.lorebookEntries,
				eq(
					schema.lorebookEntryVectors.entryId,
					schema.lorebookEntries.id
				)
			),
		db
			.selectDistinct({ id: schema.lorebookBindings.lorebookId })
			.from(schema.lorebookBindings)
			.where(isNotNull(schema.lorebookBindings.embedding)),
		// Sessions come from MESSAGES alone: they are the only embedded store
		// that names a session. Entries belong to a lorebook, and a lorebook can
		// be linked to several sessions or to none, so counting sessions through
		// one would be counting something else.
		db
			.selectDistinct({ id: schema.sessionMessages.sessionId })
			.from(schema.sessionMessages)
			.where(isNotNull(schema.sessionMessages.embedding))
	])

	const lorebookIds = new Set<number>()
	for (const r of [...entryOwners, ...bindingOwners])
		if (r.id != null) lorebookIds.add(r.id)
	const sessionIds = new Set<number>()
	for (const r of sessionOwners) if (r.id != null) sessionIds.add(r.id)

	return {
		byKind,
		lorebooks: lorebookIds.size,
		sessions: sessionIds.size
	}
}
