/**
 * Seat identity on the client (s27 S3): each helper on today's card-keyed
 * payload and on member-keyed (S4-shaped) data, where a card id and a cast
 * member id collide on purpose — card 7 is one person, member 7 another.
 */
import { describe, expect, test } from "vitest"
import {
	castEntryOf,
	castEntryOfMember,
	messageRefOf,
	seatOfCastMember,
	seatOfMessage,
	seatOfRef,
	seatRefOf,
	type SeatsPayload
} from "./seatIdentity"

const GONE = "2026-11-05"

describe("seatRefOf", () => {
	test("today: a character seat is its card; a player seat its card, else its own id", () => {
		expect(seatRefOf({ characterId: 3 }, "character")).toBe("character:3")
		expect(seatRefOf({ characterId: null }, "character")).toBeNull()
		expect(
			seatRefOf({ characterId: 3, envoySlug: "scribe" }, "character")
		).toBeNull()
		expect(seatRefOf({ id: 9, personaId: 8 }, "player")).toBe("character:8")
		expect(seatRefOf({ id: 9, personaId: null }, "player")).toBe(
			"player-seat:9"
		)
		expect(seatRefOf({ id: null, personaId: null }, "player")).toBeNull()
	})
	test("S4: the host's ref wins over the card form, for both tables", () => {
		expect(
			seatRefOf({ characterId: 3, ref: "seated-member:50" }, "character")
		).toBe("seated-member:50")
		expect(
			seatRefOf({ id: 9, personaId: 8, ref: "player-seat:9" }, "player")
		).toBe("player-seat:9")
		expect(seatRefOf({ characterId: 3, ref: "" }, "character")).toBe(
			"character:3"
		)
	})
})

describe("seatOfCastMember", () => {
	const session: SeatsPayload = {
		sessionCharacters: [
			{ id: 1, characterId: 7, castMemberId: 50, position: 0 }
		],
		sessionPersonas: [{ id: 2, personaId: 8, castMemberId: 7, position: 0 }]
	}
	test("finds the seat holding the member, never the card with that id (card 7 is not member 7)", () => {
		const found = seatOfCastMember(session, 7)
		expect(found?.form).toBe("player")
		expect(found?.seat.personaId).toBe(8)
		expect(seatOfCastMember(session, 50)?.seat.characterId).toBe(7)
	})
	test("null for no member or no seat", () => {
		expect(seatOfCastMember(session, null)).toBeNull()
		expect(seatOfCastMember(session, 999)).toBeNull()
		expect(seatOfCastMember(undefined, 7)).toBeNull()
	})
	test("seat order: live before departed in either table, then character before player, position, id", () => {
		const held = (
			characters: any[],
			players: any[] = [],
			prefer?: "character" | "player"
		) =>
			seatOfCastMember(
				{ sessionCharacters: characters, sessionPersonas: players },
				5,
				prefer
			)?.seat.id
		const departedCharacter = {
			id: 1,
			characterId: 101,
			castMemberId: 5,
			position: 0,
			removedAt: GONE
		}
		const livePlayer = {
			id: 2,
			personaId: 102,
			castMemberId: 5,
			position: 0
		}
		const lateCharacter = {
			id: 3,
			characterId: 103,
			castMemberId: 5,
			position: 4
		}
		const firstCharacter = {
			id: 8,
			characterId: 105,
			castMemberId: 5,
			position: 1
		}
		const noPosition = {
			id: 9,
			characterId: 104,
			castMemberId: 5,
			position: null
		}
		const lowId = { id: 6, characterId: 106, castMemberId: 5, position: 0 }
		expect(held([departedCharacter], [livePlayer])).toBe(2)
		expect(held([lateCharacter], [livePlayer])).toBe(3)
		expect(held([lateCharacter, firstCharacter])).toBe(8)
		expect(held([firstCharacter, noPosition])).toBe(9)
		expect(held([noPosition, lowId])).toBe(6)
		const envoy = {
			id: 1,
			characterId: 107,
			castMemberId: 5,
			envoySlug: "scribe",
			position: 0
		}
		expect(held([envoy])).toBeUndefined()
		expect(held([envoy, lateCharacter])).toBe(3)
	})
	test("prefer: a seat of that form first, then the other", () => {
		const both = {
			sessionCharacters: [{ id: 1, characterId: 3, castMemberId: 5 }],
			sessionPersonas: [{ id: 2, personaId: 4, castMemberId: 5 }]
		}
		expect(seatOfCastMember(both, 5)?.form).toBe("character")
		expect(seatOfCastMember(both, 5, "player")?.form).toBe("player")
		expect(
			seatOfCastMember(
				{ sessionCharacters: both.sessionCharacters },
				5,
				"player"
			)?.form
		).toBe("character")
		// A departed preferred seat still comes first within its form.
		const departedPlayer = {
			...both,
			sessionPersonas: [
				{ id: 2, personaId: 4, castMemberId: 5, removedAt: GONE }
			]
		}
		expect(seatOfCastMember(departedPlayer, 5, "player")?.form).toBe(
			"player"
		)
	})
})

