/**
 * 0137 — **The voicebank stars become the loadout voice** (narration fallback,
 * 2026-10-30). The migration adds `loadouts.default_voice_id` and
 * `other_speakers_voice_id`; 0138 drops `voicebank_voices.is_default` and
 * `is_narration_default`. Between them, here, each star moves onto the loadout
 * its row speaks through, taken in this order: the `is_default` row, then the
 * `is_narration_default` row. For each, when its `loadout_id` is not null and
 * that loadout's `default_voice_id` is still null, the loadout's voice becomes
 * the row. Nothing else is touched, so a second run changes nothing.
 *
 * Raw SQL through `tx` only (schema.ts no longer has the star columns); no ids
 * written down.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

/** Move the stars onto their loadouts; the number of loadouts that gained a voice. */
export async function moveStarsToLoadoutVoices(tx: MigrationTx): Promise<number> {
	let moved = 0
	for (const star of ["is_default", "is_narration_default"] as const) {
		const starred = rawRows<{ id: number; loadout_id: number | null }>(
			await tx.execute(
				sql.raw(
					`SELECT id, loadout_id FROM voicebank_voices WHERE ${star} = true ORDER BY id LIMIT 1`
				)
			)
		)
		const row = starred[0]
		if (!row || row.loadout_id == null) continue
		const done = rawRows<{ id: number }>(
			await tx.execute(
				sql`UPDATE loadouts SET default_voice_id = ${row.id}
					WHERE id = ${row.loadout_id} AND default_voice_id IS NULL RETURNING id`
			)
		)
		moved += done.length
	}
	return moved
}

export async function run(tx: MigrationTx): Promise<void> {
	await moveStarsToLoadoutVoices(tx)
}
