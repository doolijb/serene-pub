/**
 * 0142 — **Scene names number at render** (★4b, owner 2026-11-04). The
 * migration adds `scenes.name_is_default` (false) and lets
 * `scenes.history_entry_id` be null (§0-B: a scene waits for its compile).
 * Here every stored name in the automatic shape — `Scene N`, alone or
 * followed by ` · ` (place, date) — is marked default, so its leading
 * `Scene N` is numbered by position from now on (`sceneDisplayNames`).
 *
 * ⚠ A person's own rename that happens to read `Scene 4 · …` is marked
 * default too: nothing stored tells the two apart (accepted, ★S-1).
 *
 * Only rows not already marked, so a second run finds none and changes
 * nothing. Raw SQL through `tx` only; no ids written down.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

export async function run(tx: MigrationTx): Promise<void> {
	const marked = rawRows<{ id: number }>(
		await tx.execute(sql`
			UPDATE scenes
			SET name_is_default = true
			WHERE name ~ '^Scene [0-9]+( · |$)'
			  AND name_is_default = false
			RETURNING id
		`)
	)
	if (marked.length) console.log(`[upgrade 0142] marked ${marked.length} scene name(s) as default`)
}
