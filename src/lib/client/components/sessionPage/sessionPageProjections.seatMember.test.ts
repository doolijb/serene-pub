/** A ref names a seat by its card or by the cast member it holds (s27 S2). */
import { describe, expect, test } from "vitest"
import { avatarSrc } from "$lib/client/utils/media"
import {
	canControlMessageAs,
	characterForRefIn,
	headerCastKeyOf,
	participantForRefIn,
	seatCardIdOfRef
} from "./sessionPageProjections"

const card = (id: number, name: string) => ({ id, name, nickname: null })

const session = (extra: Record<string, unknown> = {}) =>
	({
		sessionCharacters: [
			{ characterId: 3, castMemberId: 50, position: 0, removedAt: null, character: card(3, "Adeline") },
			{ characterId: 4, castMemberId: 51, position: 1, removedAt: null, character: card(4, "Bo") }
		],
		sessionPersonas: [
			{ personaId: 8, castMemberId: 60, position: 0, removedAt: null, persona: card(8, "Kit") }
		],
		sessionMessages: [],
		...extra
	}) as any

describe("seatCardIdOfRef", () => {
	test("character:<id> is that id, seated or not", () => {
		expect(seatCardIdOfRef(session(), "character:3")).toBe(3)
		expect(seatCardIdOfRef(session(), "character:99")).toBe(99)
	})

	test("seated-member:<id> is the card of the seat that member holds", () => {
		expect(seatCardIdOfRef(session(), "seated-member:51")).toBe(4)
	})

	test("a persona seat is the fallback", () => {
		expect(seatCardIdOfRef(session(), "seated-member:60")).toBe(8)
	})

	test("a live seat before a departed one, then the lowest position", () => {
		const s = session({
			sessionCharacters: [
				{ characterId: 5, castMemberId: 70, position: 0, removedAt: "2026-11-05", character: card(5, "Gone") },
				{ characterId: 6, castMemberId: 70, position: 3, removedAt: null, character: card(6, "Late") },
				{ characterId: 7, castMemberId: 70, position: 2, removedAt: null, character: card(7, "Early") }
			]
		})
		expect(seatCardIdOfRef(s, "seated-member:70")).toBe(7)
	})

	test("two seats on one member: the lowest position, then payload order", () => {
		const twins = session({
			sessionCharacters: [
				{ characterId: 6, castMemberId: 70, position: 2, removedAt: null, character: card(6, "B") },
				{ characterId: 7, castMemberId: 70, position: 1, removedAt: null, character: card(7, "A") }
			]
		})
		expect(seatCardIdOfRef(twins, "seated-member:70")).toBe(7)
		const tied = session({
			sessionCharacters: [
				{ characterId: 6, castMemberId: 70, position: 1, removedAt: null, character: card(6, "B") },
				{ characterId: 7, castMemberId: 70, position: 1, removedAt: null, character: card(7, "A") }
			]
		})
		expect(seatCardIdOfRef(tied, "seated-member:70")).toBe(6)
	})

	test("a character seat wins over a persona seat on the same member", () => {
		const s = session({
			sessionPersonas: [{ personaId: 8, castMemberId: 50, position: 0, removedAt: null, persona: card(8, "Kit") }]
		})
		expect(seatCardIdOfRef(s, "seated-member:50")).toBe(3)
	})

	test("anything else, or a member with no seat, is null", () => {
		for (const ref of ["seated-member:999", "player-seat:3", "envoy:x", "seated-member:", "", null, undefined])
			expect(seatCardIdOfRef(session(), ref)).toBeNull()
		expect(seatCardIdOfRef(undefined, "seated-member:50")).toBeNull()
	})
})

