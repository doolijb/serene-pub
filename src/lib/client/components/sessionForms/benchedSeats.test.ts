import { describe, expect, test } from "vitest"
import { seatFellInStory, seatHasNoLines } from "./benchedSeats"

const later = { id: 20, personaId: null, userId: 5, removedAt: null }

describe("seatFellInStory", () => {
	test("a host-filled fellInStory: true is fallen, for either kind", () => {
		expect(seatFellInStory(null, { fellInStory: true }, "character")).toBe(
			true
		)
		expect(
			seatFellInStory(null, { id: 1, fellInStory: true }, "player")
		).toBe(true)
	})
	test("absent, false or not a boolean is not fallen", () => {
		expect(seatFellInStory(null, {}, "character")).toBe(false)
		expect(seatFellInStory(null, { fellInStory: false }, "character")).toBe(
			false
		)
		expect(seatFellInStory(null, { fellInStory: "yes" }, "character")).toBe(
			false
		)
	})
	test("a benched player seat followed by a later card-less seat of the same player fell", () => {
		const row = { id: 10, isActive: false, userId: 5, personaId: null }
		expect(
			seatFellInStory({ sessionPersonas: [row, later] }, row, "player")
		).toBe(true)
	})
	test("the player is read off the card when the seat has no userId", () => {
		const row = {
			id: 10,
			isActive: false,
			personaId: 3,
			persona: { userId: 5 }
		}
		expect(
			seatFellInStory({ sessionPersonas: [row, later] }, row, "player")
		).toBe(true)
	})
	test("a seat in play, a removed one or another player's does not fall by rule (b)", () => {
		const live = { id: 10, isActive: true, userId: 5, personaId: null }
		const removed = {
			id: 10,
			isActive: false,
			removedAt: new Date(),
			userId: 5
		}
		const other = { id: 10, isActive: false, userId: 6, personaId: null }
		expect(
			seatFellInStory({ sessionPersonas: [live, later] }, live, "player")
		).toBe(false)
		expect(
			seatFellInStory(
				{ sessionPersonas: [removed, later] },
				removed,
				"player"
			)
		).toBe(false)
		expect(
			seatFellInStory(
				{ sessionPersonas: [other, later] },
				other,
				"player"
			)
		).toBe(false)
	})
	test("an earlier, removed or carded later seat does not count", () => {
		const row = { id: 10, isActive: false, userId: 5, personaId: null }
		const earlier = { ...later, id: 9 }
		const gone = { ...later, removedAt: new Date() }
		const carded = { ...later, personaId: 2 }
		for (const o of [earlier, gone, carded])
			expect(
				seatFellInStory({ sessionPersonas: [row, o] }, row, "player")
			).toBe(false)
	})
	test("rule (b) never applies to a character seat", () => {
		const row = { id: 10, isActive: false, userId: 5, personaId: null }
		expect(
			seatFellInStory({ sessionPersonas: [row, later] }, row, "character")
		).toBe(false)
	})
})

describe("seatHasNoLines", () => {
	test("only hasLines: false says so", () => {
		expect(seatHasNoLines({ hasLines: false })).toBe(true)
		expect(seatHasNoLines({ hasLines: true })).toBe(false)
		expect(seatHasNoLines({})).toBe(false)
		expect(seatHasNoLines({ hasLines: 0 })).toBe(false)
	})
})
