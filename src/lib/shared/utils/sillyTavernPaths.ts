/**
 * Pure helpers for locating a SillyTavern "data" root within an arbitrary
 * list of relative file paths — used by both the client (to decide which
 * files from a picked folder are worth uploading) and the server (as a
 * defense-in-depth re-check of a staged upload).
 *
 * A SillyTavern data root is identified by the presence of one of its
 * landmark subdirectories (characters/sessions/groups/worlds) or settings.json,
 * rather than by a specific parent folder name — this way it doesn't matter
 * whether the user picked the SillyTavern root, a SillyTavern-Launcher root,
 * a "data" or "data/default-user" folder, or renamed any of those.
 */

const LANDMARK_DIRS = ["characters", "sessions", "groups", "worlds"]

function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/^\/+/, "")
}

/**
 * Returns the relative-path prefix (no trailing slash, "" if the picked
 * folder IS the data root) that should be treated as the SillyTavern data
 * directory, or null if nothing recognizable was found.
 */
export function resolveSillyTavernDataRoot(
	relativePaths: string[]
): string | null {
	const normalized = relativePaths.map(normalizePath)

	for (const landmark of LANDMARK_DIRS) {
		const marker = `/${landmark}/`
		for (const p of normalized) {
			if (p.startsWith(`${landmark}/`)) {
				return ""
			}
			const idx = p.indexOf(marker)
			if (idx !== -1) {
				return p.slice(0, idx)
			}
		}
	}

	// No landmark directory present — fall back to settings.json alone,
	// which covers persona-only backups.
	for (const p of normalized) {
		if (p === "settings.json") return ""
		if (p.endsWith("/settings.json")) {
			return p.slice(0, -"/settings.json".length)
		}
	}

	return null
}

/** Strip a resolved root prefix from a path, normalizing slashes. */
export function relativeToDataRoot(path: string, root: string): string {
	const normalized = normalizePath(path)
	if (!root) return normalized
	const prefix = `${root}/`
	return normalized.startsWith(prefix)
		? normalized.slice(prefix.length)
		: normalized
}

/**
 * Subpaths (relative to the resolved data root) that are actually relevant
 * to a SillyTavern import — everything else (extensions/, backgrounds/,
 * assets/, caches, etc.) is skipped so we don't upload gigabytes of
 * unrelated data.
 */
export function isRelevantImportPath(relativePath: string): boolean {
	const p = normalizePath(relativePath)
	return (
		p === "settings.json" ||
		p.startsWith("characters/") ||
		p.startsWith("sessions/") ||
		p.startsWith("groups/") ||
		p.startsWith("group sessions/") ||
		p.startsWith("worlds/") ||
		p.startsWith("User Avatars/")
	)
}
