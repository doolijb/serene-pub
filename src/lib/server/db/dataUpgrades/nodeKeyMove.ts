/**
 * 🚧 **One pipeline's stored node keys, moved** — the SQL two data upgrades
 * share: 0120 sent Story's reply steps into its `reply.prose` branch
 * (PLAN-rulesets-functions D7), and 0123 brings its save, sprite steps and
 * commit back out to one tail after the junction (RF fix 3, 2026-10-23).
 *
 * Everything stored by node key for that pipeline moves, one old key to one
 * new: the session's and the pub's overrides (`pipeline_node_overrides`), a
 * node's rebind (`pipeline_node_rebinds`), a config's values and notices
 * (`pipeline_config_values`, `pipeline_config_notices`) and a registration's
 * values (`registrations.values`, keyed by node). Where the new address
 * already holds a row, that row stands and the old one goes. Another
 * pipeline's rows (a fork has node keys of its own), a run's history and an
 * author preset's version rows are left as they are. Never two old keys onto
 * one new: a table is a rename, not a merge.
 *
 * Raw SQL through `tx`; idempotent — a second run finds no old key.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

/** What a move did, table by table — for the log and the test. */
export interface NodeKeyMoveReport {
	overrides: number
	rebinds: number
	configValues: number
	notices: number
	registrations: number
	/** Old rows dropped because the new address already held one. */
	dropped: number
}

const count = (res: unknown): number => {
	const n = (res as { affectedRows?: unknown; rowCount?: unknown } | null)?.affectedRows ?? (res as { rowCount?: unknown } | null)?.rowCount
	return typeof n === "number" ? n : 0
}

/** Move `specSlug`'s stored rows from each old node key in `keys` to its new one. */
export async function moveNodeKeys(
	tx: MigrationTx,
	specSlug: string,
	keys: Readonly<Record<string, string>>
): Promise<NodeKeyMoveReport> {
	const targets = Object.values(keys)
	if (new Set(targets).size !== targets.length) throw new Error(`moveNodeKeys: two old keys onto one new for ${specSlug}`)
	const report: NodeKeyMoveReport = { overrides: 0, rebinds: 0, configValues: 0, notices: 0, registrations: 0, dropped: 0 }
	const [spec] = rawRows<{ id: number }>(await tx.execute(sql`SELECT id FROM pipeline_specs WHERE slug = ${specSlug} LIMIT 1`))
	for (const [from, to] of Object.entries(keys)) {
		if (spec) {
			// Overrides: the new address wins where it is held.
			report.dropped += count(
				await tx.execute(sql`DELETE FROM pipeline_node_overrides o WHERE o.spec_id = ${spec.id} AND o.node_key = ${from}
					AND EXISTS (SELECT 1 FROM pipeline_node_overrides n WHERE n.spec_id = o.spec_id AND n.scope_kind = o.scope_kind
						AND n.scope_id = o.scope_id AND n.node_key = ${to} AND n.slot = o.slot AND n.path = o.path)`)
			)
			report.overrides += count(
				await tx.execute(sql`UPDATE pipeline_node_overrides SET node_key = ${to} WHERE spec_id = ${spec.id} AND node_key = ${from}`)
			)
			report.dropped += count(
				await tx.execute(sql`DELETE FROM pipeline_node_rebinds o WHERE o.spec_id = ${spec.id} AND o.node_key = ${from}
					AND EXISTS (SELECT 1 FROM pipeline_node_rebinds n WHERE n.spec_id = o.spec_id AND n.scope_kind = o.scope_kind
						AND n.scope_id = o.scope_id AND n.node_key = ${to})`)
			)
			report.rebinds += count(
				await tx.execute(sql`UPDATE pipeline_node_rebinds SET node_key = ${to} WHERE spec_id = ${spec.id} AND node_key = ${from}`)
			)
			report.dropped += count(
				await tx.execute(sql`DELETE FROM pipeline_config_values o WHERE o.node_key = ${from}
					AND o.config_id IN (SELECT id FROM pipeline_configs WHERE spec_id = ${spec.id})
					AND EXISTS (SELECT 1 FROM pipeline_config_values n WHERE n.config_id = o.config_id AND n.node_key = ${to}
						AND n.slot = o.slot AND n.path = o.path)`)
			)
			report.configValues += count(
				await tx.execute(sql`UPDATE pipeline_config_values SET node_key = ${to} WHERE node_key = ${from}
					AND config_id IN (SELECT id FROM pipeline_configs WHERE spec_id = ${spec.id})`)
			)
			report.notices += count(
				await tx.execute(sql`UPDATE pipeline_config_notices SET node_key = ${to} WHERE node_key = ${from}
					AND config_id IN (SELECT id FROM pipeline_configs WHERE spec_id = ${spec.id})`)
			)
		}
	}
	// A registration's values, by node key — the pipeline's own registrations.
	const regs = rawRows<{ id: number; values: unknown }>(
		await tx.execute(sql`SELECT id, "values" FROM registrations WHERE spec_slug = ${specSlug} AND "values" IS NOT NULL ORDER BY id`)
	)
	for (const r of regs) {
		const values = (typeof r.values === "string" ? JSON.parse(r.values) : r.values) as Record<string, unknown> | null
		if (!values || typeof values !== "object" || Array.isArray(values)) continue
		if (!Object.keys(values).some((k) => k in keys)) continue
		const next: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(values)) {
			const to = keys[k]
			if (to === undefined) next[k] = v
			else if (!(to in values)) next[to] = v
			else report.dropped++
		}
		await tx.execute(sql`UPDATE registrations SET "values" = ${JSON.stringify(next)}::jsonb WHERE id = ${r.id}`)
		report.registrations++
	}
	return report
}
