import { describe, expect, it } from "vitest"
import { composeCast, splitPayload, type SessionPayload } from "./records"

const card = (id: number, name = `C${id}`) => ({ id, name }) as any

function payload(extra: Record<string, unknown> = {}): SessionPayload {
	return {
		id: 7,
		name: "S",
		sessionMessages: [
			{ id: 3, sessionId: 7 },
			{ id: 1, sessionId: 7 }
		],
		sessionCharacters: [
			{ sessionId: 7, characterId: 10, character: card(10) },
			{ sessionId: 7, characterId: 11, character: card(11) }
		],
		sessionPersonas: [{ sessionId: 7, personaId: 10, persona: card(10) }],
		...extra
	} as any
}

describe("splitPayload", () => {
	it("sorts rows ascending and splits the collections away from the session row", () => {
		const { session, rows, members } = splitPayload(payload())
		expect(rows.map((r) => r.id)).toEqual([1, 3])
		expect("sessionMessages" in session).toBe(false)
		expect("sessionCharacters" in session).toBe(false)
		expect(members.characters.every((s) => !("character" in s))).toBe(true)
		expect(members.personas.every((s) => !("persona" in s))).toBe(true)
	})

	it("holds a card seated as a character AND a persona once", () => {
		const { cards } = splitPayload(payload())
		expect(cards.map((c) => c.id).sort()).toEqual([10, 11])
	})
})

describe("composeCast", () => {
	it("round-trips a two-seat payload", () => {
		const src = payload()
		const { members, cards } = splitPayload(src)
		const byId = new Map(cards.map((c) => [c.id, c]))
		const cast = composeCast(members, (id) => byId.get(id))
		expect(cast.sessionCharacters).toEqual(src.sessionCharacters)
		expect(cast.sessionPersonas).toEqual(src.sessionPersonas)
	})

	it("composes null for a seat whose card is not held", () => {
		const { members } = splitPayload(payload())
		const cast = composeCast(members, () => undefined)
		expect(cast.sessionCharacters.every((s) => s.character === null)).toBe(true)
		expect(cast.sessionPersonas[0].persona === null).toBe(true)
	})

	it("leaves sessionGuests absent when the payload had none, present when it had", () => {
		const none = composeCast(splitPayload(payload()).members, () => undefined)
		expect("sessionGuests" in none).toBe(false)
		const guests = [{ sessionId: 7, userId: 2 }]
		const some = composeCast(splitPayload(payload({ sessionGuests: guests })).members, () => undefined)
		expect(some.sessionGuests).toEqual(guests)
	})
})
