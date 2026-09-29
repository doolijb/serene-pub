/**
 * The write half of a session's `playerLabel` override (lair re-plan R4):
 * `sessions.metadata.playerLabel`, the settings document's existing store for
 * core keys. The read half — and the cascade over the genre's label — is
 * `$lib/shared/sessions/playerLabel`.
 *
 * `jsonb_set` / `-` as SQL, like `writeTurnOrder`: the row's other metadata
 * keys (the turn order among them) are untouched by construction, however
 * stale the caller's copy of the row is. `metadata` is a `json` column, so
 * both sides are cast and the value goes back as `json`.
 */

import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { PLAYER_LABEL_METADATA_KEY } from "$lib/shared/sessions/playerLabel"

/**
 * Store (a non-blank label, trimmed) or clear (blank or null: the genre's
 * label applies again) the session's override. The caller decides whether the
 * session's genre declares a label at all; a stored value under a genre that
 * declares none is inert (`resolvePlayerLabel`).
 */
export async function writePlayerLabel(
	db: Db,
	sessionId: number,
	label: string | null
): Promise<void> {
	const value = label?.trim()
	if (value)
		await db.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("metadata")} = jsonb_set(
				coalesce(${schema.sessions.metadata}, '{}')::jsonb,
				${`{${PLAYER_LABEL_METADATA_KEY}}`}::text[],
				${JSON.stringify(value)}::jsonb,
				true
			)::json
			where ${schema.sessions.id} = ${sessionId}
		`)
	else
		await db.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("metadata")} = (
				coalesce(${schema.sessions.metadata}, '{}')::jsonb - ${PLAYER_LABEL_METADATA_KEY}::text
			)::json
			where ${schema.sessions.id} = ${sessionId}
		`)
}
