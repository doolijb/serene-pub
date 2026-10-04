/**
 * The **lorebook table registry** (plan B1): every table whose rows belong to
 * a lorebook, declared once, with how its rows attach to a book, whether they
 * stand on a line, and how they are copied, purged and counted.
 *
 * Its consumers iterate it instead of naming tables, so a table added here is
 * handled everywhere at once, and a table that belongs to a book but is left
 * out of it fails `tableRegistry.int.test.ts` instead of silently not being
 * copied or deleted:
 *
 * - `duplicateLorebookRows` (`utils/lorebookDuplicate.ts`) runs every `copy`,
 *   in order, then every `relink`;
 * - `purgeLorebook` — book delete and overwrite import, ONE deletion rule —
 *   runs every `purge`, in reverse order;
 * - `deleteOwnedRows` — a member, place or line removed — deletes what each
 *   polymorphic table holds for those owners (`state/lorebookState.ts`
 *   `deleteOwnerStats` / `deletePlaceStats` call it);
 * - each `count` — the duplicate equality test (`lorebooks.duplicate.int.test.ts`).
 *
 * The book row itself is not here: it is the root everything else hangs
 * from, written by the duplicate and kept (renamed, re-dated) by an overwrite.
 *
 * Not here, by rule: `sessions.lorebook_id` and `characters.lorebook_id`
 * (a session and a card READ a book; they do not belong to it — the book's
 * delete sets them null), and `state_proposals` (a session's review queue;
 * the pending changes naming the book's owners are deleted with those owners,
 * `deleteOwnedRows`).
 *
 * ⚠ Every statement runs on the `tx` handed in. The outer `db` inside a
 * transaction deadlocks PGlite silently.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { orderedBindingPair } from "$lib/server/utils/duplicateBindingDetection"
import { sweepLoreEntryRankings } from "$lib/server/utils/lorebookEntries"

export type IdMap = Map<number, number>

/**
 * Source id → copy id, per table, filled as the copy runs: a spec reads only
 * the maps of the specs before it (`relink` may read all of them).
 * `historyEntries` is `entries` — a history entry is an entry.
 */
export interface IdMaps {
	branches: IdMap
	bindings: IdMap
	entries: IdMap
	historyEntries: IdMap
	scenes: IdMap
}

export type PolymorphicScope = {
	polymorphic: {
		kindColumn: string
		idColumn: string
		/** The owner kinds a BOOK holds rows under in this table. */
		kinds: readonly string[]
	}
}

export interface LorebookTableSpec {
	/** The drizzle object, never a string. */
	table: PgTable
	/**
	 * How rows attach to a book: by their own `lorebook_id` (`book`), through
	 * an entry, a cast member (`binding`), a scene, or a line (`branch`); or
	 * by an owner kind and id (`polymorphic` — the attribute tables).
	 */
	scope: "book" | "entry" | "binding" | "scene" | "branch" | PolymorphicScope
	/** Has a `branch_id`: a row stands on one line, or on main when null. */
	lineScoped: boolean
	/** Copy the source book's rows into the copy; references go through `maps`. */
	copy(tx: Db, from: number, to: number, maps: IdMaps): Promise<void>
	/**
	 * A second pass once every table is copied, for references that point
	 * forward in the copy order (a cast member's scene, a line's parent).
	 */
	relink?(tx: Db, from: number, to: number, maps: IdMaps): Promise<void>
	/**
	 * Delete the book's rows, for book delete AND overwrite import. Runs in
	 * reverse registry order, so a row goes before what it points at, and the
	 * polymorphic tables (last in the registry) go while the owners they are
	 * found through still exist.
	 */
	purge(tx: Db, lorebookId: number): Promise<void>
	/** How many rows the book holds here, on every line and in every session. */
	count(tx: Db, lorebookId: number): Promise<number>
	/** Optional: the readout's name for this count. */
	countAs?: string
	/** Set when the copy deliberately carries nothing — the reason. */
	notCopied?: string
}

/** A nullable reference through a map; a reference the map lacks is dropped. */
export const via = (map: IdMap, id: number | null | undefined): number | null =>
	id == null ? null : (map.get(id) ?? null)

