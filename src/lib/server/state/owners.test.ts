import { describe, expect, test } from "vitest"
import {
	isOwnerKind,
	OWNER_KINDS,
	ownerFacet,
	resolutionChain
} from "./owners"

describe("owner kinds", () => {
	test("🚧 `player_seat` is an owner kind, filed with the cast", () => {
		expect(OWNER_KINDS).toContain("player_seat")
		expect(isOwnerKind("player_seat")).toBe(true)
		expect(ownerFacet("player_seat")).toBe("cast")
	})

	test("a seat has no card behind it: its chain is itself alone", () => {
		expect(
			resolutionChain({ kind: "player_seat", id: 4 }, { characterId: 9, castMemberId: 3 })
		).toEqual([{ kind: "player_seat", id: 4 }])
	})

	test("a seated character still falls through member and card", () => {
		expect(
			resolutionChain({ kind: "session_cast", id: 9 }, { castMemberId: 3 })
		).toEqual([
			{ kind: "session_cast", id: 9 },
			{ kind: "cast_member", id: 3 },
			{ kind: "card", id: 9 }
		])
	})
})
