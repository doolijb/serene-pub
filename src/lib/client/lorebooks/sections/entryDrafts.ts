/**
 * What a new named entry starts as — one copy, read by every door's **New**
 * and by the places made on the spot (the canvas's **New place** and
 * **New place…**, a place's **Link a place**), so a place made anywhere is
 * the place the Places door would have made.
 *
 * Pure: no Svelte, so the Places lens's arithmetic (`places/placeGraph.ts`)
 * reads it without the doors' components.
 */

import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

/** An unnamed entry of `typeId` with world lore's defaults. */
export const namedEntryDraft = (lorebookId: number, typeId: string) => ({
	typeId,
	lorebookId,
	name: "",
	content: "",
	keys: [] as string[],
	// The absence of a condition, spelled the way the column stores it: no
	// keys and no mode. Either one alone is a rule about nothing.
	secondaryKeys: [] as string[],
	selectiveLogic: null,
	useRegex: false,
	caseSensitive: false,
	constant: false,
	enabled: true,
	priority: 1
})

/** A new place: world lore's shape, and no category yet. */
export const placeDraft = (lorebookId: number) => ({
	...namedEntryDraft(lorebookId, LOCATION_TYPE_ID),
	category: null as string | null
})
