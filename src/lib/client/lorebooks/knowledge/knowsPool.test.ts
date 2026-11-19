/** 🚧 The Knows tab's arithmetic: zones, order, filter, count. */
import { describe, expect, test } from "vitest"
import { knowsCount, otherEntries, tiedRows } from "./knowsPool"

type Row = Sockets.EntryKnowledge.Row

const row = (entryId: number, over: Partial<Row> = {}): Row => ({
	castMemberId: 1,
	name: "Mara",
	entryId,
	known: true,
	winner: null,
	hand: null,
	overruled: null,
	placeEntry: false,
	...over
})
const win = (kind: any, hand = false) => ({
	tieId: 1,
	kind,
	relationshipType: kind ?? "friend",
	hand,
	date: null
})

const entries = [
	{ id: 1, name: "Zed", typeId: "character" },
	{ id: 2, name: "apple", typeId: "item" },
	{ id: 3, name: "Mill", typeId: "place" },
	{ id: 4, name: "Bell", typeId: "item" }
]

describe("tiedRows", () => {
	test("rows with a winner or a hand, by entry name", () => {
		const rows = [
			row(1, { winner: win("knows", true), hand: "knows" }),
			row(2, { winner: win("was_told") }),
			row(3), // marked, no tie: not tied
			row(4, { hand: "kept_from", known: false })
		]
		expect(tiedRows(rows, entries).map((t) => t.name)).toEqual([
			"apple",
			"Bell",
			"Zed"
		])
	})

	test("an entry the book does not hold is Untitled, with no type", () => {
		const t = tiedRows([row(99, { winner: win("was_told") })], entries)
		expect(t).toHaveLength(1)
		expect(t[0].name).toBe("Untitled")
		expect(t[0].typeId).toBeNull()
	})
})

describe("otherEntries", () => {
	const rows = [row(1, { winner: win("knows", true), hand: "knows" })]

	test("everything not tied; marked first, each group by name", () => {
		const out = otherEntries(
			rows,
			entries,
			(id) => id === 3 || id === 4,
			""
		)
		expect(out.map((o) => [o.entry.name, o.marked])).toEqual([
			["Bell", true],
			["Mill", true],
			["apple", false]
		])
	})

	test("the filter is a case-insensitive substring of the name", () => {
		const out = otherEntries(rows, entries, () => false, "LL")
		expect(out.map((o) => o.entry.name)).toEqual(["Bell", "Mill"])
	})

	test("the filter never touches the tied zone", () => {
		expect(tiedRows(rows, entries)).toHaveLength(1)
		expect(otherEntries(rows, entries, () => false, "zzz")).toEqual([])
	})
})

describe("knowsCount", () => {
	test("known by a tie that is not kept-from", () => {
		const rows = [
			row(1, { winner: win("knows", true) }),
			row(2, { winner: win(null) }),
			row(3, { winner: win("kept_from", true), known: false }),
			row(4), // common knowledge, no tie
			row(5, { winner: win("was_told"), known: false })
		]
		expect(knowsCount(rows)).toBe(2)
	})
})
