/**
 * 🚧 A card-less seat as the speaker (S4, lane s4-seat-live w2): the seat with
 * no card whose `castMemberId` is `currentCastMemberId`.
 */
import { describe, it, expect } from "vitest"
import {
	resolveContextInput,
	CHARACTER_DETAIL as D
} from "$lib/server/pipelines/prompt/promptFields"

const carded = {
	enabled: true,
	castMemberId: 7,
	character: {
		id: 7,
		name: "Alice",
		description: "A knight.",
		personality: "Steady."
	}
}
// Member 7 is also a card id above on purpose: the ranges share numbers.
const cardless = {
	enabled: true,
	castMemberId: 7,
	character: {
		name: "Wren",
		description: "A wren of the notes.",
		personality: "Quick.",
		cardless: true
	}
}
const config = { systemPrompt: "Be brief." }
const cardNames = (r: any) => r.characters.map((c: any) => c.name)

describe("resolveContextInput: a card-less speaker", () => {
	it("renders the card-less seat FULL and names it, when currentCastMemberId names it", () => {
		const r: any = resolveContextInput({
			sessionCharacters: [carded, cardless] as any,
			promptConfig: config,
			characterDetail: D.SPEAKER_ONLY,
			currentCharacterId: null,
			currentCastMemberId: 7
		} as any)
		expect(r.charName).toBe("Wren")
		const wren = r.characters.find((c: any) => c.name === "Wren")
		expect(wren.personality).toBe("Quick.")
	})

	it("a carded speaker renders FULL and the card-less seat at the session's level", () => {
		const r: any = resolveContextInput({
			sessionCharacters: [carded, cardless] as any,
			promptConfig: config,
			characterDetail: D.BRIEF,
			currentCharacterId: 7,
			currentCastMemberId: 7
		} as any)
		expect(r.charName).toBe("Alice")
		const alice = r.characters.find((c: any) => c.name === "Alice")
		const wren = r.characters.find((c: any) => c.name === "Wren")
		expect(alice.personality).toBe("Steady.")
		expect(wren.personality).toBeUndefined()
	})

	it("narrator output is unchanged by the new input", () => {
		const input = {
			sessionCharacters: [carded, cardless] as any,
			promptConfig: config,
			currentCharacterId: null
		} as any
		const before = resolveContextInput(input)
		const after = resolveContextInput({
			...input,
			currentCastMemberId: null
		})
		expect(JSON.stringify(after)).toBe(JSON.stringify(before))
		expect(cardNames(before)).toEqual(["Alice", "Wren"])
	})
})
