/**
 * `core:vec/entity@1` — a second named vector space, holding **names**.
 *
 * Retrieval plan phase 4. One vector per name rather than one per entry: the
 * title, each alias the body declares, and for a character-anchored entry the
 * bound character's names and nicknames. Several short vectors per row.
 *
 * ## Why a separate space rather than reusing the content vectors
 *
 * Three reasons, and the third is the one that decides the shape of this file.
 *
 *  1. **Different text at different lengths means different similarity
 *     distributions.** A cutoff tuned for two-word names is wrong for
 *     two-hundred-word passages.
 *  2. **They want different weights.** *"Is called that"* and *"is about
 *     that"* are different evidence, and `rank-hybrid` weighs them apart.
 *  3. **They invalidate independently.** Renaming an entry must re-embed its
 *     names without touching its content vectors; rewriting the body must not
 *     re-embed the names. That falls out of hashing the *name set* rather than
 *     the row's text — a body edit that changes no appositive produces the same
 *     list and therefore no write at all.
 *
 * The named-vector table already specifies exactly this shape — vectors keyed
 * by `(entry, name, chunk)`, each carrying its own model identity — so this is
 * a second `vector_name` in it, not a parallel store. The `chunk_index` column
 * that has been 0 on every row since the table was created is the name's
 * position in the entry's list, which is what it was reserved for.
 *
 * ## Freshness is four things here, not one
 *
 * `(model, sourceHash, extractorVersion, gazetteerHash)`. The first is the
 * table's own comparison key; the other three are design §13.3's triple,
 * carried in the same shape `entry_annotations` carries it. The third and
 * fourth are **not optional and have no analogue in the content-vector case**:
 * what is embedded here is *derived* — an extractor reads the body for
 * appositives, and the cast is read from the lorebook's vocabulary — so
 * renaming a character changes what the same unchanged text yields, and a
 * source hash alone would call that fresh.
 *
 * The pass below recomputes the name set to decide, which makes the content
 * hash sufficient *for the writer*. The two identity columns are for the
 * **reader**, which must be able to refuse a whole book's stale name vectors
 * from one cheaply-known hash without re-deriving anything.
 *
 * **Staleness degrades to correct-and-verbose, never to silently-wrong.** A row
 * whose four identities do not all match is not returned, so an unrepaired book
 * links fewer entries and never links them to a name it no longer answers to.
 *
 * ## Where this runs
 *
 * Inline, bounded, before the arm reads — §13.4's small-N regime, the same
 * posture `annotateEntries` takes and for the same reason: entries are few and
 * change rarely, so repair-in-place is cheaper than a background hope and gives
 * the caller something it can rely on.
 *
 * ⚠ It is **not** hosted in the `vectorizationQueue`, and the reason is the
 * mirror image of §13.11's. That queue breaks at `if (!candidateModel) break`
 * before any picker runs, which is the correct behaviour for a feature that
 * requires a model — but its unit of work is *one entry, one vector*, and this
 * space's unit is *one entry, N names*, written and pruned together so a name
 * that left the set disappears with the write that replaced it. A picker
 * cannot express that, and half a name set is the silent wrongness the
 * freshness columns exist to prevent.
 */

import crypto from "crypto"
import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	ALIAS_EXTRACTOR_VERSION,
	entityNamesFor,
	nameSetHash,
	type EntityName,
	type EntityNameKind,
	type NamedBindingRow
} from "$lib/server/pipelines/ranking/entityNames"

// db is the global Db — see db/types.d.ts

/** The space. Versioned in the name, so a recipe change re-embeds only it. */
export const ENTITY_VECTOR_NAME = "core:vec/entity@1"

