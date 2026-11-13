import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { MemberAsRead } from "$lib/server/cast/memberAsRead"
import type { CharacterGreeting } from "$lib/shared/characters/profile"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import {
	cardFormRefInCast,
	hostSeatRefOf,
	seatCardAsRead,
	storedSeatRefInCast
} from "./seatCards"

/** A whole card row, as a seat's `character` carries it. */
function card(over: Record<string, unknown> = {}) {
	return {
		id: 11,
		userId: 1,
		name: "Maren",
		nickname: "Mare",
		description: "Card description.",
		personality: "Card personality.",
		scenario: "Card scenario.",
		firstMessage: "Card hello.",
		alternateGreetings: ["Card other hello."],
		exampleDialogues: ["Card dialogue one", "Card dialogue two"],
		groupOnlyGreetings: ["Card group hello."],
		avatarMediaId: 500,
		extensions: {},
		strokes: [{ kind: "description", text: "A stroke." }],
		tags: "kept",
		...over
	}
}

/**
 * A member as read whose every profile field reads what `card()` holds (a
 * member following its card version), with `over` laid on top.
 */
function asRead(over: Partial<MemberAsRead> = {}): MemberAsRead {
	const greetings: CharacterGreeting[] = [
		{ text: "Card hello." },
		{ text: "Card other hello." },
		{ text: "Card group hello.", groupOnly: true }
	]
	return {
		castMemberId: 7,
		lorebookId: 3,
		castVersionId: 70,
		cardVersion: { id: 110, number: 1, label: "1.0" },
		linkedCardId: 11,
		activeCardId: 11,
		cardless: false,
		behindCard: false,
		follows: [],
		nodeState: "active",
		nodeVisibility: "normal",
		name: "Maren",
		nickname: "Mare",
		shownName: "Mare",
		aliases: [],
		summary: null,
		description: "Card description.",
		personality: "Card personality.",
		scenario: "Card scenario.",
		greetings,
		firstMessage: "Card hello.",
		alternateGreetings: ["Card other hello."],
		exampleDialogues: ["Card dialogue one", "Card dialogue two"],
		groupOnlyGreetings: ["Card group hello."],
		postHistoryInstructions: null,
		creatorNotes: null,
		strokes: [{ kind: "description", text: "A stroke." }] as never,
		likeness: null,
		extensions: {},
		followsCard: [],
		faceMediaId: 500,
		timbre: null,
		voiceFrom: null,
		spriteSets: [],
		spriteSetsFrom: null,
		spriteSet: null,
		tags: [],
		...over
	}
}

// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
// A seat's card row reads every profile field from the member as read (its
// version in force, followed fields from the parent card version) — never
// from the card the seat holds.
describe("seatCardAsRead", () => {
	test("a member reading what the card holds is the card itself", () => {
		const c = card()
		expect(seatCardAsRead(c, asRead())).toBe(c)
	})

	test("an empty card nickname is not turned into null", () => {
		const c = card({ nickname: "" })
		expect(seatCardAsRead(c, asRead({ nickname: null }))).toBe(c)
	})

	test("the member's own names and words replace the card's, keeping the id and every other key", () => {
		const c = card()
		const read = seatCardAsRead(
			c,
			asRead({
				name: "Mara",
				nickname: "Ma",
				description: "Member description.",
				greetings: [
					{ text: "Member hello." },
					{ text: "Member group hello.", groupOnly: true }
				]
			})
		)
		expect(read).toEqual({
			...c,
			name: "Mara",
			nickname: "Ma",
			description: "Member description.",
			firstMessage: "Member hello.",
			alternateGreetings: [],
			groupOnlyGreetings: ["Member group hello."]
		})
	})

	test("a card-less member's post-history, likeness, notes and face reach a whole row", () => {
		const held = card({
			postHistoryInstructions: "Card reminder.",
			creatorNotes: "Card notes.",
			creatorNotesMultilingual: null,
			aliases: ["Mare"],
			summary: "Card summary."
		})
		const read = seatCardAsRead(
			held,
			asRead({
				cardVersion: null,
				activeCardId: null,
				cardless: true,
				name: "Wren",
				nickname: null,
				aliases: ["Little Wren"],
				summary: "A wanderer.",
				postHistoryInstructions: "Stay in Wren's voice.",
				creatorNotes: { text: "Wren's notes.", variants: {} },
				likeness: { prompt: "a small wren-like woman" },
				faceMediaId: 901,
				strokes: []
			})
		) as ReturnType<typeof card>
		expect(read).toMatchObject({
			id: 11,
			userId: 1,
			tags: "kept",
			name: "Wren",
			nickname: null,
			aliases: ["Little Wren"],
			summary: "A wanderer.",
			postHistoryInstructions: "Stay in Wren's voice.",
			creatorNotes: "Wren's notes.",
			avatarMediaId: 901,
			strokes: []
		})
		expect(
			(
				read.extensions as {
					serenepub?: { likeness?: { prompt?: string } }
				}
			).serenepub?.likeness?.prompt
		).toBe("a small wren-like woman")
	})

	test("a row that carries only names gets only names", () => {
		const names = { id: 11, name: "Maren", nickname: "Mare" }
		expect(seatCardAsRead(names, asRead({ name: "Mara" }))).toEqual({
			id: 11,
			name: "Mara",
			nickname: "Mare"
		})
	})
})

