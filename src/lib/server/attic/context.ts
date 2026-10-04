/**
 * What every step of the attic restore shares: the transaction, the notes, the
 * id maps, and the counts the reconciliation checks against the attic's own.
 */
import { and, asc, gte, lte, sql } from "drizzle-orm"
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core"
import { rawRows } from "$lib/server/db/rawRows"
import type { UpgradeNotes } from "./notes"
import type { EmbeddingCarry } from "./embeddings"

/** An old id → new id map for one 0.5.3 table. */
export type IdMap = Map<number, number>

export interface RestoreContext {
	tx: Db
	/** Where `/images/data/users/…` resolves: the app data root. */
	appDataDir: string
	notes: UpgradeNotes
	embeddings: EmbeddingCarry
	/**
	 * Every id that moved, keyed by the 0.5.3 table it came from. A table
	 * whose ids are kept has no entry here; `mapped` answers for both.
	 */
	maps: Map<string, IdMap>
	/**
	 * Rows a step deliberately did not carry, by 0.5.3 table — or by live
	 * table, for rows a repair folded away after they were carried — each with
	 * a note saying why. The reconciliation subtracts these and nothing else.
	 */
	dropped: Map<string, number>
	/**
	 * Rows a step added beyond the attic's, by live table (the embedding
	 * connection the vectorization singleton becomes).
	 */
	added: Map<string, number>
	/** Accepted losses (D10), counted for the summary note. */
	losses: Map<string, number>
}

export function mapFor(ctx: RestoreContext, table: string): IdMap {
	let m = ctx.maps.get(table)
	if (!m) {
		m = new Map()
		ctx.maps.set(table, m)
	}
	return m
}

/** The live id for a 0.5.3 id: the moved one, else the id itself. */
export function mapped(
	ctx: RestoreContext,
	table: string,
	oldId: number | null | undefined
): number | null {
	if (oldId == null) return null
	return ctx.maps.get(table)?.get(oldId) ?? oldId
}

/** The live id for a 0.5.3 id in a table whose every id moved; null if none. */
export function movedTo(
	ctx: RestoreContext,
	table: string,
	oldId: number | null | undefined
): number | null {
	if (oldId == null) return null
	return ctx.maps.get(table)?.get(oldId) ?? null
}

export function countDrop(ctx: RestoreContext, table: string, n = 1): void {
	if (n) ctx.dropped.set(table, (ctx.dropped.get(table) ?? 0) + n)
}

export function countAdd(ctx: RestoreContext, table: string, n = 1): void {
	if (n) ctx.added.set(table, (ctx.added.get(table) ?? 0) + n)
}

export function countLoss(ctx: RestoreContext, what: string, n = 1): void {
	if (n) ctx.losses.set(what, (ctx.losses.get(what) ?? 0) + n)
}

/**
 * The most one statement may carry, either way across the wire.
 *
 * PGlite 0.2's wasm build traps — `RuntimeError: memory access out of bounds`
 * — once a single query's result or its bound parameters pass about 16 MB,
 * and the instance is unusable afterwards: every later query fails the same
 * way. Row counts alone do not bound that. A 0.5.3 message carries its
 * generation's `debug_meta` (hundreds of KB on a real install) and an
 * embedding as a `real[]`, so a thousand of them can be far past it while
 * the fixtures' thousand are not. Every bulk read and write here is budgeted
 * in bytes, with a quarter of the limit as the page.
 */
export const STATEMENT_BYTES = 4 * 1024 * 1024

/** A single row past this cannot cross the wire at all. */
export const ROW_BYTES_LIMIT = 15 * 1024 * 1024

/** A row's size on the wire, near enough: its JSON, which runs at or above Postgres' text form. */
function wireBytes(row: unknown): number {
	return Buffer.byteLength(
		JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? ""
	)
}

/**
 * Insert in statements of at most `size` rows and `STATEMENT_BYTES` of
 * parameters — PGlite takes one large VALUES badly, and past ~16 MB not at all.
 */
