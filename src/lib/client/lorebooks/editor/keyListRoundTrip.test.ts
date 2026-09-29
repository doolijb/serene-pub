/**
 * An entry's keys, round trip: typed as chips → the save payload → the stored
 * column → the wire row → the editor's draft again (finding #146).
 *
 * Every hop keeps the list element for element, so a regex key holding a comma
 * (`\w{2,4}`) is the one key it was typed as when the editor opens it again. A
 * join or a re-split at any hop would come back as `\w{2` and `4}`.
 */
import { describe, expect, it } from "vitest"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { keysFromTyping, withKeys } from "$lib/shared/entries/keyList"
import { changedFields } from "$lib/shared/lorebooks/amendments"
import { entryInsert, toEntryRow } from "$lib/server/utils/lorebookEntries"
import { descriptorForKind } from "../sections"

const REGEX_KEY = String.raw`\w{2,4}`
const door = descriptorForKind(WORLD_LORE_TYPE_ID)!

/** The server's two hops: store the payload, read the row back for the wire. */
function storeAndRead(payload: Record<string, unknown>) {
	const stored = entryInsert({
		typeId: WORLD_LORE_TYPE_ID,
		lorebookId: 1,
		name: "Patterns",
		content: "",
		position: 1,
		...payload
	} as any)
	return {
		stored,
		wire: toEntryRow({
			...stored,
			id: 7,
			createdAt: new Date(0),
			updatedAt: new Date(0).toISOString(),
			archived: false,
			provenance: "human"
		} as any)
	}
}

describe("keys typed as chips come back as the same chips", () => {
	it("a regex key with a comma survives every hop", () => {
		// Typed: two chips in a regex entry — the comma stays in the first.
		let keys: string[] = []
		keys = withKeys(keys, keysFromTyping(REGEX_KEY, true))
		keys = withKeys(keys, keysFromTyping("Smith, John", true))
		expect(keys).toEqual([REGEX_KEY, "Smith, John"])

		// The payload the editor sends is the list.
		const { stored, wire } = storeAndRead({ keys, useRegex: true })
		expect(stored.keys).toEqual([REGEX_KEY, "Smith, John"])
		expect(wire.keys).toEqual([REGEX_KEY, "Smith, John"])

		// The editor opens it again as the same list.
		const draft = door.toDraft(wire as any)
		expect(draft.keys).toEqual([REGEX_KEY, "Smith, John"])
	})

	it("an unchanged list is no change; a changed one is the whole list", () => {
		const { wire } = storeAndRead({ keys: [REGEX_KEY], secondaryKeys: ["x{1,2}"] })
		const pristine = door.toDraft(wire as any)
		// A fresh copy of the same list is the same value, not a new one.
		const draft = { ...pristine, keys: [...pristine.keys] }
		expect(changedFields(draft, pristine)).toEqual({})

		draft.keys = withKeys(draft.keys, keysFromTyping("b{1,3}", true))
		expect(changedFields(draft, pristine)).toEqual({
			keys: [REGEX_KEY, "b{1,3}"]
		})
		// …and that patch stores and reads back as the list it is.
		expect(storeAndRead(changedFields(draft, pristine)).wire.keys).toEqual([
			REGEX_KEY,
			"b{1,3}"
		])
	})

	it("a row resolved through a legacy comma-string amendment opens as a list", () => {
		const { wire } = storeAndRead({ keys: ["verity"] })
		const resolved = { ...wire, keys: "keeper, warden" as unknown as string[] }
		const draft = door.toDraft(resolved as any)
		expect(draft.keys).toEqual(["keeper", "warden"])
		// The pristine copy is built the same way, so opening is not an edit.
		expect(changedFields(draft, door.toDraft(resolved as any))).toEqual({})
	})

	it("secondary keys ride the same list", () => {
		const { wire } = storeAndRead({ secondaryKeys: ["y{2,}", "Smith, John"] })
		expect(wire.secondaryKeys).toEqual(["y{2,}", "Smith, John"])
		expect(door.toDraft(wire as any).secondaryKeys).toEqual([
			"y{2,}",
			"Smith, John"
		])
	})
})
