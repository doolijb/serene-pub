import { describe, expect, test } from "vitest"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { consequenceSentences, joinNames, treeRowsOf } from "./moveDownTheTree"

describe("treeRowsOf", () => {
	test("flattens every type and reads each wire row", () => {
		const rows = treeRowsOf({
			entries: [
				{
					id: 1,
					name: "  Gate ",
					typeId: 1,
					branchId: 4,
					anchorEntryId: 2,
					year: 3,
					month: 2
				},
				{ id: 2, name: "", typeId: 1 }
			],
			history: [
				{
					id: 3,
					name: "Fall",
					typeId: HISTORY_TYPE_ID,
					branchId: null,
					year: 0
				}
			]
		})
		expect(rows).toEqual([
			{
				id: 1,
				name: "Gate",
				isHistory: false,
				branchId: 4,
				anchorEntryId: 2,
				date: { year: 3, month: 2, day: null }
			},
			{
				id: 2,
				name: "Untitled",
				isHistory: false,
				branchId: null,
				anchorEntryId: null,
				date: null
			},
			{
				id: 3,
				name: "Fall",
				isHistory: true,
				branchId: null,
				anchorEntryId: null,
				date: { year: 0, month: null, day: null }
			}
		])
	})
})

describe("joins", () => {
	test("joinNames", () => {
		expect(joinNames([])).toBe("")
		expect(joinNames(["A"])).toBe("A")
		expect(joinNames(["A", "B"])).toBe("A and B")
		expect(joinNames(["A", "B", "C"])).toBe("A, B and C")
	})

	test("consequenceSentences alone and with others", () => {
		expect(
			consequenceSentences({ along: [], reading: ["main"], source: "B" })
		).toEqual([
			"main will start reading it, and so will the sessions playing on it.",
			"Its dated changes and links written on B stay on B.",
			"It can't be moved back."
		])
		expect(
			consequenceSentences({
				along: ["P", "Q"],
				reading: ["A", "B"],
				source: "B"
			})
		).toEqual([
			"Also moves P and Q: entries filed under one another move together.",
			"A and B will start reading them, and so will the sessions playing on them.",
			"Their dated changes and links written on B stay on B.",
			"They can't be moved back."
		])
	})
})
