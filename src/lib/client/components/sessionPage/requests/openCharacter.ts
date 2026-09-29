/**
 * 🚧 `open-character` (anyone may ask): open the characters panel on one
 * character. A `characterId` that is not a number is refused.
 */

/** What this answer needs of the page's panels. */
export interface OpenCharacterDeps {
	/** Open the characters panel (never toggling it shut). */
	openCharactersPanel(): void
	/** Point that panel at this character. */
	viewCharacter(characterId: number): void
}

/** Answer one `open-character`. */
export function answerOpenCharacter(params: unknown, deps: OpenCharacterDeps): void {
	const p = params as Record<string, unknown>
	const id = Number(p.characterId)
	if (!Number.isFinite(id)) throw new Error("open-character needs a characterId")
	deps.openCharactersPanel()
	deps.viewCharacter(id)
}
