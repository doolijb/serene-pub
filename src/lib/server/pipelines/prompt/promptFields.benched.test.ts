/** Owner 2026-11-10: in play = live and not benched; the prompt reads only seats in play (the speaker always). */
import { describe, it, expect } from "vitest"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"

const seat = (id: number, name: string, over: Record<string, unknown> = {}) => ({
	enabled: true,
	...over,
	character: { id, name, description: `${name} the seat.`, personality: "Steady." }
})
const player = (id: number, name: string, over: Record<string, unknown> = {}) => ({
	enabled: true,
	...over,
	persona: { id, name, description: `${name} the player.` }
})
const input = (over: Record<string, unknown> = {}) =>
	({
		sessionCharacters: [seat(1, "Alice"), seat(2, "Cara", { enabled: false })],
		sessionPersonas: [player(10, "Bob"), player(11, "Dee", { enabled: false })],
		promptConfig: { systemPrompt: "Be brief." },
		currentCharacterId: 1,
		...over
	}) as never

const cardNames = (r: ReturnType<typeof resolveContextInput>) =>
	(r.characters as Array<{ name: string }>).map((c) => c.name)

describe("resolveContextInput — benched seats", () => {
	it("a benched character leaves the characters block and the names; the speaker's card stays", () => {
		const r = resolveContextInput(input())
		expect(cardNames(r)).toEqual(["Alice"])
		expect(r.characterNames).toEqual(["Alice"])
		expect(r.likenesses!.map((l) => l.name)).toEqual(["Alice", "Bob"])
	})

	it("a benched speaker keeps its card in full, and leaves the names", () => {
		const r = resolveContextInput(input({ currentCharacterId: 2 }))
		expect(cardNames(r)).toEqual(["Alice", "Cara"])
		expect(r.characterNames).toEqual(["Alice"])
		const cara = (r.characters as unknown as Array<Record<string, unknown>>).find((c) => c.name === "Cara")!
		expect(JSON.stringify(cara)).toContain("Cara the seat.")
	})

	it("a removed character seat leaves the block too", () => {
		const r = resolveContextInput(
			input({ sessionCharacters: [seat(1, "Alice"), seat(3, "Gone", { removedAt: new Date() })] })
		)
		expect(cardNames(r)).toEqual(["Alice"])
	})

	it("a benched persona leaves personaNames, the likenesses and the persona block", () => {
		const r = resolveContextInput(input())
		expect(r.personaNames).toEqual(["Bob"])
		expect(r.personas.map((p) => p.name)).toEqual(["Bob"])
		expect(r.likenesses!.map((l) => l.name)).not.toContain("Dee")
		expect(r.personaName).toBe("Bob")
	})

	it("a table-row bench (isActive false) reads like enabled false", () => {
		const r = resolveContextInput(
			input({ sessionPersonas: [player(10, "Bob", { enabled: undefined, isActive: false })] })
		)
		expect(r.personaNames).toEqual([])
	})
})
