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
 * The generic fold (models, foreign keys, pipeline slots, delete) lives in
 * `connectionFold.ts`; this file keeps the two KoboldCPP-only parts: an image
 * row's models becoming `image-gen`, and the `extraJson.profile` carry-over.
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

import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { foldConnectionInto } from "$lib/server/connections/connectionFold"

export interface FoldResult {
	/** Rows folded into the managed endpoint. */
	folded: number
	/** Image rows renamed in place (no endpoint yet, or a fold that failed). */
	renamed: number
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

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
	if (source.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)
		await tx
			.update(schema.connectionModels)
			.set({ modality: "image-gen" })
			.where(eq(schema.connectionModels.connectionId, source.id))

	// Image settings (`extraJson.profile`) are kept when T has none. Written
	// before the generic fold so it reads S while S still exists.
	const sourceProfile = (source.extraJson as Record<string, unknown> | null)
		?.profile
	const targetExtra = (target.extraJson ?? {}) as Record<string, unknown>
	if (sourceProfile && targetExtra.profile == null)
		await tx
			.update(schema.connections)
			.set({ extraJson: { ...targetExtra, profile: sourceProfile } })
			.where(eq(schema.connections.id, target.id))

	await foldConnectionInto(tx, source, target)
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
