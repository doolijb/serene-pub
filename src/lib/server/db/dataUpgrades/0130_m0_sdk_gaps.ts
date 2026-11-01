/**
 * 0130 — **Plugin files over 64 KB move to disk** (M0 P2, boot pass
 * `plugin-files-to-disk`). The migration adds `plugin_files.stored_at`,
 * `disk_path` and `kind`; from here on a package's large files live at
 * `<dataDir>/plugins/<id>/<version>/<path>` and the row keeps only a pointer.
 *
 * A pub upgraded from before this build holds every file as base64 in
 * `plugin_files.content`. Here each `db` row over `PLUGIN_FILE_DB_MAX_BYTES`
 * is decoded to its folder and flipped to `disk` (`content` NULL, `disk_path`
 * relative to the data dir). A row whose plugin id or path breaks the safe
 * grammar is left where it is. A second run finds nothing to move.
 *
 * Raw SQL through `tx` only, no schema-typed tables: this runs on a database
 * mid-upgrade, before the app's own queries are trustworthy.
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { rawRows } from "../rawRows"
import { PLUGIN_FILE_DB_MAX_BYTES, pluginPackageDirOf } from "$lib/server/plugins/packageDir"

const SAFE_PATH = /^[a-zA-Z0-9_\-][a-zA-Z0-9._\-]*(\/[a-zA-Z0-9._\-]+)*$/
const PLUGIN_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/

/** Move every over-size `db` row to disk under `dataDir`; the number of rows moved. */
export async function pluginFilesToDisk(tx: MigrationTx, dataDir: string): Promise<number> {
	const rows = rawRows<{
		id: number
		plugin_id: string
		path: string
		content: string
		version: string
	}>(
		await tx.execute(sql`
			SELECT pf.id, pf.plugin_id, pf.path, pf.content, coalesce(p.version, '0.0.0') AS version
			FROM plugin_files pf LEFT JOIN plugins p ON p.plugin_id = pf.plugin_id
			WHERE pf.stored_at = 'db' AND pf.bytes > ${PLUGIN_FILE_DB_MAX_BYTES} AND pf.content IS NOT NULL
		`)
	)
	let moved = 0
	for (const r of rows) {
		if (!PLUGIN_ID.test(r.plugin_id) || !SAFE_PATH.test(r.path) || r.path.split("/").includes("..")) continue
		const rel = `${pluginPackageDirOf(r.plugin_id, r.version)}/${r.path}`
		const abs = path.join(dataDir, rel)
		await mkdir(path.dirname(abs), { recursive: true })
		await writeFile(abs, Buffer.from(r.content, "base64"))
		await tx.execute(
			sql`UPDATE plugin_files SET stored_at = 'disk', disk_path = ${rel}, content = NULL WHERE id = ${r.id}`
		)
		moved++
	}
	return moved
}

export async function run(tx: MigrationTx): Promise<void> {
	await pluginFilesToDisk(tx, getAppDataDir())
}
