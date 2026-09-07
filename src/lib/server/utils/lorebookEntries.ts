/**
 * The one entry table, and the one shape the rest of the app speaks.
 *
 * `world_lore_entries`, `character_lore_entries` and `history_entries` were
 * three near-identical tables with no discriminator column anywhere: **the
 * subtype was the table**. `lorebook_entries` is the single source of truth
 * now, and since the three socket namespaces collapsed into one there is a
 * single wire shape to go with it — `LorebookEntry<typeId>`, declared in
 * `$lib/shared/entries/types`, branded by the real `type_id` column.
 *
 * This module is that shape's whole vocabulary on the server: how a stored row
 * goes out, how a payload comes back in, and the SQL predicates every reader
 * shares. **What it no longer contains is a per-type branch.** The projection
 * asks the type's declaration which column plays the title, which column is the
 * anchor, and which fields it declares with which defaults — so a fourth shape
 * is a declaration, not another `to…Row`.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { splitKeys } from "$lib/server/pipelines/ranking/signals"
import {
	declaredFields,
	entryDeclaration,
	fieldDefault
} from "$lib/server/entries/declarations"
import {
	ENTRY_TYPE_VERSION,
	HISTORY_TYPE_ID,
	type LorebookEntry,
	type NewLorebookEntry
} from "$lib/shared/entries/types"

export type SelectLorebookEntry = typeof schema.lorebookEntries.$inferSelect
export type InsertLorebookEntry = typeof schema.lorebookEntries.$inferInsert

/**
 * Re-exported so the server's entry vocabulary stays one import.
 *
 * The ids themselves live in `$lib/shared/entries/types` because the client
 * names them too — a tab asks for its own type, and a tab is not allowed to
 * spell a type id differently from the handler that answers it.
 */
export {
	CHARACTER_LORE_TYPE_ID,
	ENTRY_TYPE_IDS,
	ENTRY_TYPE_VERSION,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entriesOfType,
	isEntryOfType,
	isEntryTypeId,
	type EntryTypeId,
	type LorebookEntry,
	type LorebookEntryPatch,
	type NewLorebookEntry
} from "$lib/shared/entries/types"

/**
 * The vector space the legacy `embedding` column became.
 *
 * One name, because there is one recipe: the vectorizer wrote exactly one
 * vector per row and the migration carried each one across under this name.
 * Versioned in the name so a recipe change re-embeds only that name.
 */
export const DEFAULT_VECTOR_NAME = "core:vec/default@1"

/**
 * The anchor policy core implements.
 *
 * A type declaring it is saying *ask this question before showing one of my
 * rows to anybody* — four branches (the bound character may see it, personas in
 * the binding may see it, an unbound binding is the narrator's alone, an
 * unanchored row is visible to nobody), implemented once in
 * `prompt/characterLore.ts`. Types select policies; they never author them,
 * which is what keeps a declaration from being code.
 */
export const BINDING_VISIBILITY_POLICY = "core:policy/binding-visibility@1"

/** `WHERE type_id = …` — spelled once so a caller cannot forget the filter. */
export const ofType = (typeId: string): SQL =>
	eq(schema.lorebookEntries.typeId, typeId)

/** `WHERE lorebook_id = … AND type_id = …`, the shape almost every read wants. */
export const inBookOfType = (lorebookId: number, typeId: string): SQL =>
	and(eq(schema.lorebookEntries.lorebookId, lorebookId), ofType(typeId))!

/**
 * `text[]` back to the delimited string the wire and the ranker still use.
 *
 * `, ` and not `,`: the string this reproduces was authored by a person in a
 * text field, and every key list in the app reads back the way it was typed.
 */
export const joinKeys = (keys: readonly string[] | null | undefined): string =>
	(keys ?? []).join(", ")

/**
 * The delimited string back to `text[]`.
 *
 * `splitKeys` and not a second copy of it — comma, trimmed, empties dropped is
 * the rule the matcher applies, the rule the backfill reproduced in SQL, and
 * the rule that decides what a key even is. A second implementation here is a
 * second place for it to drift.
 */
export const keysToArray = (keys: string | null | undefined): string[] =>
	splitKeys(keys)

/**
 * A boolean member of `fields`, as a predicate.
 *
 * ⚠ **Absent is false, and that is the coalesce doing real work.** `graphed`
 * and `isCompleted` were `NOT NULL DEFAULT false` columns, so "not graphed" was
 * every row the flag had never been set on. In jsonb the key is simply not
 * there, and `(NULL)::boolean IS NOT TRUE` would be right by accident while
 * `= false` would be wrong — the coalesce says which reading is meant.
 */
export const fieldIsTrue = (key: string): SQL =>
	sql`COALESCE((${schema.lorebookEntries.fields}->>${key})::boolean, false)`

