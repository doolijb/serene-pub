/**
 * The pipeline config values that name one model, each with the job its step
 * asks of that model.
 *
 * A config value at a connection slot names a PAIR (`shared/connections/
 * slotRef.ts`); the model half is what this reads. A value naming only the
 * endpoint names no model and is not listed.
 *
 * The job is the one capability the run judges that slot by (`capabilityOfSlot`
 * — the transform the slot requires, else its shape's), read off the spec's
 * ACTIVE version's declarations. So a value the run never reads is never
 * listed: an address the active version does not declare (the reconciler culls
 * it), and a held connection slot (`isHeldConnectionSlot`, which `declarations`
 * leaves out because the run drops a stored pick there).
 *
 * Read-only. Configs are keyed on the spec, never a version, so every config of
 * a spec is judged against the one version a run would load.
 */

import { asc, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { slotConnectionId, slotModelId } from "$lib/shared/connections/slotRef"
import { capabilityOfSlot } from "$lib/server/pipelines/config/panel/provenance"
import type { Decl } from "$lib/server/pipelines/config/panel"

export interface ConfigValueNamingModel {
	configId: number
	/** The config's own name, as Pipelines shows it. */
	configName: string
	specId: number
	nodeKey: string
	slot: string
	/** The capability that step's connection slot is judged by. */
	capability: string
}

export async function configValuesNamingModel(
	db: Db,
	connectionId: number,
	modelId: number
): Promise<ConfigValueNamingModel[]> {
	// Narrowed in SQL by the model half's key, which only the object form of a
	// slot value carries; `->>` answers NULL for every other JSON shape, and
	// reads a number and a numeric string alike. The readers below still decide.
	const rows = await db
		.select({
			configId: schema.pipelineConfigValues.configId,
			nodeKey: schema.pipelineConfigValues.nodeKey,
			slot: schema.pipelineConfigValues.slot,
			path: schema.pipelineConfigValues.path,
			value: schema.pipelineConfigValues.value,
			configName: schema.pipelineConfigs.name,
			specId: schema.pipelineConfigs.specId,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			pluginEnabled: schema.plugins.enabled
		})
		.from(schema.pipelineConfigValues)
		.innerJoin(
			schema.pipelineConfigs,
			eq(schema.pipelineConfigs.id, schema.pipelineConfigValues.configId)
		)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
		)
		.leftJoin(
			schema.plugins,
			eq(schema.plugins.id, schema.pipelineSpecs.sourcePluginId)
		)
		.where(
			sql`${schema.pipelineConfigValues.value}->>'modelId' = ${String(modelId)}`
		)
		.orderBy(
			asc(schema.pipelineConfigValues.configId),
			asc(schema.pipelineConfigValues.id)
		)
	// A switched-off plugin's pipelines run nowhere and are out of reach in
	// Pipelines, so their configurations do not hold a model's modality back;
	// a run after the plugin is switched on meets the run's own refusal. A
	// disabled CONFIGURATION still counts: sessions already on it run on it.
	const named = rows.filter(
		(r) =>
			r.pluginEnabled !== false &&
			r.activeVersionId != null &&
			slotConnectionId(r.value) === connectionId &&
			slotModelId(r.value) === modelId
	)
	if (!named.length) return []

	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const declsByVersion = new Map<number, Decl[]>()
	const out: ConfigValueNamingModel[] = []
	for (const r of named) {
		const versionId = r.activeVersionId!
		let decls = declsByVersion.get(versionId)
		if (!decls) {
			decls = await declarations(db, versionId)
			declsByVersion.set(versionId, decls)
		}
		const d = decls.find(
			(x) =>
				x.control === "connection-ref" &&
				x.nodeKey === r.nodeKey &&
				x.slot === r.slot &&
				x.path === (r.path ?? "")
		)
		const capability = d ? capabilityOfSlot(d) : undefined
		if (!capability) continue
		out.push({
			configId: r.configId,
			configName: r.configName,
			specId: r.specId,
			nodeKey: r.nodeKey,
			slot: r.slot,
			capability
		})
	}
	return out
}
