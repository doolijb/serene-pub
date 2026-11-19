/** A carded player seat's person is `session_personas.user_id`; null reads the card's owner. */
import { describe, expect, test } from "vitest"
import { canControlMessageAs } from "./sessionPageProjections"

const OWNER = 1
const GUEST = 2

const session = (userId: number | null) =>
	({
		sessionCharacters: [],
		sessionMessages: [],
		sessionPersonas: [
			{
				id: 4,
				personaId: 8,
				userId,
				removedAt: null,
				persona: { id: 8, userId: OWNER }
			}
		]
	}) as any

const line = { personaId: 8, role: "user" } as any

const can = (me: number, userId: number | null) =>
	canControlMessageAs({ user: { id: me } } as any, me !== OWNER, session(userId), line)

describe("canControlMessageAs — a carded player seat", () => {
	test("the owner's card seated for a guest is the guest's, not the owner's", () => {
		expect(can(GUEST, GUEST)).toBe(true)
		expect(can(OWNER, GUEST)).toBe(false)
	})
	test("no seat person reads the card's owner", () => {
		expect(can(OWNER, null)).toBe(true)
		expect(can(GUEST, null)).toBe(false)
	})
})