export async function insertBatched<T extends PgTable>(
	tx: Db,
	table: T,
	rows: T["$inferInsert"][],
	size = 500
): Promise<void> {
	let batch: T["$inferInsert"][] = []
	let bytes = 0
	for (const row of rows) {
		const b = wireBytes(row)
		if (batch.length && (batch.length >= size || bytes + b > STATEMENT_BYTES)) {
			await tx.insert(table).values(batch as any)
			batch = []
			bytes = 0
		}
		batch.push(row)
		bytes += b
	}
	if (batch.length) await tx.insert(table).values(batch as any)
}

type IdTable = PgTable & { id: AnyPgColumn }

/** How many row sizes one sizing query reads: a few hundred KB of result. */
const SIZING_PAGE = 20_000

/**
 * Every row of a table with an integer `id`, in id order, as pages of at most
 * `budget` bytes (see `STATEMENT_BYTES`).
 *
 * Each page's id range is planned from the rows' text size, read a slice of
 * ids at a time, so neither the sizing nor the rows ever cross in one large
 * result. A single row past `ROW_BYTES_LIMIT` is refused by name before it is
 * read, rather than left to break the database for the rest of the boot.
 */
export async function* pagesById<T extends IdTable>(
	tx: Db,
	table: T,
	budget = STATEMENT_BYTES
): AsyncGenerator<T["$inferSelect"][]> {
	const { name, schema } = getTableConfig(table)
	const qualified = schema ? `"${schema}"."${name}"` : `"${name}"`
	let after: number | null = null
	for (;;) {
		const sizes: Array<{ id: number; b: number }> = rawRows<{ id: number; b: number }>(
			await tx.execute(
				sql`SELECT t."id" AS id, octet_length(t::text)::int AS b FROM ${sql.raw(qualified)} t
					WHERE ${after === null ? sql`true` : sql`t."id" > ${after}`}
					ORDER BY t."id" LIMIT ${SIZING_PAGE}`
			)
		)
		if (!sizes.length) return
		let lo = 0
		let bytes = 0
		for (let i = 0; i < sizes.length; i++) {
			const b = Number(sizes[i].b)
			if (b > ROW_BYTES_LIMIT)
				throw new Error(
					`0.5.3 upgrade: ${name} row ${sizes[i].id} is ${Math.round(b / 1048576)} MB, ` +
						`more than the database can read in one piece; nothing was changed.`
				)
			if (i > lo && bytes + b > budget) {
				yield await rowsBetween(tx, table, sizes[lo].id, sizes[i - 1].id)
				lo = i
				bytes = 0
			}
			bytes += b
		}
		yield await rowsBetween(tx, table, sizes[lo].id, sizes[sizes.length - 1].id)
		after = Number(sizes[sizes.length - 1].id)
	}
}

async function rowsBetween<T extends IdTable>(
	tx: Db,
	table: T,
	lo: number,
	hi: number
): Promise<T["$inferSelect"][]> {
	return (await tx
		.select()
		.from(table as PgTable)
		.where(and(gte(table.id, lo), lte(table.id, hi)))
		.orderBy(asc(table.id))) as T["$inferSelect"][]
}

/** The whole table, in id order, read in budgeted pages (`pagesById`). */
export async function readById<T extends IdTable>(
	tx: Db,
	table: T
): Promise<T["$inferSelect"][]> {
	const out: T["$inferSelect"][] = []
	for await (const page of pagesById(tx, table)) out.push(...page)
	return out
}

/** The highest id in a public table, or 0. */
export async function maxId(tx: Db, table: string): Promise<number> {
	const rows = rawRows<{ n: number | null }>(
		await tx.execute(sql.raw(`SELECT max("id")::int AS n FROM public."${table}"`))
	)
	return Number(rows[0]?.n ?? 0)
}

/**
 * Bring every identity sequence in `public` up to its table's highest id.
 *
 * Every table, not a list — rows went in with explicit ids all over the
 * restore. Except `messages`: its rows are always written with the
 * `session_messages` id they mirror, and its sequence is never consulted
 * (`messages/store.ts`), so it is left exactly as it is.
 */
