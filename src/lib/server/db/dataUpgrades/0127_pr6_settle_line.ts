/**
 * 0127 — **The mirror learns the forward stack** (pr-6 A4, ledger A4: "Mirror
 * `messages` has no rewind column; readers sub-select or forget"). The anchor
 * migration adds `messages.rewind_ordinal`; from here on the message store
 * writes it on every mirror (`mirrorRow`). A row Back took out before this
 * build carries its ordinal on `session_messages` alone, so it is copied
 * across once here — otherwise a reader of the mirror would take a rewound
 * row for a live one until the next write to it.
 *
 * The same migration adds the settle line (`sessions.settled_message_id`),
 * the archive flag (`sessions.archived_at`), the annex deltas, the lore
 * sources and `registrations.min_age`; none of them has content to carry —
 * NULL and empty are their honest starting state.
 */
import { sql } from "drizzle-orm"
import type { DataUpgradeContext } from "./index"

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	await tx.execute(sql`
		UPDATE messages m SET rewind_ordinal = sm.rewind_ordinal
		FROM session_messages sm
		WHERE sm.id = m.id AND sm.rewind_ordinal IS NOT NULL
	`)
}