/**
 * ⚠ **`fields` is never replaced wholesale; every writer merges.**
 *
 * `graphed` and `isCompleted` are machine-written — by the graph builder and
 * the summarizer — concurrently with a user editing the same row's `content`.
 * As columns a partial `UPDATE` was safe; in jsonb a whole-object write from
 * either side clobbers the other. This produces `"fields" || '{…}'::jsonb`,
 * which is the only shape a writer may use.
 *
 * A `null`/`undefined` value in the patch removes the key rather than storing a
 * JSON null, because absent is the state the rest of the system agrees on:
 * `JSON.stringify` drops undefined, the backfill stripped nulls, and history's
 * missing `priority` has to keep meaning *no bonus* rather than *1*.
 */
export function mergeFields(patch: Record<string, unknown>): SQL {
	const set: Record<string, unknown> = {}
	const drop: string[] = []
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === null) drop.push(key)
		else set[key] = value
	}
	let expr: SQL = sql`${schema.lorebookEntries.fields} || ${JSON.stringify(set)}::jsonb`
	// `- text[]` drops every named key in one operator, and dropping a key that
	// is not there is a no-op rather than an error.
	if (drop.length)
		expr = sql`(${expr}) - ${sql.raw(`ARRAY[${drop.map((k) => `'${k.replace(/'/g, "''")}'`).join(",")}]::text[]`)}`
	return expr
}

/** The `fields` object for a brand-new row, with absent-not-null applied. */
export function buildFields(
	patch: Record<string, unknown>
): Record<string, any> {
	const out: Record<string, any> = {}
	for (const [key, value] of Object.entries(patch))
		if (value !== undefined && value !== null) out[key] = value
	return out
}

/**
 * What the legacy row shape carried about its embedding, which now lives in
 * `lorebook_entry_vectors`.
 *
 * Carried as a separate argument rather than joined into every read: most
 * readers want the row and not a megabyte of floats, and the ones that do want
 * them (the manager lists, which have always sent them) ask for them.
 */
export interface EntryVector {
	embedding: number[] | null
	embeddingModel: string | null
	vectorizedAt: Date | null
}

const NO_VECTOR: EntryVector = {
	embedding: null,
	embeddingModel: null,
	vectorizedAt: null
}

/**
 * The default-space vector for each of `entryIds`, keyed by entry id.
 *
 * Chunk 0 only: chunking is a per-type retrieval-unit decision that nothing
 * declares yet, and the legacy column this replaces held exactly one vector.
 */
export async function loadDefaultVectors(
	dbOrTx: any,
	entryIds: number[]
): Promise<Map<number, EntryVector>> {
	const out = new Map<number, EntryVector>()
	if (!entryIds.length) return out
	const rows = await dbOrTx
		.select({
			entryId: schema.lorebookEntryVectors.entryId,
			vector: schema.lorebookEntryVectors.vector,
			model: schema.lorebookEntryVectors.model,
			vectorizedAt: schema.lorebookEntryVectors.vectorizedAt
		})
		.from(schema.lorebookEntryVectors)
		.where(
			and(
				inArray(schema.lorebookEntryVectors.entryId, entryIds),
				eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME),
				eq(schema.lorebookEntryVectors.chunkIndex, 0)
			)
		)
	for (const r of rows as any[])
		out.set(r.entryId, {
			embedding: r.vector ?? null,
			embeddingModel: r.model ?? null,
			vectorizedAt: r.vectorizedAt ?? null
		})
	return out
}

/**
 * `timestamp` back to the `date` column's string.
 *
 * The three legacy tables declared `created_at` as `date`, which Drizzle reads
 * as `'YYYY-MM-DD'`; the unified table's is a real `timestamp`. The wire keeps
 * the string, because the client hands it to `new Date(...)` and a shape change
 * there is a client change this step has no reason to make.
 */
const toDateString = (value: Date | string): string =>
	typeof value === "string" ? value : value.toISOString().slice(0, 10)

/**
 * A stored row, in the shape everything above the database reads.
 *
 * One function where there were three, and none of the three branches survive:
 *
 *  - **the title** is whichever column the type's `title` field role names, or
 *    `null` for a type that declares none. `?? ""` where a field role exists, because the
 *    columns this replaces were `NOT NULL` and a form binds to the difference;
 *    history declares no title at all, because it is not named, it is *dated*.
 *  - **the anchor** is whichever column the `anchor` field role names, exposed under
 *    the name the wire has always used. Absent for a type that declares no
 *    anchor — world lore is about the world, so there is nobody it could be
 *    private from, and flattening the column onto every shape would erase that.
 *  - **the declared fields** come out of `fields` jsonb with the type's own
 *    declared default standing in for an absent key, which is the same
 *    statement the `NOT NULL DEFAULT` columns made. `??` and not `||`, so a
 *    stored `false` is a stored `false`.
 */
