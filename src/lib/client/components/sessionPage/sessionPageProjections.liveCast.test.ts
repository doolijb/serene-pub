/** Who is in the session now: live seats only, one entry per card or member. */
import { describe, expect, test } from "vitest"
import { headerCastKeyOf } from "./sessionPageProjections"
import {
	cardlessSeatsAsShown,
	seatCardsAsShown
} from "./projections/characters"
import { messageRefOf } from "./projections/seatIdentity"

const card = (id: number, name: string) => ({ id, name, nickname: "" })

/**
 * 1 Mara: character seat only. 2 Wren: removed player seat, live character seat
 * (moved to the AI). 3 Tobin: revived player seat, removed character seat.
 * 4 Ivy: both seats live. Member 90: a card-less live character seat.
 */
const session = () =>
	({
		sessionCharacters: [
			{ id: 1, characterId: 1, castMemberId: 11, position: 0, removedAt: null, character: card(1, "Mara") },
			{ id: 2, characterId: 2, castMemberId: 12, position: 1, removedAt: null, character: card(2, "Wren") },
			{ id: 3, characterId: 3, castMemberId: 13, position: 2, removedAt: "2026-11-17", character: card(3, "Tobin") },
			{ id: 4, characterId: 4, castMemberId: 14, position: 3, removedAt: null, character: card(4, "Ivy") },
			{ id: 5, characterId: null, castMemberId: 90, position: 4, removedAt: null, character: null }
		],
		sessionPersonas: [
			{ id: 20, personaId: 2, castMemberId: 12, removedAt: "2026-11-17", persona: card(2, "Wren") },
			{ id: 21, personaId: 3, castMemberId: 13, removedAt: null, persona: card(3, "Tobin") },
			{ id: 22, personaId: 4, castMemberId: 14, removedAt: null, persona: card(4, "Ivy") }
		],
		cardlessSeatShown: { 90: { name: "Brindle", nickname: null, faceMediaId: null } },
		sessionMessages: []
	}) as any

describe("one rule for who is in the session now", () => {
	test("the header cast: live seats, one disc per card, a card-less seat by its member's name", () => {
		const names = JSON.parse(headerCastKeyOf(session(), null)).map((m: any) => m.name)
		expect(names).toEqual(["Mara", "Wren", "Ivy", "Brindle", "Tobin"])
	})

	test("Details > Cast lists live character seats once, and card-less seats by member", () => {
		expect(seatCardsAsShown(session()).map((c: any) => c.name)).toEqual(["Mara", "Wren", "Ivy"])
		expect(cardlessSeatsAsShown(session()).map((c) => c.name)).toEqual(["Brindle"])
	})

	test("a member named twice is one entry", () => {
		const s = session()
		s.sessionCharacters.push({ id: 6, characterId: null, castMemberId: 90, removedAt: null, character: null })
		expect(cardlessSeatsAsShown(s)).toHaveLength(1)
	})

	test("an old line spoken from a removed seat names its person by the live seat", () => {
		const s = session()
		const live = messageRefOf(s, { characterId: 2, role: "assistant" } as any)
		const old = messageRefOf(s, { personaId: 2, role: "user", castMemberId: 12 } as any)
		expect(old).toBe(live)
		// A line from a seat that is still live keeps that seat's own ref.
		expect(messageRefOf(s, { personaId: 3, role: "user", castMemberId: 13 } as any)).toBe(
			"character:3"
		)
	})
})
