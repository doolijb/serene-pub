/**
 * `playerLabel` (lair re-plan R4, owner ruling 3, 2026-09-28) — what a
 * person's persona-less line is called: the Lair's "Dungeon Master".
 *
 * Declared on the genre (`GenreDecl.playerLabel`, SDK) and overridable per
 * session. The override is stored in the session row's `metadata` under
 * `playerLabel` — the settings document's existing store for core keys (the
 * turn order lives beside it), so no column and no second setting system.
 *
 * **Read, never stamped.** The label is a role, not an identity: the log, the
 * transcript and `{{playerLabel}}` all resolve it when they render, so a rename
 * relabels history. Every reader goes through `resolvePlayerLabel`, so the
 * page, the prompt and the settings document cannot come to disagree.
 */

/** Where a session's override lives on `sessions.metadata`. */
export const PLAYER_LABEL_METADATA_KEY = "playerLabel"

/** The session's stored override, trimmed; null when there is none. */
export function storedPlayerLabel(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return null
	const v = (metadata as Record<string, unknown>)[PLAYER_LABEL_METADATA_KEY]
	return typeof v === "string" && v.trim() ? v.trim() : null
}

/**
 * The cascade: the session's value, else the genre's, else absent. A genre
 * that declares no label has none, whatever the session row holds — the
 * override only renames what the genre names (the same rule as a stored value
 * under an undeclared genre field).
 */
export function resolvePlayerLabel(layers: {
	/** The genre's `playerLabel`, as display text. */
	declared?: string | null
	/** The session's override (`storedPlayerLabel`). */
	stored?: string | null
}): string | undefined {
	const declared = layers.declared?.trim()
	if (!declared) return undefined
	return layers.stored?.trim() || declared
}
