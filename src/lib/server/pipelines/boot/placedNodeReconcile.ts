/**
 * Which placed nodes this build cannot run, recorded as notices (plans/29
 * R-2, 2026-09-17).
 *
 * A stored spec version pins its nodes by slug in `pipeline_nodes`, and the
 * registry keeps a row for every slug ever published — marked `removed` when
 * the code stops publishing it, `provisional` when it is published with no
 * handler behind it. A node pinning either is one the executor will refuse
 * at the node, legibly, on the next run. That is enough for the run. It is
 * not enough for the person whose configuration the pipeline belongs to,
 * who has no reason to open a receipt and would otherwise find a pipeline
 * that stops mid-way with nothing on its own screen saying why.
 *
 * So this walks every published version at boot and records one notice per
 * such node on each of the spec's configurations — the same seam a cull
 * takes (`reconcileConfigs`, NOMENCLATURE §6 *cull → notice*), under its own
 * kind, `unbound`, because nothing was culled: no value is deleted, and the
 * node stays in the document for the person to bind or remove. Boot is the
 * moment the condition is created — an upgrade that culled the definition,
 * a flag that landed — and it never fails the boot: a notice that could not
 * be written is a screen that says less, a refused boot is a product that
 * does nothing.
 *
 * Idempotent: a configuration already carrying the notice for the same node
 * and version keeps its one row, acknowledged or not — a person who dismissed
 * it has been told. And a **condition, not news** (the rule
 * `reconcilePresetBindings` states for a stale binding): when the definition
 * is published and bound again, or the node is taken out, the notice is
 * deleted rather than left to be dismissed — a notice about a node that runs
 * would say the pipeline is broken while it is not.
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export interface PlacedNodeReconcileReport {
	/** Published versions examined. */
	versions: number
	/** `nodeKey@spec` pairs found pinning a removed or provisional definition. */
	unbound: string[]
	/** Notices written on this pass (one per configuration per node). */
	noticed: number
	/** Notices deleted because their node runs again, or is gone. */
	cleared: number
	/** What went wrong, per spec, without stopping the walk. */
	errors: string[]
}

/** The notice kind a placed node this build cannot run is recorded under. */
export const UNBOUND_NOTICE_KIND = "unbound"

export async function reconcilePlacedNodes(
	db: Db
): Promise<PlacedNodeReconcileReport> {
	const report: PlacedNodeReconcileReport = {
		versions: 0,
		unbound: [],
		noticed: 0,
		cleared: 0,
		errors: []
	}

	const unrunnable = new Map<string, "removed" | "provisional">()
	for (const r of await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			status: schema.pipelineDefinitionRegistry.status
		})
		.from(schema.pipelineDefinitionRegistry)
		.where(
			inArray(schema.pipelineDefinitionRegistry.status, [
				"removed",
				"provisional"
			])
		))
		unrunnable.set(
			`${r.definitionId}@${r.version}`,
			r.status as "removed" | "provisional"
		)

	const specs = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)

	for (const spec of specs) {
		if (spec.activeVersionId == null) continue
		report.versions++
		try {
			const nodes = await db
				.select({
					nodeKey: schema.pipelineNodes.nodeKey,
					definitionId: schema.pipelineNodes.definitionId,
					definitionVersion: schema.pipelineNodes.definitionVersion
				})
				.from(schema.pipelineNodes)
				.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
			const hits = nodes
				.map((n) => ({
					...n,
					pin: `${n.definitionId}@${n.definitionVersion}`,
					status: unrunnable.get(`${n.definitionId}@${n.definitionVersion}`)
				}))
				.filter((n) => n.status)

			const configs = await db
				.select({ id: schema.pipelineConfigs.id })
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
			if (!configs.length) continue

			// The healed half first: every `unbound` notice on this spec's
			// configurations that is not about a node still unrunnable in the
			// active version goes — the node runs again, was taken out, or
			// belongs to a version the spec has moved off.
			const still = new Set(hits.map((h) => h.nodeKey))
			const stale = (
				await db
					.select({
						id: schema.pipelineConfigNotices.id,
						nodeKey: schema.pipelineConfigNotices.nodeKey,
						specVersionId: schema.pipelineConfigNotices.specVersionId
					})
					.from(schema.pipelineConfigNotices)
					.where(
						and(
							inArray(
								schema.pipelineConfigNotices.configId,
								configs.map((c) => c.id)
							),
							eq(schema.pipelineConfigNotices.kind, UNBOUND_NOTICE_KIND)
						)
					)
			).filter(
				(n) => n.specVersionId !== spec.activeVersionId || !still.has(n.nodeKey)
			)
			if (stale.length) {
				await db.delete(schema.pipelineConfigNotices).where(
					inArray(
						schema.pipelineConfigNotices.id,
						stale.map((n) => n.id)
					)
				)
				report.cleared += stale.length
			}
			if (!hits.length) continue

			for (const hit of hits) {
				report.unbound.push(`${hit.nodeKey}@${spec.slug}`)
				for (const config of configs) {
					const [existing] = await db
						.select({ id: schema.pipelineConfigNotices.id })
						.from(schema.pipelineConfigNotices)
						.where(
							and(
								eq(schema.pipelineConfigNotices.configId, config.id),
								eq(schema.pipelineConfigNotices.kind, UNBOUND_NOTICE_KIND),
								eq(schema.pipelineConfigNotices.nodeKey, hit.nodeKey),
								eq(
									schema.pipelineConfigNotices.specVersionId,
									spec.activeVersionId
								)
							)
						)
						.limit(1)
					if (existing) continue
					await db.insert(schema.pipelineConfigNotices).values({
						configId: config.id,
						kind: UNBOUND_NOTICE_KIND,
						nodeKey: hit.nodeKey,
						// A node, not an address: no slot and no path.
						slot: "",
						path: "",
						label:
							`'${hit.nodeKey}' places ${hit.pin}, which this build does not run ` +
							`(${hit.status === "removed" ? "not published by this build" : "declared, not bound"})`,
						previousValue: {
							definitionId: hit.definitionId,
							version: hit.definitionVersion,
							status: hit.status
						},
						specVersionId: spec.activeVersionId
					})
					report.noticed++
				}
			}
		} catch (e) {
			report.errors.push(`${spec.slug}: ${(e as Error).message}`)
		}
	}
	return report
}
