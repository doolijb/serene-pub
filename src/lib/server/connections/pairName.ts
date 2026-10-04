/**
 * A connection slot's value, as a person reads it: `Endpoint · Model`.
 *
 * The endpoint alone when the value names no model, and null when it names no
 * connection this instance still has. Reads every stored spelling through
 * `slotConnectionId` / `slotModelId`, so a bare id and a `{ref, modelId}` pair
 * name the same row.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	slotConnectionId,
	slotModelId
} from "$lib/shared/connections/slotRef"

export async function connectionPairName(
	db: Db,
	value: unknown
): Promise<string | null> {
	const connectionId = slotConnectionId(value)
	if (connectionId == null) return null
	return pairNameOf(db, connectionId, slotModelId(value))
}

/** The same sentence from the two ids, for a caller that holds them apart. */
export async function pairNameOf(
	db: Db,
	connectionId: number,
	modelId: number | null | undefined
): Promise<string | null> {
	const [connection] = await db
		.select({ name: schema.connections.name })
		.from(schema.connections)
		.where(eq(schema.connections.id, connectionId))
		.limit(1)
	if (!connection) return null
	if (modelId == null) return connection.name
	const [model] = await db
		.select({
			name: schema.connectionModels.name,
			connectionId: schema.connectionModels.connectionId
		})
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.id, modelId))
		.limit(1)
	return model && model.connectionId === connectionId
		? `${connection.name} · ${model.name}`
		: connection.name
}