describe("seatOfRef", () => {
	test("today: a card ref finds the seat on that card; a seat ref the card-less seat", () => {
		const session = {
			sessionCharacters: [{ id: 1, characterId: 3, castMemberId: 50 }],
			sessionPersonas: [
				{ id: 2, personaId: 8, castMemberId: 60 },
				{ id: 9, personaId: null, castMemberId: 61 }
			]
		}
		expect(seatOfRef(session, "character:3")?.seat.id).toBe(1)
		expect(seatOfRef(session, "character:8")?.seat.id).toBe(2)
		expect(seatOfRef(session, "player-seat:9")?.seat.id).toBe(9)
		// A seat that took a card keeps answering to its seat ref.
		expect(seatOfRef(session, "player-seat:2")?.seat.id).toBe(2)
		expect(seatOfRef(session, "seated-member:60")?.seat.id).toBe(2)
		expect(seatOfRef(session, "character:99")).toBeNull()
		expect(seatOfRef(session, "envoy:x")).toBeNull()
		expect(seatOfRef(session, "")).toBeNull()
		expect(seatOfRef(session, null)).toBeNull()
	})
	test("S4: a member ref finds the member's seat, not the card or the seat with that number", () => {
		const session: SeatsPayload = {
			sessionCharacters: [
				{
					id: 1,
					characterId: 7,
					castMemberId: 50,
					ref: "seated-member:50"
				},
				{
					id: 4,
					characterId: 2,
					castMemberId: 7,
					ref: "seated-member:7"
				}
			],
			sessionPersonas: [
				{
					id: 7,
					personaId: null,
					castMemberId: 51,
					ref: "player-seat:7"
				}
			]
		}
		expect(seatOfRef(session, "seated-member:7")?.seat.characterId).toBe(2)
		expect(seatOfRef(session, "seated-member:50")?.seat.characterId).toBe(7)
		expect(seatOfRef(session, "player-seat:7")?.seat.castMemberId).toBe(51)
		// A card ref names no seat when every seat carries a member ref.
		expect(seatOfRef(session, "character:7")).toBeNull()
	})
	test("a carded player seat with a host ref still answers to player-seat:<id>", () => {
		const session = {
			sessionPersonas: [
				{ id: 5, personaId: 8, castMemberId: 60, ref: "player-seat:5" }
			]
		}
		expect(seatOfRef(session, "player-seat:5")?.seat.personaId).toBe(8)
		expect(seatOfRef(session, "seated-member:60")?.seat.personaId).toBe(8)
	})
	test("the first seat in seat order answers; an envoy's seat never does", () => {
		const session = {
			sessionCharacters: [
				{ id: 1, characterId: 3, castMemberId: 5, removedAt: GONE },
				{ id: 2, characterId: 4, castMemberId: 5 },
				{
					id: 3,
					characterId: 5,
					castMemberId: 5,
					envoySlug: "scribe",
					position: -1
				}
			]
		}
		expect(seatOfRef(session, "seated-member:5")?.seat.id).toBe(2)
		expect(seatOfRef(session, "character:5")).toBeNull()
	})
})