/**
 * An annotation's entity key names an entry by id (`entry:<id>`); a copy's
 * names the copy's entry. `character:<id>` names a card, which the book does
 * not own, and `open:…` names nothing — both are kept as they are.
 */
export function remapEntityKey(key: string, entries: IdMap): string | null {
	if (!key.startsWith("entry:")) return key
	const id = via(entries, Number(key.slice("entry:".length)))
	return id == null ? null : `entry:${id}`
}

/**
 * Ids an amendment's `fields` may overlay (`changedFields` writes wire keys),
 * and which map each one is remapped through. Any other key is copied as is —
 * `characterId` included, because a card is not a row the book owns.
 */
function remapAmendedFields(
	fields: Record<string, unknown> | null | undefined,
	maps: IdMaps
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...(fields ?? {}) }
	const through: Record<string, IdMap> = {
		lorebookBindingId: maps.bindings,
		anchorBindingId: maps.bindings,
		parentNodeId: maps.bindings,
		anchorEntryId: maps.entries,
		historyEntryId: maps.entries,
		sceneId: maps.scenes
	}
	for (const [key, map] of Object.entries(through)) {
		if (!(key in out)) continue
		const v = out[key]
		out[key] = typeof v === "number" ? via(map, v) : v
	}
	return out
}

// ── Scope helpers ───────────────────────────────────────────────────────────

const entryIdsOf = (lorebookId: number) =>
	sql`(SELECT ${schema.lorebookEntries.id} FROM ${schema.lorebookEntries} WHERE ${schema.lorebookEntries.lorebookId} = ${lorebookId})`
const sceneIdsOf = (lorebookId: number) =>
	sql`(SELECT ${schema.scenes.id} FROM ${schema.scenes} WHERE ${schema.scenes.lorebookId} = ${lorebookId})`

async function countWhere(tx: Db, table: PgTable, where: SQL | undefined): Promise<number> {
	const [row] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(table as any)
		.where(where)
	return Number(row?.n ?? 0)
}

/** A table whose rows carry their own `lorebook_id`. */
function bookScoped(
	table: PgTable & { lorebookId: any },
	spec: Omit<LorebookTableSpec, "table" | "scope" | "purge" | "count"> &
		Partial<Pick<LorebookTableSpec, "purge">>
): LorebookTableSpec {
	return {
		table,
		scope: "book",
		purge: async (tx, lorebookId) => {
			await tx.delete(table as any).where(eq(table.lorebookId, lorebookId))
		},
		count: (tx, lorebookId) => countWhere(tx, table, eq(table.lorebookId, lorebookId)),
		...spec
	}
}

// ── Polymorphic owners ──────────────────────────────────────────────────────

/**
 * Every owner a book holds stats under, as owner kinds and the ids they
 * share: the book (`lorebook`), its cast members (`cast_member`, by binding)
 * and its places (`location` and each session's `session_location` layer
 * over one, by entry id). Owner ids carry no foreign key (`state/owners.ts`),
 * so nothing cascades these rows. What an overwrite counts before it deletes
 * (`overwriteLosses`) reads the same list, so the count and the delete
 * cannot drift apart.
 */
export async function bookStatOwners(
	tx: Db,
	lorebookId: number
): Promise<Array<[string[], number[]]>> {
	const places = (
		await tx
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.typeId, LOCATION_TYPE_ID)
				)
			)
	).map((r) => r.id)
	const members = (
		await tx
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).map((r) => r.id)
	return [
		[["lorebook"], [lorebookId]],
		[["cast_member"], members],
		[["location", "session_location"], places]
	]
}

/**
 * The changes still waiting in a session's review — `pending`
 * `state_proposals` — that name one of these owners. The owner rides the
 * change's payload (`{ owner: { kind, id }, … }`), not a column.
 */
export function pendingChangesFor(kinds: readonly string[], ids: readonly number[]): SQL {
	const p = schema.stateProposals
	return and(
		eq(p.status, "pending"),
		inArray(sql`${p.payload}->'owner'->>'kind'`, [...kinds]),
		inArray(sql`${p.payload}->'owner'->>'id'`, ids.map(String))
	)!
}

const ownedBy = (table: PgTable, scope: PolymorphicScope, kinds: readonly string[], ids: readonly number[]) => {
	const t = table as any
	return and(
		inArray(t[scope.polymorphic.kindColumn], [...kinds]),
		inArray(t[scope.polymorphic.idColumn], [...ids])
	)!
}

