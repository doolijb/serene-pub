/** The header cast strip names a seated character by the cast's own name (§0-D). */
import { describe, expect, test } from "vitest"
import { characterForRefIn, headerCastKeyOf } from "./sessionPageProjections"
import { castFaceOf, castNameOf } from "./projections/characters"
import { avatarSrc } from "$lib/client/utils/media"
import { withMemberNames } from "$lib/shared/lorebooks/memberIdentity"

const base = (extra: Record<string, unknown> = {}) =>
	({
		sessionCharacters: [
			{ characterId: 3, character: { id: 3, name: "Adeline", nickname: "Ada" } }
		],
		sessionPersonas: [],
		sessionMessages: [],
		...extra
	}) as any

const names = (session: any) =>
	JSON.parse(headerCastKeyOf(session, null)).map((m: any) => m.name)

describe("headerCastKeyOf with castNames", () => {
	test("absent or {} reads the card's", () => {
		expect(names(base())).toEqual(["Ada"])
		expect(names(base({ castNames: {} }))).toEqual(["Ada"])
	})
	test("an own name shows", () => {
		expect(
			names(base({ castNames: { 3: { ownName: "Adel", ownNickname: "" } } }))
		).toEqual(["Adel"])
	})
})

describe("the helpers the page's pickers call", () => {
	const session = base({
		castNames: { 3: { ownName: "Adel", ownNickname: "" } },
		castFaces: { 3: 11 }
	})
	test("a turn candidate is named by the cast's own name", () => {
		expect(castNameOf(session, 3, { name: "Adeline", nickname: "Ada" }, "Adeline")).toBe("Adel")
	})
	test("a seat shows as the member, with their face", () => {
		const seat = withMemberNames(session.sessionCharacters[0].character, session.castNames[3])
		expect(seat.nickname || seat.name).toBe("Adel")
		expect(typeof session.castFaces[3]).toBe("number")
		expect(castFaceOf(session, 3, {})).not.toBeNull()
	})
})

describe("a persona seat reads its cast member (s27 S2c)", () => {
	const persona = { id: 8, userId: 1, name: "Kit", nickname: "", avatarMediaId: 5 }
	const withPersona = (extra: Record<string, unknown> = {}, seat: Record<string, unknown> = {}) =>
		base({
			sessionPersonas: [{ personaId: 8, persona, ...seat }],
			...extra
		})
	const persons = (session: any) =>
		JSON.parse(headerCastKeyOf(session, null)).filter((m: any) => m.isPersona)

	test("the header's persona disc: the member's name and face; as before without them", () => {
		const bare = persons(withPersona())
		expect(bare.map((m: any) => m.name)).toEqual(["Kit"])
		const shown = persons(
			withPersona({
				castNames: { 8: { ownName: "Kitty", ownNickname: "" } },
				castFaces: { 8: 77 }
			})
		)
		expect(shown.map((m: any) => m.name)).toEqual(["Kitty"])
		expect(shown[0].avatarSrc).toBe(avatarSrc({ avatarMediaId: 77 }))
		expect(bare[0].avatarSrc).toBe(avatarSrc({ avatarMediaId: 5 }))
	})

	test("a seat name wins over the member's name in the header", () => {
		const out = persons(
			withPersona({ castNames: { 8: { ownName: null, ownNickname: "Kitty" } } }, { seatName: "Wren" })
		)
		expect(out.map((m: any) => m.name)).toEqual(["Wren"])
	})

	test("characterForRefIn returns a persona's card as its member shows it, the same object without", () => {
		const plain = withPersona()
		expect(characterForRefIn(plain, "character:8")).toBe(persona)
		const shown = characterForRefIn(
			withPersona({ castNames: { 8: { ownName: "Kitty", ownNickname: "" } }, castFaces: { 8: 77 } }),
			"character:8"
		) as any
		expect(shown.name).toBe("Kitty")
		expect(shown.avatarMediaId).toBe(77)
		expect(persona.name).toBe("Kit")
	})
})

describe("a disc keeps its cast name when its seat carries a ref (s27 S3)", () => {
	test("the key is the seat's ref, the name still the cast's", () => {
		const s = base({
			castNames: { 3: { ownName: "Adel", ownNickname: "" } },
			sessionCharacters: [
				{ characterId: 3, castMemberId: 50, ref: "seated-member:50", character: { id: 3, name: "Adeline", nickname: "Ada" } }
			]
		})
		const [disc] = JSON.parse(headerCastKeyOf(s, null))
		expect(disc.key).toBe("seated-member:50")
		expect(disc.name).toBe("Adel")
	})
	test("today's seat (no ref) keeps the card's key", () => {
		const [disc] = JSON.parse(headerCastKeyOf(base(), null))
		expect(disc.key).toBe("character:3")
	})
})

describe("headerCastKeyOf lights the next row by the head's ref", () => {
	// Card 7 sits in a character seat (member 50) and a player seat (member 60).
	const both = {
		sessionCharacters: [
			{ id: 1, characterId: 7, castMemberId: 50, ref: "seated-member:50", character: { id: 7, name: "Kit" } },
			{ id: 2, characterId: 8, castMemberId: 51, ref: "seated-member:51", character: { id: 8, name: "Bo" } }
		],
		sessionPersonas: [
			{ id: 20, personaId: 7, castMemberId: 60, ref: "player-seat:20", persona: { id: 7, name: "Kit" } }
		],
		sessionMessages: []
	} as any
	const next = (ref: string | null) =>
		JSON.parse(headerCastKeyOf(both, ref))
			.filter((m: any) => m.isNext)
			.map((m: any) => m.key)
	test("a character seat's ref lights its row only", () => {
		expect(next("seated-member:51")).toEqual(["seated-member:51"])
	})
	test("a player seat on the same card lights no character row", () => {
		expect(next("player-seat:20")).toEqual([])
	})
	test("no head, no row; card form still lights by the card-form key", () => {
		expect(next(null)).toEqual([])
		expect(
			JSON.parse(headerCastKeyOf(base(), "character:3")).map((m: any) => m.isNext)
		).toEqual([true])
	})
})
