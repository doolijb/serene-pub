import { describe, expect, it } from "vitest"
import { rotationPersonas, rotationSeats } from "$lib/server/pipelines/runtime/speakerRotation"

describe("rotationSeats — card-less seats", () => {
	it("skips a seat whose character has no card id, keeps carded seats", () => {
		const seats = rotationSeats({
			sessionCharacters: [
				{
					enabled: true,
					position: 0,
					character: { name: "Sable" },
					castMemberId: 8
				},
				{
					enabled: true,
					position: 1,
					character: { id: 4, name: "D", userId: 2 }
				}
			]
		})
		expect(seats.map((s) => s.characterId)).toEqual([4])
	})
})

describe("rotationSeats / rotationPersonas — a benched seat is out of play (owner 2026-11-10)", () => {
	it("skips a character seat with enabled: false and a persona row with enabled: false", () => {
		const cast = {
			sessionCharacters: [
				{ enabled: false, position: 0, character: { id: 3, name: "B" } },
				{ enabled: true, position: 1, character: { id: 4, name: "D" } }
			],
			sessionPersonas: [
				{ enabled: false, persona: { id: 7, userId: 1 } },
				{ enabled: true, persona: { id: 8, userId: 2 } },
				{ persona: { id: 9, userId: 3 } }
			]
		}
		expect(rotationSeats(cast).map((s) => s.characterId)).toEqual([4])
		expect(rotationPersonas(cast).map((p) => p.personaId)).toEqual([8, 9])
	})
})
