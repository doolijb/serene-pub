/**
 * A carded cast member's own **name** and **nickname** in a book (playtest
 * §0-D, ruled 2026-11-04). Pure and shared: every reader of "what is this
 * member called" goes through here.
 *
 * Shown in this book only; the card keeps its own. Each field has a
 * *Use from card* toggle (owner ★L-3b, 2026-11-04): on, `NULL` is stored and
 * the card's value reads through; off, the field is the book's own value,
 * which may be blank. An own empty **nickname** (`""`) means *no nickname in
 * this book* (the member shows by name); an own empty **name** is refused on
 * save (`normaliseOwnNames`) and, if ever met, reads as no own name. The
 * override is book data: it travels with the book on export/import and is
 * refused on a provided book (`markedBook`).
 *
 * ## The rule (owner ★L-3 / ★L-3b, 2026-11-04: the card's nickname stays unless the book gives one)
 *   name     = ownName || card.name || ""
 *   nickname = ownNickname ?? card.nickname || null   (own `""` → none)
 * Each field reads through on its own: a book name alone keeps the card's
 * nickname (which `resolveCharacterName` prefers when showing one word), so a
 * person who wants the new name shown everywhere gives the book a nickname,
 * or an own empty one. A member with neither own field reads exactly as the
 * card does.
 *
 * ⚠ Not a retold field (no flag), not an amendment (no date), not a config
 * *override* (NOMENCLATURE §6). The "portrait" of the ruling is the member's
 * **face** (§8), by R1: see `memberFaceMediaId`.
 */
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

export interface MemberOwnNames {
	ownName?: string | null
	ownNickname?: string | null
}
export interface CardNames {
	name?: string | null
	nickname?: string | null
}

/**
 * A stored or sent own value: trimmed text, or null when absent or not text.
 * `""` is kept — an own EMPTY value, not an absent one (★L-3b).
 */
export function ownNameValue(value: unknown): string | null {
	return typeof value === "string" ? value.trim() : null
}

/** Whether the member carries a name or a nickname of its own (an own empty nickname counts; an empty name does not). */
export function hasOwnNames(
	member: MemberOwnNames | null | undefined
): boolean {
	return (
		!!ownNameValue(member?.ownName) ||
		ownNameValue(member?.ownNickname) != null
	)
}

/** The name and nickname a carded member is shown by in this book. */
export function memberNames(
	member: MemberOwnNames | null | undefined,
	card: CardNames | null | undefined
): { name: string; nickname: string | null } {
	const ownName = ownNameValue(member?.ownName) || null
	const ownNickname = ownNameValue(member?.ownNickname)
	return {
		name: ownName ?? card?.name ?? "",
		nickname:
			ownNickname != null ? ownNickname || null : card?.nickname || null
	}
}

/** nickname || name || fallback — the resolveCharacterName rule, applied after the member's own. */
export function memberShownName(
	member: MemberOwnNames | null | undefined,
	card: CardNames | null | undefined,
	fallback = ""
): string {
	return resolveCharacterName(memberNames(member, card), fallback)
}

/** The card as this member is shown: name/nickname replaced; the SAME object when the member has no own names. */
export function withMemberNames<T extends CardNames>(
	card: T,
	member: MemberOwnNames | null | undefined
): T {
	if (!hasOwnNames(member)) return card
	return { ...card, ...memberNames(member, card) }
}

/** The face the member is drawn with: their face while `retold.face === true` and a `faceMediaId`, else the card's `avatarMediaId`, else null. */
export function memberFaceMediaId(
	member:
		| { faceMediaId?: number | null; retold?: { face?: boolean } | null }
		| null
		| undefined,
	card: { avatarMediaId?: number | null } | null | undefined
): number | null {
	if (member?.retold?.face === true && typeof member.faceMediaId === "number")
		return member.faceMediaId
	return card?.avatarMediaId ?? null
}
