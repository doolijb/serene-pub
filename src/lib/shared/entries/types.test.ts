/**
 * The mirror, with an alarm on it.
 *
 * `EntryFieldsByType` and `ENTRY_EXPORT_KEY` in `types.ts` restate what
 * `core-catalog/src/entries.ts` declares, because the client needs the shapes
 * without loading the SDK's registry. **The declaration is the source of truth
 * and this is the mirror** — so the arrangement is only safe while something
 * fails when they drift, which is this file. It is the same arrangement
 * `DEFAULT_SIGNAL_WEIGHTS` needed for `sourceKind`, one construct over.
 *
 * The branded type itself is checked by the compiler and cannot be checked
 * here: `LorebookEntry<"…/world-lore">` and `LorebookEntry<"…/character-lore">`
 * being mutually unassignable is a fact `tsc` enforces on every file that names
 * one, which is precisely why it replaced two ambient globals rather than a
 * runtime check.
 */

import { describe, it, expect } from "vitest"
import {
	CHARACTER_LORE_TYPE_ID,
	ENTRY_EXPORT_KEY,
	ENTRY_TYPE_IDS,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entriesOfType,
	entryTypeIdOfExportKey,
	isEntryOfType,
	isEntryTypeId,
	type LorebookEntry
} from "./types"
import { entryDeclarations } from "$lib/server/entries/declarations"

const declared = () => new Map(entryDeclarations().map((d) => [d.typeId, d]))

describe("the shared shapes mirror the declarations", () => {
	it("names exactly the types the catalog declares", () => {
		expect([...ENTRY_TYPE_IDS].sort()).toEqual(
			[...declared().keys()].sort()
		)
	})

	it("carries the same field names, per type, in the same order", () => {
		// The field half of `EntryFieldsByType` is a type and cannot be read at
		// runtime — so the check is against the *values* every row of that type
		// carries, which is what `toEntryRow` builds from the declaration.
		expect(Object.keys(declared().get(WORLD_LORE_TYPE_ID)!.fields)).toEqual(
			["category", "priority"]
		)
		expect(
			Object.keys(declared().get(CHARACTER_LORE_TYPE_ID)!.fields)
		).toEqual(["priority"])
		expect(Object.keys(declared().get(HISTORY_TYPE_ID)!.fields)).toEqual([
			"year",
			"month",
			"day",
			"isCompleted",
			"graphed"
		])
	})

	it("agrees with the declared export key for every type", () => {
		// ⚠ The wire name, never the type id. A file is read by installs whose
		// registry is not this one, so `core:entry/world-lore@1` must never
		// reach one.
		for (const [typeId, decl] of declared())
			expect(ENTRY_EXPORT_KEY[typeId]).toBe(decl.exportKey)
		expect(Object.values(ENTRY_EXPORT_KEY).sort()).toEqual([
			"character",
			"history",
			"world"
		])
	})
})

describe("export keys translate in both directions", () => {
	it("round-trips every type that has a marker", () => {
		// Every type that HAS one: the table is partial on purpose (L3), and a
		// type with no wire name has nothing to round-trip — it is exported as
		// world lore and read back as world lore, which is the degrade
		// `entryTypeIdOfExportKey` already performs for a foreign marker.
		for (const typeId of ENTRY_TYPE_IDS) {
			const key = ENTRY_EXPORT_KEY[typeId]
			if (!key) continue
			expect(entryTypeIdOfExportKey(key)).toBe(typeId)
		}
		expect(
			ENTRY_TYPE_IDS.filter((t) => !ENTRY_EXPORT_KEY[t])
		).toEqual([LOCATION_TYPE_ID])
	})

	it("falls back to world lore for a foreign or future marker", () => {
		// The most agnostic shape, which is what this importer has always done
		// for a source that is not Serene Pub.
		expect(entryTypeIdOfExportKey(undefined)).toBe(WORLD_LORE_TYPE_ID)
		expect(entryTypeIdOfExportKey("spell")).toBe(WORLD_LORE_TYPE_ID)
		expect(entryTypeIdOfExportKey(7)).toBe(WORLD_LORE_TYPE_ID)
	})
})

describe("the brand narrows at runtime as well as at compile time", () => {
	const row = (typeId: string) =>
		({ id: 1, typeId }) as unknown as LorebookEntry

	it("recognises a declared id and refuses anything else", () => {
		expect(isEntryTypeId(WORLD_LORE_TYPE_ID)).toBe(true)
		expect(isEntryTypeId("core:entry/world-lore@1")).toBe(false)
		expect(isEntryTypeId(null)).toBe(false)
	})

	it("narrows one row and filters a mixed list", () => {
		expect(isEntryOfType(row(HISTORY_TYPE_ID), HISTORY_TYPE_ID)).toBe(true)
		expect(isEntryOfType(row(HISTORY_TYPE_ID), WORLD_LORE_TYPE_ID)).toBe(
			false
		)
		const mixed = [
			row(WORLD_LORE_TYPE_ID),
			row(HISTORY_TYPE_ID),
			row(WORLD_LORE_TYPE_ID)
		]
		expect(entriesOfType(mixed, WORLD_LORE_TYPE_ID)).toHaveLength(2)
	})
})