export async function resyncSequences(tx: Db): Promise<void> {
	await tx.execute(
		sql.raw(`
		DO $$
		DECLARE
			rec RECORD;
		BEGIN
			FOR rec IN
				SELECT seq.relname AS seq_name, tab.relname AS table_name, attr.attname AS col_name
				FROM pg_class seq
				JOIN pg_namespace ns ON ns.oid = seq.relnamespace
				JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
				JOIN pg_class tab ON dep.refobjid = tab.oid
				JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
				WHERE seq.relkind = 'S' AND ns.nspname = 'public' AND tab.relname <> 'messages'
			LOOP
				EXECUTE format(
					'SELECT setval(%L, GREATEST(COALESCE((SELECT MAX(%I) FROM public.%I), 0), 1), COALESCE((SELECT MAX(%I) FROM public.%I), 0) > 0)',
					'public.' || rec.seq_name, rec.col_name, rec.table_name, rec.col_name, rec.table_name
				);
			END LOOP;
		END $$
	`)
	)
}

/** One table's sequence, before the restore asks it for fresh ids. */
export async function resyncSequence(tx: Db, table: string): Promise<void> {
	await tx.execute(
		sql.raw(`SELECT setval(pg_get_serial_sequence('public."${table}"', 'id'),
			GREATEST(COALESCE((SELECT max("id") FROM public."${table}"), 0), 1),
			COALESCE((SELECT max("id") FROM public."${table}"), 0) > 0)`)
	)
}

/**
 * Rows that arrived on the same instant, spread across their day in id order.
 *
 * 0.5.3 kept `chats.created_at`/`updated_at` and `chat_messages.created_at` as
 * `date` columns, so every row of a day restores at its midnight and a sort on
 * the timestamp ties — the order a list shows is then whatever the planner
 * returns. Ids are 0.5.3's own order of creation, so each tie group is
 * stepped by id: at most a second apart, and always inside the day it came
 * from (a group of n rows spans less than 86,399 s).
 */
export async function spreadSameInstant(
	tx: Db,
	table: string,
	column: string
): Promise<void> {
	await tx.execute(
		sql.raw(`
		WITH ranked AS (
			SELECT "id",
				row_number() OVER (PARTITION BY "${column}" ORDER BY "id") - 1 AS rn,
				count(*) OVER (PARTITION BY "${column}") AS n
			FROM public."${table}"
			WHERE "${column}" IS NOT NULL
		)
		UPDATE public."${table}" t
		SET "${column}" = t."${column}" + r.rn * LEAST(interval '1 second', interval '86399 seconds' / r.n)
		FROM ranked r
		WHERE r."id" = t."id" AND r.n > 1 AND r.rn > 0`)
	)
}

/** A 0.5.3 `date` column (a `YYYY-MM-DD` string) as a timestamp. */
export function asDate(v: string | Date | null | undefined): Date | undefined {
	if (v == null) return undefined
	const d = v instanceof Date ? v : new Date(v)
	return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * Lift named indexes for the length of a repair, and put them back exactly.
 *
 * For the two uniques on `lorebook_bindings` that 0.5.3 data can violate
 * until the restore's repairs have run (one binding per character per book,
 * one per tag per book). The definitions are read from the catalog and
 * replayed verbatim, so what comes back is what the schema migration made;
 * a repair that left a duplicate fails the replay, and the restore with it.
 * Inside the restore's transaction, so a failure puts them back by itself.
 */
export async function liftIndexes(
	tx: Db,
	table: string,
	names: string[]
): Promise<() => Promise<void>> {
	const defs = rawRows<{ indexname: string; indexdef: string }>(
		await tx.execute(
			sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${table}`
		)
	).filter((d) => names.includes(d.indexname))
	if (defs.length !== names.length)
		throw new Error(
			`0.5.3 upgrade: expected indexes ${names.join(", ")} on ${table}, found ${defs.map((d) => d.indexname).join(", ") || "none"}`
		)
	for (const d of defs)
		await tx.execute(sql.raw(`DROP INDEX public."${d.indexname}"`))
	return async () => {
		for (const d of defs) await tx.execute(sql.raw(d.indexdef))
	}
}
