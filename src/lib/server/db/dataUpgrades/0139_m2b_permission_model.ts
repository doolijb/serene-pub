/**
 * 0139 — **Annex document versions become a column** (M2b, a8 ruling
 * 2026-10-31). For a day (M2a a8) each owner's session annex document
 * version was core's runtime key `annexVersions` (`annex.core.annexVersions`,
 * `{ owner: count }`); the migration adds `sessions.annex_versions`, and here
 * every stored map moves there — merged under any count the column already
 * holds (the larger wins) — and the key leaves core's document. A second run
 * finds no key and changes nothing.
 *
 * The migration's other parts (ruleset_versions, user_annexes,
 * lorebooks.annex_versions, plugins.enabled_by) need no content moved:
 * a lorebook's versions start at 0, and the boot backfills ruleset versions.
 *
 * Raw SQL through `tx` only; no ids written down.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

/** Move every `annex.core.annexVersions` into `annex_versions`; the number of sessions moved. */
export async function moveAnnexVersionsToColumn(tx: MigrationTx): Promise<number> {
	const moved = rawRows<{ id: number }>(
		await tx.execute(sql`
			UPDATE sessions
			SET annex_versions = (
				SELECT coalesce(jsonb_object_agg(k, greatest(
					CASE WHEN jsonb_typeof(old.v) = 'number' THEN floor((old.v)::text::numeric)::bigint ELSE 0 END,
					CASE WHEN jsonb_typeof(sessions.annex_versions -> k) = 'number' THEN floor((sessions.annex_versions ->> k)::numeric)::bigint ELSE 0 END
				)), '{}'::jsonb)
				FROM jsonb_each(sessions.annex -> 'core' -> 'annexVersions') AS old(k, v)
			) || (
				SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
				FROM jsonb_each(CASE WHEN jsonb_typeof(sessions.annex_versions) = 'object' THEN sessions.annex_versions ELSE '{}'::jsonb END) AS kept(k, v)
				WHERE NOT (sessions.annex -> 'core' -> 'annexVersions') ? k
			),
			annex = sessions.annex #- '{core,annexVersions}'
			WHERE jsonb_typeof(sessions.annex -> 'core' -> 'annexVersions') = 'object'
			RETURNING id
		`)
	)
	return moved.length
}

export async function run(tx: MigrationTx): Promise<void> {
	await moveAnnexVersionsToColumn(tx)
}
