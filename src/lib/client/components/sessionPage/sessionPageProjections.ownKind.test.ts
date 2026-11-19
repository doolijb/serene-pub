/** `canControlMessageAs`: a line is judged among seats of its own kind, removed seats included. */
import { describe, expect, test } from "vitest"
import { canControlMessageAs } from "./sessionPageProjections"

const OWNER = 1
const GUEST = 2
const OTHER = 3
const CARD = 50
const MEMBER = 7

const as = (id: number, isGuest: boolean, session: any, msg: any) =>
	canControlMessageAs({ user: { id } } as any, isGuest, session, msg)
const asOwner = (s: any, m: any) => as(OWNER, false, s, m)
const asGuest = (s: any, m: any) => as(GUEST, true, s, m)
const asOther = (s: any, m: any) => as(OTHER, true, s, m)

const movedCarded = {
	sessionPersonas: [
		{
			id: 1,
			personaId: CARD,
			persona: { id: CARD, userId: GUEST },
			userId: GUEST,
			castMemberId: null,
			removedAt: "2026-01-01T00:00:00Z"
		}
	],
	sessionCharacters: [
		{
			id: 2,
			characterId: CARD,
			character: { id: CARD, userId: GUEST },
			castMemberId: 90,
			seatedByUserId: GUEST,
			removedAt: null,
			envoySlug: null
		}
	]
}

const person = {
	characterId: null,
	personaId: CARD,
	role: "user",
	metadata: { speaker: "player-seat:1" }
} as any
const personBare = { ...person, metadata: null }
const ai = {
	characterId: CARD,
	personaId: null,
	role: "assistant",
	metadata: null
} as any

describe("after a move, carded", () => {
	test("earlier person lines stay the guest's, never the owner's", () => {
		for (const line of [person, personBare]) {
			expect(asGuest(movedCarded, line)).toBe(true)
			expect(asOwner(movedCarded, line)).toBe(false)
			expect(asOther(movedCarded, line)).toBe(false)
		}
	})
	test("a new AI line: the owner and the card's owner may, a third member may not", () => {
		expect(asOwner(movedCarded, ai)).toBe(true)
		expect(asGuest(movedCarded, ai)).toBe(true)
		expect(asOther(movedCarded, ai)).toBe(false)
	})
})

describe("after a move, card-less", () => {
	const session = {
		sessionPersonas: [
			{
				id: 1,
				personaId: null,
				persona: null,
				userId: GUEST,
				castMemberId: MEMBER,
				removedAt: "2026-01-01T00:00:00Z"
			}
		],
		sessionCharacters: [
			{
				id: 2,
				characterId: null,
				character: null,
				castMemberId: MEMBER,
				seatedByUserId: OWNER,
				removedAt: null,
				envoySlug: null
			}
		]
	}
	test("earlier person lines stay the guest's; a new seated-member line is the owner's only", () => {
		const typed = {
			characterId: null,
			personaId: null,
			castMemberId: MEMBER,
			role: "user",
			userId: GUEST,
			metadata: { speaker: "player-seat:1" }
		} as any
		const seated = {
			characterId: null,
			personaId: null,
			castMemberId: MEMBER,
			role: "assistant",
			metadata: { speaker: `seated-member:${MEMBER}` }
		} as any
		expect(asGuest(session, typed)).toBe(true)
		expect(asOwner(session, typed)).toBe(false)
		expect(asOwner(session, seated)).toBe(true)
		expect(asGuest(session, seated)).toBe(false)
	})
})

describe("★K-2, no move", () => {
	const session = {
		sessionPersonas: [
			{ ...movedCarded.sessionPersonas[0], removedAt: null }
		],
		sessionCharacters: [
			{
				...movedCarded.sessionCharacters[0],
				character: { id: CARD, userId: OWNER },
				seatedByUserId: OWNER
			}
		]
	}
	test("a person line is the guest's; an AI line the owner's, not the guest's", () => {
		expect(asGuest(session, person)).toBe(true)
		expect(asOwner(session, person)).toBe(false)
		expect(asOwner(session, ai)).toBe(true)
		expect(asGuest(session, ai)).toBe(false)
	})
})
