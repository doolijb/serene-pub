/**
 * **The party's reach** (owner ruling 2026-09-30) — place sight for the
 * Lair's Castellan speaking for the party: the stats of the place the scene
 * is at and of the places one way from it (the room's listed links to other
 * places, its "From here:" ways), and no other place's. Names are untouched:
 * the rooms listing still names every room. `withinReach` beside
 * `withinSight` (a voice: one place).
 */
import { describe, expect, it } from "vitest"
import { withinReach } from "$lib/server/pipelines/prompt/adventureContext"

const place = (id: number, name: string, item: string) => ({
	id,
	key: name.toLowerCase().replace(/\s+/g, "-"),
	name,
	inventory: [item]
})

const STATE = {
	world: { location: "The Guardroom" },
	cast: {},
	locations: {
		"the-guardroom": place(1, "The Guardroom", "a dropped torch"),
		"the-drowned-hall": place(2, "The Drowned Hall", "a sealed iron chest"),
		"the-far-vault": place(3, "The Far Vault", "a crown of black iron"),
		byId: {
			"1": place(1, "The Guardroom", "a dropped torch"),
			"2": place(2, "The Drowned Hall", "a sealed iron chest"),
			"3": place(3, "The Far Vault", "a crown of black iron")
		}
	}
}

/** The rooms listing, with the guardroom's one way on — to the hall. */
const ROOMS = [
	{
		id: 1,
		name: "The Guardroom",
		content: "A bare room.",
		links: [{ id: 9, to: { entryId: 2, name: "The Drowned Hall" }, linkType: "leads north to" }]
	},
	{ id: 2, name: "The Drowned Hall", content: "Black water.", links: [] },
	{ id: 3, name: "The Far Vault", content: "Dry and sealed.", links: [] }
]

const kept = (state: any) => Object.keys(state.locations.byId).sort()

describe("withinReach", () => {
	it("keeps the place the scene is at and the places one way from it, and no other", () => {
		const reached: any = withinReach(STATE, undefined, ROOMS)
		expect(kept(reached)).toEqual(["1", "2"])
		expect(reached.locations["the-far-vault"]).toBeUndefined()
		expect(reached.locations["the-drowned-hall"]).toBeTruthy()
	})

	it("reads where the scene is from the planner's hint when the world names nowhere", () => {
		const unset = { ...STATE, world: {} }
		const reached: any = withinReach(unset, { worldHints: { location: "The Drowned Hall" } }, ROOMS)
		// The hall lists no way on: it alone.
		expect(kept(reached)).toEqual(["2"])
	})

	it("reads no place's stats when the scene is at no place", () => {
		const nowhere = { ...STATE, world: { location: "Somewhere else" } }
		expect(kept(withinReach(nowhere, undefined, ROOMS))).toEqual([])
	})

	it("leaves a state with no places as it was, and never mutates", () => {
		const bare = { world: {}, cast: {} }
		expect(withinReach(bare, undefined, ROOMS)).toBe(bare)
		withinReach(STATE, undefined, ROOMS)
		expect(kept(STATE)).toEqual(["1", "2", "3"])
	})
})
