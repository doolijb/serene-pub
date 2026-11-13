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

import { afterEach, describe, expect, it } from "vitest"
import "@serene-pub/core-catalog"
import {
	locationVariables,
	sceneAnchor,
	withinEarshot
} from "$lib/server/pipelines/prompt/adventureContext"
import { memberFormSwitch } from "$lib/server/state/memberForm"

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

/**
 * Earshot by the voice's own entry (seat-cast S4, s4-on Q3): a voice keeps its
 * own holder-only values with the flip switch off (card form) and on (member
 * form, `seated_member:<id>` keys). Member ids and card ids share one range,
 * so the on case seats card 8 as member 7 — a wrong-person read would show.
 */
describe("withinEarshot — a voice hears its own holder-only values, switch off and on", () => {
	const WHISPER = "test:slot/whisper@1"
	const slots = [{ id: WHISPER, earshot: "holder" }]
	const entry = (fields: Record<string, unknown>, whisper: string) => ({
		key: "x",
		name: "x",
		enabled: true,
		...fields,
		whisper,
		test_whisper: whisper
	})

	const was = memberFormSwitch.on
	afterEach(() => {
		memberFormSwitch.on = was
	})

	it("off: a card-form voice keeps its own, nobody else's", () => {
		memberFormSwitch.on = false
		const ash = entry(
			{ id: 7, ref: "character:7", castMemberId: 70 },
			"to ash"
		)
		const bram = entry(
			{ id: 8, ref: "character:8", castMemberId: 80 },
			"to bram"
		)
		const state = {
			slots,
			cast: { byId: { "7": ash, "8": bram }, ash, bram }
		}
		const heard = withinEarshot(state, "character:7") as any
		expect(heard.cast.byId["7"].whisper).toBe("to ash")
		expect(heard.cast.byId["8"]).not.toHaveProperty("whisper")
		expect(heard.cast.ash).toBe(heard.cast.byId["7"])
		// Off, a member-form speaker is nobody's voice (it fails closed).
		const member = withinEarshot(state, "seated-member:70") as any
		expect(member.cast.byId["7"]).not.toHaveProperty("whisper")
		expect(member.cast.byId["8"]).not.toHaveProperty("whisper")
		for (const nobody of [null, "envoy:castellan"]) {
			const n = withinEarshot(state, nobody) as any
			expect(n.cast.byId["7"]).not.toHaveProperty("whisper")
		}
	})

	it("on: a member-form or card-form voice keeps its own seat's, never its player seat's or another member's", () => {
		memberFormSwitch.on = true
		// Card 7 sits in a character seat as member 70 and (K-2) in player seat 5;
		// card 8 sits as member 7 — the same number as card 7.
		const ash = entry(
			{ id: 7, ref: "seated-member:70", castMemberId: 70 },
			"to ash"
		)
		const ashPlayer = entry(
			{ id: 7, playerSeatId: 5, ref: "player-seat:5", castMemberId: 70 },
			"to ash's player seat"
		)
		const bram = entry(
			{ id: 8, ref: "seated-member:7", castMemberId: 7 },
			"to bram"
		)
		const state = {
			slots,
			cast: {
				byId: {
					"seated_member:70": ash,
					"player_seat:5": ashPlayer,
					"seated_member:7": bram
				}
			}
		}
		for (const speaker of ["seated-member:70", "character:7"]) {
			const heard = withinEarshot(state, speaker) as any
			expect(heard.cast.byId["seated_member:70"].whisper).toBe("to ash")
			expect(heard.cast.byId["player_seat:5"]).not.toHaveProperty(
				"whisper"
			)
			expect(heard.cast.byId["seated_member:7"]).not.toHaveProperty(
				"whisper"
			)
		}
		const bramVoice = withinEarshot(state, "seated-member:7") as any
		expect(bramVoice.cast.byId["seated_member:7"].whisper).toBe("to bram")
		expect(bramVoice.cast.byId["seated_member:70"]).not.toHaveProperty(
			"whisper"
		)
		// A member nobody seats names nobody.
		const stray = withinEarshot(state, "seated-member:999") as any
		expect(stray.cast.byId["seated_member:70"]).not.toHaveProperty(
			"whisper"
		)
		expect(stray.cast.byId["seated_member:7"]).not.toHaveProperty("whisper")
	})

	it("on: a card held only by a player seat is voiced as that seat", () => {
		memberFormSwitch.on = true
		const rook = entry(
			{ id: 9, playerSeatId: 6, ref: "player-seat:6", castMemberId: 90 },
			"to rook"
		)
		const bram = entry(
			{ id: 8, ref: "seated-member:7", castMemberId: 7 },
			"to bram"
		)
		const state = {
			slots,
			cast: { byId: { "player_seat:6": rook, "seated_member:7": bram } }
		}
		const heard = withinEarshot(state, "character:9") as any
		expect(heard.cast.byId["player_seat:6"].whisper).toBe("to rook")
		expect(heard.cast.byId["seated_member:7"]).not.toHaveProperty("whisper")
	})
})
