/**
 * The delete confirmations name the thing and what goes with it
 * (less-confusing G5), so a reader never finds the cascade afterwards.
 */
import { describe, expect, it } from "vitest"
import {
	deleteBookCopy,
	deleteBookRefusal,
	deleteEntryTitle
} from "./deleteCopy"

const PLACE = "core:entry/location"

describe("deleteBookCopy", () => {
	it("names the book in the title", () => {
		const copy = deleteBookCopy(
			{ name: "Umber City" },
			{ placeTypeId: PLACE }
		)
		expect(copy.title).toBe('Delete "Umber City"?')
	})

	it("falls back to a plain title for a nameless or unknown book", () => {
		expect(
			deleteBookCopy({ name: "  " }, { placeTypeId: PLACE }).title
		).toBe("Delete this lorebook?")
		expect(deleteBookCopy(null, { placeTypeId: PLACE }).title).toBe(
			"Delete this lorebook?"
		)
	})

	it("counts the entries, the places among them and the cast", () => {
		const copy = deleteBookCopy(
			{
				name: "Umber City",
				entryCount: 12,
				entryCounts: { [PLACE]: 3, "core:entry/world-lore": 9 },
				lorebookBindings: [{}, {}, {}, {}]
			},
			{ placeTypeId: PLACE }
		)
		expect(copy.lines[0]).toBe(
			"Everything in it is deleted with it: 12 entries (3 of them places), 4 cast members, and its history, scenes, relationships and branches."
		)
	})

	it("says the singular and leaves places out when there are none", () => {
		const copy = deleteBookCopy(
			{ entryCount: 1, entryCounts: {}, lorebookBindings: [{}] },
			{ placeTypeId: PLACE }
		)
		expect(copy.lines[0]).toContain(": 1 entry, 1 cast member,")
		const one = deleteBookCopy(
			{
				entryCount: 1,
				entryCounts: { [PLACE]: 1 },
				lorebookBindings: []
			},
			{ placeTypeId: PLACE }
		)
		expect(one.lines[0]).toContain(
			"1 entry (1 of them a place), 0 cast members"
		)
		const none = deleteBookCopy(
			{ entryCount: 0, lorebookBindings: [] },
			{ placeTypeId: PLACE }
		)
		expect(none.lines[0]).toContain(": no entries, 0 cast members")
	})

	it("names what goes without figures when the list has none", () => {
		const copy = deleteBookCopy({ name: "X" }, { placeTypeId: PLACE })
		expect(copy.lines[0]).toBe(
			"Everything in it is deleted with it: its entries, cast, places, history, scenes, relationships and branches."
		)
	})

	it("ends on no undo, and carries no em-dash", () => {
		const copy = deleteBookCopy(
			{ name: "A", entryCount: 2, lorebookBindings: [] },
			{ placeTypeId: PLACE }
		)
		expect(copy.lines.at(-1)).toBe("This cannot be undone.")
		expect([copy.title, ...copy.lines].join(" ")).not.toContain("—")
	})
})

describe("deleteBookRefusal", () => {
	const readers = (n: number) =>
		Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `S${i + 1}` }))

	it("is null with no reading session", () => {
		expect(deleteBookRefusal(null)).toBeNull()
		expect(deleteBookRefusal({ name: "Umber City" })).toBeNull()
		expect(deleteBookRefusal({ name: "Umber City", readBy: [] })).toBeNull()
	})

	it("names the book and the sessions that read it", () => {
		const w = deleteBookRefusal({ name: "Umber City", readBy: readers(1) })
		expect(w?.title).toBe('Can\'t delete "Umber City"')
		expect(w?.shown).toEqual(readers(1))
		expect(w?.more).toBe(0)
		expect(w?.wayOut).toContain("Delete that session first")
	})

	it("shows five and counts the rest; the way out is plural", () => {
		const w = deleteBookRefusal({ name: "Umber City", readBy: readers(7) })
		expect(w?.shown).toHaveLength(5)
		expect(w?.more).toBe(2)
		expect(w?.wayOut).toContain("Delete those sessions first")
	})
})

describe("deleteEntryTitle", () => {
	it("names the entry", () => {
		expect(deleteEntryTitle("The Hall")).toBe('Delete "The Hall"?')
	})

	it("falls back for an untitled entry", () => {
		expect(deleteEntryTitle("")).toBe("Delete this entry?")
		expect(deleteEntryTitle(null)).toBe("Delete this entry?")
	})
})
