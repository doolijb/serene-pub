/**
 * 🚧 A card-less CHARACTER seat's line is named by the seat with no card whose
 * member spoke it (seat-cast S4). Card ids and member ids share one id range,
 * so the rows here deliberately overlap (member 1, card 1).
 */
import { describe, expect, it } from "vitest"
import { SessionMessageProcessor } from "./contentProcessors"

const engine = { interpolateString: (text: string) => text }
const context = {
	interpolationContext: {} as any,
	charName: "Verity",
	personaName: "",
	priority: 0
}

const cast = {
	sessionCharacters: [
		{ character: { id: 1, name: "Vell" }, castMemberId: null },
		{
			characterId: null,
			castMemberId: 1,
			character: { cardless: true, name: "Ash" }
		}
	],
	removedSessionCharacters: [
		{
			characterId: null,
			castMemberId: 7,
			character: { cardless: true, name: "Gone" },
			removedName: "Departed"
		}
	],
	sessionPersonas: [
		{
			persona: null,
			seatName: "Wren",
			seatId: 4,
			seatUserId: 2,
			castMemberId: 1
		}
	]
}

const line = (over: Record<string, unknown>) =>
	({
		id: 1,
		role: "assistant",
		content: "hello",
		userId: null,
		personaId: null,
		characterId: null,
		...over
	}) as any

const named = (over: Record<string, unknown>) =>
	new SessionMessageProcessor(cast as any, engine).processItem(
		line(over),
		context
	)!.name

describe("a card-less character line in the session processor", () => {
	it("is named by the seat of the member its speaker stamp names", () => {
		expect(named({ speaker: "seated-member:1" })).toBe("Ash")
		expect(named({ metadata: { speaker: "seated-member:1" } })).toBe("Ash")
	})

	it("with no stamp, is named by its castMemberId", () => {
		expect(named({ castMemberId: 1 })).toBe("Ash")
	})

	it("a card-less PLAYER line with the same member is not named as the character seat", () => {
		expect(
			named({
				role: "user",
				userId: 2,
				castMemberId: 1,
				speaker: "player-seat:4"
			})
		).toBe("Wren")
		// even when stamped as an assistant line by a player seat
		expect(
			named({ castMemberId: 1, metadata: { speaker: "player-seat:4" } })
		).not.toBe("Ash")
	})

	it("a departed card-less seat's line is still named", () => {
		// The departed seat's card-shaped read names it; its `removedName`
		// snapshot stands in only when that read is gone.
		expect(named({ speaker: "seated-member:7" })).toBe("Gone")
	})

	it("a member no card-less seat holds is never the unclaimed name's lookalike of a seat", () => {
		expect(named({ speaker: "seated-member:99" })).not.toBe("Ash")
	})
})
