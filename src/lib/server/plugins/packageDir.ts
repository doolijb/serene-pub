/**
 * Where a plugin package's files live on disk (M0, SHAPES L2).
 *
 * Pure: no db, no schema, no data-dir lookup. The folder is returned RELATIVE
 * to the data dir, so a moved data dir keeps working; callers resolve it with
 * `getAppDataDir()`.
 */

/** A text file at or under this size stays in `plugin_files.content`; anything larger goes to disk. */
export const PLUGIN_FILE_DB_MAX_BYTES = 64 * 1024

const PLUGIN_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/

/** `plugins/<pluginId>/<version>`, relative to the data dir. */
export function pluginPackageDirOf(pluginId: string, version: string): string {
	if (!PLUGIN_ID.test(pluginId))
		throw new Error(`'${pluginId}' is not a plugin id, so it names no package folder.`)
	const v = String(version ?? "").replace(/[^0-9A-Za-z.+-]/g, "_")
	return `plugins/${pluginId}/${v || "0.0.0"}`
}
