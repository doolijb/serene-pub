/**
 * Fold one connection row into another without losing a reference.
 *
 * Connections are referenced by id from many places, and deleting a row
 * silently set-nulls or cascades all of them. So a source row S is folded into
 * a target T, inside the caller's transaction:
 *
 * 1. S's model rows MOVE to T; a model T already has (same `model` string)
 *    maps to T's row instead.
 * 2. Every foreign key into `connections.id` is repointed S -> T, and every
 *    foreign key into `connection_models.id` is repointed for the mapped
 *    duplicates. Found by introspecting the schema, so a column added later
 *    is folded without an edit here. A row that would break a unique key the
 *    target already holds is dropped first; the target's row wins.
 * 3. Every pipeline Connection slot naming S (`pipeline_config_values` rows
 *    with `slot = 'connection'`, stored in any legacy spelling) is rewritten
 *    to name T and the mapped model.
 * 4. S is deleted - by now nothing points at it.
 *
 * Type-specific carry-over (the managed KoboldCPP's image settings) stays with
 * its caller: `koboldCppManagedFold.ts`, `localOnnxConnections.ts`.
 */

import { and, eq, exists, getTableColumns, is, sql, SQL } from "drizzle-orm"
import {
	alias,
	getTableConfig,
	PgTable,
	type PgColumn
} from "drizzle-orm/pg-core"
import { dev } from "$app/environment"
import * as schema from "$lib/server/db/schema"
import {
	connectionSlotValue,
	slotConnectionId,
	slotModelId
} from "$lib/shared/connections/slotRef"

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Every foreign-key column that points at `target`'s `id`. */
function referencesTo(
	target: PgTable
): { table: PgTable; key: string; column: PgColumn }[] {
	const out: { table: PgTable; key: string; column: PgColumn }[] = []
	for (const table of Object.values(schema)) {
		if (!is(table, PgTable)) continue
		const columns = getTableColumns(table) as Record<string, PgColumn>
		for (const fk of getTableConfig(table).foreignKeys) {
			const ref = fk.reference()
			if (ref.foreignTable !== target || ref.columns.length !== 1)
				continue
			const column = ref.columns[0]
			const key = Object.keys(columns).find(
				(k) => columns[k].name === column.name
			)
			if (key) out.push({ table, key, column })
		}
	}
	return out
}

/** The other columns of each unique key on `table` that includes `column` (exported for its test). */
export function uniqueKeysWith(
	table: PgTable,
	column: PgColumn
): { others: PgColumn[]; nullsNotDistinct: boolean }[] {
	const own = getTableColumns(table) as Record<string, PgColumn>
	const config = getTableConfig(table)
	const keys: { others: PgColumn[]; nullsNotDistinct: boolean }[] = []
	const add = (names: string[], nullsNotDistinct: boolean) => {
		if (!names.includes(column.name)) return
		const others = names
			.filter((n) => n !== column.name)
			.map((n) => Object.values(own).find((c) => c.name === n)!)
		keys.push({ others, nullsNotDistinct })
	}
	for (const index of config.indexes) {
		const { name, columns, unique, where } = index.config
		if (!unique) continue
		if (columns.some((c) => is(c, SQL))) {
			if (dev)
				console.warn(
					`[connections] Fold: unique index ${name} on ${config.name} uses an expression; not checked for collisions.`
				)
			continue
		}
		const names = columns.map((c) => (c as { name: string }).name)
		if (!names.includes(column.name)) continue
		if (where) {
			if (dev)
				console.warn(
					`[connections] Fold: unique index ${name} on ${config.name} is partial; not checked for collisions.`
				)
			continue
		}
		add(names, false)
	}
	for (const u of config.uniqueConstraints)
		add(
			u.columns.map((c) => c.name),
			u.nullsNotDistinct
		)
	for (const pk of config.primaryKeys)
		add(
			pk.columns.map((c) => c.name),
			false
		)
	if (column.isUnique || column.primary)
		keys.push({
			others: [],
			nullsNotDistinct: column.uniqueType === "not distinct"
		})
	return keys
}

/** Delete `from`'s rows in `table` that the repoint to `to` would collide with; the row already on `to` wins. */
async function dropCollisions(
	tx: Tx,
	table: PgTable,
	column: PgColumn,
	from: number,
	to: number
): Promise<void> {
	const own = getTableColumns(table) as Record<string, PgColumn>
	const kept = alias(table, "fold_kept")
	const keptOwn = getTableColumns(kept) as Record<string, PgColumn>
	const keptCol = (c: PgColumn) =>
		keptOwn[Object.keys(own).find((k) => own[k].name === c.name)!]
	for (const { others, nullsNotDistinct } of uniqueKeysWith(table, column))
		await tx.delete(table).where(
			and(
				eq(column, from),
				exists(
					tx
						.select({ one: sql`1` })
						.from(kept)
						.where(
							and(
								eq(keptCol(column), to),
								...others.map((c) =>
									nullsNotDistinct
										? sql`${keptCol(c)} is not distinct from ${c}`
										: eq(keptCol(c), c)
								)
							)
						)
				)
			)
		)
}

export async function foldConnectionInto(
	tx: Tx,
	source: SelectConnection,
	target: SelectConnection
): Promise<void> {
	// 1. The models.
	const sourceModels = await tx
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, source.id))
	const targetModels = await tx
		.select({
			id: schema.connectionModels.id,
			model: schema.connectionModels.model
		})
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, target.id))
	const targetByModel = new Map(targetModels.map((m) => [m.model, m.id]))
	/** Source model id → the id that means the same model on the target. */
	const mapped = new Map<number, number>()
	const duplicates = new Map<number, number>()
	for (const m of sourceModels) {
		const existing = targetByModel.get(m.model)
		if (existing != null) {
			mapped.set(m.id, existing)
			duplicates.set(m.id, existing)
			continue
		}
		await tx
			.update(schema.connectionModels)
			.set({ connectionId: target.id })
			.where(eq(schema.connectionModels.id, m.id))
		mapped.set(m.id, m.id)
	}

	// 2. Foreign keys.
	for (const { table, key, column } of referencesTo(schema.connections)) {
		// Its rows were moved above; the duplicates go with the source row.
		if (table === schema.connectionModels) continue
		await dropCollisions(tx, table, column, source.id, target.id)
		await tx
			.update(table)
			.set({ [key]: target.id })
			.where(eq(column, source.id))
	}
	for (const { table, key, column } of referencesTo(schema.connectionModels))
		for (const [from, to] of duplicates) {
			await dropCollisions(tx, table, column, from, to)
			await tx
				.update(table)
				.set({ [key]: to })
				.where(eq(column, from))
		}

	// 3. Pipeline Connection slots.
	const slots = await tx
		.select({
			id: schema.pipelineConfigValues.id,
			value: schema.pipelineConfigValues.value
		})
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.slot, "connection"))
	for (const row of slots) {
		if (slotConnectionId(row.value) !== source.id) continue
		const modelId = slotModelId(row.value)
		await tx
			.update(schema.pipelineConfigValues)
			.set({
				value: connectionSlotValue(
					target.id,
					modelId == null ? null : (mapped.get(modelId) ?? null)
				)
			})
			.where(eq(schema.pipelineConfigValues.id, row.id))
	}

	// 4. Nothing points at it any more.
	await tx
		.delete(schema.connections)
		.where(eq(schema.connections.id, source.id))
}