describe("seatCardIdOfRef keeps seatOf's order", () => {
	// Every seat is on member 5; each test lists the seats still in play, so
	// the step under test is the one that decides.
	const gone = "2026-11-05"
	const departedCharacter = { id: 1, characterId: 101, castMemberId: 5, position: 0, removedAt: gone }
	const livePlayer = { id: 2, personaId: 102, castMemberId: 5, position: 0, removedAt: null }
	const liveCharacterLate = { id: 3, characterId: 103, castMemberId: 5, position: 4, removedAt: null }
	const liveCharacterNoPosition = { id: 9, characterId: 104, castMemberId: 5, position: null, removedAt: null }
	const liveCharacterFirst = { id: 8, characterId: 105, castMemberId: 5, position: 1, removedAt: null }
	const liveCharacterLowId = { id: 6, characterId: 106, castMemberId: 5, position: 0, removedAt: null }
	const read = (characters: any[], players: any[] = []) =>
		seatCardIdOfRef({ sessionCharacters: characters, sessionPersonas: players }, "seated-member:5")

	test("live before departed: a live player seat beats a departed character seat", () => {
		expect(read([departedCharacter], [livePlayer])).toBe(102)
	})

	test("then the character seat before the player seat, whatever the position", () => {
		expect(read([liveCharacterLate], [livePlayer])).toBe(103)
	})

	test("then the lowest position, a null position counting as 0", () => {
		expect(read([liveCharacterLate, liveCharacterFirst])).toBe(105)
		expect(read([liveCharacterFirst, liveCharacterNoPosition])).toBe(104)
	})

	test("then the lowest seat id, whatever the payload order", () => {
		// seat 9 has no position (0), seat 6 has position 0: a tie, seat 6 wins.
		expect(read([liveCharacterNoPosition, liveCharacterLowId])).toBe(106)
	})

	test("an envoy seat on the same member is never picked", () => {
		const envoy = { id: 1, characterId: 107, castMemberId: 5, envoySlug: "scribe", position: 0, removedAt: null }
		expect(read([envoy, liveCharacterLate])).toBe(103)
		expect(read([envoy])).toBeNull()
		expect(read([envoy], [livePlayer])).toBe(102)
	})

	test("the seat picked with no card id is null, not the next seat's card", () => {
		const noCard = { id: 1, characterId: null, castMemberId: 5, position: 0, removedAt: gone }
		expect(read([noCard])).toBeNull()
		expect(read([noCard], [{ id: 2, personaId: 102, castMemberId: 5, position: 0, removedAt: gone }])).toBeNull()
	})
})

describe("characterForRefIn with a seated-member ref", () => {
	test("finds the seat's card, as its member shows it", () => {
		const s = session({ castNames: { 3: { ownName: "Adel", ownNickname: "" } } })
		expect(characterForRefIn(s, "seated-member:50")?.name).toBe("Adel")
		expect(characterForRefIn(s, "character:3")?.name).toBe("Adel")
	})

	test("a member with no own names gives the card itself; a persona too", () => {
		const s = session()
		expect(characterForRefIn(s, "seated-member:50")).toBe(s.sessionCharacters[0].character)
		expect(characterForRefIn(s, "seated-member:60")).toBe(s.sessionPersonas[0].persona)
		expect(characterForRefIn(s, "seated-member:999")).toBeUndefined()
	})
})

