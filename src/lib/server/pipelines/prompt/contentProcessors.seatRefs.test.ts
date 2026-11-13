/**
 * 🚧 A person's own line is named by the seat its sender resolves to (plan
 * §27, S3): the processor passes the SDK's `senderRefOf` a lookup built from
 * the cast read it holds, and finds the seat by the ref the lookup answers
 * rather than parsing an id out of it.
 */
import { describe, expect, it } from "vitest"
import { SessionMessageProcessor } from "./contentProcessors"

const engine = { interpolateString: (text: string) => text }
const context = (personaName = "") => ({
	interpolationContext: {} as any,
	charName: "Verity",
	personaName,
	priority: 0
})

const seats = (refs: [string, string]) => [
	{
		persona: null,
		seatName: "Wren",
		seatId: 4,
		seatUserId: 1,
		castMemberId: 10,
		ref: refs[0]
	},
	{
		persona: null,
		seatName: "Bo",
		seatId: 5,
		seatUserId: 2,
		castMemberId: 11,
		ref: refs[1]
	}
]

const line = (over: Record<string, unknown>) =>
	({
		id: 1,
		role: "user",
		content: "hello",
		userId: 2,
		personaId: null,
		characterId: null,
		...over
	}) as any

describe("SessionMessageProcessor names a card-less seat's line", () => {
	it("today: by the player-seat speaker the row carries", () => {
		const p = new SessionMessageProcessor(
			{
				sessionPersonas: seats(["player-seat:4", "player-seat:5"]),
				sessionCharacters: []
			},
			engine
		)
		expect(
			p.processItem(line({ speaker: "player-seat:5" }), context())!.name
		).toBe("Bo")
	})

	it("a row with a castMemberId the cast answers is found by that seat's ref (S4 refs)", () => {
		const p = new SessionMessageProcessor(
			{
				sessionPersonas: seats([
					"seated-member:10",
					"seated-member:11"
				]),
				sessionCharacters: []
			},
			engine
		)
		expect(
			p.processItem(
				line({ speaker: "player-seat:5", castMemberId: 11 }),
				context()
			)!.name
		).toBe("Bo")
		expect(
			p.processItem(
				line({ speaker: "player-seat:4", castMemberId: 10 }),
				context()
			)!.name
		).toBe("Wren")
	})

	it("a row whose member the cast does not answer falls back to its player-seat speaker", () => {
		const p = new SessionMessageProcessor(
			{
				sessionPersonas: seats([
					"seated-member:10",
					"seated-member:11"
				]),
				sessionCharacters: []
			},
			engine
		)
		expect(
			p.processItem(
				line({ speaker: "player-seat:4", castMemberId: 99 }),
				context()
			)!.name
		).toBe("Wren")
	})
})
