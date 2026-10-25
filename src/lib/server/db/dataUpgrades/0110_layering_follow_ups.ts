/**
 * 0110 — **The layering follow-ups** (R50, R54, R55; lane F1, 2026-10-21).
 * Shape is drizzle's (`pipeline_specs.instance_values`, `pipeline_prompts.hidden`);
 * this moves what the last configuration reads and Story's removed setting said:
 *
 * | from | to |
 * |---|---|
 * | the configuration the pub selected for a pipeline (`pipeline_config_selections`, scope `pub`, not the shipped one) | that pipeline's **instance values** (`pipeline_specs.instance_values`) — read under the genre layer (R50). A pipeline a genre registers had the same values carried into the genre's defaults by 0108; they agree, and the genre's win where both speak |
 * | a configuration a **session** selected for a pipeline it does not register | not carried, logged — a summary, a portrait or a likeness has no session layer (R50) |
 * | Story's `applyActionChanges` in a session's `genre_fields` or a preset's `settings` | removed — Rest follows the reckoning routine's mode (R55) |
 *
 * After this nothing reads `pipeline_configs`, `pipeline_config_values` or
 * `pipeline_config_selections` at run time; the tables stay for the RC1
 * squash. Raw SQL through `tx`; idempotent — a pipeline whose instance values
 * are already set is left alone, a removed key stays removed.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import type { DataUpgradeContext } from "./index"
import { valuesOfConfigRows } from "$lib/server/pipelines/registrations/rows"

/** What the upgrade did — for the log and the test. */
export interface FollowUpsUpgradeReport {
	instanceValues: number
	notCarried: string[]
	applyActionChangesRemoved: number
}

export async function run(tx: MigrationTx, ctx: DataUpgradeContext): Promise<void> {
	await followUpsUpgrade(tx, ctx)
}

/** The upgrade, with what it did — `run` for the runner, this for the test and the attic's finish. */
export async function followUpsUpgrade(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<FollowUpsUpgradeReport> {
	const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> =>
		rawRows<T>(await tx.execute(sql.raw(s)))
	const report: FollowUpsUpgradeReport = { instanceValues: 0, notCarried: [], applyActionChangesRemoved: 0 }

	// ── The pub's configuration → the pipeline's instance values (R50) ────
	const selections = await rows<{
		scope_kind: string
		scope_id: number | null
		config_id: number | null
		spec_id: number
		slug: string
		seed_key: string | null
		instance_values: unknown
	}>(
		`SELECT sel.scope_kind, sel.scope_id, sel.config_id, sel.spec_id, s.slug, c.seed_key, s.instance_values
		 FROM pipeline_config_selections sel
		 JOIN pipeline_specs s ON s.id = sel.spec_id
		 LEFT JOIN pipeline_configs c ON c.id = sel.config_id
		 ORDER BY sel.id`
	)
	for (const sel of selections) {
		if (sel.config_id == null) continue
		// The shipped configuration IS the declared defaults: nothing new to carry.
		if (sel.seed_key === `pipeline-default:${sel.slug}`) continue
		if (sel.scope_kind === "session") {
			// 0108 carried it into the session's registration when the session
			// registers the pipeline; either way nothing reads it any more.
			report.notCarried.push(`session #${sel.scope_id} configuration #${sel.config_id} of ${sel.slug} (unread)`)
			continue
		}
		if (sel.scope_kind !== "pub") continue
		if (sel.instance_values != null) continue
		const values = valuesOfConfigRows(
			(
				await rows<{ node_key: string; slot: string; path: string | null; value: unknown }>(
					`SELECT node_key, slot, path, value FROM pipeline_config_values WHERE config_id = ${Number(sel.config_id)} ORDER BY id`
				)
			).map((r) => ({ nodeKey: r.node_key, slot: r.slot, path: r.path, value: r.value }))
		)
		if (!values || !Object.keys(values).length) continue
		await tx.execute(
			sql`UPDATE pipeline_specs SET instance_values = ${JSON.stringify(values)}::json
				WHERE id = ${sel.spec_id} AND instance_values IS NULL`
		)
		report.instanceValues++
	}

	// ── Story's `applyActionChanges` removed (R55) ──────────────────────────
	const sessions = rawRows<{ id: number }>(
		await tx.execute(sql`UPDATE sessions SET genre_fields = (genre_fields::jsonb - 'applyActionChanges')::json
			WHERE jsonb_typeof(genre_fields::jsonb) = 'object' AND genre_fields::jsonb ? 'applyActionChanges'
			RETURNING id`)
	)
	const presets = rawRows<{ id: number }>(
		await tx.execute(sql`UPDATE session_presets SET settings = (settings::jsonb - 'applyActionChanges')::json
			WHERE jsonb_typeof(settings::jsonb) = 'object' AND settings::jsonb ? 'applyActionChanges'
			RETURNING id`)
	)
	report.applyActionChangesRemoved = sessions.length + presets.length

	console.log(
		`[data-upgrade 0110] ${report.instanceValues} pipeline(s) took the pub's configuration as instance values; ` +
			`applyActionChanges removed from ${report.applyActionChangesRemoved} row(s)` +
			(report.notCarried.length ? `; not carried: ${report.notCarried.join("; ")}` : "")
	)
	return report
}