/** Which source → copy map an owner kind's ids go through. */
function ownerMap(kind: string, from: number, to: number, maps: IdMaps): IdMap {
	if (kind === "lorebook") return new Map([[from, to]])
	if (kind === "cast_member") return maps.bindings
	return maps.entries
}

/**
 * An attribute table: owned by kind and id. A copy carries the template layer
 * only (`session_id IS NULL`) — a session's rows belong to the session, which
 * reads the ORIGINAL book. A purge takes every layer.
 */
function polymorphic(
	table: PgTable,
	opts: { lineScoped: boolean; countAs?: string; remapRow?: (r: any, maps: IdMaps) => any }
): LorebookTableSpec {
	const scope: PolymorphicScope = {
		polymorphic: {
			kindColumn: "ownerKind",
			idColumn: "ownerId",
			kinds: ["lorebook", "cast_member", "location", "session_location"]
		}
	}
	const t = table as any
	const owners = async (tx: Db, lorebookId: number) =>
		(await bookStatOwners(tx, lorebookId)).filter(([, ids]) => ids.length > 0)
	return {
		table,
		scope,
		lineScoped: opts.lineScoped,
		countAs: opts.countAs,
		copy: async (tx, from, to, maps) => {
			// `session_location` is a session's layer: never copied.
			for (const kind of ["lorebook", "cast_member", "location"]) {
				const map = ownerMap(kind, from, to, maps)
				const ownerIds = [...map.keys()]
				if (ownerIds.length === 0) continue
				const rows: any[] = await tx
					.select()
					.from(t)
					.where(and(eq(t.ownerKind, kind), inArray(t.ownerId, ownerIds), isNull(t.sessionId)))
				const copies = rows.map(({ id: _id, ...r }) => ({
					...(opts.remapRow ? opts.remapRow(r, maps) : r),
					ownerId: map.get(r.ownerId)!
				}))
				if (copies.length > 0) await tx.insert(t).values(copies)
			}
		},
		purge: async (tx, lorebookId) => {
			for (const [kinds, ids] of await owners(tx, lorebookId))
				await tx.delete(t).where(ownedBy(table, scope, kinds, ids))
		},
		count: async (tx, lorebookId) => {
			const all = await owners(tx, lorebookId)
			if (all.length === 0) return 0
			return countWhere(tx, table, sql.join(
				all.map(([kinds, ids]) => sql`(${ownedBy(table, scope, kinds, ids)})`),
				sql` OR `
			))
		}
	}
}

/** The copy's line, scene and history entry for an attribute row. */
const attributeRow = (r: any, maps: IdMaps) => ({
	...r,
	// The COPY's branch, never the original's.
	branchId: r.branchId == null ? null : via(maps.branches, r.branchId),
	historyEntryId: via(maps.historyEntries, r.historyEntryId),
	sceneId: via(maps.scenes, r.sceneId)
})

// ── The registry ────────────────────────────────────────────────────────────

/**
 * In copy order: a table comes after every table its rows point at, except
 * the references a `relink` writes. Purge runs it backwards.
 */
