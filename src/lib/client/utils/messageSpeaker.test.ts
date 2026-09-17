/**
 * The lookup every rendered message's avatar goes through.
 *
 * The point of these assertions is that a message row holds NO copy of its
 * speaker: it holds an id, and the face comes from the live participant link.
 * So patching that link — which is all a `characters:update` handler does — has
 * to change what a message renders, with no reload and no per-message state.
 */
import { describe, expect, test } from "vitest"
import { messageSpeaker } from "./messageSpeaker"
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
