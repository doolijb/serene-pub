/**
 * The lines a template renders, and the one line it renders *open*.
 *
 * The seed is not a message among messages. On the completion path its
 * assistant block is the only one rendered with `includeClose: false`, so the
 * prompt ends mid-line and the model continues the string it was handed. That
 * makes edge whitespace on the seed's text a character *inside* the open block
 * — the mid-word continue case the 2026-09-08 ruling addresses — and Anthropic's
 * Messages API refuses a prefill ending in whitespace outright.
 *
 * Whitespace is trimmed at compile as well as at save because the two guards
 * cover different holes: the store cannot trim a mid-stream partial (the frames
 * split anywhere), and history predating the ruling is already stored padded.
 */

import { describe, it, expect } from "vitest"
import { processMessages, SEED_MESSAGE_ID } from "./messages"

const base = {
	cast: {},
	charName: "Alice",
	personaName: "Bob"
}

const seedOf = (r: ReturnType<typeof processMessages>) =>
	r.messages.find((m) => m.id === SEED_MESSAGE_ID)!

describe("the seed line", () => {
	it("carries no trailing whitespace from the continuation prefill", () => {
		const out = processMessages({
			...base,
			messages: [],
			continuationPrefill: "The rain had just "
		})
		expect(seedOf(out).message).toBe("The rain had just")
	})

	it("strips a trailing newline the same way", () => {
		const out = processMessages({
			...base,
			messages: [],
			continuationPrefill: "The rain had just\n"
		})
		expect(seedOf(out).message).toBe("The rain had just")
	})

	it("stays empty when this turn is not a continue", () => {
		const out = processMessages({ ...base, messages: [] })
		expect(seedOf(out).message).toBe("")
	})
})

describe("history lines", () => {
	it("are trimmed, so a padded row cannot open or close a line with space", () => {
		const out = processMessages({
			...base,
			messages: [
				{ id: 1, role: "user", content: "  Well met.  " },
				{ id: 2, role: "assistant", content: "And you.\n\n" }
			]
		})
		expect(out.messages.map((m) => m.message)).toEqual([
			"Well met.",
			"And you.",
			""
		])
		expect(out.includedIds).toEqual([1, 2])
	})

	it("keep whitespace that is interior to the body", () => {
		const out = processMessages({
			...base,
			messages: [
				{ id: 1, role: "assistant", content: "  One.\n\nTwo.  " }
			]
		})
		expect(out.messages[0].message).toBe("One.\n\nTwo.")
	})
})

/**
 * Every line is labelled with ITS speaker, never this turn's (ruled
 * 2026-09-26: "everyone should have names"). An envoy's row names it by
 * reference (`metadata.speaker = envoy:<slug>`) and holds no `characterId`,
 * so without its own branch it fell through to `charName` — a Referee's
 * ruling rendered as Alice's line, and the model read it as hers.
 */
describe("who a line is labelled under", () => {
	const envoyCast = {
		envoys: [
			{ slug: "referee", name: { en: "Referee" }, fallback: false },
			{ slug: "scribe", name: "Scribe", fallback: true }
		]
	}

	it("an envoy's line renders under the envoy's declared name", () => {
		const out = processMessages({
			...base,
			cast: envoyCast,
			seed: false,
			messages: [
				{
					id: 1,
					role: "assistant",
					content: "Roll for initiative, {{char}}.",
					metadata: { speaker: "envoy:referee" }
				}
			]
		})
		expect(out.messages[0].name).toBe("Referee")
		expect(out.messages[0].message).toBe("Roll for initiative, Referee.")
	})

	it("an envoy the cast does not list renders under its slug, not the speaker", () => {
		const out = processMessages({
			...base,
			seed: false,
			messages: [
				{
					id: 1,
					role: "assistant",
					content: "Noted.",
					metadata: { speaker: "envoy:acme.master" }
				}
			]
		})
		expect(out.messages[0].name).toBe("acme.master")
	})

	it("a line nobody claims renders under the genre's fallback envoy", () => {
		const out = processMessages({
			...base,
			cast: envoyCast,
			seed: false,
			messages: [{ id: 1, role: "assistant", content: "Time passes." }]
		})
		expect(out.messages[0].name).toBe("Scribe")
	})

	it("then under the session's narrator name, then the SDK's generic name", () => {
		const narrated = processMessages({
			...base,
			narratorName: "The Voice",
			seed: false,
			messages: [{ id: 1, role: "assistant", content: "Time passes." }]
		})
		expect(narrated.messages[0].name).toBe("The Voice")
		const bare = processMessages({
			...base,
			seed: false,
			messages: [{ id: 1, role: "assistant", content: "Time passes." }]
		})
		expect(bare.messages[0].name).toBe("Narrator")
	})

	it("a removed participant renders under their stored name, never 'Unknown'", () => {
		const out = processMessages({
			...base,
			cast: {
				removedSessionCharacters: [
					{ characterId: 7, character: null, removedName: "Mira" },
					{ characterId: 8, character: null, removedName: null }
				]
			},
			seed: false,
			messages: [
				{ id: 1, role: "assistant", characterId: 7, content: "Farewell." },
				{ id: 2, role: "assistant", characterId: 8, content: "..." }
			]
		})
		expect(out.messages[0].name).toBe("Mira")
		expect(out.messages[1].name).toBe("Narrator")
		expect(out.messages.map((m) => m.name)).not.toContain("Unknown")
		expect(out.messages.map((m) => m.name)).not.toContain("Alice")
	})
})

