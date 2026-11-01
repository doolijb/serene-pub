/**
 * 🚧 **Annex document versions** (M2a a8; a column since M2b, ruled 2026-10-31):
 * a count per owner, 0 before the first write, moved by every write that changes
 * that owner's document. Kept beside the annex it counts — `sessions.annex_versions`
 * for the session annex, `lorebooks.annex_versions` for the lorebook annex — as
 * `{ "<owner>": <count> }`. `set-session-annex` / `set-lorebook-annex` take a
 * `base` and compare it against the stored count under the annex's lock; the
 * annex reads give it as `version`.
 *
 * ⚠ Not the **owner version** (`ownerVersionOf`: the writing package's semver an
 * annex delta carries), not a message **revision**.
 *
 * A leaf module: drizzle only.
 */

import { sql, type AnyColumn, type SQL } from "drizzle-orm"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** One owner's annex document version out of an `annex_versions` value already read; 0 when absent or not a count. Pure. */
export function annexVersionOf(versions: unknown, owner: string): number {
	if (!isPlainObject(versions)) return 0
	const n = versions[owner]
	return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0
}

/**
 * SQL (jsonb): the `annex_versions` column given with `owner`'s count one
 * higher — for `set annex_versions = ${bumpedAnnexVersionsSql(col, owner)}`,
 * in the statement (or the transaction, under the annex's lock) that wrote
 * that owner's document. A stored value that is not a count restarts from 0.
 */
export function bumpedAnnexVersionsSql(column: AnyColumn, owner: string): SQL {
	const held = sql`(CASE WHEN jsonb_typeof(${column}) = 'object' THEN ${column} ELSE '{}'::jsonb END)`
	const count = sql`(CASE WHEN jsonb_typeof(${held} -> ${owner}::text) = 'number' THEN floor((${held} ->> ${owner}::text)::numeric)::bigint ELSE 0 END)`
	return sql`(${held} || jsonb_build_object(${owner}::text, ${count} + 1))`
}