/**
 * How many *entries* one pass re-embeds.
 *
 * Two orders of magnitude below `ANNOTATION_BATCH`'s 200, because the unit is a
 * model call rather than a regex — and an entry is several names, so eight
 * entries is already twenty-odd embeddings on a reply path with a 5-second node
 * budget. A book nobody has indexed converges over a handful of turns instead of
 * putting its whole cost on one of them.
 *
 * ⚠ **Each entry is written before the next is embedded**, which is what makes
 * that safe under a timeout: the executor cutting the node short loses the
 * remainder of the pass and keeps everything already written, so progress
 * survives and the next turn continues from it. The arm meanwhile links whatever
 * is ready — a half-indexed book is a *smaller* search, never a wrong one.
 */
export const ENTITY_VECTOR_BATCH = 8

/** Short digests, matching `server/annotations`'. */
const digest = (value: string) =>
	crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)

/**
 * The identity of the whole name recipe.
 *
 * `ALIAS_EXTRACTOR_VERSION` names the appositive reader, and the assembly
 * around it — which sources contribute, in what order, under what caps — is
 * part of the same recipe. Changing either **must** move this string, or stored
 * vectors survive a change to what they were supposed to be vectors of.
 */
export const ENTITY_VECTOR_EXTRACTOR = ALIAS_EXTRACTOR_VERSION

export interface EntityVectorRow {
	entryId: number
	chunkIndex: number
	name: string
	kind: EntityNameKind
	vector: number[]
}

export interface EntityVectorPassReport {
	/** Entries whose freshness was checked. */
	examined: number
	/** Entries re-embedded and written. */
	written: number
	/** Names embedded across those entries. */
	names: number
	/** Entries left because the batch cap was reached — the next pass takes them. */
	deferred: number
}

const EMPTY_PASS: EntityVectorPassReport = {
	examined: 0,
	written: 0,
	names: 0,
	deferred: 0
}

/**
 * The bindings a book's entries can be anchored to, by id.
 *
 * All three name columns, and the union is mandatory: `absorbedAliases` is
 * where a graph merge puts the identity it absorbed and `aliases` is a
 * one-directional sync target replaced wholesale on every entity edit, so
 * feeding one half would leave the absorbed name resolving and the name it was
 * merged into not.
 */
