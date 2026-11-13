import { afterEach, describe, expect, test } from "vitest"
import { memberFormSwitch } from "./memberForm"
import {
	isOwnerKind,
	OWNER_KINDS,
	ownerFacet,
	resolutionChain
} from "./owners"

const switchWas = memberFormSwitch.on

describe("owner kinds", () => {
	afterEach(() => {
		memberFormSwitch.on = switchWas
	})

	test("🚧 `player_seat` is an owner kind, filed with the cast", () => {
		expect(OWNER_KINDS).toContain("player_seat")
		expect(isOwnerKind("player_seat")).toBe(true)
		expect(ownerFacet("player_seat")).toBe("cast")
	})

	test("a seat has no card behind it: its chain is itself alone (switch off)", () => {
		memberFormSwitch.on = false
		expect(
			resolutionChain({ kind: "player_seat", id: 4 }, { characterId: 9, castMemberId: 3 })
		).toEqual([{ kind: "player_seat", id: 4 }])
	})

	test("switch on: a player seat falls through the own book's member, the attached member, then its card", () => {
		memberFormSwitch.on = true
		expect(
			resolutionChain({ kind: "player_seat", id: 4 }, { characterId: 9, castMemberId: 3 })
		).toEqual([
			{ kind: "player_seat", id: 4 },
			{ kind: "cast_member", id: 3 },
			{ kind: "card", id: 9 }
		])
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

	test("🚧 (m3b-V2) the session's own book is read before the attached book's", () => {
		expect(
			resolutionChain(
				{ kind: "session_cast", id: 9 },
				{ ownBookMemberId: 7, castMemberId: 3 }
			)
		).toEqual([
			{ kind: "session_cast", id: 9 },
			{ kind: "cast_member", id: 7 },
			{ kind: "cast_member", id: 3 },
			{ kind: "card", id: 9 }
		])
		expect(
			resolutionChain({ kind: "session", id: 1 }, { ownBookId: 20, lorebookId: 10 })
		).toEqual([
			{ kind: "session", id: 1 },
			{ kind: "lorebook", id: 20 },
			{ kind: "lorebook", id: 10 }
		])
	})

	test("🚧 (m3b-V2) without the own book's keys the chains are as before; the same id is never read twice", () => {
		expect(resolutionChain({ kind: "session", id: 1 }, { lorebookId: 10 })).toEqual([
			{ kind: "session", id: 1 },
			{ kind: "lorebook", id: 10 }
		])
		expect(
			resolutionChain({ kind: "session_cast", id: 9 }, { ownBookMemberId: 3, castMemberId: 3 })
		).toEqual([
			{ kind: "session_cast", id: 9 },
			{ kind: "cast_member", id: 3 },
			{ kind: "card", id: 9 }
		])
		expect(
			resolutionChain({ kind: "session", id: 1 }, { ownBookId: 10, lorebookId: 10 })
		).toEqual([
			{ kind: "session", id: 1 },
			{ kind: "lorebook", id: 10 }
		])
	})
})
