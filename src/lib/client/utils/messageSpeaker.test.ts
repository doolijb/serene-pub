/**
 * The lookup every rendered message's avatar goes through.
 *
 * The point of these assertions is that a message row holds NO copy of its
 * speaker: it holds an id, and the face comes from the live participant link.
 * So patching that link — which is all a `characters:update` handler does — has
 * to change what a message renders, with no reload and no per-message state.
 */
import { describe, expect, test } from "vitest"
import { messageSpeaker, personLineName } from "./messageSpeaker"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { avatarSrc } from "./media"

const UUID_A = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const UUID_B = "11111111-2222-3333-4444-555555555555"

function character(over: Record<string, unknown> = {}) {
	return { id: 1, name: "Verity", ...over } as unknown as SelectCharacter
}

/** A persona is a character row flagged `isPersona` — same fixture shape. */
function persona(over: Record<string, unknown> = {}) {
	return {
		id: 7,
		name: "Jody",
		isPersona: true,
		...over
	} as unknown as SelectCharacter
}

describe("messageSpeaker", () => {
	test("resolves a character message through the session link", () => {
		const session = {
			sessionCharacters: [
				{
					characterId: 1,
					character: character({
						avatarMediaId: 1,
						avatarMedia: { uuid: UUID_A, rev: 0 }
					})
				}
			]
		}
		const speaker = messageSpeaker(session, { characterId: 1 })
		expect(avatarSrc(speaker)).toBe(`/media/${UUID_A}?v=thumb&r=0`)
	})

	test("a new avatar on the link re-faces every message that names it", () => {
		const link = {
			characterId: 1,
			character: character({
				avatarMediaId: 1,
				avatarMedia: { uuid: UUID_A, rev: 0 }
			})
		}
		const session = { sessionCharacters: [link] }
		const before = avatarSrc(messageSpeaker(session, { characterId: 1 }))

		// Exactly what handleCharactersUpdate does with the broadcast payload.
		session.sessionCharacters = [
			{
				...link,
				character: character({
					avatarMediaId: 2,
					avatarMedia: { uuid: UUID_B, rev: 0 }
				})
			}
		]
		const after = avatarSrc(messageSpeaker(session, { characterId: 1 }))

		expect(before).toBe(`/media/${UUID_A}?v=thumb&r=0`)
		expect(after).toBe(`/media/${UUID_B}?v=thumb&r=0`)
	})

	test("a persona message reads the persona link, not the character one", () => {
		const session = {
			sessionCharacters: [{ characterId: 1, character: character() }],
			sessionPersonas: [
				{
					personaId: 7,
					persona: persona({
						avatarMediaId: 9,
						avatarMedia: { uuid: UUID_B, rev: 2 }
					})
				}
			]
		}
		const speaker = messageSpeaker(session, {
			characterId: 1,
			personaId: 7
		})
		expect(speaker?.name).toBe("Jody")
		expect(avatarSrc(speaker)).toBe(`/media/${UUID_B}?v=thumb&r=2`)
	})

	test("falls back to the removal snapshot once the entity itself is gone", () => {
		const session = {
			sessionCharacters: [
				{ characterId: 1, character: null, removedName: "Verity" }
			]
		}
		const speaker = messageSpeaker(session, { characterId: 1 })
		expect(speaker?.name).toBe("Verity")
		expect(avatarSrc(speaker)).toBeUndefined()
	})

	test("a removed participant still renders its live face", () => {
		const session = {
			sessionCharacters: [
				{
					characterId: 1,
					character: character({
						avatarMediaId: 1,
						avatarMedia: { uuid: UUID_A, rev: 0 }
					}),
					removedName: "Verity"
				}
			]
		}
		expect(avatarSrc(messageSpeaker(session, { characterId: 1 }))).toBe(
			`/media/${UUID_A}?v=thumb&r=0`
		)
	})

	test("is undefined for a message with no speaker at all", () => {
		expect(messageSpeaker({ sessionCharacters: [] }, {})).toBeUndefined()
		expect(messageSpeaker(null, { characterId: 1 })).toBeUndefined()
		expect(
			messageSpeaker({ sessionCharacters: [] }, { characterId: 99 })
		).toBeUndefined()
	})
})

/*
 * Everyone has a name (ruled 2026-09-26). A line the lookup resolves to
 * nobody — written before the host stamped a fallback, or in a genre that
 * declares none — renders under the genre's fallback envoy, else the
 * session's narrator name, else the SDK's generic name. Never "Unknown".
 */
describe("an unclaimed line is the own voice's (ownVoiceName, R5)", () => {
	const referee = { slug: "referee", name: "Referee", fallback: true }
	const guide = { slug: "mascot", name: "Guide" }

	test("the genre's fallback envoy names a line nobody claims", () => {
		expect(ownVoiceName({ envoys: [guide, referee], narratorName: "Dungeon Master" })).toBe("Referee")
	})

	test("with no fallback envoy, the session's narrator name; with none of either, the generic name", () => {
		expect(ownVoiceName({ envoys: [guide], narratorName: "Dungeon Master" })).toBe("Dungeon Master")
		expect(ownVoiceName({ envoys: [], narratorName: "  " })).toBe("Narrator")
		expect(ownVoiceName(undefined)).toBe("Narrator")
	})

	test("a speakerless row renders a name that is never Unknown — the page's own composition", () => {
		const row = { characterId: null, personaId: null, metadata: {} }
		const who = messageSpeaker({ sessionCharacters: [], envoys: [guide] }, row)
		expect(who).toBeUndefined()
		for (const session of [{ envoys: [guide, referee] }, { envoys: [guide] }, undefined]) {
			const name = resolveCharacterName(who, ownVoiceName(session))
			expect(name).toBeTruthy()
			expect(name).not.toBe("Unknown")
		}
	})
})

/**
 * A person's own line with no persona (lair re-plan R4): named by the genre's
 * `playerLabel` when it declares one ("Dungeon Master"), with the member's
 * own name beside it only when the session has more than one member; the
 * member's name alone when the genre declares no label (B11, unchanged).
 */
describe("personLineName", () => {
	test("one member: the label alone", () => {
		expect(
			personLineName({
				playerLabel: "Dungeon Master",
				memberName: "jody",
				memberCount: 1
			})
		).toEqual({ name: "Dungeon Master" })
	})

	test("two members: the label, and whose line it is", () => {
		expect(
			personLineName({
				playerLabel: "Dungeon Master",
				memberName: "jody",
				memberCount: 2
			})
		).toEqual({ name: "Dungeon Master", member: "jody" })
	})

	test("a session's override is just the label it hands in", () => {
		expect(
			personLineName({
				playerLabel: "Game Master",
				memberName: "jody",
				memberCount: 1
			})?.name
		).toBe("Game Master")
	})

	test("no label: the member's name, as before", () => {
		expect(
			personLineName({ memberName: "jody", memberCount: 2 })
		).toEqual({ name: "jody" })
	})

	test("no label and no member: nothing to name it by", () => {
		expect(personLineName({ memberCount: 1 })).toBeUndefined()
	})
})
