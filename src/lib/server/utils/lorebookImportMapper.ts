/**
 * Pure mapping helpers for importing a parsed CharacterBook (lorebook/world
 * info, CCv2/CCv3 spec) into Serene Pub's world lore entry shape. Kept free
 * of DB imports so the mapping logic can be unit tested without a database.
 */

export interface LorebookEntryLike {
	keys: string[]
	content: string
	enabled: boolean
	constant?: boolean
	name?: string
	comment?: string
	priority?: number
}

/** Clamp an entry's priority into Serene Pub's supported 1-3 range, defaulting to 1. */
export function normalizeLorebookEntryPriority(
	priority: number | null | undefined
): number {
	if (priority === null || priority === undefined || priority < 1) {
		return 1
	}
	if (priority > 3) {
		return 3
	}
	return priority
}

/**
 * Map a single parsed lorebook entry to the plain values used to insert a
 * worldLoreEntries row (minus lorebookId, which the caller assigns after
 * creating the lorebook).
 */
export function mapLorebookEntryToWorldLoreEntry(
	entry: LorebookEntryLike,
	position: number
) {
	return {
		name: entry.name || entry.comment || "Imported Entry",
		content: entry.content || "",
		position,
		keys: entry.keys?.join(", ") || "",
		enabled: entry.enabled ?? true,
		constant: entry.constant ?? false,
		priority: normalizeLorebookEntryPriority(entry.priority),
		extraJson: {}
	}
}
