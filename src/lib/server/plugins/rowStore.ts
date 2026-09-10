/**
 * The database half of `ctx.storage`'s row store — the seam between
 * `plugin_rows` and the sandbox, and the only code in the plugin subsystem that
 * touches both.
 *
 * ## Why the host does this and the sandbox does not
 *
 * A hook's storage object is **synchronous**, and it has to be: the QuickJS
 * backend is the secure default and has no asynchronous capability bridge at all
 * (`ctx.fetch` is SES-only for exactly that reason), so a row store the guest
 * awaited across the boundary would work on the opt-in backend and throw on the
 * one most extensions run on. A store that silently fails on the default backend
 * is worse than no store.
 *
 * So the database work happens out here, on both sides of the call, and the
 * sandbox does none of it:
 *
 *  1. `load(pluginId)` reads the extension's slice — one seek on
 *     `plugin_rows_plugin_key_unique` — and `SandboxManager.dispatch` hands it
 *     to the sandbox as the job's row snapshot.
 *  2. Every read inside the hook is answered from that snapshot plus the call's
 *     own uncommitted diff (`storageHost.ts`), so `get`/`keys`/`query` are
 *     synchronous and identical on both backends.
 *  3. A hook that returns hands back one collapsed op per key it touched, and
 *     `commit(pluginId, changes)` applies them in one transaction.
 *
 * The cost of that shape is stated where it is decided (`storageHost.ts`):
 * `query()` filters in memory, so the index makes the *load* a real query rather
 * than making `prefix`/`since` ones, and the row budget is a small fraction of
 * the storage grant because the snapshot crosses the sandbox boundary per call.
 *
 * ## Scope
 *
 * `pluginId` is always the caller's — `dispatch` passes the id of the descriptor
 * it is dispatching, and nothing an extension can say reaches this parameter.
 * Every statement below is scoped by it, so there is no query here that could
 * read or write another extension's rows even if one were asked for.
 *
 * Takes the db handle as a parameter, like `store.ts`, so the same code runs
 * against the app db and an in-memory test db.
 */

import { and, eq, inArray } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { pluginRows } from "$lib/server/db/schema"
import type { PluginRowChange, PluginRowSnapshotEntry } from "./storageHost"

/**
 * What `SandboxManager` needs of the row store, and nothing more.
 *
 * A port rather than a db handle on the manager: the manager stays
 * database-free and testable without one (its own suite constructs it with no
 * port at all and every hook simply starts with no rows), and the DB-backed
 * implementation below stays a plain pair of functions over a handle.
 */
export interface PluginRowPort {
	load(pluginId: string): Promise<PluginRowSnapshotEntry[]>
	commit(pluginId: string, changes: PluginRowChange[]): Promise<void>
}

/** Keys are capped at the write (`storageHost.ts`); asserted again here so a
 *  malformed diff fails loudly instead of landing in the table. */
const MAX_KEY = 512

/**
 * One extension's rows, keyed order.
 *
 * `bytes` is re-derived inside the sandbox from the value it actually receives,
 * so the stored column is a convenience for admin views and this snapshot
 * rather than an input the quota trusts — one formula decides what a row costs,
 * and it lives beside the check.
 */
export async function loadPluginRows(
	db: Db,
	pluginId: string
): Promise<PluginRowSnapshotEntry[]> {
	const rows: {
		key: string
		value: unknown
		bytes: number | null
		updatedAt: Date | string | null
	}[] = await db
		.select({
			key: pluginRows.key,
			value: pluginRows.value,
			bytes: pluginRows.bytes,
			updatedAt: pluginRows.updatedAt
		})
		.from(pluginRows)
		.where(eq(pluginRows.pluginId, pluginId))
		.orderBy(pluginRows.key)
	return rows.map((r) => ({
		key: r.key,
		// SQL NULL in this column IS the extension's JSON null (see schema.ts).
		value: r.value ?? null,
		bytes: typeof r.bytes === "number" ? r.bytes : 0,
		updatedAt: isoOf(r.updatedAt)
	}))
}