describe("seatOfMessage", () => {
	// Card 7 is Ivy's character; member 7 holds a different card (2).
	const session = {
		sessionCharacters: [
			{ id: 1, characterId: 7, castMemberId: 50 },
			{ id: 4, characterId: 2, castMemberId: 7 }
		],
		sessionPersonas: [
			{ id: 10, personaId: 8, castMemberId: 60 },
			{ id: 11, personaId: null, castMemberId: 61 }
		]
	}
	test("today: a persona line finds the player seat on its card; a character line the character seat", () => {
		expect(seatOfMessage(session, { personaId: 8 })?.seat.id).toBe(10)
		expect(seatOfMessage(session, { characterId: 7 })?.seat.id).toBe(1)
		expect(seatOfMessage(session, { characterId: 99 })).toBeNull()
		expect(seatOfMessage(session, { personaId: 99 })).toBeNull()
	})
	test("S4: the line's member finds its seat; a colliding card id does not mislead", () => {
		// The line says member 7 spoke, and card 2 is that seat's.
		expect(
			seatOfMessage(session, { characterId: 2, castMemberId: 7 })?.seat.id
		).toBe(4)
		// A member no seat of the form holds falls back to the card column.
		expect(
			seatOfMessage(session, { characterId: 7, castMemberId: 999 })?.seat
				.id
		).toBe(1)
		// The member must be held by a seat of the line's form.
		expect(
			seatOfMessage(session, { personaId: 8, castMemberId: 50 })?.seat.id
		).toBe(10)
		expect(
			seatOfMessage(session, { personaId: 8, castMemberId: 60 })?.seat.id
		).toBe(10)
	})
	test("a card-less line finds the player seat its stamped speaker names; an envoy finds nothing", () => {
		expect(
			seatOfMessage(session, { metadata: { speaker: "player-seat:11" } })
				?.seat.id
		).toBe(11)
		expect(
			seatOfMessage(session, { metadata: { speaker: "envoy:scribe" } })
		).toBeNull()
		// A stamp names any seat of either table, as the turn order's refs do.
		expect(
			seatOfMessage(session, { metadata: { speaker: "character:7" } })
				?.seat.id
		).toBe(1)
		expect(seatOfMessage(session, { metadata: {} })).toBeNull()
		// A card-less line with only a member: the role picks the form; this
		// member holds no character seat, so an assistant line finds nothing.
		expect(
			seatOfMessage(session, { castMemberId: 61, role: "assistant" })
		).toBeNull()
		expect(
			seatOfMessage(session, { castMemberId: 61, role: "user" })?.seat.id
		).toBe(11)
	})
	test("a card-less line finds its seat by a member-keyed host ref", () => {
		const s4 = {
			sessionPersonas: [
				{
					id: 11,
					personaId: null,
					castMemberId: 61,
					ref: "seated-member:61"
				}
			]
		}
		expect(
			seatOfMessage(s4, { metadata: { speaker: "seated-member:61" } })
				?.seat.id
		).toBe(11)
	})
})

