/**
 * How a `{{char:N}}` tag reads in a prose editor — its label and its kind.
 *
 * A tag names a cast member (a `lorebook_bindings` row). The member may carry
 * a character card (a persona is a card flagged as the reader's own), or be a
 * **background** member with no card and only its own name. A tag whose row
 * is gone is a dangling reference — the only case that warns.
 */

export type CastTagKind = "character" | "persona" | "background" | "unknown"

/** The fields read here — the binding list rows carry more. */
export interface CastTagRow {
	binding: string
	name?: string | null
	characterId?: number | null
	character?: {
		name?: string | null
		nickname?: string | null
		isPersona?: boolean | null
	} | null
}

function rowFor(rows: readonly CastTagRow[], tag: string) {
	return rows.find((b) => b.binding == tag)
}

/** Card nickname, card name, the member's own name, then the raw tag. */
export function castMemberLabel(row: CastTagRow | undefined, tag: string) {
	return row?.character?.nickname || row?.character?.name || row?.name || tag
}

export function castTagLabel(rows: readonly CastTagRow[], tag: string) {
	return castMemberLabel(rowFor(rows, tag), tag)
}

export function castTagKind(
	rows: readonly CastTagRow[],
	tag: string
): CastTagKind {
	const row = rowFor(rows, tag)
	if (!row) return "unknown"
	if (!row.characterId) return "background"
	return row.character?.isPersona ? "persona" : "character"
}

/** The chip's tooltip. */
export function castTagTitle(kind: CastTagKind, label: string) {
	switch (kind) {
		case "character":
			return `Character: ${label}`
		case "persona":
			return `Persona: ${label}`
		case "background":
			return `Cast member: ${label}`
		default:
			return "No cast member for this tag"
	}
}
