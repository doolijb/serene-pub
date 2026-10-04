/**
 * `{{locationEntry}}`'s **"From here:"** block (places plan B6, §6.3,
 * 2026-09-29).
 *
 * The room the party stand in reaches the Lair's planner, its voices and its
 * Castellan as `{{locationEntry}}`: the room's name, its body, and — when the
 * rooms listing asked `withLinks` — its ways out, one line each, said from the
 * room with the one sentence every surface says a relationship with
 * (`relationshipSentence`). The rows arrive as `LoreLinkRow`s, already said
 * from the listed room and already filtered by the host's reading (standing,
 * not secret, one way in left out); what is tested here is the rendering.
 */

import { describe, expect, it } from "vitest"
import "@serene-pub/core-catalog"
import { locationVariables, sceneAnchor } from "$lib/server/pipelines/prompt/adventureContext"

const LOCATION = { id: "core:slot/location@1", appliesTo: ["world"] }
const at = (location: unknown) => ({ world: { location }, slots: [LOCATION] })

const GUARDROOM = {
	id: 1,
	name: "The Guardroom",
	content: "A bare room with a brazier."
}
const HALL = { id: 2, name: "The Drowned Hall", content: "Black water." }

/** The door, as the listing says it from each end. */
const DOOR_FROM_GUARDROOM = {
	id: 10,
	to: { entryId: 2, name: "The Drowned Hall" },
	linkType: "leads north to",
	reverseLinkType: "leads south to",
	name: "the rusted iron door"
}
const DOOR_FROM_HALL = {
	id: 10,
	to: { entryId: 1, name: "The Guardroom" },
	linkType: "leads south to",
	reverseLinkType: "leads north to",
	name: "the rusted iron door"
}
const INSIDE = {
	id: 11,
	to: { entryId: 3, name: "the Rusty Flagon" },
	linkType: "is inside",
	reverseLinkType: "holds"
}

