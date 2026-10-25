/**
 * 🚧 **An administrator's instance-wide edit of a pipeline's values** (R38,
 * A15; PLAN-layering D5) — what the pipeline panel's global write was (the
 * pub-selected configuration), now a change to **the genre's defaults**: a
 * change row at genre scope (origin `admin`) on every registration of the
 * pipeline the genre's defaults hold, carrying `values`. The boot's
 * projection never touches it (another origin); the resolver folds it into
 * the genre layer (`resolve.ts`), the value cascade reads it there.
 *
 * A pipeline no genre registers has no such home: the panel writes its
 * instance values instead (`instanceValues.ts`, R50).
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { invalidateRegistrations } from "$lib/server/pipelines/registrations/resolve"
import { genreChangeKey, rowOfChange } from "$lib/server/pipelines/registrations/rows"

export interface GenreValueTarget {
	genreId: string
	key: string
}

/** The genre registrations of a pipeline — where an instance-wide edit of its values lands. */
export async function genreValueTargets(db: Db, specSlug: string): Promise<GenreValueTarget[]> {
	const rows = await db
		.select({ genreId: schema.registrations.scopeRef, key: schema.registrations.key })
		.from(schema.registrations)
		.where(
			and(
				eq(schema.registrations.scopeKind, "genre"),
				eq(schema.registrations.specSlug, specSlug),
				eq(schema.registrations.dropped, false)
			)
		)
		.orderBy(schema.registrations.id)
	const seen = new Set<string>()
	return rows.filter((r) => {
		const k = `${r.genreId}\u0000${r.key}`
		return seen.has(k) ? false : (seen.add(k), true)
	})
}

type Values = Record<string, Record<string, unknown>>

/** `values` with one address set (a value) or removed (`undefined`); null when nothing is left. */
export function withAddress(values: Values | null, nodeKey: string, slot: string, path: string, value: unknown): Values | null {
	const out: Values = {}
	for (const [k, v] of Object.entries(values ?? {})) out[k] = { ...v }
	const node = (out[nodeKey] ??= {})
	// The shapes `valuesOfConfigRows` writes: a slot's own address (`''`)
	// whole, or path → value with `''` among them when it has both. A slot's
	// whole value may itself be an object (a connection, a loadout), so the
	// `''` address replaces the slot unless the slot already holds a path map
	// with a `''` entry; a path address treats an object as that map.
	const cur = node[slot]
	const isObject = !!cur && typeof cur === "object" && !Array.isArray(cur)
	const mixed = isObject && Object.prototype.hasOwnProperty.call(cur, "")
	if (!path && !mixed) {
		if (value === undefined) delete node[slot]
		else node[slot] = value
	} else {
		const obj: Record<string, unknown> = isObject
			? { ...(cur as Record<string, unknown>) }
			: cur !== undefined
				? { "": cur }
				: {}
		if (value === undefined) delete obj[path]
		else obj[path] = value
		const keys = Object.keys(obj)
		if (!keys.length) delete node[slot]
		else node[slot] = keys.length === 1 && keys[0] === "" ? obj[""] : obj
	}
	if (!Object.keys(node).length) delete out[nodeKey]
	return Object.keys(out).length ? out : null
}

/** The administrator's change row at genre scope for one registration, if any. */
async function adminRow(db: Db, t: GenreValueTarget) {
	const [row] = await db
		.select()
		.from(schema.registrations)
		.where(
			and(
				eq(schema.registrations.scopeKind, "genre"),
				eq(schema.registrations.scopeRef, t.genreId),
				eq(schema.registrations.key, genreChangeKey(t.key))
			)
		)
		.limit(1)
	return row ?? null
}

