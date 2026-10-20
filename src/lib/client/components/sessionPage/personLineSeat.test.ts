/**
 * A live row from a seat made after the page loaded (Dungeon Crawler walk
 * round 2, 2026-10-15): it rendered "Adventurer · Bo" with an "A" avatar
 * until a reload. The row names its seat (`player-seat:<id>`); once the
 * pushed session carries that seat, the line takes the seat's name.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { personLineOf } from "./sessionPageProjections"

const OWNER = 1
const GUEST = 2
const userCtx = { user: { id: OWNER, username: "jody" } } as any
const line = { role: "user", userId: GUEST, personaId: null, metadata: { speaker: "player-seat:9" } } as any
const guests = [{ userId: GUEST, user: { id: GUEST, username: "Bo" } }]

describe("a live line from a card-less seat", () => {
	test("before the push the seat is unknown: the label and the member", () => {
		const session = { sessionPersonas: [], sessionGuests: guests } as any
		expect(personLineOf(userCtx, session, "Adventurer", line)).toEqual({ name: "Adventurer", member: "Bo" })
	})
	test("the pushed persona list carries the seat: the line takes its name", () => {
		const session = {
			sessionPersonas: [{ id: 9, personaId: null, persona: null, userId: GUEST, seatName: "Bo the Quick" }],
			sessionGuests: guests
		} as any
		expect(personLineOf(userCtx, session, "Adventurer", line)).toEqual({ name: "Bo the Quick" })
	})
})
