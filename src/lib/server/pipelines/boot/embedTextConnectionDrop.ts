/**
 * ⏳ **`embed-text`'s connection setting is removed quietly** (plan
 * PLAN-embeddings-ner-connections D-c, ruled 2026-10-05).
 *
 * A pipeline never chooses its embedding connection — the install has one
 * active per modality — so the value had no reader. The node declares no such
 * slot, so the configs reconcile would cull any stored value with a "culled"
 * notice: a notice about losing a setting that never had an effect. Owner: "As long as the pipeline and configs update smoothly." So
 * those values are removed here first, with no notice.
 *
 * What goes: named-config values in slot `connection` on a node that the
 * spec's ACTIVE version places as `core:oracle/embed-text`. It runs before the
 * catalog seed publishes the new versions, while the active version still
 * places the old nodes. Nothing else is touched.
 *
 * Idempotent: a second boot finds nothing. Delete this module once a release
 * has shipped it.
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export const EMBED_TEXT_DEFINITION_ID = "core:oracle/embed-text"

/** Removes the values; returns how many went. */
export async function dropEmbedTextConnectionValues(db: Db): Promise<number> {
	const rows = await db
		.select({ id: schema.pipelineConfigValues.id })
		.from(schema.pipelineConfigValues)
		.innerJoin(
			schema.pipelineConfigs,
			eq(schema.pipelineConfigs.id, schema.pipelineConfigValues.configId)
		)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
		)
		.innerJoin(
			schema.pipelineNodes,
			and(
				eq(
					schema.pipelineNodes.specVersionId,
					schema.pipelineSpecs.activeVersionId
				),
				eq(
					schema.pipelineNodes.nodeKey,
					schema.pipelineConfigValues.nodeKey
				)
			)
		)
		.where(
			and(
				eq(schema.pipelineConfigValues.slot, "connection"),
				eq(schema.pipelineNodes.definitionId, EMBED_TEXT_DEFINITION_ID)
			)
		)
	if (!rows.length) return 0
	await db.delete(schema.pipelineConfigValues).where(
		inArray(
			schema.pipelineConfigValues.id,
			rows.map((r) => r.id)
		)
	)
	return rows.length
}
