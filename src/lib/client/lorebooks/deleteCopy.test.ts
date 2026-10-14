/**
 * The delete confirmations name the thing and what goes with it
 * (less-confusing G5), so a reader never finds the cascade afterwards.
 */
import { describe, expect, it } from "vitest"
import { deleteBookCopy, deleteEntryTitle } from "./deleteCopy"

const PLACE = "core:entry/location"

describe("deleteBookCopy", () => {
	it("names the book in the title", () => {
		const copy = deleteBookCopy({ name: "Umber City" }, { placeTypeId: PLACE })
		expect(copy.title).toBe('Delete "Umber City"?')
	})

	it("falls back to a plain title for a nameless or unknown book", () => {
		expect(deleteBookCopy({ name: "  " }, { placeTypeId: PLACE }).title).toBe(
			"Delete this lorebook?"
		)
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
			{ entryCount: 1, entryCounts: { [PLACE]: 1 }, lorebookBindings: [] },
			{ placeTypeId: PLACE }
		)
		expect(one.lines[0]).toContain("1 entry (1 of them a place), 0 cast members")
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

	it("says what happens to the sessions reading it, naming the open one", () => {
		expect(deleteBookCopy(null, { placeTypeId: PLACE }).lines[1]).toBe(
			"Sessions reading it keep their messages but stop reading lore from it."
		)
		expect(
			deleteBookCopy(null, {
				placeTypeId: PLACE,
				openSessionName: "Night market"
			}).lines[1]
		).toBe(
			'Sessions reading it, "Night market" among them, keep their messages but stop reading lore from it.'
		)
	})

	it("ends on no undo, and carries no em-dash", () => {
		const copy = deleteBookCopy(
			{ name: "A", entryCount: 2, lorebookBindings: [] },
			{ placeTypeId: PLACE, openSessionName: "B" }
		)
		expect(copy.lines.at(-1)).toBe("This cannot be undone.")
		expect([copy.title, ...copy.lines].join(" ")).not.toContain("—")
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
