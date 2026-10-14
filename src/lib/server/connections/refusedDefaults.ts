/**
 * The capability defaults whose registered pair cannot do its job.
 *
 * A default is judged when it is set (`starRefusal`), but the pair can change
 * underneath it afterwards: a sync replaces a model's modality with what the
 * service now says (`modelSync.ts`), and a person can switch a capability off
 * on the connection. The registration stays as it was — nothing clears or
 * moves a default on its own — and every run it names is refused by
 * `capabilityRefusal`. This answers which ones, so Admin → Defaults and the
 * Overview's **Needs you** can say so before a run does.
 *
 * Only the star's last check, the pair judgement. A model switched off or
 * missing from its host's listing is its own fault with its own sentence
 * ("Model gone", "not listed"), and a pair naming no model is no pair; those
 * are skipped here rather than reported twice.
 */

import { inArray } from "drizzle-orm"
import type { CapabilityId } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import type { CapabilityDefault } from "./capabilityDefaults"
import { mergeEndpointModel } from "./models"

export interface RefusedDefault {
	/** The transform id, e.g. `text->embedding`. */
	capability: string
	connectionId: number
	connectionName: string
	connectionModelId: number
	/** The model's display name. */
	modelName: string
	/** `capabilityRefusal`'s sentence for the pair. */
	refusal: string
}

/** Pure: the judgement over rows already read. */
export function refusedDefaults(
	defaults: Record<string, CapabilityDefault>,
	connections: readonly SelectConnection[],
	models: readonly SelectConnectionModel[]
): RefusedDefault[] {
	const out: RefusedDefault[] = []
	for (const [capability, d] of Object.entries(defaults)) {
		if (d.connectionId == null || d.connectionModelId == null) continue
		const endpoint = connections.find((c) => c.id === d.connectionId)
		const model = models.find(
			(m) =>
				m.id === d.connectionModelId &&
				m.connectionId === d.connectionId
		)
		if (!endpoint || !model || !model.enabled || model.missingSince)
			continue
		const refusal = capabilityRefusal(
			mergeEndpointModel(endpoint, model) as any,
			capability as CapabilityId
		)
		if (!refusal) continue
		out.push({
			capability,
			connectionId: endpoint.id,
			connectionName: endpoint.name,
			connectionModelId: model.id,
			modelName: model.name,
			refusal
		})
	}
	return out
}

/** The same, reading only the rows the defaults name. */
export async function readRefusedDefaults(
	db: Db,
	defaults: Record<string, CapabilityDefault>
): Promise<RefusedDefault[]> {
	const connectionIds = new Set<number>()
	const modelIds = new Set<number>()
	for (const d of Object.values(defaults)) {
		if (d.connectionId == null || d.connectionModelId == null) continue
		connectionIds.add(d.connectionId)
		modelIds.add(d.connectionModelId)
	}
	if (!modelIds.size) return []
	const connections = await db
		.select()
		.from(schema.connections)
		.where(inArray(schema.connections.id, [...connectionIds]))
	const models = await db
		.select()
		.from(schema.connectionModels)
		.where(inArray(schema.connectionModels.id, [...modelIds]))
	return refusedDefaults(defaults, connections, models)
}
