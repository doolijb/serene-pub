/**
 * The turn-order write (PLAN-turn-order §4.2, unit A4; R5): the ONE path
 * that stores `sessions.annex -> 'core' -> 'turnOrder'`
 * (a core runtime key, `coreAnnex.ts`). `core:outlet/set-turn-order@1`
 * (A6) calls it and nothing else does — §3's "one write path" invariant is
 * this function being the only writer of that key.
 *
 * ## The write rule
 *
 * One transaction: take the annex lock (`lockSessionAnnex`), read the stored `basedOnAt`, and
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
 * `update sessions set annex = …` as SQL (`coreAnnexSetSql`), never a
 * read-modify-write of the column through the ORM: the row's other
 * annex keys and owners are untouched by construction, `updated_at` does not move
 * (drizzle's `$onUpdate` never runs), and no `sessions:update` handler is
 * on the path — so the recompute cannot re-trigger itself through
 * `session-updated` (§3, §6). The annex lock serialises the
 * check-and-set across callers; `withKeyedLock('turnOrder', sessionId, …)`
 * serialises whole recomputes above it (§4.2), so the lock here is the
 * floor, not the only guard.
 *
 * `annex` is a `jsonb` column: the value is written as one `jsonb` key
 * of the `core` owner's document.
 */

import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { coreAnnexIn, coreAnnexKeySql, coreAnnexSetSql, lockSessionAnnex } from "$lib/server/sessions/coreAnnex"
import { EMPTY_TURN_ORDER, readTurnOrder, type TurnOrderV1 } from "@serene-pub/sdk"

/**
 * 🚧 The session's stored turn order (pr-6s2 §G-1): `readTurnOrder` of where
 * it is kept, `EMPTY_TURN_ORDER` for a session that is gone. The one read of
 * the stored order for a caller that holds no session row.
 */
export async function readStoredTurnOrder(db: Db, sessionId: number): Promise<TurnOrderV1> {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row ? readTurnOrder(coreAnnexIn(row.annex)) : EMPTY_TURN_ORDER
}

export async function writeTurnOrder(
	db: Db,
	sessionId: number,
	next: TurnOrderV1
): Promise<{ written: boolean; reason?: "stale" }> {
	return await db.transaction(async (tx) => {
		await lockSessionAnnex(tx, sessionId)
		const [row] = rawRows<{ based_on_at: string | null }>(
			await tx.execute(sql`
				select ${coreAnnexKeySql("turnOrder")} ->> 'basedOnAt' as based_on_at
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
				set ${sql.identifier("annex")} = ${coreAnnexSetSql("turnOrder", sql`${JSON.stringify(next)}::jsonb`)}
				where ${schema.sessions.id} = ${sessionId}
				returning ${schema.sessions.id} as id
			`)
		)
		return { written: written.length > 0 }
	})
}
