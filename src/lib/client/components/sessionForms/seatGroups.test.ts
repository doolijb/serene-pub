import { describe, expect, test } from "vitest"
import {
	differingHandovers,
	fillGroupSlots,
	groupPeople,
	handoverSeatOf,
	isMoveValue,
	MOVE_TO_AI,
	moveTargetOf,
	moveToPersonValue,
	seatMovesOf,
	swapWithinGroup
} from "./seatGroups"

type Row = { id: number; who: number }
// One session-wide order: person 1 and person 2 interleaved.
const order: Row[] = [
	{ id: 1, who: 1 },
	{ id: 2, who: 2 },
	{ id: 3, who: 1 },
	{ id: 4, who: 2 },
	{ id: 5, who: 1 }
]
const of = (who: number) => (r: Row) => r.who === who
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe("swapWithinGroup", () => {
	test("down swaps with the nearest row of the same group; foreign rows stay", () => {
		expect(ids(swapWithinGroup(order, 0, 1, of(1)))).toEqual([3, 2, 1, 4, 5])
		expect(ids(swapWithinGroup(order, 1, 1, of(2)))).toEqual([1, 4, 3, 2, 5])
	})
	test("up swaps with the nearest row of the same group", () => {
		expect(ids(swapWithinGroup(order, 4, -1, of(1)))).toEqual([1, 2, 5, 4, 3])
	})
	test("at the group's ends nothing moves", () => {
		expect(ids(swapWithinGroup(order, 0, -1, of(1)))).toEqual([1, 2, 3, 4, 5])
		expect(ids(swapWithinGroup(order, 4, 1, of(1)))).toEqual([1, 2, 3, 4, 5])
		expect(ids(swapWithinGroup(order, 3, 1, of(2)))).toEqual([1, 2, 3, 4, 5])
	})
})

describe("fillGroupSlots", () => {
	test("a group's new order fills its slots; foreign rows keep their places", () => {
		const mine = [order[4], order[0], order[2]]
		expect(ids(fillGroupSlots(order, of(1), mine))).toEqual([5, 2, 1, 4, 3])
	})
	test("with one group the result is the items", () => {
		const one = order.map((r) => ({ ...r, who: 1 }))
		const items = [one[3], one[1], one[0], one[2], one[4]]
		expect(fillGroupSlots(one, of(1), items)).toEqual(items)
	})
	test("a row gained goes after the group's last slot; one lost closes up", () => {
		const extra = { id: 9, who: 1 }
		expect(
			ids(
				fillGroupSlots(order, of(1), [order[0], order[2], order[4], extra])
			)
		).toEqual([1, 2, 3, 4, 5, 9])
		expect(ids(fillGroupSlots(order, of(2), [order[3]]))).toEqual([1, 4, 3, 5])
	})
})

describe("groupPeople, differingHandovers, handoverSeatOf", () => {
	test("people first, then any other player once", () => {
		expect(groupPeople([1, 2], [3, 2, 3])).toEqual([1, 2, 3])
	})
	test("only entries that differ from the saved person, sorted by key", () => {
		const draft = new Map([
			["member:9", 2],
			["character:4", 1],
			["player:3", 2]
		])
		const saved = (k: string) => ({ "character:4": 1, "member:9": 1, "player:3": 1 })[k]
		expect(differingHandovers(draft, saved)).toEqual([
			{ key: "member:9", toUserId: 2 },
			{ key: "player:3", toUserId: 2 }
		])
	})
	test("a key names its seat", () => {
		expect(handoverSeatOf("character:4")).toEqual({ characterId: 4 })
		expect(handoverSeatOf("member:5")).toEqual({ castMemberId: 5 })
		expect(handoverSeatOf("player:6")).toEqual({ playerSeatId: 6 })
	})
})

describe("seat moves", () => {
	test("move values are never a user id, and name their person", () => {
		expect(isMoveValue(MOVE_TO_AI)).toBe(true)
		expect(isMoveValue(moveToPersonValue(3))).toBe(true)
		expect(isMoveValue("3")).toBe(false)
		expect(isMoveValue("")).toBe(false)
		expect(moveTargetOf(moveToPersonValue(3))).toBe(3)
		expect(moveTargetOf(MOVE_TO_AI)).toBeNull()
		expect(moveTargetOf("3")).toBeNull()
	})

	test("seatMovesOf: a player seat to the AI, a character seat to a person, sorted by key", () => {
		const draft = new Map([
			["player:12", MOVE_TO_AI],
			["member:31", moveToPersonValue(2)],
			["character:51", moveToPersonValue(1)]
		])
		const seatId = (key: string) =>
			({ "member:31": 22, "character:51": 21 })[key]
		expect(seatMovesOf(draft, seatId)).toEqual([
			{ characterSeatId: 21, toUserId: 1 },
			{ characterSeatId: 22, toUserId: 2 },
			{ playerSeatId: 12 }
		])
	})

	test("seatMovesOf: an empty draft, a vanished seat and a mismatched value send nothing", () => {
		expect(seatMovesOf(new Map(), () => 1)).toEqual([])
		expect(
			seatMovesOf(new Map([["member:9", moveToPersonValue(2)]]), () => null)
		).toEqual([])
		expect(seatMovesOf(new Map([["player:9", "2"]]), () => 1)).toEqual([])
		expect(seatMovesOf(new Map([["member:9", MOVE_TO_AI]]), () => 1)).toEqual(
			[]
		)
	})
})