describe("cardFormRefInCast", () => {
	const cast = {
		sessionCharacters: [
			{
				castMemberId: 7,
				seatId: 2,
				position: 1,
				removedAt: new Date(),
				character: { id: 30 }
			},
			{
				castMemberId: 7,
				seatId: 1,
				position: 2,
				removedAt: null,
				character: { id: 11 }
			},
			{
				castMemberId: 8,
				seatId: 3,
				position: 0,
				removedAt: null,
				character: { id: 40 }
			}
		],
		sessionPersonas: [
			{
				castMemberId: 8,
				seatId: 9,
				position: 0,
				removedAt: null,
				persona: { id: 50 }
			},
			{
				castMemberId: 9,
				seatId: 10,
				position: 1,
				removedAt: null,
				persona: null
			}
		]
	}

	test("other refs pass through unchanged", () => {
		expect(cardFormRefInCast(cast, "character:11")).toBe("character:11")
		expect(cardFormRefInCast(cast, "envoy:castellan")).toBe(
			"envoy:castellan"
		)
		expect(cardFormRefInCast(null, "player-seat:4")).toBe("player-seat:4")
	})

	test("a live seat wins over a departed one", () => {
		expect(cardFormRefInCast(cast, "seated-member:7")).toBe("character:11")
	})

	test("a character seat wins over a player seat", () => {
		expect(cardFormRefInCast(cast, "seated-member:8")).toBe("character:40")
	})

	test("a card-less player seat answers as its own seat", () => {
		expect(cardFormRefInCast(cast, "seated-member:9")).toBe(
			"player-seat:10"
		)
	})

	test("a member nobody seats is null", () => {
		expect(cardFormRefInCast(cast, "seated-member:99")).toBeNull()
	})
})

describe("cardFormRefInCast keeps seatOf's order", () => {
	// Every seat is on member 5; each test lists the seats still in play, so
	// the step under test is the one that decides.
	const gone = new Date()
	const seats = {
		departedCharacter: {
			castMemberId: 5,
			seatId: 1,
			position: 0,
			removedAt: gone,
			character: { id: 101 }
		},
		livePlayer: {
			castMemberId: 5,
			seatId: 2,
			position: 0,
			removedAt: null,
			persona: { id: 102 }
		},
		liveCharacterLate: {
			castMemberId: 5,
			seatId: 3,
			position: 4,
			removedAt: null,
			character: { id: 103 }
		},
		liveCharacterNoPosition: {
			castMemberId: 5,
			seatId: 9,
			position: null,
			removedAt: null,
			character: { id: 104 }
		},
		liveCharacterFirst: {
			castMemberId: 5,
			seatId: 8,
			position: 1,
			removedAt: null,
			character: { id: 105 }
		},
		liveCharacterNoPositionLowId: {
			castMemberId: 5,
			seatId: 6,
			position: 0,
			removedAt: null,
			character: { id: 106 }
		}
	}
	const read = (
		characters: (typeof seats)[keyof typeof seats][],
		players: (typeof seats)[keyof typeof seats][] = []
	) =>
		cardFormRefInCast(
			{
				sessionCharacters: characters as any,
				sessionPersonas: players as any
			},
			"seated-member:5"
		)

	test("live before departed: a live player seat beats a departed character seat", () => {
		expect(read([seats.departedCharacter], [seats.livePlayer])).toBe(
			"character:102"
		)
	})

	test("then the character seat before the player seat, whatever the position", () => {
		expect(read([seats.liveCharacterLate], [seats.livePlayer])).toBe(
			"character:103"
		)
	})

	test("then the lowest position, a null position counting as 0", () => {
		expect(read([seats.liveCharacterLate, seats.liveCharacterFirst])).toBe(
			"character:105"
		)
		expect(
			read([seats.liveCharacterFirst, seats.liveCharacterNoPosition])
		).toBe("character:104")
	})

	test("then the lowest seat id", () => {
		// seat 9 has no position (0), seat 6 has position 0: a tie, seat 6 wins.
		expect(
			read([
				seats.liveCharacterNoPosition,
				seats.liveCharacterNoPositionLowId
			])
		).toBe("character:106")
	})
})

