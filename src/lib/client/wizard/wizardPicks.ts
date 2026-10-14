/**
 * The home wizard's two picks — the character the AI plays (the Character
 * step) and the persona the person plays as (Who you are) — as the rows
 * each step's picker offers and the row each step shows once chosen.
 *
 * Each step is one row, not a list: **Choose a character** / **Choose a
 * persona** opens the picker, and a chosen row shows with **Change**. The
 * picker offers every row, uncapped; its search is what narrows a long
 * library.
 *
 * Each picker hides what the other holds, the session forms' rule (note 33):
 * the character played as is not offered for the AI to play, and the AI's
 * character is not offered to play as.
 *
 * Pure: the page passes its lists in and renders what comes back.
 */

/** A `characters:list` row, narrowed to what the picks read. */
export interface PickRow {
	id?: number | null
	isPersona?: boolean | null
}

/**
 * What the Character step's picker offers: every character but the
 * personas and the one chosen to play as, in the list's own order (the page
 * passes it favourites first).
 */
export function characterPickOptions<T extends PickRow>(
	characters: readonly T[],
	personaId: number | null
): (T & { id: number })[] {
	return characters.filter(
		(c): c is T & { id: number } =>
			c.id != null && !c.isPersona && c.id !== personaId
	)
}

/** What the persona picker leaves out: the character the AI plays. */
export function personaPickExcludes(characterId: number | null): number[] {
	return characterId == null ? [] : [characterId]
}

/**
 * The chosen row, or null when nothing is chosen or its row is not in
 * `rows` — deleted, not offered any more, or a new row whose list push has
 * not landed yet. The step shows **Choose** and its primary stays disabled
 * until the row is there, so the two never disagree.
 */
export function pickedRow<T extends PickRow>(
	rows: readonly T[],
	id: number | null
): T | null {
	if (id == null) return null
	return rows.find((r) => r.id === id) ?? null
}
