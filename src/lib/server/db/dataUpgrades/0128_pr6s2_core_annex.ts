/**
 * 0128 — **Core's runtime keys move onto annex owner `core`; the branch
 * marker onto its columns** (pr-6s2 C4, ruled 2026-10-24: "`sessions.metadata`
 * runtime keys → annex owner `core`; `branchOf` → a column"). The migration
 * adds `sessions.branch_of_session_id`, `branch_of_message_id` and
 * `branch_of_name`; from here on:
 *
 *  - `turnOrder`, `turnTally`, `laneReads` and `rulesetDecks` live in the
 *    `core` owner's annex document (`sessions.annex -> 'core'`, see
 *    `sessions/coreAnnex.ts`), written under the annex lock;
 *  - a branch's marker is the three columns, written by `branchSession`.
 *
 * A session made before this build holds all five in `metadata`. Here the
 * marker (only a well-formed one) is copied onto its columns, the four
 * runtime keys are merged into `annex.core` with their values verbatim (no
 * `jsonb_strip_nulls`: a turn order's `null` run id survives), and the five
 * keys leave `metadata` — `playerLabel`, `scenes` and the rest of the
 * settings stay. A second run finds nothing to move.
 *
 * `metadata` is a `json` column and `annex` a `jsonb` one: the settings are
 * cast to `jsonb` to be read and cast back to `json` once the keys are gone.
 * No `?` operator (driver placeholders).
 */
import { sql } from "drizzle-orm"
import type { DataUpgradeContext } from "./index"

/** The three statements, in order: marker to columns, keys into `annex.core`, keys out of `metadata`. */
export async function moveCoreRuntimeKeys(tx: MigrationTx): Promise<void> {
	await tx.execute(sql`
		UPDATE sessions SET
			branch_of_session_id = (metadata::jsonb -> 'branchOf' ->> 'sessionId')::int,
			branch_of_message_id = (metadata::jsonb -> 'branchOf' ->> 'messageId')::int,
			branch_of_name = metadata::jsonb -> 'branchOf' ->> 'name'
		WHERE jsonb_typeof(metadata::jsonb -> 'branchOf') = 'object'
			AND jsonb_typeof(metadata::jsonb -> 'branchOf' -> 'sessionId') = 'number'
			AND jsonb_typeof(metadata::jsonb -> 'branchOf' -> 'messageId') = 'number'
	`)
	await tx.execute(sql`
		UPDATE sessions s SET annex = jsonb_set(
			coalesce(s.annex, '{}'::jsonb), '{core}',
			(CASE WHEN jsonb_typeof(s.annex -> 'core') = 'object' THEN s.annex -> 'core' ELSE '{}'::jsonb END)
				|| (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(s.metadata::jsonb) e
					WHERE e.key IN ('turnOrder', 'turnTally', 'laneReads', 'rulesetDecks')),
			true)
		WHERE (s.metadata::jsonb -> 'turnOrder') IS NOT NULL OR (s.metadata::jsonb -> 'turnTally') IS NOT NULL
			OR (s.metadata::jsonb -> 'laneReads') IS NOT NULL OR (s.metadata::jsonb -> 'rulesetDecks') IS NOT NULL
	`)
	await tx.execute(sql`
		UPDATE sessions SET metadata = (metadata::jsonb - 'turnOrder' - 'turnTally' - 'laneReads' - 'rulesetDecks' - 'branchOf')::json
		WHERE (metadata::jsonb -> 'turnOrder') IS NOT NULL OR (metadata::jsonb -> 'turnTally') IS NOT NULL
			OR (metadata::jsonb -> 'laneReads') IS NOT NULL OR (metadata::jsonb -> 'rulesetDecks') IS NOT NULL
			OR (metadata::jsonb -> 'branchOf') IS NOT NULL
	`)
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	await moveCoreRuntimeKeys(tx)
}
