/**
 * 🚧 `open-character` (anyone may ask): open the person a widget named.
 *
 * Who they are in THIS story comes first (owner rulings 2026-10-13 and
 * 2026-11-05 — "the cast panel and a message's name open the cast member page
 * in its book"): a character the session seats opens as that cast member,
 * wherever its book lives, for a guest as for the owner. The page asks the
 * server which member the seat seats; if the viewer can open that book it
 * lands on the member's page in the lorebooks panel, otherwise (a guest
 * without a share, someone else's session notes) it shows the member's
 * read-only sheet in the sessions panel. A seat with no member yet, or a
 * character the session does not seat, opens the character card in the
 * characters panel as before. The widget still asks by `characterId`; which of
 * these it lands on is the page's knowledge, never the widget's.
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
	 * Where the card's seat in this session stands, as the viewer can reach
	 * it: an address when they can open the member's book, `"sheet"` when the
	 * member exists but they cannot (its read-only sheet shows instead), null
	 * when the seat has no member yet. May answer later (a Promise); a
	 * rejection reaches the widget as the reason.
	 */
	castMemberOf(
		characterId: number
	): CastMemberAddress | "sheet" | null | Promise<CastMemberAddress | "sheet" | null>
	/** Open the lorebooks panel on one cast member's page (never toggling it shut). */
	openCastMember(where: CastMemberAddress): void
	/**
	 * Open the read-only sheet of the member this card's seat seats, in the
	 * sessions panel. Optional so a caller that never answers `"sheet"` (it
	 * has no sheet to show) need not name it; without it, `"sheet"` opens the
	 * card.
	 */
	openSeatMemberSheet?(characterId: number): void
	/** Open the characters panel (never toggling it shut). */
	openCharactersPanel(): void
	/** Point that panel at this character. */
	viewCharacter(characterId: number): void
}

/** Answer one `open-character`. Synchronous when `castMemberOf` answers so. */
export function answerOpenCharacter(
	params: unknown,
	deps: OpenCharacterDeps
): void | Promise<void> {
	const p = params as Record<string, unknown>
	const id = Number(p.characterId)
	if (!Number.isFinite(id)) throw new Error("open-character needs a characterId")
	const open = (member: CastMemberAddress | "sheet" | null): void => {
		if (member === "sheet" && deps.openSeatMemberSheet) {
			deps.openSeatMemberSheet(id)
			return
		}
		if (member && member !== "sheet") {
			deps.openCastMember(member)
			return
		}
		deps.openCharactersPanel()
		deps.viewCharacter(id)
	}
	const member = deps.castMemberOf(id)
	if (member instanceof Promise) return member.then(open)
	open(member)
}