export const LOREBOOK_TABLES: readonly LorebookTableSpec[] = [
	// Lines — inserted flat; the parent chain is written by `relink` once
	// every line has its new id (a fork of a fork may name a later id).
	bookScoped(schema.lorebookBranches, {
		lineScoped: false,
		countAs: "branches",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.lorebookBranches)
				.where(eq(schema.lorebookBranches.lorebookId, from))
			for (const { id, ...row } of rows) {
				const [ins] = await tx
					.insert(schema.lorebookBranches)
					.values({ ...row, lorebookId: to, forkedFromBranchId: null })
					.returning({ id: schema.lorebookBranches.id })
				maps.branches.set(id, ins.id)
			}
		},
		relink: async (tx, from, _to, maps) => {
			const rows = await tx
				.select()
				.from(schema.lorebookBranches)
				.where(eq(schema.lorebookBranches.lorebookId, from))
			for (const row of rows) {
				if (row.forkedFromBranchId == null) continue
				await tx
					.update(schema.lorebookBranches)
					.set({ forkedFromBranchId: via(maps.branches, row.forkedFromBranchId) })
					.where(eq(schema.lorebookBranches.id, maps.branches.get(row.id)!))
			}
		}
	}),

	// Cast members — their scene, history entry and parent are written by
	// `relink`, after those rows exist.
	bookScoped(schema.lorebookBindings, {
		lineScoped: false,
		countAs: "castMembers",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, from))
			for (const { id, ...row } of rows) {
				const [ins] = await tx
					.insert(schema.lorebookBindings)
					.values({
						...row,
						lorebookId: to,
						parentNodeId: null,
						sceneId: null,
						historyEntryId: null
					})
					.returning({ id: schema.lorebookBindings.id })
				maps.bindings.set(id, ins.id)
			}
		},
		relink: async (tx, from, _to, maps) => {
			const rows = await tx
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, from))
			for (const row of rows) {
				if (row.parentNodeId == null && row.sceneId == null && row.historyEntryId == null)
					continue
				await tx
					.update(schema.lorebookBindings)
					.set({
						parentNodeId: via(maps.bindings, row.parentNodeId),
						sceneId: via(maps.scenes, row.sceneId),
						historyEntryId: via(maps.historyEntries, row.historyEntryId)
					})
					.where(eq(schema.lorebookBindings.id, maps.bindings.get(row.id)!))
			}
		}
	}),

	// Entries — every line, archived rows included. The `parent` role
	// (anchorEntryId) is written by `relink`.
	bookScoped(schema.lorebookEntries, {
		lineScoped: true,
		countAs: "entries",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, from))
			for (const { id, ...row } of rows) {
				const [ins] = await tx
					.insert(schema.lorebookEntries)
					.values({
						...row,
						lorebookId: to,
						anchorBindingId: via(maps.bindings, row.anchorBindingId),
						anchorEntryId: null,
						branchId: via(maps.branches, row.branchId)
					})
					.returning({ id: schema.lorebookEntries.id })
				maps.entries.set(id, ins.id)
			}
		},
		relink: async (tx, from, _to, maps) => {
			const rows = await tx
				.select({ id: schema.lorebookEntries.id, anchorEntryId: schema.lorebookEntries.anchorEntryId })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, from))
			for (const row of rows) {
				if (row.anchorEntryId == null) continue
				await tx
					.update(schema.lorebookEntries)
					.set({ anchorEntryId: via(maps.entries, row.anchorEntryId) })
					.where(eq(schema.lorebookEntries.id, maps.entries.get(row.id)!))
			}
		}
	}),

	// Entry vectors — through their entry.
	{
		table: schema.lorebookEntryVectors,
		scope: "entry",
		lineScoped: false,
		copy: async (tx, _from, _to, maps) => {
			const ids = [...maps.entries.keys()]
			if (ids.length === 0) return
			const rows = await tx
				.select()
				.from(schema.lorebookEntryVectors)
				.where(inArray(schema.lorebookEntryVectors.entryId, ids))
			if (rows.length > 0)
				await tx
					.insert(schema.lorebookEntryVectors)
					.values(rows.map((v) => ({ ...v, entryId: maps.entries.get(v.entryId)! })))
		},
		purge: async (tx, lorebookId) => {
			await tx
				.delete(schema.lorebookEntryVectors)
				.where(sql`${schema.lorebookEntryVectors.entryId} IN ${entryIdsOf(lorebookId)}`)
		},
		count: (tx, lorebookId) =>
			countWhere(
				tx,
				schema.lorebookEntryVectors,
				sql`${schema.lorebookEntryVectors.entryId} IN ${entryIdsOf(lorebookId)}`
			)
	},

	// Entry annotations — through their entry: the table has no
	// `lorebook_id` (plan A8), so every book-level read joins
	// `lorebook_entries`. An `entry:<id>` key names the copy's entry
	// (plan A23(a)); a key naming an entry outside the book is not copied.
	{
		table: schema.entryAnnotations,
		scope: "entry",
		lineScoped: false,
		copy: async (tx, _from, _to, maps) => {
			const ids = [...maps.entries.keys()]
			if (ids.length === 0) return
			const rows = await tx
				.select()
				.from(schema.entryAnnotations)
				.where(inArray(schema.entryAnnotations.entryId, ids))
			const copies = rows.flatMap((a) => {
				const entityKey = remapEntityKey(a.entityKey, maps.entries)
				return entityKey == null
					? []
					: [
							{
								...a,
								entityKey,
								entryId: maps.entries.get(a.entryId)!,
								refEntryId: via(maps.entries, a.refEntryId)
							}
						]
			})
			if (copies.length > 0) await tx.insert(schema.entryAnnotations).values(copies)
		},
		purge: async (tx, lorebookId) => {
			await tx
				.delete(schema.entryAnnotations)
				.where(sql`${schema.entryAnnotations.entryId} IN ${entryIdsOf(lorebookId)}`)
		},
		count: (tx, lorebookId) =>
			countWhere(
				tx,
				schema.entryAnnotations,
				sql`${schema.entryAnnotations.entryId} IN ${entryIdsOf(lorebookId)}`
			)
	},

	// Scenes. The session capture (`sessionId`, `selectedMessageIds`) stays
	// with the original: it names messages in a session that reads the
	// ORIGINAL book, so a copy that kept it would show every captured scene
	// twice in that session.
	bookScoped(schema.scenes, {
		lineScoped: true,
		countAs: "scenes",
		copy: async (tx, from, to, maps) => {
			const rows = await tx.select().from(schema.scenes).where(eq(schema.scenes.lorebookId, from))
			for (const { id, ...row } of rows) {
				const historyEntryId = via(maps.historyEntries, row.historyEntryId)
				if (historyEntryId == null) continue
				const [ins] = await tx
					.insert(schema.scenes)
					.values({
						...row,
						lorebookId: to,
						historyEntryId,
						branchId: via(maps.branches, row.branchId),
						sessionId: null,
						selectedMessageIds: []
					})
					.returning({ id: schema.scenes.id })
				maps.scenes.set(id, ins.id)
			}
		}
	}),

	// A scene's cast — through its scene.
	{
		table: schema.sceneCharacters,
		scope: "scene",
		lineScoped: false,
		copy: async (tx, _from, _to, maps) => {
			const ids = [...maps.scenes.keys()]
			if (ids.length === 0) return
			const cast = await tx
				.select()
				.from(schema.sceneCharacters)
				.where(inArray(schema.sceneCharacters.sceneId, ids))
			const rows = cast
				.map(({ id: _id, ...c }) => ({
					...c,
					sceneId: maps.scenes.get(c.sceneId)!,
					bindingId: via(maps.bindings, c.bindingId)
				}))
				.filter((c): c is typeof c & { bindingId: number } => c.bindingId != null)
			if (rows.length > 0) await tx.insert(schema.sceneCharacters).values(rows)
		},
		purge: async (tx, lorebookId) => {
			await tx
				.delete(schema.sceneCharacters)
				.where(sql`${schema.sceneCharacters.sceneId} IN ${sceneIdsOf(lorebookId)}`)
		},
		count: (tx, lorebookId) =>
			countWhere(
				tx,
				schema.sceneCharacters,
				sql`${schema.sceneCharacters.sceneId} IN ${sceneIdsOf(lorebookId)}`
			)
	},

	// Links, both endpoint kinds, with their dates and their line. Purged
	// before the entries: a history entry's delete un-dates the links it
	// dated (`set null`), and a link that also stands undated, or at a second
	// date, would then stand twice on the entry-pair index.
	bookScoped(schema.narrativeRelationships, {
		lineScoped: true,
		countAs: "links",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.lorebookId, from))
			for (const { id: _id, ...row } of rows) {
				const fromNodeId = via(maps.bindings, row.fromNodeId)
				const fromEntryId = via(maps.entries, row.fromEntryId)
				const toNodeId = via(maps.bindings, row.toNodeId)
				const toEntryId = via(maps.entries, row.toEntryId)
				// An endpoint outside this book cannot be carried; half a link
				// is not a link.
				if ((fromNodeId == null) === (fromEntryId == null)) continue
				if ((toNodeId == null) === (toEntryId == null)) continue
				await tx.insert(schema.narrativeRelationships).values({
					...row,
					lorebookId: to,
					fromNodeId,
					fromEntryId,
					toNodeId,
					toEntryId,
					historyEntryId: via(maps.historyEntries, row.historyEntryId),
					sceneId: via(maps.scenes, row.sceneId),
					branchId: via(maps.branches, row.branchId)
				})
			}
		}
	}),

	// Dated changes to entries (ids inside `fields` remapped too).
	bookScoped(schema.entryAmendments, {
		lineScoped: true,
		countAs: "entryAmendments",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.lorebookId, from))
			const copies = rows.flatMap(({ id: _id, ...a }) => {
				const entryId = via(maps.entries, a.entryId)
				return entryId == null
					? []
					: [
							{
								...a,
								lorebookId: to,
								entryId,
								branchId: via(maps.branches, a.branchId),
								historyEntryId: via(maps.historyEntries, a.historyEntryId),
								fields: remapAmendedFields(a.fields, maps)
							}
						]
			})
			if (copies.length > 0) await tx.insert(schema.entryAmendments).values(copies)
		}
	}),

	// Dated changes to cast members.
	bookScoped(schema.castAmendments, {
		lineScoped: true,
		countAs: "castAmendments",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.castAmendments)
				.where(eq(schema.castAmendments.lorebookId, from))
			const copies = rows.flatMap(({ id: _id, ...a }) => {
				const lorebookBindingId = via(maps.bindings, a.lorebookBindingId)
				return lorebookBindingId == null
					? []
					: [
							{
								...a,
								lorebookId: to,
								lorebookBindingId,
								branchId: via(maps.branches, a.branchId),
								historyEntryId: via(maps.historyEntries, a.historyEntryId),
								fields: remapAmendedFields(a.fields, maps)
							}
						]
			})
			if (copies.length > 0) await tx.insert(schema.castAmendments).values(copies)
		}
	}),

	bookScoped(schema.castPresences, {
		lineScoped: true,
		countAs: "presences",
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.castPresences)
				.where(eq(schema.castPresences.lorebookId, from))
			const copies = rows.flatMap(({ id: _id, ...p }) => {
				const lorebookBindingId = via(maps.bindings, p.lorebookBindingId)
				return lorebookBindingId == null
					? []
					: [{ ...p, lorebookId: to, lorebookBindingId, branchId: via(maps.branches, p.branchId) }]
			})
			if (copies.length > 0) await tx.insert(schema.castPresences).values(copies)
		}
	}),

	// The book's tags are its labels, like its name: an overwrite keeps them
	// (the file's book replaces the content, not the shelf it sits on), and
	// book delete takes them with the book row (cascade).
	bookScoped(schema.lorebookTags, {
		lineScoped: false,
		copy: async (tx, from, to) => {
			const tags = await tx
				.select({ tagId: schema.lorebookTags.tagId })
				.from(schema.lorebookTags)
				.where(eq(schema.lorebookTags.lorebookId, from))
			if (tags.length > 0)
				await tx
					.insert(schema.lorebookTags)
					.values(tags.map((t) => ({ lorebookId: to, tagId: t.tagId })))
					.onConflictDoNothing()
		},
		purge: async () => {}
	}),

	// Curation the user already did on this cast. Ordered again after the
	// remap (`orderedBindingPair`): the copy may number the two members the
	// other way round, and a pair the source holds in both orders is one
	// pair, copied once.
	bookScoped(schema.dismissedDuplicatePairs, {
		lineScoped: false,
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.dismissedDuplicatePairs)
				.where(eq(schema.dismissedDuplicatePairs.lorebookId, from))
			const pairs = new Map<string, typeof schema.dismissedDuplicatePairs.$inferInsert>()
			for (const { id: _id, ...d } of rows) {
				const a = via(maps.bindings, d.bindingIdA)
				const b = via(maps.bindings, d.bindingIdB)
				if (a == null || b == null) continue
				const [bindingIdA, bindingIdB] = orderedBindingPair(a, b)
				const key = `${bindingIdA}:${bindingIdB}`
				if (!pairs.has(key)) pairs.set(key, { ...d, lorebookId: to, bindingIdA, bindingIdB })
			}
			const copies = [...pairs.values()]
			if (copies.length > 0) await tx.insert(schema.dismissedDuplicatePairs).values(copies)
		}
	}),

	// Names the book's text keeps using that no cast member holds yet. Derived
	// from the content, so an overwrite purges them with it (they are found
	// again from the file's entries).
	bookScoped(schema.bindingSuggestions, {
		lineScoped: false,
		copy: async (tx, from, to, maps) => {
			const rows = await tx
				.select()
				.from(schema.bindingSuggestions)
				.where(eq(schema.bindingSuggestions.lorebookId, from))
			const copies = rows.flatMap(({ id: _id, ...s }) => {
				const entityKey = remapEntityKey(s.entityKey, maps.entries)
				return entityKey == null
					? []
					: [
							{
								...s,
								entityKey,
								lorebookId: to,
								resolvedBindingId: via(maps.bindings, s.resolvedBindingId),
								exampleSourceId:
									s.exampleSourceKind === "entry"
										? via(maps.entries, s.exampleSourceId)
										: s.exampleSourceId
							}
						]
			})
			if (copies.length > 0) await tx.insert(schema.bindingSuggestions).values(copies)
		}
	}),

	// ⚠ Never copied: an undo record of a merge done to the
	// ORIGINAL's rows; undoing it on the copy would restore into the wrong
	// book. Not purged by an overwrite either: its survivor goes with the
	// cast (`survivor_id` set null), which makes the record undo-unavailable
	// and leaves it as history; book delete takes it with the book row.
	bookScoped(schema.bindingMergeLogs, {
		lineScoped: false,
		notCopied: "an undo record of the original's rows",
		copy: async () => {},
		purge: async () => {}
	}),

	// The attribute tables — owned by kind and id, so last: every owner they
	// map through is copied by now, and the purge (backwards) reaches them
	// while their owners still exist.
	polymorphic(schema.attributeConfigs, { lineScoped: true, countAs: "statConfigs", remapRow: attributeRow }),
	polymorphic(schema.attributeValues, { lineScoped: true, countAs: "stats", remapRow: attributeRow }),
	polymorphic(schema.ownerSheets, { lineScoped: false, countAs: "sheets" })
]