describe("headerCastKeyOf with a member's face and sets", () => {
	const faces = (s: any) => JSON.parse(headerCastKeyOf(s, null)).map((m: any) => m.avatarSrc)

	test("the member's face is the disc's, over the card's media row", () => {
		const s = session()
		s.sessionCharacters[0].character.avatarMedia = { uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", rev: 1 }
		const before = faces(s)[0]
		s.castFaces = { 3: 21 }
		const after = faces(s)[0]
		expect(before).toContain("aaaaaaaa")
		expect(after).not.toContain("aaaaaaaa")
		expect(after).toContain("21")
	})

	test("the member's own sprite sets draw the disc's sprite", () => {
		const s = session({
			sessionMessages: [{ id: 1, characterId: 3, metadata: { sprite: { set: "Member", label: "neutral" } } }],
			castSpriteSets: {
				3: [
					{
						name: "Member",
						isDefault: true,
						sprites: [{ label: "neutral", position: 0, file: { uuid: "11111111-2222-4333-8444-555555555555", rev: 2 } }]
					}
				]
			}
		})
		expect(faces(s)[0]).toContain("11111111")
	})
})

describe("seats read by what they carry, not by the number in a ref (s27 S3)", () => {
	// Card 7 is one person's, cast member 7 another's: a reader that takes
	// the number in a ref for the other kind of id picks the wrong person.
	const collide = () =>
		({
			sessionCharacters: [
				{ id: 1, characterId: 7, castMemberId: 50, position: 0, removedAt: null, ref: "seated-member:50", character: card(7, "Ivy") },
				{ id: 2, characterId: 2, castMemberId: 7, position: 1, removedAt: null, ref: "seated-member:7", character: card(2, "Joss") }
			],
			sessionPersonas: [
				{ id: 9, personaId: null, castMemberId: 61, position: 0, removedAt: null, ref: "player-seat:9", persona: null }
			],
			sessionMessages: []
		}) as any

	test("seatCardIdOfRef: a member ref gives the member's seat's card, a seat ref its seat's", () => {
		const s = collide()
		expect(seatCardIdOfRef(s, "seated-member:7")).toBe(2)
		expect(seatCardIdOfRef(s, "seated-member:50")).toBe(7)
		// A seat with no card is null, not the next seat's.
		expect(seatCardIdOfRef(s, "player-seat:9")).toBeNull()
	})

	test("seatCardIdOfRef on today's data: a card ref is its id, a carded player seat answers to both its refs", () => {
		const s = {
			sessionCharacters: [{ id: 1, characterId: 3, castMemberId: 50 }],
			sessionPersonas: [{ id: 5, personaId: 8, castMemberId: 60 }]
		}
		expect(seatCardIdOfRef(s, "character:3")).toBe(3)
		expect(seatCardIdOfRef(s, "character:99")).toBe(99)
		expect(seatCardIdOfRef(s, "player-seat:5")).toBe(8)
		expect(seatCardIdOfRef(s, "seated-member:60")).toBe(8)
	})

	test("characterForRefIn: a member ref draws the member's card", () => {
		expect(characterForRefIn(collide(), "seated-member:7")?.name).toBe("Joss")
		expect(characterForRefIn(collide(), "seated-member:50")?.name).toBe("Ivy")
	})

	test("characterForRefIn: the seat the ref names gives its own card, even where two seats share a card", () => {
		// Card 7 sits in two seats (two members); each ref draws its own seat's card.
		const twins = {
			sessionCharacters: [
				{ id: 1, characterId: 7, castMemberId: 50, position: 0, removedAt: null, ref: "seated-member:50", character: card(7, "Ivy A") },
				{ id: 2, characterId: 7, castMemberId: 51, position: 1, removedAt: null, ref: "seated-member:51", character: card(7, "Ivy B") }
			],
			sessionPersonas: [
				{ id: 9, personaId: 2, castMemberId: 61, position: 0, removedAt: null, ref: "player-seat:9", persona: card(2, "Kit") }
			],
			sessionMessages: []
		} as any
		expect(characterForRefIn(twins, "seated-member:51")?.name).toBe("Ivy B")
		expect(characterForRefIn(twins, "seated-member:50")?.name).toBe("Ivy A")
		expect(characterForRefIn(twins, "player-seat:9")?.name).toBe("Kit")
		// Card 7 is one person's, member 7 another's: the member ref wins.
		expect(characterForRefIn(collide(), "seated-member:7")?.name).toBe("Joss")
		// An unseated card ref names no card here.
		expect(characterForRefIn(collide(), "character:99")).toBeUndefined()
	})

	test("headerCastKeyOf: a disc is keyed by its seat's ref when the host fills one, else by its card", () => {
		const keys = (s: any) => JSON.parse(headerCastKeyOf(s, null)).map((m: any) => m.key)
		expect(keys(collide())).toEqual(["seated-member:50", "seated-member:7"])
		expect(keys(session())).toEqual(["character:3", "character:4", "persona:8"])
	})
})

describe("canControlMessageAs finds the line's seat (s27 S3)", () => {
	const guest = { user: { id: 2 } } as any
	const asGuest = (s: any, msg: any) => canControlMessageAs(guest, true, s, msg)

	test("today: a persona line is its card's owner's; a character line a guest's own character's", () => {
		const s: any = {
			sessionPersonas: [{ personaId: 8, persona: { userId: 2 } }, { personaId: 9, persona: { userId: 1 } }],
			sessionCharacters: [{ characterId: 3, character: { userId: 2 } }, { characterId: 4, character: { userId: 1 } }]
		}
		expect(asGuest(s, { personaId: 8 })).toBe(true)
		expect(asGuest(s, { personaId: 9 })).toBe(false)
		expect(asGuest(s, { characterId: 3 })).toBe(true)
		expect(asGuest(s, { characterId: 4 })).toBe(false)
		expect(canControlMessageAs({ user: { id: 1 } } as any, false, s, { characterId: 4 } as any)).toBe(true)
	})

	test("a departed and a live seat on one card still judge by the card's owner", () => {
		const s = {
			sessionCharacters: [
				{ characterId: 3, removedAt: "2026-11-05", character: { userId: 2 } },
				{ characterId: 3, character: { userId: 2 } }
			]
		}
		expect(asGuest(s, { characterId: 3 })).toBe(true)
	})

	test("S4: a line stamped with a member is judged by the seat holding that member, not the colliding card", () => {
		// Card 7 is the owner's (user 1); member 7 holds card 2, the guest's.
		const s = {
			sessionCharacters: [
				{ characterId: 7, castMemberId: 50, character: { id: 7, userId: 1 } },
				{ characterId: 2, castMemberId: 7, character: { id: 2, userId: 2 } }
			],
			sessionPersonas: [
				{ personaId: 7, castMemberId: 60, persona: { id: 7, userId: 1 } },
				{ personaId: 2, castMemberId: 7, persona: { id: 2, userId: 2 } }
			]
		}
		// Carded 7 by the guest's member: the guest's own seat holds member 7.
		expect(asGuest(s, { characterId: 7, castMemberId: 7 })).toBe(true)
		expect(asGuest(s, { characterId: 7, castMemberId: 50 })).toBe(false)
		expect(asGuest(s, { personaId: 7, castMemberId: 7 })).toBe(true)
		expect(asGuest(s, { personaId: 7, castMemberId: 60 })).toBe(false)
		// A member no seat of the form holds falls back to the card column.
		expect(asGuest(s, { personaId: 2, castMemberId: 999 })).toBe(true)
		expect(asGuest(s, { characterId: 7, castMemberId: 999 })).toBe(false)
	})
})

describe("participantForRefIn (card 7 is not member 7)", () => {
	const s4 = {
		sessionCharacters: [
			{ id: 1, characterId: 7, castMemberId: 50, ref: "seated-member:50", position: 0, removedAt: null, character: card(7, "Adeline") },
			// A card-less character seat of member 7.
			{ id: 2, characterId: null, castMemberId: 7, ref: "seated-member:7", position: 1, removedAt: null }
		],
		sessionPersonas: [
			// Card 7 again, in a player seat, under a seat name.
			{ id: 20, personaId: 7, castMemberId: 60, ref: "player-seat:20", position: 0, removedAt: null, persona: card(7, "Adeline"), seatName: "Wren" },
			{ id: 21, personaId: null, castMemberId: 61, ref: "player-seat:21", position: 1, removedAt: null, seatName: "Rook", portraitMediaId: 9 },
			{ id: 22, personaId: null, castMemberId: 62, ref: "player-seat:22", position: 2, removedAt: null, seatName: "Pip" }
		],
		castNames: { 7: { ownName: "Ada", ownNickname: "" } },
		sessionMessages: []
	} as any
	test("a character seat as before: the cast's name for its card", () => {
		expect(participantForRefIn(s4, "seated-member:50")?.name).toBe("Ada")
	})
	test("a K-2 card gives each ref its own seat's name", () => {
		expect(participantForRefIn(s4, "seated-member:50")?.name).toBe("Ada")
		expect(participantForRefIn(s4, "player-seat:20")?.name).toBe("Wren")
	})
	test("a carded player seat has its persona's face", () => {
		const withFace = {
			...s4,
			sessionPersonas: [
				{ ...s4.sessionPersonas[0], persona: { ...card(7, "Kit"), avatarMediaId: 5 }, seatName: null }
			],
			castNames: {}
		}
		expect(participantForRefIn(withFace, "player-seat:20")).toEqual({
			name: "Kit",
			avatarUrl: avatarSrc({ avatarMediaId: 5 }) ?? null
		})
	})
	test("a card-less player seat: its seat name, its portrait as the face, else none", () => {
		expect(participantForRefIn(s4, "player-seat:21")).toEqual({
			name: "Rook",
			avatarUrl: avatarSrc({ avatarMediaId: 9 }) ?? null
		})
		expect(participantForRefIn(s4, "player-seat:22")).toEqual({ name: "Pip", avatarUrl: null })
	})
	test("no seat: null; card form still answers", () => {
		expect(participantForRefIn(s4, "seated-member:99")).toBeNull()
		expect(participantForRefIn(session(), "character:3")?.name).toBe("Adeline")
	})
})
