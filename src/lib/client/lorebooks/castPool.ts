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

/** Which of the three a member is. The kind is read, never stored. */
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
	characterId?: number | null
	personaId?: number | null
	character?: { nickname?: string | null; name?: string | null } | null
	persona?: { name?: string | null } | null
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
	/** Whether a character or persona card is attached. */
	linked: boolean
}

/** An entry that may be anchored to a member. */
export interface AnchoredLore {
	id: number
	lorebookBindingId?: number | null
}

function cardName(row: CastRow): string {
	if (row.characterId)
		return (row.character?.nickname || row.character?.name || "").trim()
	if (row.personaId) return (row.persona?.name || "").trim()
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
	const kind: CastKind = row.characterId
		? "character"
		: row.personaId
			? "persona"
			: "background"
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