export function toEntryRow(
	row: SelectLorebookEntry,
	vec: EntryVector = NO_VECTOR
): LorebookEntry {
	const decl = entryDeclaration(row.typeId)
	const titleColumn = decl?.roles.title
	const anchorColumn = decl?.roles.anchor?.column
	const stored = (row.fields ?? {}) as Record<string, unknown>

	const declared: Record<string, unknown> = {}
	for (const field of declaredFields(row.typeId))
		declared[field] = stored[field] ?? fieldDefault(row.typeId, field)

	return {
		id: row.id,
		lorebookId: row.lorebookId,
		typeId: row.typeId,
		name: titleColumn ? ((row as any)[titleColumn] ?? "") : null,
		keys: joinKeys(row.keys),
		secondaryKeys: joinKeys(row.secondaryKeys),
		selectiveLogic: row.selectiveLogic,
		matchMode: row.matchMode,
		useRegex: row.useRegex,
		caseSensitive: row.caseSensitive ?? false,
		recursionDepth: row.recursionDepth,
		content: row.content,
		constant: row.constant,
		enabled: row.enabled,
		extraJson: row.extraJson,
		createdAt: toDateString(row.createdAt),
		updatedAt: row.updatedAt,
		position: row.position,
		embedding: vec.embedding,
		embeddingModel: vec.embeddingModel,
		vectorizedAt: vec.vectorizedAt,
		...(anchorColumn
			? { lorebookBindingId: (row as any)[anchorColumn] ?? null }
			: {}),
		...declared
	} as LorebookEntry
}

/**
 * A history entry's date, read straight out of a stored row's `fields`.
 *
 * The three parts are asked for together everywhere they are asked for at all —
 * a scene list, a compile heading, the graph's ordering — so they are read
 * together, with the type's own declared defaults standing in for absent keys,
 * exactly as `toEntryRow` does. Kept for the readers that hold a raw row rather
 * than a wire one and want only the date.
 */
export const historyDateOf = (row: {
	fields?: Record<string, any> | null
}): { year: number; month: number | null; day: number | null } => {
	const stored = (row.fields ?? {}) as Record<string, unknown>
	const of = (field: string) =>
		(stored[field] ?? fieldDefault(HISTORY_TYPE_ID, field)) as any
	return { year: of("year"), month: of("month"), day: of("day") }
}

/**
 * A wire payload, as a row to insert.
 *
 * `position` is the caller's because it is allocated under a lock — see
 * `nextPosition` — and never the client's.
 */
export function entryInsert(
	data: NewLorebookEntry & { position: number }
): InsertLorebookEntry {
	const typeId = data.typeId
	const decl = entryDeclaration(typeId)
	const source = data as Record<string, any>

	const fields: Record<string, unknown> = {}
	for (const field of declaredFields(typeId))
		fields[field] = source[field] ?? fieldDefault(typeId, field)

	return {
		lorebookId: data.lorebookId,
		typeId,
		typeVersion: decl?.version ?? ENTRY_TYPE_VERSION,
		position: data.position,
		// `?? ""` mirrors the `NOT NULL` column this replaces; a type with no
		// title field role stores none. History's heading is its date.
		title: decl?.roles.title ? (source.name ?? "") : null,
		anchorBindingId: decl?.roles.anchor
			? (source.lorebookBindingId ?? null)
			: null,
		fields: buildFields(fields),
		keys: keysToArray(data.keys),
		secondaryKeys: keysToArray(data.secondaryKeys),
		// `?? null` and not a default mode: an entry nobody has ruled on has no
		// condition at all, which is a different state from every mode there is.
		selectiveLogic: data.selectiveLogic ?? null,
		matchMode: data.matchMode ?? null,
		useRegex: data.useRegex ?? false,
		caseSensitive: data.caseSensitive ?? false,
		recursionDepth: data.recursionDepth ?? null,
		content: data.content ?? "",
		constant: data.constant ?? false,
		enabled: data.enabled ?? true,
		extraJson: data.extraJson ?? {}
	}
}

/**
 * A partial wire payload, split into the column half and the `fields` half.
 *
 * The split is the point: the column half goes into `.set()` as itself, and the
 * `fields` half goes through `mergeFields` so a writer touching `graphed` never
 * lands on top of a writer touching `content`. A key the payload did not
 * mention appears in neither half and is therefore not written at all — and a
 * key this *type* does not declare appears in neither either, so a `year` sent
 * to a world lore row is ignored rather than stored where nothing reads it.
 */
