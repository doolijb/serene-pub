/**
 * 🚧 **Core's runtime values** (ruled 2026-11-11: "The annex becomes purely the
 * modders' home … Ruleset decks follow Back; turn order and read marks do not.").
 *
 * The annex document `core` holds declared fields only (`retake-quietly`,
 * `story-goals`, …) — what a genre or a member set through the annex. Core's
 * own runtime values are not in it:
 *
 *  - four are nullable jsonb columns on `sessions`, one writer each:
 *    `turn_order` (`TurnOrderV1`, `writeTurnOrder`), `turn_tally`
 *    (`TurnTallyV1`, `writeLaneTally` / `writeTurnTally`), `lane_reads`
 *    (`{ "<userId>": { "<canonical lane>": <message id> } }`, `markLaneRead`)
 *    and `ruleset_decks` (`{ [methodKey]: DeckState }`, the ruleset
 *    resolver's `writeDecks`). Each write is raw SQL under the annex's one
 *    lock (`lockSessionAnnex`) inside its own transaction, so no annex delta,
 *    no `annex-changed`, and no `updated_at` move. None of the four is ever
 *    sent to a client;
 *  - `rulesetConversions` and `seatBenches` are `session_imprints` rows (kinds
 *    `ruleset-conversion` and `seat-bench`); the ruleset deck draws file
 *    `deck` imprints.
 *
 * (`annexVersions`, the annex document versions, is the column
 * `sessions.annex_versions`, `sessions/annexVersions.ts`.)
 *
 * A leaf module: drizzle and the schema only (annexChanges.ts imports this).
 */

import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The annex owner core keeps its own document under. */
export const CORE_ANNEX_OWNER = "core"

/** 🚧 The keys core's runtime values once held in the `core` document — the list the data upgrade and the readers of old snapshots strip. */
export const CORE_RUNTIME_KEYS = Object.freeze([
	"turnOrder",
	"turnTally",
	"laneReads",
	"rulesetDecks",
	"rulesetConversions",
	"seatBenches"
] as const)

export type CoreRuntimeKey = (typeof CORE_RUNTIME_KEYS)[number]

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** One session's `core` document (one indexed read of `sessions.annex`); null when the session is gone. */
export async function readCoreAnnex(db: Db, sessionId: number): Promise<Record<string, unknown> | null> {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	const annex = row.annex as unknown
	const doc = isPlainObject(annex) ? annex[CORE_ANNEX_OWNER] : undefined
	return isPlainObject(doc) ? doc : {}
}

/** The annex's one lock (`pg_advisory_xact_lock(hashtext('annex'), sessionId)`), inside the caller's transaction. */
export async function lockSessionAnnex(tx: Db, sessionId: number): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`)
}
