/**
 * `hearingWithHiddenStats` — a seater's own AI seats added to their hearing on request; a
 * player seat is never added, and a hearing that already hears everything is
 * returned as it came.
 */
import { describe, expect, test } from "vitest"
import { hearingWithHiddenStats, hears, type Hearing } from "./earshot"

const links = {
	cast: [
		{ characterId: 10, seatMemberId: 100, playerSeatId: null },
		{ characterId: 11, seatMemberId: 101, playerSeatId: 5 },
		{ characterId: 12, seatMemberId: 102, playerSeatId: null }
	],
	seatedMembers: [{ seatMemberId: 200 }, { seatMemberId: 201 }]
} as any

const own: Hearing = { all: false, characterIds: new Set(["mine"]) }

describe("hearingWithHiddenStats", () => {
	test("is unchanged when the hearing is all, or no member is asked for", () => {
		const all: Hearing = { all: true }
		expect(hearingWithHiddenStats(all, links, new Set([100]))).toBe(all)
		expect(hearingWithHiddenStats(own, links, new Set())).toBe(own)
	})

	test("adds a carded seat's two keys and a card-less seat's key, keeping the hearing's own", () => {
		const h = hearingWithHiddenStats(own, links, new Set([100, 200]))
		expect(h.all).toBe(false)
		expect(hears(h, "mine")).toBe(true)
		expect(hears(h, "10")).toBe(true)
		expect(hears(h, "seated_member:100")).toBe(true)
		expect(hears(h, "seated_member:200")).toBe(true)
		expect(hears(h, "12")).toBe(false)
		expect(hears(h, "seated_member:201")).toBe(false)
		// The input is not mutated.
		expect(hears(own, "10")).toBe(false)
	})

	test("never adds a player seat, even when its member is named", () => {
		const h = hearingWithHiddenStats(own, links, new Set([101]))
		expect(hears(h, "11")).toBe(false)
		expect(hears(h, "player_seat:5")).toBe(false)
		expect(hears(h, "seated_member:101")).toBe(false)
	})
})