export function splitUpdate(
	typeId: string,
	data: Record<string, any>
): { columns: Record<string, any>; fields: Record<string, unknown> } {
	const columns: Record<string, any> = {}
	const fields: Record<string, unknown> = {}
	const has = (k: string) => Object.prototype.hasOwnProperty.call(data, k)
	const decl = entryDeclaration(typeId)

	if (has("keys")) columns.keys = keysToArray(data.keys)
	if (has("secondaryKeys"))
		columns.secondaryKeys = keysToArray(data.secondaryKeys)
	if (has("selectiveLogic"))
		columns.selectiveLogic = data.selectiveLogic || null
	if (has("matchMode")) columns.matchMode = data.matchMode
	if (has("useRegex")) columns.useRegex = data.useRegex
	if (has("caseSensitive")) columns.caseSensitive = data.caseSensitive
	if (has("recursionDepth")) columns.recursionDepth = data.recursionDepth
	if (has("content")) columns.content = data.content
	if (has("constant")) columns.constant = data.constant
	if (has("enabled")) columns.enabled = data.enabled
	if (has("extraJson")) columns.extraJson = data.extraJson
	if (has("position")) columns.position = data.position

	if (decl?.roles.title && has("name")) columns.title = data.name
	if (decl?.roles.anchor && has("lorebookBindingId"))
		columns.anchorBindingId = data.lorebookBindingId

	for (const field of declaredFields(typeId))
		if (has(field)) fields[field] = data[field]

	return { columns, fields }
}

/**
 * The first free `position` for a type within a lorebook.
 *
 * The three socket handlers each carried this scan; it is one function now
 * because `position` is unique per `(lorebook_id, type_id)` in the database,
 * so a duplicate is no longer a cosmetic reordering but a failed write.
 *
 * ⚠ **Call this inside a transaction holding
 * `pg_advisory_xact_lock(lorebookId)`.** Without it two concurrent creates read
 * the same gap and the second one now raises a unique violation rather than
 * quietly landing on the same slot — the same race the handlers already locked
 * against, with a louder failure mode.
 */
export async function nextPosition(
	tx: any,
	lorebookId: number,
	typeId: string
): Promise<number> {
	const rows = await tx
		.select({ position: schema.lorebookEntries.position })
		.from(schema.lorebookEntries)
		.where(inBookOfType(lorebookId, typeId))
	const taken = new Set((rows as any[]).map((r) => r.position))
	let position = 1
	while (taken.has(position)) position++
	return position
}

/**
 * The top of a free range every renumber stages its rows through.
 *
 * ⚠ **`lorebook_entries_position_uq` is a plain, non-deferrable UNIQUE**, so
 * Postgres rejects a duplicate as each index tuple lands rather than at COMMIT.
 * A renumber is a permutation, and a permutation written straight —
 * `SET position = position + 1` over a run, or a 1..n rewrite — duplicates a
 * position *partway through* producing a finished state that has none. So every
 * such write **parks** its rows at or below this value first and then **places**
 * them at their finals: the parked values are disjoint from every live row and
 * from every final, so no single row ever collides and the constraint holds at
 * every instant instead of only at COMMIT.
 *
 * `where` scopes it to the `(lorebook_id, type_id)` group(s) being renumbered,
 * and `finals` are the positions the write is heading for — the range has to
 * sit below **both**, or a row placed at a low final would land on a row still
 * parked. An empty scope yields `-1`, which is free by vacuity.
 *
 * ⚠ **Below, not negated.** `position` is a plain `integer` with no sign check,
 * `0` is a real position — the ordered allocator hands it out for the first row
 * and import counts from it — and `-0 === 0`, so a sign flip does not move such
 * a row out of the way at all. A range strictly under the live minimum is
 * disjoint whatever the live values happen to be.
 */
export async function parkingFloor(
	tx: any,
	where: SQL,
	finals: readonly number[] = []
): Promise<number> {
	const [row] = await tx
		.select({
			lowest: sql<
				number | null
			>`min(${schema.lorebookEntries.position})`
		})
		.from(schema.lorebookEntries)
		.where(where)
	const lowest = (row as any)?.lowest
	const bounds =
		lowest === null || lowest === undefined
			? [...finals]
			: [Number(lowest), ...finals]
	return (bounds.length ? Math.min(...bounds) : 0) - 1
}

/**
 * A lorebook's entries, in the wire shape.
 *
 * One read of one table, sorted by id so a caller sees the same order the three
 * Drizzle relations gave; the vectors ride along because those relations
 * selected every column and the manager lists read `embeddingModel` off the row.
 *
 * It lives here rather than in `lorebooks.ts` because the export builder needs
 * it, and the export builder exists precisely to stay out of that module's
 * import cycle.
 */
export async function loadBookEntries(
	dbOrTx: any,
	lorebookId: number
): Promise<LorebookEntry[]> {
	const rows: SelectLorebookEntry[] = await dbOrTx
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		.orderBy(schema.lorebookEntries.id)
	const vectors = await loadDefaultVectors(
		dbOrTx,
		rows.map((r) => r.id)
	)
	return rows.map((r) => toEntryRow(r, vectors.get(r.id)))
}