describe("{{locationEntry}} — From here:", () => {
	it("writes the room's ways out under its body, each said from the room", () => {
		const rows = [{ ...GUARDROOM, links: [DOOR_FROM_GUARDROOM, INSIDE] }, HALL]
		expect(locationVariables(rows, at("The Guardroom") as never).locationEntry).toBe(
			[
				"The Guardroom",
				"A bare room with a brazier.",
				"From here:",
				"- The rusted iron door leads north to The Drowned Hall.",
				"- Is inside the Rusty Flagon."
			].join("\n")
		)
	})

	it("says the same door from the other end in its own words", () => {
		const rows = [GUARDROOM, { ...HALL, links: [DOOR_FROM_HALL] }]
		expect(locationVariables(rows, at("the drowned hall") as never).locationEntry).toBe(
			[
				"The Drowned Hall",
				"Black water.",
				"From here:",
				"- The rusted iron door leads south to The Guardroom."
			].join("\n")
		)
	})

	it("an unnamed one-way link reads from its words alone", () => {
		const rows = [
			{
				...GUARDROOM,
				links: [{ id: 12, to: { entryId: 4, name: "the Crypt" }, linkType: "leads down to" }]
			}
		]
		expect(locationVariables(rows, at("The Guardroom") as never).locationEntry).toBe(
			"The Guardroom\nA bare room with a brazier.\nFrom here:\n- Leads down to the Crypt."
		)
	})

	it("no links, no block: a room read without `withLinks` renders as it always did", () => {
		for (const row of [GUARDROOM, { ...GUARDROOM, links: [] }])
			expect(locationVariables([row], at("The Guardroom") as never).locationEntry).toBe(
				"The Guardroom\nA bare room with a brazier."
			)
	})

	it("a room with no body still says its ways out", () => {
		const rows = [{ ...GUARDROOM, content: "  ", links: [DOOR_FROM_GUARDROOM] }]
		expect(locationVariables(rows, at("The Guardroom") as never).locationEntry).toBe(
			"The Guardroom\nFrom here:\n- The rusted iron door leads north to The Drowned Hall."
		)
	})

	it("a link with no far end, or a far end with no name, says nothing", () => {
		const rows = [
			{
				...GUARDROOM,
				links: [
					{ id: 13, linkType: "leads to" },
					{ id: 14, to: { entryId: 5, name: "  " }, linkType: "leads to" },
					null,
					DOOR_FROM_GUARDROOM
				]
			}
		]
		expect(locationVariables(rows, at("The Guardroom") as never).locationEntry).toBe(
			"The Guardroom\nA bare room with a brazier.\nFrom here:\n- The rusted iron door leads north to The Drowned Hall."
		)
	})

	/**
	 * B6 review round: `{{locationEntry}}` finds the room by the rule the
	 * Lair's Answer the door links it by (`locationRowOf`), so a location
	 * spelled loosely, or by a key, still shows the room's From here: block.
	 */
	it("finds the room as Answer the door does: a looser spelling, a key, a lore reference", () => {
		const rows = [
			{ ...GUARDROOM, name: "Guardroom", keys: ["the watch room"], links: [DOOR_FROM_GUARDROOM] },
			HALL
		]
		const block = [
			"Guardroom",
			"A bare room with a brazier.",
			"From here:",
			"- The rusted iron door leads north to The Drowned Hall."
		].join("\n")
		expect(locationVariables(rows, at("the guardroom") as never).locationEntry).toBe(block)
		expect(locationVariables(rows, at("The Watch Room") as never).locationEntry).toBe(block)
		// A lore reference is its row, by id — never its title's namesake.
		expect(
			locationVariables(rows, at({ entryId: 1, name: "The Drowned Hall" }) as never)
				.locationEntry
		).toBe(block)
	})

	it("a room's own name beats another room's key", () => {
		const rows = [
			{ ...HALL, keys: ["guardroom"] },
			{ ...GUARDROOM, links: [DOOR_FROM_GUARDROOM] }
		]
		expect(
			locationVariables(rows, at("The Guardroom") as never).locationEntry
		).toMatch(/^The Guardroom\n/)
	})

	it("only the room the party stand in says its ways out", () => {
		const rows = [GUARDROOM, { ...HALL, links: [DOOR_FROM_HALL] }]
		const vars = locationVariables(rows, at("The Guardroom") as never)
		expect(vars.locationEntry).toBe("The Guardroom\nA bare room with a brazier.")
		expect(vars.knownLocations).toBe("The Guardroom, The Drowned Hall")
	})
})

describe("where the scene is — one answer for {{location}} and {{locationEntry}} (plan A27)", () => {
	const unset = { world: {}, slots: [LOCATION] }
	const plan = { worldHints: { location: "the guardroom" } }

	it("with nothing written down yet, both read the planner's hint", () => {
		const rows = [{ ...GUARDROOM, links: [DOOR_FROM_GUARDROOM] }, HALL]
		expect(sceneAnchor(unset as never, plan).location).toBe("the guardroom")
		expect(locationVariables(rows, unset as never, plan).locationEntry).toMatch(
			/^The Guardroom\nA bare room with a brazier\.\nFrom here:/
		)
	})

	it("the world's value wins over the hint in both", () => {
		const rows = [GUARDROOM, HALL]
		const state = at("The Drowned Hall")
		expect(sceneAnchor(state as never, plan).location).toBe("The Drowned Hall")
		expect(locationVariables(rows, state as never, plan).locationEntry).toBe(
			"The Drowned Hall\nBlack water."
		)
	})

	it("with no hint and nothing written, neither names a room", () => {
		expect(locationVariables([GUARDROOM], unset as never, {}).locationEntry).toBeUndefined()
		expect(sceneAnchor(unset as never, {}).location).toBe(
			"somewhere this session has not named yet"
		)
	})
})
