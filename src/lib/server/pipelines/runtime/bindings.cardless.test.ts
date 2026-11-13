/**
 * 🚧 Card-less seats in the turn pool (S4, lane s4-seat w2): a row with no
 * card takes its owner from the seat's `seatedByUserId` (★S2b-1), never a
 * card's `userId`; a carded row is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { memberFormSwitch } from "$lib/server/state/memberForm"

let was = false
beforeEach(() => {
	was = memberFormSwitch.on
	memberFormSwitch.on = true
})
afterEach(() => {
	memberFormSwitch.on = was
})

const bindings = coreBindings() as Record<
	string,
	(input: any, ctx?: any) => Promise<any>
>

describe("turn pool — card-less character seats", () => {
	const cast = {
		sessionCharacters: [
			{
				enabled: true,
				position: 0,
				character: { id: 11, name: "Alice", userId: 1 },
				ref: "seated-member:5",
				castMemberId: 5,
				seatId: 1,
				seatedByUserId: 99
			},
			{
				enabled: true,
				position: 1,
				// A card-less seat's card-shaped read: no `id`, no `userId`.
				character: { name: "Sable", cardless: true },
				ref: "seated-member:8",
				castMemberId: 8,
				seatId: 2,
				seatedByUserId: 4
			}
		],
		sessionPersonas: [],
		envoys: []
	}

	it("a row with no card takes its owner from seatedByUserId; a carded row keeps the card's", async () => {
		const out = await bindings["core:task/turn-pool@1"]!({
			cast,
			messages: []
		})
		const chars = out.value.main.filter((c: any) => c.kind === "character")
		expect(chars).toEqual([
			{
				ref: "seated-member:5",
				kind: "character",
				name: "Alice",
				position: 0,
				ownerUserId: 1,
				castMemberId: 5
			},
			{
				ref: "seated-member:8",
				kind: "character",
				name: "Sable",
				position: 1,
				ownerUserId: 4,
				castMemberId: 8
			}
		])
	})

	it("a card-less row with no ref and no card id is not a candidate (never character:undefined)", async () => {
		const out = await bindings["core:task/turn-pool@1"]!({
			cast: {
				sessionCharacters: [
					{
						enabled: true,
						character: { name: "Nobody" },
						castMemberId: 8
					}
				]
			},
			messages: []
		})
		expect(out.value.main).toEqual([])
	})
})
