/**
 * What a scene list sends a person who is not the session's owner.
 *
 * Owner rulings, 2026-11-16: "A guest neither opens nor edits the notes";
 * "In another person's session an administrator is a guest". A scene's
 * `summary` and `notes` are the notes' text (a summary waiting for review
 * included): the page shows a status, never the text, so a payload bound for
 * anyone but the session's owner carries `hasSummary` in their place.
 */

type SceneRow = { summary?: string | null; notes?: string | null } & Record<string, any>

/** One scene as a non-owner receives it: no text, one boolean. */
export function sceneWithoutText<R extends SceneRow>(
	scene: R
): Omit<R, "summary" | "notes"> & { hasSummary: boolean } {
	const { summary, notes: _notes, ...rest } = scene
	return { ...rest, hasSummary: !!summary?.trim() }
}

/**
 * The payload with every scene's text removed; the same reference when it is
 * not a scene list. Understands `{ sceneList }`.
 */
export function withoutSceneText<T>(payload: T): T {
	const list = (payload as { sceneList?: unknown } | null)?.sceneList
	if (!Array.isArray(list)) return payload
	return { ...payload, sceneList: list.map(sceneWithoutText) } as T
}
