/** Card-less seats on the client (plan §34.2): named from `cardlessSeatShown` by member id. */
import { describe, expect, test } from "vitest"
import { avatarSrc } from "$lib/client/utils/media"
import {
	canControlMessageAs,
	participantForRefIn
} from "./sessionPageProjections"

const session = (extra: Record<string, unknown> = {}) =>
	({
		sessionCharacters: [
			{
				id: 1,
				characterId: null,
				castMemberId: 7,
				character: null,
				position: 0,
				removedAt: null,
				envoySlug: null,
				ref: "seated-member:7",
				seatedByUserId: 2
			},
			{
				id: 2,
				characterId: 7,
				castMemberId: 90,
				character: { id: 7, name: "Card Seven", nickname: null },
				position: 1,
				removedAt: null
			}
		],
		sessionPersonas: [],
		sessionMessages: [],
		castNames: { 7: { ownName: "Card-keyed", ownNickname: "" } },
		cardlessSeatShown: {
			7: { name: "Member Seven", nickname: null, faceMediaId: 33 }
		},
		...extra
	}) as any

describe("participantForRefIn — a card-less seat", () => {
	test("seated-member:<M> is M's name and face from cardlessSeatShown", () => {
		const who = participantForRefIn(session(), "seated-member:7")
		expect(who?.name).toBe("Member Seven")
		expect(who?.avatarUrl).toBe(avatarSrc({ avatarMediaId: 33 }))
	})

	test("a card-keyed castNames[7] does not name the member", () => {
		expect(
			participantForRefIn(session(), "seated-member:7")?.name
		).not.toBe("Card-keyed")
	})
})

describe("canControlMessageAs — a card-less character line", () => {
	// Mirrors the server's `canActOnMessage` seat branch: the owner, else the
	// seater (`seatedByUserId`).
	const line = {
		characterId: null,
		personaId: null,
		castMemberId: 7,
		role: "assistant",
		metadata: { speaker: "seated-member:7" }
	} as any
	test("the session owner may", () => {
		expect(
			canControlMessageAs(
				{ user: { id: 1 } } as any,
				false,
				session(),
				line
			)
		).toBe(true)
	})
	test("the guest who seated it may; another guest may not", () => {
		expect(
			canControlMessageAs({ user: { id: 2 } } as any, true, session(), line)
		).toBe(true)
		expect(
			canControlMessageAs({ user: { id: 3 } } as any, true, session(), line)
		).toBe(false)
	})
	test("a card-less player line keeps its own path (the author's)", () => {
		const playerLine = {
			characterId: null,
			personaId: null,
			castMemberId: 7,
			role: "user",
			userId: 3,
			metadata: { speaker: "player-seat:4" }
		} as any
		expect(
			canControlMessageAs({ user: { id: 3 } } as any, true, session(), playerLine)
		).toBe(true)
		expect(
			canControlMessageAs({ user: { id: 2 } } as any, true, session(), playerLine)
		).toBe(false)
	})
})
