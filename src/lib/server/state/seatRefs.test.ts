/**
 * 🚧 `memberFormOf` / `memberFormTargetsOf` (plan §34.1): the one pure
 * translator from card form to member form, answering exactly the seat
 * `seatOf("character:<card>")` answers.
 */
import { describe, expect, test } from "vitest"
import {
	memberFormOf,
	memberFormTargetsOf,
	seatMapOf,
	type SeatMapSeat
} from "$lib/server/state/seatRefs"

const character = (
	seatId: number,
	cardId: number | null,
	castMemberId: number | null,
	extra: Partial<SeatMapSeat> = {}
): SeatMapSeat => ({
	kind: "character",
	seatId,
	cardId,
	castMemberId,
	departed: false,
	position: 0,
	...extra
})
const player = (
	seatId: number,
	cardId: number | null,
	castMemberId: number | null,
	extra: Partial<SeatMapSeat> = {}
): SeatMapSeat => ({
	kind: "player",
	seatId,
	cardId,
	castMemberId,
	departed: false,
	position: 0,
	...extra
})

describe("memberFormOf", () => {
	test("a character seat answers its cast member, in the input's shape", () => {
		const map = seatMapOf(1, [character(10, 7, 70)])
		expect(memberFormOf(map, "character:7")).toBe("seated-member:70")
		expect(memberFormOf(map, "7")).toBe("seated_member:70")
		expect(memberFormOf(map, { kind: "session_cast", id: 7 })).toEqual({
			kind: "seated_member",
			id: 70
		})
	})

	test("a player seat answers its seat id, card or not", () => {
		const map = seatMapOf(1, [player(20, 8, 80)])
		expect(memberFormOf(map, "character:8")).toBe("player-seat:20")
		expect(memberFormOf(map, "8")).toBe("player_seat:20")
		expect(memberFormOf(map, { kind: "session_cast", id: 8 })).toEqual({
			kind: "player_seat",
			id: 20
		})
	})

	test("a live seat wins over a departed one, in either table", () => {
		const map = seatMapOf(1, [
			character(10, 7, 70, { departed: true }),
			player(20, 7, 71)
		])
		expect(memberFormOf(map, "character:7")).toBe("player-seat:20")
	})

	test("the character seat wins over the player seat when both are live (the merged pair)", () => {
		const map = seatMapOf(1, [player(20, 7, 70), character(10, 7, 70)])
		expect(memberFormOf(map, "character:7")).toBe("seated-member:70")
		expect(memberFormOf(map, { kind: "session_cast", id: 7 })).toEqual({
			kind: "seated_member",
			id: 70
		})
	})

	test("among player seats, the lowest position, then the lowest seat id", () => {
		expect(
			memberFormOf(
				seatMapOf(1, [player(21, 9, null, { position: 2 }), player(22, 9, null, { position: 1 })]),
				"character:9"
			)
		).toBe("player-seat:22")
		expect(
			memberFormOf(
				seatMapOf(1, [player(24, 9, null, { position: 1 }), player(23, 9, null, { position: 1 })]),
				"character:9"
			)
		).toBe("player-seat:23")
	})

	test("a hard-deleted card (no seat holds it) is null", () => {
		const map = seatMapOf(1, [character(10, 7, 70)])
		expect(memberFormOf(map, "character:99")).toBeNull()
		expect(memberFormOf(map, "99")).toBeNull()
		expect(memberFormOf(map, { kind: "session_cast", id: 99 })).toBeNull()
	})

	test("a member-less character seat is null, never the next seat", () => {
		const map = seatMapOf(1, [character(10, 7, null), player(20, 7, 70)])
		expect(memberFormOf(map, "character:7")).toBeNull()
	})

	test("card id N and member id N never cross", () => {
		// Card 5 sits in seat 10 as member 6; member 5 sits in seat 11 holding card 6.
		const map = seatMapOf(1, [character(10, 5, 6), character(11, 6, 5)])
		expect(memberFormOf(map, "character:5")).toBe("seated-member:6")
		expect(memberFormOf(map, "character:6")).toBe("seated-member:5")
		expect(memberFormOf(map, "5")).toBe("seated_member:6")
		// Member forms come back as they are — never re-read as a card id.
		expect(memberFormOf(map, "seated-member:5")).toBe("seated-member:5")
		expect(memberFormOf(map, "seated_member:5")).toBe("seated_member:5")
		expect(memberFormOf(map, { kind: "seated_member", id: 5 })).toEqual({
			kind: "seated_member",
			id: 5
		})
		expect(memberFormOf(map, { kind: "cast_member", id: 5 })).toEqual({
			kind: "cast_member",
			id: 5
		})
	})

	test("anything that is not card form comes back unchanged", () => {
		const map = seatMapOf(1, [character(10, 7, 70)])
		for (const ref of ["player-seat:3", "player_seat:3", "user:7", "location:harbor", "", "character:0", "character:x"])
			expect(memberFormOf(map, ref)).toBe(ref)
		const card = { kind: "card", id: 7 }
		expect(memberFormOf(map, card)).toBe(card)
		const session = { kind: "session", id: 1 }
		expect(memberFormOf(map, session)).toBe(session)
	})

	test("an envoy seat is never in the map, so its card does not translate", () => {
		// `loadSeatMap` leaves envoys out; a map without the seat answers null.
		expect(memberFormOf(seatMapOf(1, []), "character:7")).toBeNull()
	})
})

describe("memberFormTargetsOf (★K-2: copy to every seat)", () => {
	test("a card in a character seat AND player seats answers every seat, seatOf's first first", () => {
		const map = seatMapOf(1, [
			player(21, 7, 71, { position: 1 }),
			character(10, 7, 70),
			player(20, 7, 72, { departed: true })
		])
		expect(memberFormTargetsOf(map, "character:7")).toEqual([
			"seated-member:70",
			"player-seat:21",
			"player-seat:20"
		])
		expect(memberFormTargetsOf(map, "7")[0]).toBe(memberFormOf(map, "7"))
		expect(memberFormTargetsOf(map, { kind: "session_cast", id: 7 })).toEqual([
			{ kind: "seated_member", id: 70 },
			{ kind: "player_seat", id: 21 },
			{ kind: "player_seat", id: 20 }
		])
	})

	test("a member-less seat is skipped; no seat is empty; not card form is itself", () => {
		const map = seatMapOf(1, [character(10, 7, null), player(20, 7, null)])
		expect(memberFormTargetsOf(map, "character:7")).toEqual(["player-seat:20"])
		expect(memberFormTargetsOf(map, "character:8")).toEqual([])
		expect(memberFormTargetsOf(map, "seated-member:7")).toEqual(["seated-member:7"])
	})
})
