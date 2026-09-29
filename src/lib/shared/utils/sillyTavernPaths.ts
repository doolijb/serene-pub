/**
 * Pure helpers for locating a SillyTavern "data" root within an arbitrary
 * list of relative file paths — used by both the client (to decide which
 * files from a picked folder are worth uploading) and the server (as a
 * defense-in-depth re-check of a staged upload).
 *
 * A SillyTavern data root is identified by the presence of one of its
 * landmark subdirectories (characters/chats/groups/worlds) or settings.json,
 * rather than by a specific parent folder name — this way it doesn't matter
 * whether the user picked the SillyTavern root, a SillyTavern-Launcher root,
 * a "data" or "data/default-user" folder, or renamed any of those.
 */

/**
 * SillyTavern's OWN folder names under its data root — its vocabulary, not
 * ours (NOMENCLATURE R5). SillyTavern calls a conversation a *chat* and keeps
 * one per `.jsonl` under `chats/<character>/`; group conversations live under
 * `group chats/`. Serene Pub imports each one as a session, but the folders
 * are SillyTavern's and keep SillyTavern's names. A Serene Pub rename sweep
 * must never touch these: baf439d7 turned `chats/` into `sessions/` and the
 * importer silently found no history in any real SillyTavern folder.
 */
export const SILLYTAVERN_DIRS = {
	characters: "characters",
	chats: "chats",
	groups: "groups",
	groupChats: "group chats",
	worlds: "worlds",
	userAvatars: "User Avatars"
} as const

const LANDMARK_DIRS = [
	SILLYTAVERN_DIRS.characters,
	SILLYTAVERN_DIRS.chats,
	SILLYTAVERN_DIRS.groups,
	SILLYTAVERN_DIRS.worlds
]

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
		p.startsWith(`${SILLYTAVERN_DIRS.characters}/`) ||
		p.startsWith(`${SILLYTAVERN_DIRS.chats}/`) ||
		p.startsWith(`${SILLYTAVERN_DIRS.groups}/`) ||
		p.startsWith(`${SILLYTAVERN_DIRS.groupChats}/`) ||
		p.startsWith(`${SILLYTAVERN_DIRS.worlds}/`) ||
		p.startsWith(`${SILLYTAVERN_DIRS.userAvatars}/`)
	)
}

/**
 * True for a SillyTavern chat-history file (relative to the data root) — a
 * solo chat under `chats/` or a group chat under `group chats/`. These are
 * the large files the import uploads only for what the user selects.
 */
export function isSillyTavernChatHistoryPath(relativePath: string): boolean {
	const p = normalizePath(relativePath)
	return (
		p.startsWith(`${SILLYTAVERN_DIRS.chats}/`) ||
		p.startsWith(`${SILLYTAVERN_DIRS.groupChats}/`)
	)
}
