import { CAST_KIND, type PoolItem } from "./poolFilter"

/**
 * The cast, as arithmetic.
 *
 * A cast member is someone who exists in the lorebook's world, carded or not —
 * a character, a persona, or a background figure with nothing but a name. The
 * *binding* is the link to a card, which is one fact about a member rather than
 * the member itself, so the row this module builds is named for the person and
 * carries the tag alongside.
 *
 * Character lore is not a section of its own: a member's page lists the lore
 * anchored to them. Which entries those are is the grouping below, kept pure so
 * "whose lore is this?" is answerable without a browser.
 */

/**
 * Which of the three a member is. The kind is read, never stored — and
 * "persona" is not a different binding: it is a character binding whose card
 * the reader has flagged as one of their own personas.
 */
export type CastKind = "character" | "persona" | "background"

/** A cast row as the wire sends it, with whatever card it names resolved. */
export interface CastRow {
	id: number
	/** A background member's own name. Empty on a row that never had one. */
	name?: string | null
	/** The `{{char:N}}` tag content refers to this member by. */
	binding?: string | null
	aliases?: string[] | null
	/** Identities folded in by a merge; the reader sees one alias list. */
	absorbedAliases?: string[] | null
	summary?: string | null
	nodeState?: string | null
	nodeVisibility?: string | null
	/**
	 * Which of the card's sprite sets they are drawn with. Null = its default.
	 *
	 * ⚠ A NAME, not an id: sets belong to the card, and which card represents
	 * this member is itself amendable, so an id would dangle the moment a
	 * card-swap amendment lands. A name the new card has no set by falls back
	 * to that card's default and is kept as written.
	 */
	spriteSet?: string | null
	characterId?: number | null
	character?: {
		nickname?: string | null
		name?: string | null
		isPersona?: boolean | null
	} | null
}

/** One row of the Cast list. */
export interface CastMember {
	id: number
	name: string
	tag: string
	aliases: string[]
	kind: CastKind
	state: string
	visibility: string
	summary: string
	/** Whether a character card is attached. */
	linked: boolean
}

/**
 * A member's face as the Cast board draws it: name, kind and the linked
 * card's avatar URL (absent for a background member or a card with none).
 */
export interface CastFace {
	id: number
	name: string
	kind: CastKind
	src?: string
}

/** An entry that may be anchored to a member. */
export interface AnchoredLore {
	id: number
	lorebookBindingId?: number | null
}

function cardName(row: CastRow): string {
	if (row.characterId)
		return (row.character?.nickname || row.character?.name || "").trim()
	return ""
}

/**
 * One row, as the list reads it.
 *
 * The name falls back to the tag rather than to an empty string: `name` is
 * NOT NULL DEFAULT '' on the table, so a row can carry nothing at all, and a
 * heading nobody can see is a row nobody can click.
 */
export function toCastMember(row: CastRow): CastMember {
	const kind: CastKind = !row.characterId
		? "background"
		: row.character?.isPersona
			? "persona"
			: "character"
	const name =
		cardName(row) || (row.name ?? "").trim() || (row.binding ?? "").trim()
	return {
		id: row.id,
		name: name || "Unnamed",
		tag: row.binding ?? "",
		aliases: [
			...new Set([...(row.aliases ?? []), ...(row.absorbedAliases ?? [])])
		].filter((a) => a.trim().length > 0),
		kind,
		state: row.nodeState || "active",
		visibility: row.nodeVisibility || "normal",
		summary: row.summary ?? "",
		linked: kind !== "background"
	}
}

/** A cast row of Everything, carrying what its row draws. */
export type CastPoolItem = PoolItem & {
	castKind: CastKind
	summary: string
	avatar?: string
}

/**
 * A member as a row of Everything (note 12, 2026-10-02): All lists every
 * kind the book holds, and the people are part of the book.
 *
 * The row only lists and finds them — choosing it opens the Cast board, which
 * is where a member is edited. It is never pinned, off or filed under
 * anything, and it has no keywords to need: a member is reached by name and
 * alias, which search reads from `content`.
 *
 * `cardName` is the card the member reads as at the moment, when an
 * amendment swapped it — the joined `character` is the stored one.
 */
export function castPoolItem(
	row: CastRow & {
		branchId?: number | null
		createdAt?: unknown
		updatedAt?: unknown
	},
	cardName?: string,
	avatar?: string
): CastPoolItem {
	const member = toCastMember(row)
	const timeOf = (value: unknown) => {
		if (!value) return 0
		const ms = new Date(value as string).getTime()
		return Number.isFinite(ms) ? ms : 0
	}
	return {
		key: `cast#${row.id}`,
		id: row.id,
		kind: CAST_KIND,
		name: (row.characterId != null && cardName) || member.name,
		content: [member.summary, ...member.aliases].filter(Boolean).join("\n"),
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		branchId: row.branchId ?? null,
		order: row.id,
		position: row.id,
		priority: 0,
		createdAt: timeOf(row.createdAt),
		updatedAt: timeOf(row.updatedAt),
		castKind: member.kind,
		summary: member.summary,
		avatar
	}
}

export function castMembers(rows: readonly CastRow[]): CastMember[] {
	return rows.map(toCastMember)
}

/**
 * The list, narrowed.
 *
 * Name and aliases, because those are the two ways a reader knows who they are
 * looking for; an empty query returns the cast rather than nobody.
 */
export function filterCast(
	members: readonly CastMember[],
	query: string
): CastMember[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return [...members]
	return members.filter(
		(m) =>
			m.name.toLowerCase().includes(needle) ||
			m.aliases.some((a) => a.toLowerCase().includes(needle))
	)
}

/** Anchored lore, filed under the member it is private to. */
export function loreByMember<T extends AnchoredLore>(
	entries: readonly T[]
): Map<number, T[]> {
	const map = new Map<number, T[]>()
	for (const entry of entries) {
		const id = entry.lorebookBindingId
		if (id == null) continue
		const list = map.get(id) ?? []
		list.push(entry)
		map.set(id, list)
	}
	return map
}

/**
 * Lore anchored to nobody.
 *
 * Visible to nobody, so it is surfaced rather than dropped: an unanchored row
 * is a row the writer has to repair, and the Cast page is where the anchor is
 * set.
 */
export function unanchoredLore<T extends AnchoredLore>(
	entries: readonly T[]
): T[] {
	return entries.filter((e) => e.lorebookBindingId == null)
}

export interface CastPool<T extends AnchoredLore> {
	/** The members the search left, in the order the wire sent them. */
	members: CastMember[]
	/** Every member's lore, searched or not — the search narrows the list. */
	lore: Map<number, T[]>
	unanchored: T[]
}

/** The Cast section's two columns, in one shape. */
export function castPool<T extends AnchoredLore>(
	rows: readonly CastRow[],
	entries: readonly T[],
	query = ""
): CastPool<T> {
	return {
		members: filterCast(castMembers(rows), query),
		lore: loreByMember(entries),
		unanchored: unanchoredLore(entries)
	}
}
