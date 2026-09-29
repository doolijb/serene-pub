import {
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import type { LoreScope } from "$lib/shared/lorebooks/loreRoute"

/**
 * Which scope a deep link should open for one declared type.
 *
 * A kind facet where the type has one, and the unnarrowed pool where it
 * does not: "All entries" holds every kind, and the row's own kind is what
 * picks the curated editor once it is selected. A door invented for a type
 * that has none would be an address nothing answers.
 *
 * Kept here rather than read off the section descriptors so that a caller
 * outside the workspace — a retrieval explanation, a receipt — can address an
 * entry without pulling the workspace's components in behind it.
 */
export function entryTypeScope(typeId: string): LoreScope {
	if (typeId === WORLD_LORE_TYPE_ID) return "world"
	if (typeId === HISTORY_TYPE_ID) return "history"
	if (typeId === ITEM_TYPE_ID) return "items"
	return "all"
}