const POLYMORPHIC_TABLES = LOREBOOK_TABLES.filter(
	(s): s is LorebookTableSpec & { scope: PolymorphicScope } => typeof s.scope === "object"
)

// ── Consumers ───────────────────────────────────────────────────────────────

/** Copy every registered table from `from` into `to` (an existing, empty book). */
export async function copyLorebookTables(tx: Db, from: number, to: number): Promise<IdMaps> {
	const entries: IdMap = new Map()
	const maps: IdMaps = {
		branches: new Map(),
		bindings: new Map(),
		entries,
		historyEntries: entries,
		scenes: new Map()
	}
	for (const spec of LOREBOOK_TABLES) await spec.copy(tx, from, to, maps)
	for (const spec of LOREBOOK_TABLES) await spec.relink?.(tx, from, to, maps)
	return maps
}

/**
 * Delete everything the book holds, leaving the book row (and its tags):
 * book delete then deletes the row, an overwrite import writes the file's
 * content into it. ONE deletion rule for both. The pending changes a session
 * still has waiting on the book's owners go first (nothing could accept one).
 */
export async function purgeLorebook(tx: Db, lorebookId: number): Promise<void> {
	for (const [kinds, ids] of await bookStatOwners(tx, lorebookId))
		if (ids.length > 0) await tx.delete(schema.stateProposals).where(pendingChangesFor(kinds, ids))
	// The ranking evidence about the book's entries: its subject id has no
	// foreign key, so nothing else removes it (`sweepLoreEntryRankings`).
	const entryIds = await tx
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	await sweepLoreEntryRankings(
		tx,
		entryIds.map((row) => row.id)
	)
	for (const spec of [...LOREBOOK_TABLES].reverse()) await spec.purge(tx, lorebookId)
}

/**
 * Delete what every polymorphic table holds for the owners `ids` under
 * `kinds`, on every line and in every session, and the changes to them
 * still waiting in a session's review. A decided change stays: it is the
 * record of what was asked and answered.
 */
export async function deleteOwnedRows(
	tx: Db,
	kinds: readonly string[],
	ids: readonly number[]
): Promise<void> {
	if (!ids.length || !kinds.length) return
	for (const spec of POLYMORPHIC_TABLES)
		await tx.delete(spec.table as any).where(ownedBy(spec.table, spec.scope, kinds, ids))
	await tx.delete(schema.stateProposals).where(pendingChangesFor(kinds, ids))
}

