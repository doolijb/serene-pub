/**
 * 🚧 (M2b) Removing the per-person plugin files (`ctx.storage.user`).
 *
 * They live at `<dataDir>/extensions_user_data/<plugin segment>/<userId>/`
 * (`userStorageDir`), outside both the package folder and the pub-wide jail.
 * Two things end them: the account (every plugin's folder for that person) and
 * an uninstall that chooses to delete them (the plugin's whole folder).
 * Both are best-effort and never throw — a file that cannot be removed must
 * not undo the account deletion or the uninstall that already happened.
 */
import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import { storageSegment, userDataRoot, userStorageDir } from "./SandboxManager"

/** Remove every plugin's folder for one person. Returns the folders removed. */
export async function removeUserPluginFiles(
	dataDir: string,
	userId: number
): Promise<number> {
	let removed = 0
	let segments: string[]
	try {
		segments = await readdir(userDataRoot(dataDir))
	} catch {
		return 0
	}
	for (const seg of segments) {
		// The same builder every writer uses, so only a real person folder is
		// ever named; `seg` is a directory entry, so it carries no separator.
		const dir = userStorageDir(dataDir, seg, userId)
		if (!dir) continue
		try {
			await rm(dir, { recursive: true, force: true })
			removed++
		} catch (e) {
			console.warn(
				`[plugins] could not remove user ${userId}'s files for '${seg}':`,
				e
			)
		}
	}
	return removed
}

/** Remove one plugin's per-person files for everybody (uninstall → delete). */
export async function removePluginUserFiles(
	dataDir: string,
	pluginId: string
): Promise<void> {
	const dir = path.join(userDataRoot(dataDir), storageSegment(pluginId))
	try {
		await rm(dir, { recursive: true, force: true })
	} catch (e) {
		console.warn(`[plugins] could not remove '${pluginId}' user files:`, e)
	}
}
