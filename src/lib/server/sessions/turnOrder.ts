/**
 * The turn-order write (PLAN-turn-order §4.2, unit A4; R5): the ONE path
 * that stores `sessions.metadata.turnOrder`. `core:outlet/set-turn-order@1`
 * (A6) calls it and nothing else does — §3's "one write path" invariant is
 * this function being the only writer of that key.
 *
 * ## The write rule
 *
 * One transaction: take `pg_advisory_xact_lock(hashtext('turnOrder'),
 * sessionId)`, read the stored `basedOnAt`, and
 *
 *  - if the stored value is **greater** than `next.basedOnAt`, return
 *    `{ written: false, reason: 'stale' }` — an order answering an older
 *    event must never overwrite one answering a newer one, whichever run
 *    finished first (§3: a stale write is dropped and receipted; the
 *    receipting is the outlet's);
 *  - else `jsonb_set` the one key.
 *
 * Equal `basedOnAt` is not stale: two recomputes for the same instant let
 * the later one win, which is the same answer either way.
 *
 * ## Why raw SQL
 *
 * `update sessions set metadata = jsonb_set(…)` as SQL, never a
 * read-modify-write of the column through the ORM: the row's other
 * metadata keys are untouched by construction, `updated_at` does not move
 * (drizzle's `$onUpdate` never runs), and no `sessions:update` handler is
 * on the path — so the recompute cannot re-trigger itself through
 * `session-updated` (§3, §6). The advisory lock serialises the
 * check-and-set across callers; `withKeyedLock('turnOrder', sessionId, …)`
 * serialises whole recomputes above it (§4.2), so the lock here is the
 * floor, not the only guard.
 *
 * `metadata` is a `json` column, not `jsonb` (schema.ts): both sides are
 * cast, and the value is written back as `json` so the column's type is
 * what it was.
 */

import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import type { TurnOrderV1 } from "@serene-pub/sdk"

export async function writeTurnOrder(
	db: Db,
	sessionId: number,
	next: TurnOrderV1
): Promise<{ written: boolean; reason?: "stale" }> {
	return await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext('turnOrder'), ${sessionId})`
		)
		const [row] = rawRows<{ based_on_at: string | null }>(
			await tx.execute(sql`
				select ${schema.sessions.metadata}->'turnOrder'->>'basedOnAt' as based_on_at
				from ${schema.sessions}
				where ${schema.sessions.id} = ${sessionId}
			`)
		)
		// No row: nothing to write, and nothing newer either.
		if (!row) return { written: false }
		const stored = row.based_on_at === null ? NaN : Number(row.based_on_at)
		// A stored document with a numeric, newer `basedOnAt` wins. Anything
		// else stored — nothing, garbage, a document with no such key — is
		// overwritten: `readTurnOrder` treats it as empty, and so does this.
		if (Number.isFinite(stored) && stored > next.basedOnAt)
			return { written: false, reason: "stale" }
		const written = rawRows<{ id: number }>(
			await tx.execute(sql`
				update ${schema.sessions}
				set ${sql.identifier("metadata")} = jsonb_set(
					coalesce(${schema.sessions.metadata}, '{}')::jsonb,
					'{turnOrder}',
					${JSON.stringify(next)}::jsonb,
					true
				)::json
				where ${schema.sessions.id} = ${sessionId}
				returning ${schema.sessions.id} as id
			`)
		)
		return { written: written.length > 0 }
	})
}
