import { describe, expect, it } from "vitest"
import { memberScenes } from "./memberScenes"

const ENTRIES = [
	{ id: 1, year: 3, month: 2 },
	{ id: 2, year: 1 },
	{ id: 3, year: null },
	// Day 150 of Year 1 packs past Year 2 in `dateValue`; it still reads first.
	{ id: 4, year: 1, month: 1, day: 150 }
]

const SCENES = [
	{ id: 10, historyEntryId: 1, name: "The fire", participantCharacters: [7] },
	{ id: 11, historyEntryId: 2, name: "", participantCharacters: [7, 8] },
	{ id: 12, historyEntryId: 3, name: "Undated", participantCharacters: [7] },
	{ id: 13, historyEntryId: 1, name: "Not hers", participantCharacters: [8] },
	{
		id: 14,
		historyEntryId: 99,
		name: "Entry gone",
		participantCharacters: [7]
	},
	{ id: 15, historyEntryId: 4, name: "Early", participantCharacters: [7] }
]

describe("memberScenes", () => {
	it("lists only the scenes the member is in, oldest first, undated last", () => {
		const rows = memberScenes({
			castId: 7,
			scenes: SCENES,
			entries: ENTRIES
		})
		expect(rows.map((r) => r.id)).toEqual([11, 15, 10, 12, 14])
	})

	it("names an unnamed scene and dates it from its history entry", () => {
		const [first] = memberScenes({
			castId: 7,
			scenes: SCENES,
			entries: ENTRIES
		})
		expect(first.label).toBe("Unnamed Scene")
		expect(first.date).toEqual({ year: 1, month: null, day: null })
		expect(first.historyEntryId).toBe(2)
	})

	it("marks a scene dated after the moment as later, and none at now", () => {
		const at = { year: 2 }
		const later = memberScenes({
			castId: 7,
			scenes: SCENES,
			entries: ENTRIES,
			at
		})
			.filter((r) => r.later)
			.map((r) => r.id)
		expect(later).toEqual([10])
		expect(
			memberScenes({ castId: 7, scenes: SCENES, entries: ENTRIES }).some(
				(r) => r.later
			)
		).toBe(false)
	})

	it("is empty for a member in no scene", () => {
		expect(
			memberScenes({ castId: 42, scenes: SCENES, entries: ENTRIES })
		).toEqual([])
	})
})
