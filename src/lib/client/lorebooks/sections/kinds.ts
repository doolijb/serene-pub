import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { SCENE_KIND } from "../poolFilter"

/**
 * What a chip calls one kind of row.
 *
 * The declared name, always, spelled the way the rail's scopes spell it so a
 * chip and a scope never disagree about what a kind is called. The words
 * "entry type" are not a label, and a bare type id is not a name a reader
 * should ever be shown, so an unrecognised kind falls back to the last segment
 * of its id rather than the whole pin.
 */
const LABELS: Record<string, string> = {
	[WORLD_LORE_TYPE_ID]: "World lore",
	[CHARACTER_LORE_TYPE_ID]: "Character lore",
	[HISTORY_TYPE_ID]: "History",
	[SCENE_KIND]: "Scenes"
}

export function kindLabel(kind: string): string {
	const declared = LABELS[kind]
	if (declared) return declared
	const tail = kind.split("/").pop() ?? kind
	return tail.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