describe("messageRefOf", () => {
	test("today: the line's own card columns; a card-less player line names its seat (★S3W-1)", () => {
		const session = {
			sessionPersonas: [{ id: 11, personaId: null, castMemberId: 61 }]
		}
		expect(messageRefOf(session, { characterId: 3 })).toBe("character:3")
		expect(messageRefOf(session, { personaId: 8 })).toBe("character:8")
		expect(messageRefOf(session, { characterId: 3, personaId: 8 })).toBe(
			"character:3"
		)
		expect(
			messageRefOf(session, { metadata: { speaker: "player-seat:11" } })
		).toBe("player-seat:11")
		expect(messageRefOf(undefined, { characterId: 3 })).toBe("character:3")
	})
	test("S4: the seat's host-filled ref wins; a colliding card id is not the ref", () => {
		const session = {
			sessionCharacters: [
				{
					id: 1,
					characterId: 7,
					castMemberId: 50,
					ref: "seated-member:50"
				},
				{
					id: 4,
					characterId: 2,
					castMemberId: 7,
					ref: "seated-member:7"
				}
			],
			sessionPersonas: [
				{
					id: 10,
					personaId: 8,
					castMemberId: 60,
					ref: "player-seat:10"
				},
				{
					id: 11,
					personaId: null,
					castMemberId: 61,
					ref: "player-seat:11"
				}
			]
		}
		expect(messageRefOf(session, { characterId: 2, castMemberId: 7 })).toBe(
			"seated-member:7"
		)
		expect(
			messageRefOf(session, { characterId: 7, castMemberId: 50 })
		).toBe("seated-member:50")
		expect(messageRefOf(session, { personaId: 8, castMemberId: 60 })).toBe(
			"player-seat:10"
		)
		// A card-less player seat's line carries its seat ref (★S3W-1).
		expect(
			messageRefOf(session, { metadata: { speaker: "player-seat:11" } })
		).toBe("player-seat:11")
		// No seat found: today's form on the line's own columns.
		expect(messageRefOf(session, { characterId: 99 })).toBe("character:99")
	})
})

describe("castEntryOf", () => {
	const today = {
		"3": { "core.fate": "alive" },
		player_seat_9: { "core.fate": "dead" },
		"player_seat:9": { "core.fate": "taken-out" }
	}
	test("today (no entry carries a ref): the card's key, or the seat's", () => {
		expect(castEntryOf(today, "character:3")).toBe(today["3"])
		expect(castEntryOf(today, "player-seat:9")).toBe(today["player_seat:9"])
		expect(castEntryOf(today, "character:4")).toBeUndefined()
		expect(castEntryOf(today, null)).toBeUndefined()
		expect(castEntryOf(undefined, "character:3")).toBeUndefined()
	})
	test("S4: the entry whose ref it is, or whose member it is", () => {
		const byId = {
			"7": { ref: "seated-member:7", castMemberId: 7, fate: "alive" },
			"50": { ref: "seated-member:50", castMemberId: 50, fate: "dead" },
			"player_seat:9": { ref: "player-seat:9", fate: "taken-out" }
		}
		expect(castEntryOf(byId, "seated-member:50")).toBe(byId["50"])
		expect(castEntryOf(byId, "player-seat:9")).toBe(byId["player_seat:9"])
		// Member-keyed by member id, the entry lacking a ref is still found by its member.
		const bare = {
			"7": { castMemberId: 7 },
			"8": { ref: "seated-member:8", castMemberId: 8 }
		}
		expect(castEntryOf(bare, "seated-member:7")).toBe(bare["7"])
	})
	test("S4: no fallback to the card key while any entry carries a ref", () => {
		// Card 7's ref would hit member 7's key: the wrong person.
		const byId = {
			"7": { ref: "seated-member:7", castMemberId: 7 },
			"50": { ref: "seated-member:50", castMemberId: 50 }
		}
		expect(castEntryOf(byId, "character:7")).toBeUndefined()
		expect(castEntryOf(byId, "player-seat:7")).toBeUndefined()
	})
})

describe("castEntryOfMember", () => {
	test("finds the entry of the member, not the key with that number", () => {
		const byId = {
			"7": { castMemberId: 50 },
			"50": { castMemberId: 7 },
			bare: undefined
		}
		expect(castEntryOfMember(byId, 7)).toBe(byId["50"])
		expect(castEntryOfMember(byId, 999)).toBeUndefined()
		expect(castEntryOfMember(byId, null)).toBeUndefined()
		expect(castEntryOfMember(undefined, 7)).toBeUndefined()
	})
})

