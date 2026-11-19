/**
 * A seat moved between the groups leaves the old seat departed and opens a
 * live one of the other kind for the same cast member: an old line keeps
 * finding the seat it was stamped for.
 */
import { describe, expect, test } from "vitest"
import { seatOfMessage, type SeatsPayload } from "./seatIdentity"

const GONE = "2026-11-17"
const M = 40
const P = 71
const X = 72

describe("seatOfMessage after a move", () => {
	test("a person to AI move: the old user line finds the departed player seat, not the live character seat", () => {
		const payload: SeatsPayload = {
			sessionCharacters: [
				{ id: 5, castMemberId: M, ref: `seated-member:${M}` }
			],
			sessionPersonas: [
				{ id: X, castMemberId: M, ref: `player-seat:${X}`, removedAt: GONE }
			]
		}
		const found = seatOfMessage(payload, {
			role: "user",
			castMemberId: M,
			metadata: { speaker: `player-seat:${X}` }
		})
		expect(found?.form).toBe("player")
		expect(found?.seat.id).toBe(X)
		expect(found?.seat.removedAt).toBe(GONE)
	})

	test("an AI to person move: each old line finds the seat of its own kind", () => {
		const payload: SeatsPayload = {
			sessionCharacters: [
				{
					id: 5,
					castMemberId: M,
					ref: `seated-member:${M}`,
					removedAt: GONE
				}
			],
			sessionPersonas: [
				{ id: P, castMemberId: M, ref: `player-seat:${P}` }
			]
		}
		const assistant = seatOfMessage(payload, {
			role: "assistant",
			castMemberId: M,
			metadata: { speaker: `seated-member:${M}` }
		})
		expect(assistant?.form).toBe("character")
		expect(assistant?.seat.id).toBe(5)
		expect(assistant?.seat.removedAt).toBe(GONE)
		const user = seatOfMessage(payload, {
			role: "user",
			castMemberId: M,
			metadata: { speaker: `player-seat:${P}` }
		})
		expect(user?.form).toBe("player")
		expect(user?.seat.id).toBe(P)
		expect(user?.seat.removedAt).toBeUndefined()
	})

	test("unstamped lines pick the seat by the line's kind", () => {
		const payload: SeatsPayload = {
			sessionCharacters: [
				{ id: 5, castMemberId: M, ref: `seated-member:${M}`, removedAt: GONE }
			],
			sessionPersonas: [{ id: P, castMemberId: M, ref: `player-seat:${P}` }]
		}
		expect(
			seatOfMessage(payload, { role: "assistant", castMemberId: M })?.seat.id
		).toBe(5)
		expect(
			seatOfMessage(payload, { role: "user", castMemberId: M })?.seat.id
		).toBe(P)
	})
})
