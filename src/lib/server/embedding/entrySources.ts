/**
 * Which entry types the vector index holds, and under which index source.
 *
 * ⚠ **Derived from the declared types, never listed by hand** (finding #150).
 * The index, the queue and the promotion scan all read this list and never
 * spell out their own: a hand-written list silently leaves a newly declared
 * type (places, items) unembedded and unsearched. Every declared type is
 * here, and `entrySources.test.ts` fails if one ever drops out.
 *
 * The source is the type's budget band (`bandOfType`) in the INDEX vocabulary:
 * `history` is `historyEntry` here — the deliberate split documented at
 * `RAG_INDEX_SOURCES` and `bindings.ts` `VECTOR_SOURCE_ALIASES`. A place and an
 * item are world lore's shape and band, so they index as `worldLore` and the
 * vector gate matches them against the lore read's `worldLore:<id>` rows.
 *
 * Whether the title is embedded is the type's own `embedText` role: `[title,
 * content]` for the named types, `[content]` for history, which is dated.
 */

import { bandOfType, entryDeclaration } from "$lib/server/entries/declarations"
import {
	ENTRY_TYPE_IDS,
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	type EntryTypeId
} from "$lib/shared/entries/types"

/** The index sources an entry can be embedded under. */
export type EntryIndexSource = "worldLore" | "characterLore" | "historyEntry"

export interface EmbeddableEntryType {
	typeId: EntryTypeId
	source: EntryIndexSource
	/** The type's `embedText` role names the title. */
	withTitle: boolean
	/** What the queue's progress line calls one row of it. */
	noun: string
}

/** A budget band in the index's vocabulary; null for one the index has no source for. */
export function indexSourceOfBand(band: string): EntryIndexSource | null {
	if (band === "history") return "historyEntry"
	if (band === "worldLore" || band === "characterLore") return band
	return null
}

const NOUNS: Record<string, string> = {
	[WORLD_LORE_TYPE_ID]: "World lore",
	[CHARACTER_LORE_TYPE_ID]: "Character lore",
	[HISTORY_TYPE_ID]: "History entry",
	[LOCATION_TYPE_ID]: "Place",
	[ITEM_TYPE_ID]: "Item"
}

/** Every declared entry type the index holds, in declaration order. */
export const EMBEDDABLE_ENTRY_TYPES: readonly EmbeddableEntryType[] = ENTRY_TYPE_IDS.flatMap(
	(typeId) => {
		const source = indexSourceOfBand(bandOfType(typeId))
		if (!source) return []
		const roles = entryDeclaration(typeId)?.roles
		const title = roles?.title
		const withTitle = Array.isArray(roles?.embedText)
			? !!title && roles.embedText.includes(title)
			: !!title
		return [{ typeId, source, withTitle, noun: NOUNS[typeId] ?? typeId }]
	}
)

/** The type ids one index source holds, in declaration order. */
export function entryTypesOfSource(source: EntryIndexSource): EntryTypeId[] {
	return EMBEDDABLE_ENTRY_TYPES.filter((t) => t.source === source).map((t) => t.typeId)
}

/** The index sources, each once, in the order their first type is declared. */
export const ENTRY_INDEX_SOURCES: readonly EntryIndexSource[] = [
	...new Set(EMBEDDABLE_ENTRY_TYPES.map((t) => t.source))
]

/** One embeddable type, by id. */
export const embeddableEntryType = (typeId: string): EmbeddableEntryType | undefined =>
	EMBEDDABLE_ENTRY_TYPES.find((t) => t.typeId === typeId)