describe("member-form lines (S4): card 7 is not member 7", () => {
	const session = {
		sessionCharacters: [
			{ id: 1, characterId: 7, castMemberId: 50, ref: "seated-member:50" },
			{ id: 2, characterId: null, castMemberId: 7, ref: "seated-member:7" },
			// A member holding both seats: character seat 3 and player seat 21.
			{ id: 3, characterId: 4, castMemberId: 70, ref: "seated-member:70" },
			// A departed seat of member 80, and a live one of the same member.
			{
				id: 5,
				characterId: 9,
				castMemberId: 80,
				ref: "seated-member:80",
				removedAt: GONE
			},
			{ id: 6, characterId: 9, castMemberId: 81, ref: "seated-member:81" },
			{
				id: 8,
				characterId: 12,
				castMemberId: 90,
				ref: "seated-member:90",
				removedAt: GONE
			}
		],
		sessionPersonas: [
			{ id: 20, personaId: 7, castMemberId: 60, ref: "player-seat:20" },
			{ id: 21, personaId: null, castMemberId: 70, ref: "player-seat:21" },
			{ id: 22, personaId: null, castMemberId: 61, ref: "player-seat:22" }
		]
	}
	const idOf = (msg: Parameters<typeof seatOfMessage>[1]) =>
		seatOfMessage(session, msg)?.seat.id
	test("a carded character line and a carded persona line", () => {
		expect(idOf({ characterId: 7, castMemberId: 50, role: "assistant" })).toBe(1)
		expect(messageRefOf(session, { characterId: 7, castMemberId: 50 })).toBe(
			"seated-member:50"
		)
		expect(idOf({ personaId: 7, castMemberId: 60, role: "user" })).toBe(20)
		expect(messageRefOf(session, { personaId: 7, castMemberId: 60 })).toBe(
			"player-seat:20"
		)
	})
	test("a card-less character line finds its seat by member", () => {
		const line = { castMemberId: 7, role: "assistant" }
		expect(idOf(line)).toBe(2)
		expect(messageRefOf(session, line)).toBe("seated-member:7")
	})
	test("a card-less player line, stamped and unstamped", () => {
		const stamped = {
			role: "user",
			metadata: { speaker: "player-seat:22" }
		}
		expect(idOf(stamped)).toBe(22)
		expect(messageRefOf(session, stamped)).toBe("player-seat:22")
		const bare = { role: "user", castMemberId: 61 }
		expect(idOf(bare)).toBe(22)
		expect(messageRefOf(session, bare)).toBe("player-seat:22")
	})
	test("a member holding both seats: a user line is the player, an assistant line the character", () => {
		expect(idOf({ castMemberId: 70, role: "user" })).toBe(21)
		expect(
			messageRefOf(session, { castMemberId: 70, role: "user" })
		).toBe("player-seat:21")
		expect(idOf({ castMemberId: 70, role: "assistant" })).toBe(3)
		expect(
			messageRefOf(session, { castMemberId: 70, role: "assistant" })
		).toBe("seated-member:70")
	})
	test("a departed seat: live wins; a departed seat alone is still found", () => {
		expect(idOf({ characterId: 9, role: "assistant" })).toBe(6)
		expect(idOf({ characterId: 9, castMemberId: 80, role: "assistant" })).toBe(5)
		expect(idOf({ characterId: 12, castMemberId: 90, role: "assistant" })).toBe(8)
	})
	test("a narrator line finds nothing", () => {
		expect(
			idOf({ castMemberId: 50, role: "assistant", isNarratorResponse: true })
		).toBeUndefined()
		expect(
			messageRefOf(session, {
				castMemberId: 50,
				isNarratorResponse: true
			})
		).toBeNull()
	})
})
