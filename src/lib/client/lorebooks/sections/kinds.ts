import { SvelteMap } from "svelte/reactivity"
import {
	CHARACTER_LORE_TYPE_ID,
	isDerivedEntryTypeId,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { CAST_KIND, SCENE_KIND } from "../poolFilter"

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
	[LOCATION_TYPE_ID]: "Places",
	[ITEM_TYPE_ID]: "Items",
	[SCENE_KIND]: "Scenes",
	[CAST_KIND]: "Cast"
}

/**
 * 🚧 The labels of the rules lists the workspace has been told about
 * (`entries:types`), by derived entry type: "Weapons", never
 * "Vis Itineris.Weapons". A type id names the same list in every book, so
 * one map serves them all; the workspace fills it when a book's lists land.
 */
const RULES_LIST_LABELS = new SvelteMap<string, string>()

/** Remembers what each of a book's rules lists is called. */
export function rememberRulesListLabels(
	lists: readonly { typeId: string; label: string }[]
): void {
	for (const list of lists)
		if (RULES_LIST_LABELS.get(list.typeId) !== list.label)
			RULES_LIST_LABELS.set(list.typeId, list.label)
}

export function kindLabel(kind: string): string {
	const declared = LABELS[kind] ?? RULES_LIST_LABELS.get(kind)
	if (declared) return declared
	// A derived entry type not told about yet: its list's id, after the dot.
	const tail = isDerivedEntryTypeId(kind)
		? kind.slice(kind.lastIndexOf(".") + 1)
		: (kind.split("/").pop() ?? kind)
	return tail.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
