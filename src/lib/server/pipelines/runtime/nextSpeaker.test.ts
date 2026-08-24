/**
 * The next-speaker strategies (19 §5, U-C4), at the binding.
 *
 * What is pinned: an explicit pick wins under every strategy; round-robin is
 * the 0.5 rotation (the same `getNextCharacterTurn`, so its own suite carries
 * the deep cases — here it advances past the last speaker); random is a
 * function of the run seed (same seed, same speaker — the d20 lesson: assert
 * same-seed equality, never cross-seed inequality); manual and none decide
 * nobody; and no strategy halts on an empty cast, because "no speaker" is an
 * outcome the legacy path handed on every narrator-adjacent turn.
 */

import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

const bindings = coreBindings() as Record<
	string,
	(input: any, ctx?: any) => Promise<any>
>

/** A two-character cast in position order, with one persona. */
const cast = {
	sessionCharacters: [
		{
			isActive: true,
			position: 0,
			removedAt: null,
			character: { id: 11, name: "Alice" }
		},
		{
			isActive: true,
			position: 1,
			removedAt: null,
			character: { id: 22, name: "Bram" }
		}
	],
	sessionPersonas: [{ persona: { id: 7 }, position: 0, removedAt: null }]
}

/** A healthy window: everyone spoke recently, Alice most recently. */
const messages = [
	{ id: 1, role: "user", personaId: 7, characterId: null },
	{ id: 2, role: "assistant", characterId: 22, personaId: null },
	{ id: 3, role: "user", personaId: 7, characterId: null },
	{ id: 4, role: "assistant", characterId: 11, personaId: null }
]

describe("the explicit pick", () => {
	it("wins under every strategy, and the receipt says so", async () => {
		for (const id of [
			"core:task/turn-round-robin@1",
			"core:task/turn-random@1",
			"core:task/turn-manual@1",
			"core:task/turn-none@1"
		]) {
			const r = await bindings[id]!({ cast, messages, characterId: 22 })
			expect(r.value.characterId).toBe(22)
			expect(r.value.main).toMatchObject({
				characterId: 22,
				via: "pick"
			})
		}
	})
})

describe("round-robin", () => {
	it("advances past the last speaker — the 0.5 rotation, inside the run", async () => {
		const r = await bindings["core:task/turn-round-robin@1"]!({
			cast,
			messages
		})
		// Alice (11) spoke last; Bram (22) is due.
		expect(r.value.characterId).toBe(22)
		expect(r.value.main).toMatchObject({
			strategy: "round-robin",
			via: "strategy"
		})
	})

	it("decides nobody on an empty cast rather than halting", async () => {
		const r = await bindings["core:task/turn-round-robin@1"]!({
			cast: { sessionCharacters: [], sessionPersonas: [] },
			messages: []
		})
		expect(r.value.characterId).toBe(null)
	})
})

describe("random", () => {
	it("is a function of the seed: the same rolls seat the same speaker", async () => {
		// A deterministic stand-in for ctx.random — the executor supplies the
		// seeded one when `declaresRandomness` is set.
		const rng = (vals: number[]) => {
			let i = 0
			return () => vals[i++ % vals.length]!
		}
		const a = await bindings["core:task/turn-random@1"]!(
			{ cast, messages },
			{ random: rng([0.9]) }
		)
		const b = await bindings["core:task/turn-random@1"]!(
			{ cast, messages },
			{ random: rng([0.9]) }
		)
		expect(a.value.characterId).toBe(b.value.characterId)
		expect(a.value.characterId).toBe(22) // 0.9 of two seats is the second
	})

	it("never seats an inactive or removed character", async () => {
		const r = await bindings["core:task/turn-random@1"]!(
			{
				cast: {
					sessionCharacters: [
						...cast.sessionCharacters,
						{
							isActive: false,
							position: 2,
							removedAt: null,
							character: { id: 33 }
						},
						{
							isActive: true,
							position: 3,
							removedAt: "2026-01-01",
							character: { id: 44 }
						}
					],
					sessionPersonas: cast.sessionPersonas
				},
				messages
			},
			{ random: () => 0.99 }
		)
		expect([11, 22]).toContain(r.value.characterId)
	})
})

describe("manual and none", () => {
	it("decide nobody without a pick — they differ in UI, not computation", async () => {
		for (const id of ["core:task/turn-manual@1", "core:task/turn-none@1"]) {
			const r = await bindings[id]!({ cast, messages })
			expect(r.value.characterId).toBe(null)
			expect(r.value.main.via).toBe("strategy")
		}
	})
})
