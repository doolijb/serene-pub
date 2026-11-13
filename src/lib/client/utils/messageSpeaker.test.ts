/**
 * The lookup every rendered message's avatar goes through.
 *
 * The point of these assertions is that a message row holds NO copy of its
 * speaker: it holds an id, and the face comes from the live participant link.
 * So patching that link — which is all a `characters:update` handler does — has
 * to change what a message renders, with no reload and no per-message state.
 */
import { describe, expect, test } from "vitest"
import { messageSpeaker, personLineName, seatNameOf, seatPortraitOf } from "./messageSpeaker"
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

	test("a seated speaker is the card as its cast member shows it (s27 S2)", () => {
		const card = character({ name: "Verity", nickname: "Ver", avatarMediaId: 1, avatarMedia: { uuid: UUID_A, rev: 0 } })
		const link = { characterId: 1, character: card }
		const plain = messageSpeaker({ sessionCharacters: [link] }, { characterId: 1 })
		expect(plain).toBe(card)
		const speaker = messageSpeaker(
			{
				sessionCharacters: [link],
				castNames: { 1: { ownName: "Vera", ownNickname: "" } },
				castFaces: { 1: 21 }
			},
			{ characterId: 1 }
		)
		expect(resolveCharacterName(speaker, "")).toBe("Vera")
		expect(avatarSrc(speaker)).toBe(avatarSrc({ avatarMediaId: 21 }))
		// The card itself is untouched.
		expect(card.name).toBe("Verity")
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

/**
 * 🚧 A seat name (2026-10-14): the player's character name in this session.
 * It wins over the voiced card's name and over the player label.
 */
describe("seat name", () => {
	test("wins over the persona's name, keeping the card's face", () => {
		const session = {
			sessionPersonas: [
				{
					personaId: 7,
					persona: persona({ avatarMediaId: 3 }),
					seatName: "Wren"
				}
			]
		}
		const speaker = messageSpeaker(session, { personaId: 7 })
		expect(speaker?.name).toBe("Wren")
		expect((speaker as any)?.avatarMediaId).toBe(3)
	})

	test("a blank seat name is no name: the persona's stands", () => {
		const session = {
			sessionPersonas: [{ personaId: 7, persona: persona(), seatName: "  " }]
		}
		expect(messageSpeaker(session, { personaId: 7 })?.name).toBe("Jody")
	})

	test("a card-less player seat names the lines that name it, not every line of its player", () => {
		const session = {
			sessionPersonas: [
				{ id: 1, personaId: null, userId: 2, seatName: "Old", removedAt: "2026-10-01" },
				{ id: 2, personaId: null, userId: 2, seatName: " Wren " },
				{ id: 3, personaId: 9, userId: 2, seatName: "Carded" }
			]
		}
		const line = (speaker?: string) => ({ metadata: speaker ? { speaker } : {} })
		expect(seatNameOf(session, line("player-seat:2"))).toBe("Wren")
		// A removed seat still names the lines it sent.
		expect(seatNameOf(session, line("player-seat:1"))).toBe("Old")
		// A seat with a card is named by its card, never as `player-seat:`.
		expect(seatNameOf(session, line("player-seat:3"))).toBeUndefined()
		expect(seatNameOf(session, line())).toBeUndefined()
		expect(seatNameOf(session, { personaId: 9, metadata: { speaker: "player-seat:2" } })).toBeUndefined()
	})

	test("wins over the player label and the member's name", () => {
		expect(
			personLineName({
				seatName: "Wren",
				playerLabel: "Dungeon Master",
				memberName: "jody",
				memberCount: 2
			})
		).toEqual({ name: "Wren" })
	})
})

describe("a persona seat reads its cast member like every seat (s27 S2c)", () => {
	const card = () => persona({ nickname: "Jo", avatarMediaId: 3 })
	const maps = {
		castNames: { 7: { ownName: "Jodyne", ownNickname: "" } },
		castFaces: { 7: 21 }
	}

	test("the member's name and face stand for the card's", () => {
		const speaker = messageSpeaker(
			{ sessionPersonas: [{ personaId: 7, persona: card() }], ...maps },
			{ personaId: 7 }
		)
		expect(resolveCharacterName(speaker, "")).toBe("Jodyne")
		expect(avatarSrc(speaker)).toBe(avatarSrc({ avatarMediaId: 21 }))
	})

	test("a seat name wins over the member's name, the member's face stays", () => {
		const speaker = messageSpeaker(
			{ sessionPersonas: [{ personaId: 7, persona: card(), seatName: "Wren" }], ...maps },
			{ personaId: 7 }
		)
		expect(resolveCharacterName(speaker, "")).toBe("Wren")
		expect(avatarSrc(speaker)).toBe(avatarSrc({ avatarMediaId: 21 }))
		// Even against a nickname of the member's own.
		const nicked = messageSpeaker(
			{
				sessionPersonas: [{ personaId: 7, persona: card(), seatName: "Wren" }],
				castNames: { 7: { ownName: null, ownNickname: "Joj" } }
			},
			{ personaId: 7 }
		)
		expect(resolveCharacterName(nicked, "")).toBe("Wren")
	})

	test("a seat portrait wins over the member's face", () => {
		const speaker = messageSpeaker(
			{ sessionPersonas: [{ personaId: 7, persona: card(), portraitMediaId: 44 }], ...maps },
			{ personaId: 7 }
		)
		expect(avatarSrc(speaker)).toBe(avatarSrc({ avatarMediaId: 44 }))
		expect(resolveCharacterName(speaker, "")).toBe("Jodyne")
	})

	test("a persona with nothing in the maps reads exactly as before", () => {
		const c = card()
		const link = { personaId: 7, persona: c }
		expect(messageSpeaker({ sessionPersonas: [link] }, { personaId: 7 })).toBe(c)
		expect(
			messageSpeaker({ sessionPersonas: [link], castNames: { 1: { ownName: "X", ownNickname: null } }, castFaces: {} }, { personaId: 7 })
		).toBe(c)
		const named = messageSpeaker({ sessionPersonas: [{ ...link, seatName: "Wren" }] }, { personaId: 7 }) as any
		expect(named).toEqual({ ...c, name: "Wren" })
	})
})

describe("a line is read from the seat that holds its cast member (s27 S3)", () => {
	// Card 1 is Verity's; cast member 1 holds a different card (2, Joss).
	const session = {
		sessionCharacters: [
			{ id: 1, characterId: 1, castMemberId: 50, character: character({ id: 1, name: "Verity" }) },
			{ id: 2, characterId: 2, castMemberId: 1, character: character({ id: 2, name: "Joss" }) }
		],
		sessionPersonas: [
			{ id: 7, personaId: 7, castMemberId: 60, persona: persona(), seatName: "Wren" },
			{ id: 8, personaId: 8, castMemberId: 7, persona: persona({ id: 8, name: "Kit" }) }
		]
	}

	test("today's lines (no member on them) read the seat on their card", () => {
		expect(messageSpeaker(session, { characterId: 1 })?.name).toBe("Verity")
		expect(messageSpeaker(session, { personaId: 7 })?.name).toBe("Wren")
		expect(messageSpeaker(session, { characterId: 99 })).toBeUndefined()
	})

	test("a line stamped with a member reads the seat holding it, not the colliding card", () => {
		expect(messageSpeaker(session, { characterId: 1, castMemberId: 1 })?.name).toBe("Joss")
		expect(messageSpeaker(session, { characterId: 1, castMemberId: 50 })?.name).toBe("Verity")
		expect(messageSpeaker(session, { personaId: 7, castMemberId: 7 })?.name).toBe("Kit")
		// A member no seat of that form holds falls back to the card.
		expect(messageSpeaker(session, { characterId: 1, castMemberId: 999 })?.name).toBe("Verity")
	})

	test("a live seat is read before a departed one on the same card", () => {
		const twins = {
			sessionPersonas: [
				{ id: 1, personaId: 7, persona: persona(), seatName: "Old", removedAt: "2026-10-01" },
				{ id: 2, personaId: 7, persona: persona(), seatName: "New" }
			]
		}
		expect(messageSpeaker(twins, { personaId: 7 })?.name).toBe("New")
	})

	test("seatNameOf and seatPortraitOf find the card-less seat by its ref, not by the number in it", () => {
		const s4 = {
			sessionPersonas: [
				{ id: 4, personaId: null, castMemberId: 9, seatName: "Not this", portraitMediaId: 1, ref: "player-seat:4" },
				{ id: 9, personaId: null, castMemberId: 20, seatName: " Bo ", portraitMediaId: 44, ref: "player-seat:9" },
				{ id: 5, personaId: 3, castMemberId: 21, seatName: "Carded", portraitMediaId: 45, ref: "player-seat:5" }
			]
		}
		const line = (speaker: string) => ({ metadata: { speaker } })
		expect(seatNameOf(s4, line("player-seat:9"))).toBe("Bo")
		expect(seatPortraitOf(s4, line("player-seat:9"))).toBe(44)
		// A carded seat is named by its card, but its portrait is still its own.
		expect(seatNameOf(s4, line("player-seat:5"))).toBeUndefined()
		expect(seatPortraitOf(s4, line("player-seat:5"))).toBe(45)
		expect(seatNameOf(s4, line("player-seat:77"))).toBeUndefined()
		expect(seatPortraitOf(s4, line("seated-member:20"))).toBeUndefined()
	})

	test("today's seat (no ref) answers as before", () => {
		const today = { sessionPersonas: [{ id: 2, personaId: null, seatName: "Wren", portraitMediaId: 12 }] }
		const line = { metadata: { speaker: "player-seat:2" } }
		expect(seatNameOf(today, line)).toBe("Wren")
		expect(seatPortraitOf(today, line)).toBe(12)
		expect(seatPortraitOf(today, { metadata: {} })).toBeUndefined()
	})
})

describe("messageSpeaker — a card-less character seat's line (plan §34.2)", () => {
	const seat = (over: Record<string, unknown> = {}) => ({
		id: 1,
		characterId: null,
		castMemberId: 7,
		character: null,
		position: 0,
		removedAt: null,
		envoySlug: null,
		...over
	})

	test("is named and faced from cardlessSeatShown by member id", () => {
		const session = {
			sessionCharacters: [seat()],
			cardlessSeatShown: { 7: { name: "Nobody", nickname: "Nob", faceMediaId: 33 } }
		}
		const speaker = messageSpeaker(session, { characterId: null, personaId: null, castMemberId: 7 })
		expect(speaker?.name).toBe("Nobody")
		expect(resolveCharacterName(speaker, "")).toBe("Nob")
		expect(avatarSrc(speaker)).toBe(avatarSrc({ avatarMediaId: 33 }))
	})

	test("card 7 vs member 7 never cross", () => {
		const carded = {
			id: 2,
			characterId: 7,
			castMemberId: 90,
			character: character({ id: 7, name: "Card Seven" }),
			position: 1,
			removedAt: null
		}
		const session = {
			sessionCharacters: [seat(), carded],
			castNames: { 7: { ownName: "Card-keyed name", ownNickname: "" } },
			cardlessSeatShown: { 7: { name: "Member Seven", nickname: null, faceMediaId: null } }
		}
		// Member 7's line is named by the member-keyed map, not castNames[7].
		const memberLine = messageSpeaker(session, { castMemberId: 7 })
		expect(memberLine?.name).toBe("Member Seven")
		// Card 7's line is named by the card-keyed map, not cardlessSeatShown[7].
		const cardLine = messageSpeaker(session, { characterId: 7, castMemberId: 90 })
		expect(resolveCharacterName(cardLine, "")).toBe("Card-keyed name")
	})

	test("a departed seat with no entry falls back to its removedName", () => {
		const session = {
			sessionCharacters: [seat({ removedAt: "2026-11-01", removedName: "Gone Nobody" })],
			cardlessSeatShown: {}
		}
		expect(messageSpeaker(session, { castMemberId: 7 })?.name).toBe("Gone Nobody")
	})

	test("a card-less player seat keeps its seat name; without one it takes the member's entry", () => {
		const named = {
			sessionPersonas: [{ id: 5, personaId: null, castMemberId: 7, seatName: "Captain", position: 0 }],
			cardlessSeatShown: { 7: { name: "Member", nickname: null, faceMediaId: null } }
		}
		const line = { castMemberId: 7, metadata: { speaker: "player-seat:5" } }
		expect(messageSpeaker(named, line)).toBeUndefined()
		const unnamed = { ...named, sessionPersonas: [{ ...named.sessionPersonas[0]!, seatName: null }] }
		expect(messageSpeaker(unnamed, line)?.name).toBe("Member")
	})
})
