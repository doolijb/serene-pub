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
 *   · Entries are `lorebook_entries` with their vectors in
 *     `lorebook_entry_vectors`, which IS listed.
 *
 * ⚠ There is a second enumeration of the live set — `countUnembedded` in
 * `vectorizationQueue.ts`, which counts the same stores with the opposite
 * predicate and cannot share this shape (entries are counted through a join, and
 * each table carries its own staleness condition). The two must name the same
 * stores; `vectors.int.test.ts` asserts they do.
 */

import { and, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { sameEmbeddingModel } from "./target"

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
 * Which vectors a count is about: every stored one, or — `keepModels` — every
 * one a switch would clear, i.e. those NOT made by any of the named models.
 */
export interface EmbeddedRowFilter {
	/**
	 * The identities a switch keeps: the target's own and any spelling of it
	 * (`keptModelIds`). A vector with no model stamp is never kept — the clear
	 * treats it the same way (`IS DISTINCT FROM`).
	 */
	keepModels?: readonly string[]
}

const columnStoreRows = (
	t: (typeof COLUMN_STORES)[number],
	filter: EmbeddedRowFilter
) =>
	filter.keepModels?.length
		? and(
				isNotNull(t.embedding),
				or(
					isNull(t.embeddingModel),
					notInArray(t.embeddingModel, [...filter.keepModels])
				)
			)
		: isNotNull(t.embedding)

const entryVectorRows = (filter: EmbeddedRowFilter) =>
	filter.keepModels?.length
		? or(
				isNull(schema.lorebookEntryVectors.model),
				notInArray(schema.lorebookEntryVectors.model, [
					...filter.keepModels
				])
			)
		: undefined

/**
 * How many rows carry a vector right now — or, with `keepModels`, how many a
 * switch to that model would clear.
 *
 * Unfiltered it is MODEL-BLIND, and that is the lane card's number: everything
 * stored. The switch confirmation asks the filtered question, because since
 * plan A10 the star's consequence clears only what the new model cannot use —
 * quoting every stored row for a re-star of the model that made them would put
 * a re-index on screen that never happens.
 */
export async function countEmbeddedRows(
	db: Db,
	filter: EmbeddedRowFilter = {}
): Promise<number> {
	const counts = await Promise.all([
		...COLUMN_STORES.map((t) => db.$count(t, columnStoreRows(t, filter))),
		db.$count(schema.lorebookEntryVectors, entryVectorRows(filter))
	])
	return counts.reduce((sum, n) => sum + Number(n), 0)
}

/**
 * Every identity a stored vector carries, once each. The set is tiny — one
 * model per star an install has ever had — though finding it reads every store.
 */
export async function embeddedModelIds(db: Db): Promise<string[]> {
	const found = new Set<string>()
	for (const t of COLUMN_STORES)
		for (const r of await db
			.selectDistinct({ model: t.embeddingModel })
			.from(t)
			.where(isNotNull(t.embedding)))
			if (r.model) found.add(r.model)
	for (const r of await db
		.selectDistinct({ model: schema.lorebookEntryVectors.model })
		.from(schema.lorebookEntryVectors))
		if (r.model) found.add(r.model)
	return [...found]
}

/**
 * The identities a switch to `modelId` keeps: itself, and every stored
 * spelling of it (`sameEmbeddingModel`).
 */
export async function keptModelIds(db: Db, modelId: string): Promise<string[]> {
	const kept = (await embeddedModelIds(db)).filter((m) =>
		sameEmbeddingModel(m, modelId)
	)
	return kept.includes(modelId) ? kept : [modelId, ...kept]
}

/**
 * Re-stamp every vector made by the model now starred under another spelling
 * of its identity — a trailing slash, a capital, a written-out default port —
 * with the spelling in force. Returns how many rows moved.
 *
 * This is what keeps a cosmetic edit of the starred address (or starring a
 * second connection naming the same address and model) from re-embedding the
 * whole library: the vectors are byte-identical to what the model would return
 * again, and paying a service to recompute them is the waste plan A10 is about.
 * Runs before the clear, so the clear's `keepModel` spares them.
 *
 * ⚠ `updated_at` is pinned on the column stores, as the clear pins it: a new
 * stamp is not an edit.
 */
export async function restampEquivalentVectors(
	db: Db,
	modelId: string
): Promise<number> {
	const aliases = (await keptModelIds(db, modelId)).filter(
		(m) => m !== modelId
	)
	if (!aliases.length) return 0
	let moved = 0
	for (const t of COLUMN_STORES) {
		const rows = await db
			.update(t)
			.set({ embeddingModel: modelId, updatedAt: sql`${t.updatedAt}` })
			.where(and(isNotNull(t.embedding), inArray(t.embeddingModel, aliases)))
			.returning({ id: t.id })
		moved += rows.length
	}
	const rows = await db
		.update(schema.lorebookEntryVectors)
		.set({ model: modelId })
		.where(inArray(schema.lorebookEntryVectors.model, aliases))
		.returning({ entryId: schema.lorebookEntryVectors.entryId })
	return moved + rows.length
}

/**
 * Throw every stored vector away. Returns how many rows were affected.
 *
 * ⚠ Destructive and not undoable. The only caller is the embedding star moving
 * to a different model, and the confirmation that precedes it is what makes that
 * legitimate.
 *
 * Nulls `embedding_model`, `embedding_source_hash` and `vectorized_at`
 * alongside the vector, not just the vector: a row with a model stamp and no
 * vector would read as "embedded by X" to every badge in the app and as "needs
 * work" to the queue, which is the exact disagreement this exists to remove.
 *
 * `keepModel` spares the vectors that model produced (plan A10): the star's
 * consequence clears only what the new model cannot use, so a vector already
 * made by the model now starred — an unstar and a re-star of the same one —
 * survives. Every other vector is unusable to it (`rankBySimilarity` drops a
 * row whose model is not the loaded one, and the queue re-embeds it), so
 * clearing those loses nothing a search could have read.
 *
 * ⚠ `updated_at` is pinned to itself on the column stores: dropping a vector is
 * not an edit, and those tables read `updated_at` as a content timestamp (the
 * recency signals) — the same reason `writeEmbeddingIfFresh` pins it.
 */
export async function clearEmbeddedVectors(
	db: Db,
	opts: { keepModel?: string | null } = {}
): Promise<number> {
	const keep = opts.keepModel ?? null
	let cleared = 0
	for (const t of COLUMN_STORES) {
		const rows = await db
			.update(t)
			.set({
				embedding: null,
				embeddingModel: null,
				embeddingSourceHash: null,
				vectorizedAt: null,
				updatedAt: sql`${t.updatedAt}`
			})
			.where(
				keep == null
					? isNotNull(t.embedding)
					: and(
							isNotNull(t.embedding),
							sql`${t.embeddingModel} IS DISTINCT FROM ${keep}`
						)
			)
			.returning({ id: t.id })
		cleared += rows.length
	}
	const dropped = await db
		.delete(schema.lorebookEntryVectors)
		.where(
			keep == null
				? undefined
				: sql`${schema.lorebookEntryVectors.model} IS DISTINCT FROM ${keep}`
		)
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
 *   · Entries are `lorebook_entries` with their vectors in
 *     `lorebook_entry_vectors`, which IS counted, under `lorebookEntries`.
 *
 * A `history` kind therefore never appears while entries live in one table; if
 * history becomes its own retrieval unit again, it decomposes out of
 * `lorebookEntries` here rather than out of a legacy table.
 *
 * A kind with zero rows is omitted, so a fresh instance answers `{}` rather
 * than seven zeroes.
 */
export async function embeddedBreakdown(
	db: Db,
	filter: EmbeddedRowFilter = {}
): Promise<{
	byKind: Record<string, number>
	lorebooks: number
	sessions: number
}> {
	const [messages, characters, relationships, bindings, entryVectors] =
		await Promise.all([
			db.$count(
				schema.sessionMessages,
				columnStoreRows(schema.sessionMessages, filter)
			),
			db.$count(
				schema.characters,
				columnStoreRows(schema.characters, filter)
			),
			db.$count(
				schema.narrativeRelationships,
				columnStoreRows(schema.narrativeRelationships, filter)
			),
			db.$count(
				schema.lorebookBindings,
				columnStoreRows(schema.lorebookBindings, filter)
			),
			db.$count(schema.lorebookEntryVectors, entryVectorRows(filter))
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
			)
			.where(entryVectorRows(filter)),
		db
			.selectDistinct({ id: schema.lorebookBindings.lorebookId })
			.from(schema.lorebookBindings)
			.where(columnStoreRows(schema.lorebookBindings, filter)),
		// Sessions come from MESSAGES alone: they are the only embedded store
		// that names a session. Entries belong to a lorebook, and a lorebook can
		// be linked to several sessions or to none, so counting sessions through
		// one would be counting something else.
		db
			.selectDistinct({ id: schema.sessionMessages.sessionId })
			.from(schema.sessionMessages)
			.where(columnStoreRows(schema.sessionMessages, filter))
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
