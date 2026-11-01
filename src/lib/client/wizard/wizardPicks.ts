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
 * The Character step also offers the **starter character** first, while the
 * person has no unchanged copy of her (`characterStepOffers`).
 *
 * Pure: the page passes its lists in and renders what comes back.
 */
import { isStarterCharacterRow } from "$lib/shared/characters/starterCharacter"

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

/** One thing the Character step draws, in `characterStepOffers`' order. */
export type CharacterStepOffer =
	| "starter"
	| "choose"
	| "create"
	| "library"
	| "import"

/** A `characters:list` row, narrowed to what the starter check reads. */
type StarterRow = PickRow & {
	name?: string | null
	description?: string | null
	isSharedWithMe?: boolean | null
}

/**
 * The person's own, unchanged copy of the starter character, or null: the
 * first row `isStarterCharacterRow` accepts.
 */
export function ownStarterCharacter<T extends StarterRow>(
	characters: readonly T[]
): T | null {
	return characters.find((c) => isStarterCharacterRow(c)) ?? null
}

/**
 * What the Character step offers, in the order it draws them: the starter
 * character first while the person has no unchanged copy of it
 * (`ownStarterCharacter`), then **Choose a character** when
 * `characterPickOptions` offers anything, then the three ways to add one —
 * Create one, Browse the library, Import a card. `characters` is the full
 * list, not the pick options.
 */
export function characterStepOffers<T extends StarterRow>(
	characters: readonly T[],
	personaId: number | null
): CharacterStepOffer[] {
	const offers: CharacterStepOffer[] = []
	if (!ownStarterCharacter(characters)) offers.push("starter")
	if (characterPickOptions(characters, personaId).length > 0)
		offers.push("choose")
	offers.push("create", "library", "import")
	return offers
}
