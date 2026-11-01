/**
 * 0135 — **Voicebank entries speak through a loadout** (voice loadouts,
 * 2026-10-29). The migration adds `voicebank_voices.loadout_id`; 0136 drops
 * `connection_model_id`. Between them, here, every row with no loadout gets one:
 *
 *   1. a `text->audio` loadout whose merge root's model equals the row's
 *      `connection_model_id` (lowest id wins when several match);
 *   2. else the `text->audio` default loadout;
 *   3. else the shipped Narration loadout, by seed key (`core:loadout/tts@1`).
 *
 * A row with no `connection_model_id` follows the same order from step 2. No
 * loadout at all leaves the row unassigned (null) — skipped at speak time.
 * A row that already has a loadout is left alone, so a second run does nothing.
 *
 * Raw SQL through `tx` only, no schema-typed tables and no ids written down.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

interface LoadoutRaw extends Record<string, unknown> {
	id: number
	seed_key: string | null
	merged_into: number | null
	connection_id: number | null
	connection_model_id: number | null
	is_default: boolean
}

/** Back-fill null `loadout_id`; the number of rows assigned. */
export async function backfillVoicebankLoadouts(tx: MigrationTx): Promise<number> {
	const voices = rawRows<{ id: number; connection_model_id: number | null }>(
		await tx.execute(
			sql`SELECT id, connection_model_id FROM voicebank_voices WHERE loadout_id IS NULL ORDER BY id`
		)
	)
	if (!voices.length) return 0
	const loadouts = rawRows<LoadoutRaw>(
		await tx.execute(sql`
			SELECT id, seed_key, merged_into, connection_id, connection_model_id,
				(default_for_input IS NOT NULL AND default_for_output IS NOT NULL) AS is_default
			FROM loadouts WHERE transform = 'text->audio' ORDER BY id
		`)
	)
	if (!loadouts.length) return 0
	const byId = new Map(loadouts.map((l) => [l.id, l]))
	const rootOf = (l: LoadoutRaw): LoadoutRaw => {
		const seen = new Set([l.id])
		let at = l
		while (at.merged_into != null) {
			const parent = byId.get(at.merged_into)
			if (!parent || seen.has(parent.id)) break
			seen.add(parent.id)
			at = parent
		}
		return at
	}
	const fallback =
		loadouts.find((l) => l.is_default) ??
		loadouts.find((l) => l.seed_key === "core:loadout/tts@1") ??
		null

	let assigned = 0
	for (const v of voices) {
		const matched =
			v.connection_model_id == null
				? undefined
				: loadouts.find(
						(l) => rootOf(l).connection_model_id === v.connection_model_id
					)
		const target = matched ?? fallback
		if (!target) continue
		await tx.execute(
			sql`UPDATE voicebank_voices SET loadout_id = ${target.id} WHERE id = ${v.id}`
		)
		assigned++
	}
	return assigned
}

export async function run(tx: MigrationTx): Promise<void> {
	await backfillVoicebankLoadouts(tx)
}