/**
 * A person speaking as themselves (lair pass F8/B11). A genre with no persona
 * system — the Lair, the Guide — leaves `{{user}}` empty, and the transcript
 * once labelled the person's line `": The torches gutter…"`. The line is named
 * the way the session view names it (`getMessageCharacter`): the member the row
 * belongs to, by display name, else username — never an empty name.
 */
describe("a person's own line, with no persona", () => {
	const memberCast = { memberNames: { 3: "Morgan" } }

	it("renders under the member it belongs to when no persona names it", () => {
		const out = processMessages({
			...base,
			personaName: "",
			cast: memberCast,
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 3, content: "The torches gutter." }
			]
		})
		expect(out.messages[0].name).toBe("Morgan")
	})

	it("is never an empty name, even with no member on the cast", () => {
		const out = processMessages({
			...base,
			personaName: "",
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 9, content: "The torches gutter." }
			]
		})
		expect(out.messages[0].name).not.toBe("")
		expect(out.messages[0].name.trim()).not.toBe("")
	})

	it("keeps the persona name wherever there is one — persona genres are untouched", () => {
		const out = processMessages({
			...base,
			cast: memberCast,
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 3, content: "Well met." }
			]
		})
		expect(out.messages[0].name).toBe("Bob")
	})
})

/**
 * The genre's `playerLabel` (lair re-plan R4): a persona-less person's line
 * is labelled "Dungeon Master" in the transcript — before B11's member name —
 * and a persona still names its own line wherever there is one.
 */
describe("a person's own line, in a genre that declares a playerLabel", () => {
	const labelled = { memberNames: { 3: "Morgan" }, playerLabel: "Dungeon Master" }

	it("renders under the label, not the member", () => {
		const out = processMessages({
			...base,
			personaName: "",
			cast: labelled,
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 3, content: "The torches gutter." }
			]
		})
		expect(out.messages[0].name).toBe("Dungeon Master")
	})

	it("renders under a session's override, which the cast read already resolved", () => {
		const out = processMessages({
			...base,
			personaName: "",
			cast: { ...labelled, playerLabel: "Game Master" },
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 3, content: "The torches gutter." }
			]
		})
		expect(out.messages[0].name).toBe("Game Master")
	})

	it("never names a persona's line or a reply by it", () => {
		const out = processMessages({
			...base,
			cast: labelled,
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 3, content: "Well met." },
				{ id: 2, role: "assistant", characterId: 1, content: "Hello." }
			]
		})
		expect(out.messages[0].name).toBe("Bob")
		expect(out.messages[1].name).not.toBe("Dungeon Master")
	})
})

describe("🚧 a person's line with two seats (2026-10-16)", () => {
	// Ann's seat is card-less; Bo's arrived later, also card-less.
	const cast = {
		sessionPersonas: [
			{ persona: null, seatId: 11, seatName: "Ann", seatUserId: 1 },
			{ persona: null, seatId: 12, seatName: "Bo", seatUserId: 2 }
		]
	}
	const run = (messages: any[]) =>
		processMessages({ ...base, personaName: "Ann and Bo", cast, seed: false, messages })

	it("labels each line with its own seat, never the joined list", () => {
		const out = run([
			{ id: 1, role: "user", userId: 1, metadata: { speaker: "player-seat:11" }, content: "I look around. {{user}}" },
			{ id: 2, role: "user", userId: 2, metadata: { speaker: "player-seat:12" }, content: "I cover Ann with my bow." }
		])
		expect(out.messages.map((m) => m.name)).toEqual(["Ann", "Bo"])
		expect(out.messages[0].message).toBe("I look around. Ann")
	})

	it("names an unstamped line by its sender's one seat", () => {
		const out = run([{ id: 1, role: "user", userId: 2, content: "Hi!" }])
		expect(out.messages[0].name).toBe("Bo")
	})

	it("🚧 one seat: another person's line is never named by it — a guest before their seat (the 100-turn walk, B2)", () => {
		const out = processMessages({
			...base,
			personaName: "Wren",
			cast: {
				sessionPersonas: [{ persona: { id: 4, name: "Wren", userId: 1 }, seatId: 11, seatName: null, seatUserId: 1 }],
				memberNames: { 9: "Rook" }
			},
			seed: false,
			messages: [
				{ id: 1, role: "user", userId: 9, content: "Hi! How do I join in, {{user}}?" },
				{ id: 2, role: "user", userId: 1, content: "Welcome." }
			]
		})
		expect(out.messages.map((m) => m.name)).toEqual(["Rook", "Wren"])
		expect(out.messages[0].message).toBe("Hi! How do I join in, Rook?")
	})

	it("falls to the member rule, not the join, when no seat is the sender's", () => {
		const out = processMessages({
			...base,
			personaName: "Ann and Bo",
			cast: { ...cast, memberNames: { 9: "Morgan" } },
			seed: false,
			messages: [{ id: 1, role: "user", userId: 9, content: "Hello {{user}}" }]
		})
		expect(out.messages[0].name).toBe("Morgan")
		expect(out.messages[0].message).toBe("Hello Morgan")
	})
})
