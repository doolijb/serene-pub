import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * Boot markers (★P9, owner 2026-11-13): one `system_settings.boot_markers`
 * key per one-off startup task, written after the task's first clean run. The
 * next boot finds the key and skips the task with one log line, instead of
 * re-reading the tables the task already settled.
 *
 * Deterministic and visible: a marker is a key and an ISO time, the skip says
 * so in the log, and **clearing a key re-runs its task on the next boot**
 * (`UPDATE system_settings SET boot_markers = boot_markers - 'dc-cairns'
 * WHERE id = 1`). A task that later learns new work must take a **new** key
 * (e.g. `dc-cairns@2`), never reuse the old one — the old key would skip it.
 *
 * Takes `db` as a parameter and imports no database, so a test hands it its
 * own handle.
 */

/** The `boot_markers` of the single `system_settings` row; `{}` with no row. */
export async function readBootMarkers(db: Db): Promise<Record<string, string>> {
	const [row] = await db
		.select({ bootMarkers: schema.systemSettings.bootMarkers })
		.from(schema.systemSettings)
		.where(sql`${schema.systemSettings.id} = 1`)
	return row?.bootMarkers ?? {}
}

/** Merges one key into the row in one statement — never read-modify-write. */
export async function writeBootMarker(
	db: Db,
	key: string,
	at: Date = new Date()
): Promise<void> {
	await db.execute(
		sql`UPDATE system_settings SET boot_markers = boot_markers || jsonb_build_object(${key}::text, ${at.toISOString()}::text) WHERE id = 1`
	)
}

/**
 * Runs `task.run` unless its marker is present. The marker is written only
 * when `run` returns; a throw propagates to the caller and writes nothing.
 */
export async function runWithBootMarker(
	db: Db,
	task: { name: string; doneMarker: string; run: () => Promise<void> }
): Promise<void> {
	const markers = await readBootMarkers(db)
	const when = markers[task.doneMarker]
	if (when !== undefined) {
		console.log(
			`[${task.name}] skipped: done ${when} (boot marker ${task.doneMarker})`
		)
		return
	}
	await task.run()
	await writeBootMarker(db, task.doneMarker)
}