/** Set (a value) or clear (`undefined`) one address on every target. */
export async function setGenreValue(
	db: Db,
	targets: readonly GenreValueTarget[],
	address: { nodeKey: string; slot: string; path: string },
	value: unknown
): Promise<void> {
	for (const t of targets) {
		const row = await adminRow(db, t)
		const next = withAddress((row?.values as Values | null) ?? null, address.nodeKey, address.slot, address.path, value)
		if (row) {
			if (!next && !row.triggerFamily && row.when == null && row.mode == null && row.order == null)
				await db.delete(schema.registrations).where(eq(schema.registrations.id, row.id))
			else
				await db
					.update(schema.registrations)
					.set({ values: next, updatedAt: new Date() })
					.where(eq(schema.registrations.id, row.id))
		} else if (next) {
			// A row of its own beside the projection's (`genreChangeKey`).
			await db
				.insert(schema.registrations)
				.values(
					rowOfChange(
						{ key: genreChangeKey(t.key), values: next as never },
						{ kind: "genre", genreId: t.genreId },
						"admin"
					)
				)
		}
	}
	invalidateRegistrations()
}

/** Remove every administrator's value change on these targets. */
export async function resetGenreValues(db: Db, targets: readonly GenreValueTarget[]): Promise<number> {
	let gone = 0
	for (const t of targets) {
		const row = await adminRow(db, t)
		if (!row) continue
		await db.delete(schema.registrations).where(eq(schema.registrations.id, row.id))
		gone++
	}
	invalidateRegistrations()
	return gone
}


/**
 * Every address an administrator's genre-scope change stores a value at for
 * this pipeline — the shapes `withAddress` writes, exploded back to
 * `{ nodeKey, slot, path, value }`. What the panel's unplaced chains (D4) are
 * found over, beside the ⏳ configuration rows.
 */
export async function genreStoredValues(
	db: Db,
	specSlug: string
): Promise<Array<{ nodeKey: string; slot: string; path: string; value: unknown }>> {
	const out: Array<{ nodeKey: string; slot: string; path: string; value: unknown }> = []
	for (const t of await genreValueTargets(db, specSlug)) {
		const row = await adminRow(db, t)
		for (const [nodeKey, slots] of Object.entries((row?.values as Values | null) ?? {}))
			for (const [slot, cur] of Object.entries(slots ?? {})) {
				if (cur && typeof cur === "object" && !Array.isArray(cur))
					for (const [path, value] of Object.entries(cur as Record<string, unknown>))
						out.push({ nodeKey, slot, path, value })
				else out.push({ nodeKey, slot, path: "", value: cur })
			}
	}
	return out
}

/**
 * Set (a value) or clear (`undefined`) one address of a pipeline everywhere
 * the genres' defaults register it — the instance-wide edit by slug.
 */
export async function setPipelineGenreValue(
	db: Db,
	specSlug: string,
	address: { nodeKey: string; slot: string; path: string },
	value: unknown
): Promise<number> {
	const targets = await genreValueTargets(db, specSlug)
	await setGenreValue(db, targets, address, value)
	return targets.length
}

/**
 * An administrator's own instance-wide selection of row `id` at `slots` on
 * this pipeline — the genre-scope change rows `setGenreValue` writes. What a
 * delete from the global panel releases rather than refuses on (the same
 * "your own selection does not hold it alive" rule the configuration had).
 */
export async function ownGenreValueRefs(
	db: Db,
	specSlug: string,
	slots: readonly string[],
	id: number
): Promise<import("$lib/server/pipelines/registrations/values").RegistrationValueRef[]> {
	if (!slots.length) return []
	const targets = await genreValueTargets(db, specSlug)
	if (!targets.length) return []
	const { registrationValueRefs } = await import("$lib/server/pipelines/registrations/values")
	return (await registrationValueRefs(db, slots)).filter(
		(r) =>
			r.scopeKind === "genre" &&
			r.value === id &&
			targets.some((t) => t.genreId === r.scopeRef && genreChangeKey(t.key) === r.key)
	)
}

/** Clear the addresses `ownGenreValueRefs` found, once the delete has succeeded. */
export async function releaseGenreValueRefs(
	db: Db,
	specSlug: string,
	refs: readonly { nodeKey: string; slot: string; path: string }[]
): Promise<void> {
	if (!refs.length) return
	const targets = await genreValueTargets(db, specSlug)
	for (const r of refs)
		await setGenreValue(db, targets, { nodeKey: r.nodeKey, slot: r.slot, path: r.path }, undefined)
}
