/**
 * Fold every other managed KoboldCPP row into THE managed endpoint.
 *
 * Serene Pub runs one koboldcpp, and its model manager swaps the text or image
 * model that process holds. `koboldcpp_managed_image` was a second connection
 * type for that same process, because a connection once named exactly one
 * model. Connections now hold many models, each with its own `modality`, so
 * the managed endpoint lists image checkpoints beside text GGUFs and serves
 * both (`managedEndpoint.ts`). This retires the second type on an upgrading
 * install, and with it any second `koboldcpp_managed` row (an install from
 * when "Use for chat" could create one per model). Boot-time data work, per
 * the defaults-sync ruling (2026-09-06).
 *
 * ## A true fold, never a delete that drops references
 *
 * Connections are referenced by id from many places, and deleting a row
 * silently set-nulls or cascades all of them. So each extra row S is folded
 * into the managed endpoint T — the oldest `koboldcpp_managed` row — inside
 * one transaction:
 *
 * 1. Its model rows MOVE to T — an image row's as `image-gen`, a managed
 *    row's keeping their modality; a model T already has maps to T's row
 *    instead.
 * 2. Every foreign key into `connections.id` is repointed S → T, and every
 *    foreign key into `connection_models.id` is repointed for the mapped
 *    duplicates. Found by introspecting the schema, so a column added later
 *    is folded without an edit here.
 * 3. Every pipeline Connection slot naming S (`pipeline_config_values` rows
 *    with `slot = 'connection'`, stored in any legacy spelling) is rewritten
 *    to name T and the mapped model.
 * 4. S's image settings (`extraJson.profile`) are kept when T has none.
 * 5. S is deleted — by now nothing points at it.
 *
 * With no managed endpoint yet, the first image row is RENAMED into one in
 * place, which keeps every reference by construction.
 *
 * ⚠ If a fold fails, the transaction rolls back and that row is left as a
 * managed row of its own (an image row renamed in place): two managed rows is
 * untidy, a lost reference is data loss.
 *
 * Idempotent: a settled install has one managed row and does nothing.
 */

import { and, eq, getTableColumns, inArray, is } from "drizzle-orm"
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	connectionSlotValue,
	slotConnectionId,
	slotModelId
} from "$lib/shared/connections/slotRef"

export interface FoldResult {
	/** Rows folded into the managed endpoint. */
	folded: number
	/** Image rows renamed in place (no endpoint yet, or a fold that failed). */
	renamed: number
}

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
			if (ref.foreignTable !== target || ref.columns.length !== 1) continue
			const column = ref.columns[0]
			const key = Object.keys(columns).find(
				(k) => columns[k].name === column.name
			)
			if (key) out.push({ table, key, column })
		}
	}
	return out
}

/** S becomes a managed endpoint where it stands; its models are image models. */
async function renameInPlace(db: Db | Tx, id: number): Promise<void> {
	await db
		.update(schema.connections)
		.set({ type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, modality: "text-gen" })
		.where(eq(schema.connections.id, id))
	await db
		.update(schema.connectionModels)
		.set({ modality: "image-gen" })
		.where(eq(schema.connectionModels.connectionId, id))
}

async function foldOne(
	tx: Tx,
	source: typeof schema.connections.$inferSelect,
	target: typeof schema.connections.$inferSelect
): Promise<void> {
	// An image row's models are image models; a managed row's say for
	// themselves (and the next sync fills in any that do not).
	const movedModality =
		source.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
			? { modality: "image-gen" }
			: {}
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
			.set({ connectionId: target.id, ...movedModality })
			.where(eq(schema.connectionModels.id, m.id))
		mapped.set(m.id, m.id)
	}

	// 2. Foreign keys. A script attached to both would break the pair's
	// uniqueness when repointed, and the target already has it.
	const targetScripts = await tx
		.select({ scriptId: schema.connectionScripts.scriptId })
		.from(schema.connectionScripts)
		.where(eq(schema.connectionScripts.connectionId, target.id))
	if (targetScripts.length)
		await tx.delete(schema.connectionScripts).where(
			and(
				eq(schema.connectionScripts.connectionId, source.id),
				inArray(
					schema.connectionScripts.scriptId,
					targetScripts.map((s) => s.scriptId)
				)
			)
		)
	for (const { table, key, column } of referencesTo(schema.connections)) {
		// Its rows were moved above; the duplicates go with the source row.
		if (table === schema.connectionModels) continue
		await tx
			.update(table)
			.set({ [key]: target.id })
			.where(eq(column, source.id))
	}
	for (const { table, key, column } of referencesTo(schema.connectionModels))
		for (const [from, to] of duplicates)
			await tx
				.update(table)
				.set({ [key]: to })
				.where(eq(column, from))

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

	// 4. Image settings.
	const sourceProfile = (source.extraJson as Record<string, unknown> | null)
		?.profile
	const targetExtra = (target.extraJson ?? {}) as Record<string, unknown>
	if (sourceProfile && targetExtra.profile == null)
		await tx
			.update(schema.connections)
			.set({ extraJson: { ...targetExtra, profile: sourceProfile } })
			.where(eq(schema.connections.id, target.id))

	// 5. Nothing points at it any more.
	await tx
		.delete(schema.connections)
		.where(eq(schema.connections.id, source.id))
}

export async function foldKoboldCppManagedImage(db: Db): Promise<FoldResult> {
	const rows = await db
		.select()
		.from(schema.connections)
		.where(
			inArray(schema.connections.type, [
				CONNECTION_TYPE.KOBOLDCPP_MANAGED,
				CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
			])
		)
		.orderBy(schema.connections.id)
	const result: FoldResult = { folded: 0, renamed: 0 }

	let target = rows.find((r) => r.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED)
	for (const source of rows) {
		if (source.id === target?.id) continue
		if (!target) {
			// Only an image row can reach here: the first managed row IS the
			// target. It becomes the endpoint in place.
			await renameInPlace(db, source.id)
			result.renamed++
			target = { ...source, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED }
			continue
		}
		const into = target
		try {
			await db.transaction(async (tx) => foldOne(tx, source, into))
			result.folded++
		} catch (error) {
			console.error(
				`[connections] Could not fold managed KoboldCPP connection ${source.id} into ${into.id}; leaving it as its own row:`,
				error
			)
			if (source.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE) {
				await renameInPlace(db, source.id)
				result.renamed++
			}
		}
	}
	return result
}
