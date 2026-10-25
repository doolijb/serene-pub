/**
 * 🚧 Writing registration rows (PLAN-layering D7). Every write here
 * invalidates the resolver's cache; nothing else writes the table except the
 * data upgrade (raw SQL at its anchor, before anything is cached).
 */
import { and, eq, inArray, notInArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { invalidateRegistrations } from "$lib/server/pipelines/registrations/resolve"
import {
	registrationScopeWhere,
	type RegistrationInsert,
	type RegistrationRow,
	type RegistrationScope
} from "$lib/server/pipelines/registrations/rows"

/** The rows at one scope, oldest first. */
export async function rowsAt(db: Db, scope: RegistrationScope): Promise<RegistrationRow[]> {
	return (await db
		.select()
		.from(schema.registrations)
		.where(registrationScopeWhere(scope))
		.orderBy(schema.registrations.id)) as RegistrationRow[]
}

const comparable = (r: Partial<RegistrationInsert>) =>
	JSON.stringify([
		r.key,
		r.triggerFamily ?? null,
		r.triggerRef ?? null,
		r.cadenceOptions ?? null,
		r.specSlug ?? null,
		r.when ?? null,
		r.values ?? null,
		r.order ?? null,
		r.mode ?? null,
		r.allowStacking ?? null,
		r.minAge ?? null,
		r.caps ?? null,
		!!r.dropped,
		r.origin,
		r.label ?? null
	])

/**
 * Make the rows of `origins` at `scope` exactly `rows` — a projection's
 * re-sync (the genre's defaults, a shipped preset's changes) or an
 * administrator's save of a preset's changes. Rows of other origins at the
 * scope are left alone, and a row of theirs under a key `rows` also names
 * wins (it is somebody's). Unchanged rows are not rewritten. Returns whether
 * anything changed.
 */
export async function replaceRows(
	db: Db,
	scope: RegistrationScope,
	rows: readonly RegistrationInsert[],
	origins: readonly string[]
): Promise<boolean> {
	const existing = await rowsAt(db, scope)
	const owned = existing.filter((r) => origins.includes(r.origin))
	const foreignKeys = new Set(existing.filter((r) => !origins.includes(r.origin)).map((r) => r.key))
	const want = rows.filter((r) => !foreignKeys.has(r.key))
	const byKey = new Map(owned.map((r) => [r.key, r]))
	let changed = false
	const keep = new Set<string>()
	for (const row of want) {
		keep.add(row.key)
		const had = byKey.get(row.key)
		if (had && comparable(had) === comparable(row)) continue
		changed = true
		if (had)
			await db
				.update(schema.registrations)
				.set({ ...row, state: had.state, updatedAt: new Date() })
				.where(eq(schema.registrations.id, had.id))
		else await db.insert(schema.registrations).values(row)
	}
	const gone = owned.filter((r) => !keep.has(r.key)).map((r) => r.id)
	if (gone.length) {
		changed = true
		await db.delete(schema.registrations).where(inArray(schema.registrations.id, gone))
	}
	if (changed) invalidateRegistrations()
	return changed
}

/** Write one row at its scope by key — insert, or replace the row under that key. */
export async function upsertRow(db: Db, row: RegistrationInsert): Promise<void> {
	const [had] = await db
		.select({ id: schema.registrations.id, state: schema.registrations.state })
		.from(schema.registrations)
		.where(
			and(
				eq(schema.registrations.scopeKind, row.scopeKind),
				eq(schema.registrations.scopeRef, row.scopeRef),
				eq(schema.registrations.key, row.key)
			)
		)
		.limit(1)
	if (had)
		await db
			.update(schema.registrations)
			.set({ ...row, state: had.state, updatedAt: new Date() })
			.where(eq(schema.registrations.id, had.id))
	else await db.insert(schema.registrations).values(row)
	invalidateRegistrations()
}

/** Remove the row under `key` at `scope`, if there is one. */
export async function deleteRow(db: Db, scope: RegistrationScope, key: string): Promise<void> {
	await db.delete(schema.registrations).where(and(registrationScopeWhere(scope), eq(schema.registrations.key, key)))
	invalidateRegistrations()
}

/** Remove every row at `scope` except those of `keepOrigins`. */
export async function clearScope(db: Db, scope: RegistrationScope, keepOrigins: readonly string[] = []): Promise<void> {
	const where = keepOrigins.length
		? and(registrationScopeWhere(scope), notInArray(schema.registrations.origin, [...keepOrigins]))
		: registrationScopeWhere(scope)
	await db.delete(schema.registrations).where(where)
	invalidateRegistrations()
}