function isoOf(v: Date | string | null | undefined): string {
	if (v instanceof Date) return v.toISOString()
	if (typeof v === "string") {
		const t = Date.parse(v)
		if (!isNaN(t)) return new Date(t).toISOString()
	}
	return new Date(0).toISOString()
}

/**
 * Apply a returning hook's row diff — **one transaction, all or nothing.**
 *
 * This is the only atomic half of the two-store commit, and it is worth being
 * exact about what that buys. The sandbox has already applied its *files* by the
 * time this runs (see `SandboxManager.dispatch` for why that order and not the
 * other one), so:
 *  - rows are atomic with respect to each other;
 *  - files are per-file atomic, as they always were;
 *  - the two are **not** atomic with respect to each other, and the window is
 *    right here — a process death between the sandbox's file apply and this
 *    transaction committing leaves files ahead of rows.
 *
 * Two statements at most, not one per key: a hook that rewrote a hundred keys
 * owes the database one upsert and one delete, and the ops arrive already
 * collapsed to one per key.
 *
 * Ops are per-key upserts rather than a replace-the-world write, which is what
 * keeps two concurrent calls of the same extension from clobbering each other
 * except on a key they both wrote — the same granularity the file half has
 * always had, where the last rename of a given path wins.
 */
export async function commitPluginRows(
	db: Db,
	pluginId: string,
	changes: PluginRowChange[]
): Promise<void> {
	if (!changes.length) return
	const puts: {
		pluginId: string
		key: string
		value: unknown
		bytes: number
		updatedAt: Date
	}[] = []
	const deletes: string[] = []
	for (const c of changes) {
		if (
			!c ||
			typeof c.key !== "string" ||
			!c.key.length ||
			c.key.length > MAX_KEY
		)
			throw new Error("plugin rows: a change carried an unusable key")
		if (c.op === "delete") {
			deletes.push(c.key)
			continue
		}
		if (c.op !== "put")
			throw new Error(
				`plugin rows: unknown change op '${String((c as { op?: unknown }).op)}'`
			)
		puts.push({
			pluginId,
			key: c.key,
			value: c.value ?? null,
			bytes: Number.isFinite(c.bytes)
				? Math.max(0, Math.floor(c.bytes))
				: 0,
			updatedAt: new Date(Date.parse(c.updatedAt) || Date.now())
		})
	}
	await db.transaction(async (tx: Db) => {
		if (deletes.length)
			await tx
				.delete(pluginRows)
				.where(
					and(
						eq(pluginRows.pluginId, pluginId),
						inArray(pluginRows.key, deletes)
					)
				)
		if (puts.length)
			await tx
				.insert(pluginRows)
				.values(puts)
				.onConflictDoUpdate({
					target: [pluginRows.pluginId, pluginRows.key],
					set: {
						value: sql`excluded."value"`,
						bytes: sql`excluded."bytes"`,
						updatedAt: sql`excluded."updated_at"`
					}
				})
	})
}

/**
 * Remove every row an extension owns.
 *
 * The FK is ON DELETE CASCADE, so uninstalling through `removePlugin` already
 * takes the rows with it — this is for the case that is *not* an uninstall: an
 * admin clearing a misbehaving extension's data while leaving it installed.
 */
export async function clearPluginRows(db: Db, pluginId: string): Promise<void> {
	await db.delete(pluginRows).where(eq(pluginRows.pluginId, pluginId))
}

/** The port, over a handle resolved at call time — so the manager can be built
 *  before `bootstrapPlugins` has a database, exactly as its invocation log is. */
export function makePluginRowPort(dbOf: () => Db | null): PluginRowPort {
	return {
		async load(pluginId) {
			const db = dbOf()
			return db ? loadPluginRows(db, pluginId) : []
		},
		async commit(pluginId, changes) {
			const db = dbOf()
			// No database means no store; a hook that wrote rows must not be
			// told they landed, so this is a throw rather than a shrug.
			if (!db) throw new Error("plugin rows: no database is attached")
			await commitPluginRows(db, pluginId, changes)
		}
	}
}