export async function loadBindingNames(
	db: Db,
	lorebookId: number | null | undefined
): Promise<Map<number, NamedBindingRow>> {
	const out = new Map<number, NamedBindingRow>()
	if (lorebookId == null) return out
	const rows = await db
		.select({
			id: schema.lorebookBindings.id,
			name: schema.lorebookBindings.name,
			aliases: schema.lorebookBindings.aliases,
			absorbedAliases: schema.lorebookBindings.absorbedAliases
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	for (const row of rows) out.set(row.id, row)
	return out
}

interface StoredFreshness {
	sourceHash: string | null
	extractorVersion: string | null
	gazetteerHash: string | null
	model: string | null
	names: number
}

/** `entryId -> what is stored for it in this space`, for one entry set. */
async function freshnessOf(
	db: Db,
	entryIds: readonly number[]
): Promise<Map<number, StoredFreshness>> {
	const out = new Map<number, StoredFreshness>()
	if (!entryIds.length) return out
	const rows = await db
		.select({
			entryId: schema.lorebookEntryVectors.entryId,
			sourceHash: schema.lorebookEntryVectors.sourceHash,
			extractorVersion: schema.lorebookEntryVectors.extractorVersion,
			gazetteerHash: schema.lorebookEntryVectors.gazetteerHash,
			model: schema.lorebookEntryVectors.model
		})
		.from(schema.lorebookEntryVectors)
		.where(
			and(
				inArray(
					schema.lorebookEntryVectors.entryId,
					entryIds as number[]
				),
				eq(schema.lorebookEntryVectors.vectorName, ENTITY_VECTOR_NAME)
			)
		)
	// Every row of one entry carries the same identity by construction — they
	// are written together — so the first seen is that entry's answer, and the
	// count is how many names it currently has stored.
	for (const row of rows) {
		const seen = out.get(row.entryId)
		if (seen) seen.names++
		else out.set(row.entryId, { ...row, names: 1 })
	}
	return out
}

const isFresh = (
	stored: StoredFreshness | undefined,
	sourceHash: string,
	gazetteerHash: string,
	modelId: string,
	names: number
): boolean =>
	stored !== undefined &&
	stored.names === names &&
	stored.model === modelId &&
	stored.sourceHash === sourceHash &&
	stored.extractorVersion === ENTITY_VECTOR_EXTRACTOR &&
	stored.gazetteerHash === gazetteerHash

/**
 * Replace one entry's name vectors.
 *
 * **Upsert first, then delete what left the set** — never delete-then-insert.
 * `writeAnnotations` does the same thing for the same reason: two passes over
 * one entry really can interleave (two sessions over one book, both repairing),
 * and delete-A/delete-B/insert-A/insert-B makes the second insert collide on
 * the primary key. Both passes compute the same rows from the same names, so an
 * upsert converges; a blanket delete a sibling is about to re-insert into does
 * not.
 */
async function writeEntityVectors(
	db: Db,
	entryId: number,
	names: readonly EntityName[],
	vectors: readonly number[][],
	sourceHash: string,
	gazetteerHash: string,
	modelId: string
): Promise<void> {
	const values = names.map((name, index) => ({
		entryId,
		vectorName: ENTITY_VECTOR_NAME,
		chunkIndex: index,
		model: modelId,
		dims: vectors[index]!.length,
		vector: vectors[index]!,
		sourceHash,
		extractorVersion: ENTITY_VECTOR_EXTRACTOR,
		gazetteerHash,
		chunkMeta: { name: name.text, kind: name.kind },
		vectorizedAt: new Date()
	}))

	if (values.length)
		await db
			.insert(schema.lorebookEntryVectors)
			.values(values)
			.onConflictDoUpdate({
				target: [
					schema.lorebookEntryVectors.entryId,
					schema.lorebookEntryVectors.vectorName,
					schema.lorebookEntryVectors.chunkIndex
				],
				set: {
					model: sql`excluded.model`,
					dims: sql`excluded.dims`,
					vector: sql`excluded.vector`,
					sourceHash: sql`excluded.source_hash`,
					extractorVersion: sql`excluded.extractor_version`,
					gazetteerHash: sql`excluded.gazetteer_hash`,
					chunkMeta: sql`excluded.chunk_meta`,
					vectorizedAt: sql`excluded.vectorized_at`
				}
			})

	// Names that left the set. Scoped to this space, so nothing here can touch
	// the content vector the queue owns.
	await db.delete(schema.lorebookEntryVectors).where(
		and(
			eq(schema.lorebookEntryVectors.entryId, entryId),
			eq(schema.lorebookEntryVectors.vectorName, ENTITY_VECTOR_NAME),
			values.length
				? notInArray(
						schema.lorebookEntryVectors.chunkIndex,
						values.map((v) => v.chunkIndex)
					)
				: sql`true`
		)
	)
}

export interface EnsureEntityVectorsInput {
	lorebookId: number | null | undefined
	entryIds: readonly number[]
	/** `AnnotationVocabulary.hash` — the third identity, shared with annotations. */
	gazetteerHash: string
	/** The loaded encoder. A row from another one is not comparable. */
	modelId: string
	/** Batched: one call, one vector per name, in order. */
	batchEmbed: (texts: string[]) => Promise<number[][]>
	limit?: number
}

/**
 * Bring a set of entries' name vectors up to date, bounded.
 *
 * Awaited by the arm before it reads, so a caller can rely on every id it named
 * being indexed for the current names and vocabulary — up to `limit`, after
 * which the report says how many were left rather than leaving it to be
 * inferred.
 *
 * An entry with **no names at all** — a history row, which is dated rather than
 * titled, and has no binding — is not written and not deferred. It has nothing
 * to be called, so there is nothing here for it, and no sentinel is needed: the
 * reader keys on rows and an entry with no names correctly produces none.
 */
export async function ensureEntityVectors(
	db: Db,
	input: EnsureEntityVectorsInput
): Promise<EntityVectorPassReport> {
	const limit = input.limit ?? ENTITY_VECTOR_BATCH
	if (!input.entryIds.length) return { ...EMPTY_PASS }

	const [rows, bindings] = await Promise.all([
		db
			.select({
				id: schema.lorebookEntries.id,
				title: schema.lorebookEntries.title,
				content: schema.lorebookEntries.content,
				anchorBindingId: schema.lorebookEntries.anchorBindingId
			})
			.from(schema.lorebookEntries)
			.where(
				inArray(schema.lorebookEntries.id, input.entryIds as number[])
			),
		loadBindingNames(db, input.lorebookId)
	])

	const stored = await freshnessOf(
		db,
		rows.map((r) => r.id)
	)

	const report: EntityVectorPassReport = {
		...EMPTY_PASS,
		examined: rows.length
	}
	for (const row of rows) {
		const names = entityNamesFor(row, bindings)
		const sourceHash = nameSetHash(names, digest)
		if (
			isFresh(
				stored.get(row.id),
				sourceHash,
				input.gazetteerHash,
				input.modelId,
				names.length
			)
		)
			continue
		if (!names.length) {
			// Nothing to embed, but a row set may still need clearing — an
			// entry whose title was deleted must lose the vector for it.
			if (stored.has(row.id))
				await writeEntityVectors(
					db,
					row.id,
					[],
					[],
					sourceHash,
					input.gazetteerHash,
					input.modelId
				)
			continue
		}
		if (report.written >= limit) {
			report.deferred++
			continue
		}
		const vectors = await input.batchEmbed(names.map((n) => n.text))
		if (vectors.length !== names.length) continue
		await writeEntityVectors(
			db,
			row.id,
			names,
			vectors,
			sourceHash,
			input.gazetteerHash,
			input.modelId
		)
		report.written++
		report.names += names.length
	}
	return report
}

/**
 * The name vectors of a set of entries, fresh ones only.
 *
 * Every one of the four identities is checked here and not assumed, even though
 * `ensureEntityVectors` has just run: "the repair ran" is an assumption, and
 * this is the reader. A stale row is not a fact about what the entry is called
 * now, and linking a mention to a name the entry has stopped answering to is
 * exactly the silent wrongness the identity columns exist to prevent.
 */
export async function readEntityVectors(
	db: Db,
	entryIds: readonly number[],
	gazetteerHash: string,
	modelId: string
): Promise<EntityVectorRow[]> {
	if (!entryIds.length) return []
	const rows = await db
		.select({
			entryId: schema.lorebookEntryVectors.entryId,
			chunkIndex: schema.lorebookEntryVectors.chunkIndex,
			vector: schema.lorebookEntryVectors.vector,
			chunkMeta: schema.lorebookEntryVectors.chunkMeta,
			extractorVersion: schema.lorebookEntryVectors.extractorVersion,
			gazetteerHash: schema.lorebookEntryVectors.gazetteerHash
		})
		.from(schema.lorebookEntryVectors)
		.where(
			and(
				inArray(
					schema.lorebookEntryVectors.entryId,
					entryIds as number[]
				),
				eq(schema.lorebookEntryVectors.vectorName, ENTITY_VECTOR_NAME),
				eq(schema.lorebookEntryVectors.model, modelId)
			)
		)

	const out: EntityVectorRow[] = []
	for (const row of rows) {
		if (row.extractorVersion !== ENTITY_VECTOR_EXTRACTOR) continue
		if (row.gazetteerHash !== gazetteerHash) continue
		const name = (row.chunkMeta ?? {}).name
		if (typeof name !== "string" || !name) continue
		if (!Array.isArray(row.vector) || row.vector.length === 0) continue
		out.push({
			entryId: row.entryId,
			chunkIndex: row.chunkIndex,
			name,
			kind: ((row.chunkMeta ?? {}).kind ?? "title") as EntityNameKind,
			vector: row.vector
		})
	}
	return out
}
