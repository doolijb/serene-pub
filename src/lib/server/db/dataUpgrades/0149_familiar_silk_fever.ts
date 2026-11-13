/**
 * 0149 — **Show advanced controls** (owner 2026-11-10, ★B). The migration adds
 * `user_settings.show_advanced_controls` (false). People who had *Show all
 * character fields* on were already asking for the full forms; they keep them
 * by getting advanced controls on, so nothing they could see goes away.
 *
 * Only rows still off, so a second run finds none and changes nothing. Raw SQL
 * through `tx` only; no ids written down.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

export async function run(tx: MigrationTx): Promise<void> {
	const carried = rawRows<{ id: number }>(
		await tx.execute(sql`
			UPDATE user_settings
			SET show_advanced_controls = true
			WHERE show_all_character_fields = true
			  AND show_advanced_controls = false
			RETURNING id
		`)
	)
	if (carried.length)
		console.log(
			`[upgrade 0149] turned advanced controls on for ${carried.length} user(s) who had all character fields shown`
		)
}
