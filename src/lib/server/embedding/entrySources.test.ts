/**
 * Every declared entry type is in the vector index (finding #150): places
 * and items were declared after the index's hand-written list and were never
 * embedded or searched. The list is derived now; this pins that it stays
 * complete, and that each type indexes under its own band.
 */
import { describe, expect, it } from "vitest"
import {
	EMBEDDABLE_ENTRY_TYPES,
	ENTRY_INDEX_SOURCES,
	entryTypesOfSource,
	indexSourceOfBand
} from "./entrySources"
import { bandOfType } from "$lib/server/entries/declarations"
import {
	ENTRY_TYPE_IDS,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

describe("the index's entry types", () => {
	it("holds every declared entry type — a new type cannot drop out again", () => {
		expect(EMBEDDABLE_ENTRY_TYPES.map((t) => t.typeId)).toEqual([...ENTRY_TYPE_IDS])
	})

	it("files each under its band, in the index's vocabulary", () => {
		for (const t of EMBEDDABLE_ENTRY_TYPES)
			expect(t.source).toBe(indexSourceOfBand(bandOfType(t.typeId)))
		expect(entryTypesOfSource("worldLore")).toEqual([
			WORLD_LORE_TYPE_ID,
			LOCATION_TYPE_ID,
			ITEM_TYPE_ID
		])
		expect(entryTypesOfSource("historyEntry")).toEqual([HISTORY_TYPE_ID])
		expect(ENTRY_INDEX_SOURCES).toEqual(["worldLore", "characterLore", "historyEntry"])
	})

	it("embeds the title only for a type whose embedText role names it", () => {
		const of = (id: string) => EMBEDDABLE_ENTRY_TYPES.find((t) => t.typeId === id)!
		expect(of(HISTORY_TYPE_ID).withTitle).toBe(false)
		expect(of(LOCATION_TYPE_ID).withTitle).toBe(true)
		expect(of(ITEM_TYPE_ID).withTitle).toBe(true)
	})
})
