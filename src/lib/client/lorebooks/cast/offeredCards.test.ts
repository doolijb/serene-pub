/**
 * The card picker offers only cards no other cast member has (plan A25): a
 * card draws one member, linked or drawn with from a date on any line, and
 * the server refuses the rest — so the picker must not offer them.
 */
import { describe, expect, test } from "vitest"
import { offeredCards } from "./offeredCards"

const cards = [1, 2, 3, 4, 5].map((id) => ({ id, name: `Card ${id}` }))
const members = [
	{ id: 10, characterId: 1 },
	{ id: 11, characterId: null }
]
const amendments: Record<number, { fields: Record<string, unknown> }[]> = {
	10: [{ fields: { characterId: 2 } }],
	11: [{ fields: { characterId: 3 } }, { fields: { name: "Only a name" } }]
}
const amendmentsOf = (id: number) => amendments[id] ?? []

describe("offeredCards (A25)", () => {
	test("a new member is offered no card any member has, linked or dated", () => {
		const offered = offeredCards({
			characters: cards,
			members,
			resolved: members,
			amendmentsOf,
			target: null
		})
		expect(offered.map((c) => c.id)).toEqual([4, 5])
	})

	test("a member is offered their own dated cards, never another member's", () => {
		const offered = offeredCards({
			characters: cards,
			members,
			resolved: members,
			amendmentsOf,
			target: 11
		})
		expect(offered.map((c) => c.id)).toEqual([3, 4, 5])
	})

	test("a card a member reads as at the moment is not offered back", () => {
		const offered = offeredCards({
			characters: cards,
			members,
			resolved: [
				{ id: 10, characterId: 1 },
				{ id: 11, characterId: 4 }
			],
			amendmentsOf,
			target: 11
		})
		expect(offered.map((c) => c.id)).toEqual([3, 5])
	})
})