describe("hostSeatRefOf and storedSeatRefInCast (S4 flip)", () => {
	let was = false
	beforeEach(() => {
		was = memberFormSwitch.on
	})
	afterEach(() => {
		memberFormSwitch.on = was
	})

	const cast = {
		sessionCharacters: [
			{
				castMemberId: 7,
				seatId: 2,
				position: 0,
				removedAt: null,
				character: { id: 11 }
			},
			// member-less character seat
			{
				castMemberId: null,
				seatId: 3,
				position: 1,
				removedAt: null,
				character: { id: 12 }
			}
		],
		sessionPersonas: [
			// the same member and card as seat 2 (★K-2): a person voicing the card
			{
				castMemberId: 7,
				seatId: 20,
				position: 0,
				removedAt: null,
				persona: { id: 11 }
			},
			// a member seated only in a player seat
			{
				castMemberId: 8,
				seatId: 21,
				position: 1,
				removedAt: null,
				persona: { id: 13 }
			},
			// card-less player seat
			{
				castMemberId: 9,
				seatId: 22,
				position: 2,
				removedAt: null,
				persona: null
			}
		]
	}

	test("off: the card form", () => {
		memberFormSwitch.on = false
		expect(
			hostSeatRefOf({
				kind: "character",
				seatId: 2,
				castMemberId: 7,
				cardId: 11
			})
		).toBe("character:11")
		expect(
			hostSeatRefOf({
				kind: "player",
				seatId: 20,
				castMemberId: 7,
				cardId: 11
			})
		).toBe("character:11")
		expect(
			hostSeatRefOf({
				kind: "player",
				seatId: 22,
				castMemberId: 9,
				cardId: null
			})
		).toBe("player-seat:22")
		expect(
			hostSeatRefOf({
				kind: "character",
				seatId: 4,
				castMemberId: 5,
				cardId: null
			})
		).toBeNull()
		expect(storedSeatRefInCast(cast, "seated-member:8")).toBe(
			"character:13"
		)
		expect(storedSeatRefInCast(cast, "character:11")).toBe("character:11")
	})

	test("on: member form for every seat", () => {
		memberFormSwitch.on = true
		expect(
			hostSeatRefOf({
				kind: "character",
				seatId: 2,
				castMemberId: 7,
				cardId: 11
			})
		).toBe("seated-member:7")
		expect(
			hostSeatRefOf({
				kind: "player",
				seatId: 20,
				castMemberId: 7,
				cardId: 11
			})
		).toBe("player-seat:20")
		expect(
			hostSeatRefOf({
				kind: "player",
				seatId: 22,
				castMemberId: 9,
				cardId: null
			})
		).toBe("player-seat:22")
		expect(
			hostSeatRefOf({
				kind: "character",
				seatId: 3,
				castMemberId: null,
				cardId: 12
			})
		).toBe("character:12")
		expect(
			hostSeatRefOf({
				kind: "character",
				seatId: 4,
				castMemberId: null,
				cardId: null
			})
		).toBeNull()
	})

	test("on: the in-hand door reads card form and seated-member as the seat's member form", () => {
		memberFormSwitch.on = true
		// a card in a character seat and a player seat: the character seat, as seatOf
		expect(storedSeatRefInCast(cast, "character:11")).toBe(
			"seated-member:7"
		)
		expect(storedSeatRefInCast(cast, "seated-member:7")).toBe(
			"seated-member:7"
		)
		// a member seated only in a player seat
		expect(storedSeatRefInCast(cast, "seated-member:8")).toBe(
			"player-seat:21"
		)
		expect(storedSeatRefInCast(cast, "character:13")).toBe("player-seat:21")
		// a member-less character seat keeps the card form
		expect(storedSeatRefInCast(cast, "character:12")).toBe("character:12")
		// other refs unchanged; no seat → null
		expect(storedSeatRefInCast(cast, "player-seat:22")).toBe(
			"player-seat:22"
		)
		expect(storedSeatRefInCast(cast, "envoy:castellan")).toBe(
			"envoy:castellan"
		)
		expect(storedSeatRefInCast(cast, "character:99")).toBeNull()
		expect(storedSeatRefInCast(cast, "seated-member:99")).toBeNull()
	})
})
