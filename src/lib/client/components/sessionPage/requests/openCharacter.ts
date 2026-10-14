/**
 * 🚧 `open-character` (anyone may ask): open the person a widget named.
 *
 * Who they are in THIS story comes first: a character that is a cast member
 * of the session's lorebook opens as that member, on their page in the
 * lorebooks panel (owner ruling 2026-10-13 — "the cast member if it's from a
 * lorebook, the card if it's not"). A character the book does not hold, or a
 * session with no readable book, opens the character card in the characters
 * panel as before. The widget still asks by `characterId`; which of the two
 * it lands on is the page's knowledge, never the widget's.
 *
 * A `characterId` that is not a number is refused.
 */

/** Where a character stands in the session's book, when it is in it. */
export interface CastMemberAddress {
	lorebookId: number
	castId: number
}

/** What this answer needs of the page's panels. */
export interface OpenCharacterDeps {
	/**
	 * The session's cast member for this card, or null when the session has
	 * no book the viewer may read, or the book has no member for the card.
	 */
	castMemberOf(characterId: number): CastMemberAddress | null
	/** Open the lorebooks panel on one cast member's page (never toggling it shut). */
	openCastMember(where: CastMemberAddress): void
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
	const member = deps.castMemberOf(id)
	if (member) {
		deps.openCastMember(member)
		return
	}
	deps.openCharactersPanel()
	deps.viewCharacter(id)
}
