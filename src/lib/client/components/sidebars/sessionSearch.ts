/**
 * 🚧 The Sessions view's filter text, matched against a session (s27 S2c,
 * owner ruling 2026-11-05: search matches the shown name). Pure.
 *
 * A session matches when the text is in its name, in a seated card's name
 * (a player seat's as well as a character seat's), in a seat's cast member's
 * own name or own nickname (`castNames`, by the seated card's id), or in a tag's
 * name. An own nickname of `""` means none, so it adds nothing; a session
 * whose payload has no `castNames` matches as it always did.
 */

interface SeatCard {
	id?: number | null
	name?: string | null
}

export interface SessionSearchable {
	name?: string | null
	sessionPersonas?: readonly { persona?: SeatCard | null }[] | null
	sessionCharacters?: readonly { character?: SeatCard | null }[] | null
	sessionTags?: readonly { tag?: { name?: string | null } | null }[] | null
	castNames?: Readonly<
		Record<number, { ownName?: string | null; ownNickname?: string | null }>
	> | null
}

/** `lowerText` is the filter text, already lower-cased. */
export function sessionMatchesSearch(
	session: SessionSearchable,
	lowerText: string
): boolean {
	const names: string[] = [session.name?.toLowerCase() || ""]
	const seatCards = [
		...(session.sessionPersonas ?? []).map((cp) => cp.persona),
		...(session.sessionCharacters ?? []).map((cc) => cc.character)
	]
	for (const card of seatCards) {
		names.push(card?.name?.toLowerCase() || "")
		const member =
			typeof card?.id === "number" ? session.castNames?.[card.id] : null
		names.push(member?.ownName?.toLowerCase() || "")
		names.push(member?.ownNickname?.toLowerCase() || "")
	}
	for (const st of session.sessionTags ?? [])
		names.push(st?.tag?.name?.toLowerCase() || "")
	return names.some((n) => n.includes(lowerText))
}
