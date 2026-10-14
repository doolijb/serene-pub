/**
 * `attendance.v1` (W10): the server's push, with who writes as whom (the
 * persona card's owner) and who is typing (the typing pings) added.
 */
import { describe, expect, test } from "vitest"
import { personaOwnersOf, projectAttendance } from "./attendance"

const pushed = (
	sessionId: number,
	people: Sockets.Sessions.Attendance.Person[]
): Sockets.Sessions.Attendance.Response => ({ sessionId, people })

const MIRA: Sockets.Sessions.Attendance.Person = {
	userId: 1,
	name: "Mira",
	role: "owner",
	here: true,
	lastSeenAt: 100
}
const MARCO: Sockets.Sessions.Attendance.Person = {
	userId: 2,
	name: "Marco",
	role: "guest",
	here: true,
	lastSeenAt: 100
}
const ANA: Sockets.Sessions.Attendance.Person = {
	userId: 3,
	name: "Ana",
	role: "guest",
	here: false,
	lastSeenAt: 40
}

const session = {
	sessionPersonas: [
		{ removedAt: null, personaId: 8, persona: { id: 8, userId: 1 } },
		{ removedAt: null, personaId: 9, persona: { id: 9, userId: 2 } },
		{ removedAt: null, personaId: 10, persona: { id: 10, userId: 1 } },
		// Removed from the session: nobody writes as it now.
		{
			removedAt: "2026-10-01",
			personaId: 11,
			persona: { id: 11, userId: 3 }
		},
		// A persona whose card is gone: no owner to name.
		{ removedAt: null, personaId: null, persona: null }
	]
}

describe("personaOwnersOf", () => {
	test("each seated persona with its card's owner, in seat order — one string", () => {
		expect(personaOwnersOf(session)).toBe("1:8 2:9 1:10")
		expect(personaOwnersOf(undefined)).toBe("")
		expect(personaOwnersOf({ sessionPersonas: null })).toBe("")
	})

	test("a streamed chunk — a new session object, the same personas — reads the same", () => {
		expect(personaOwnersOf({ ...session })).toBe(personaOwnersOf(session))
	})
})

describe("projectAttendance", () => {
	test("the pushed people, each with the personas they write as and whether one is typing", () => {
		const section = projectAttendance({
			sessionId: 7,
			pushed: pushed(7, [MIRA, MARCO, ANA]),
			personaOwners: personaOwnersOf(session),
			typingPersonaIds: [9]
		})
		expect(section).toEqual({
			v: 1,
			people: [
				{
					...MIRA,
					personaRefs: ["character:8", "character:10"],
					typing: false
				},
				{ ...MARCO, personaRefs: ["character:9"], typing: true },
				{ ...ANA, personaRefs: [], typing: false }
			]
		})
	})

	test("nobody away is typing, whatever a stale ping says", () => {
		const section = projectAttendance({
			sessionId: 7,
			pushed: pushed(7, [{ ...MARCO, here: false }]),
			personaOwners: "2:9",
			typingPersonaIds: [9]
		})
		expect(section.people[0]!.typing).toBe(false)
	})

	test("empty before the first push, and never another session's", () => {
		expect(
			projectAttendance({
				sessionId: 7,
				pushed: null,
				personaOwners: "",
				typingPersonaIds: []
			})
		).toEqual({ v: 1, people: [] })
		expect(
			projectAttendance({
				sessionId: 7,
				pushed: pushed(6, [MIRA]),
				personaOwners: "",
				typingPersonaIds: []
			})
		).toEqual({ v: 1, people: [] })
	})
})
