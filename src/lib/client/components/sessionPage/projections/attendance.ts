/**
 * `attendance.v1` (W10, the Who's here widget's base section): the session's
 * people as the server last pushed them (`sessions:attendance` — who has it
 * open, by name and role, and when each was last here), with what only the
 * page knows added: the personas each writes as, from the session payload,
 * and who is typing, from the typing pings (`sessions:userTyping`).
 *
 * Pure: plain values in, a detached section out. `envelopeSections` wraps it
 * in a `$derived` and sets it under `SESSION_ATTENDANCE_KEY`; the widget
 * wire posts it to a widget that reads `attendance`, and to no other (R75).
 *
 * Who writes as whom is the persona card's owner (`persona.userId`) — a
 * persona is a character a person voices, and the card is theirs — read off
 * the session payload as a string (`personaOwnersOf`), so a streamed chunk,
 * which replaces the session object and moves no persona, moves nothing here.
 */
import type { AttendanceV1, AttendeeV1 } from "@serene-pub/sdk"

/** The session payload (`sessions:get`), as far as who writes as whom needs it. */
export interface AttendanceSourceSession {
	sessionPersonas?:
		| readonly {
				removedAt?: unknown
				personaId?: number | null
				persona?: { id?: number | null; userId?: number | null } | null
		  }[]
		| null
}

/**
 * Who writes as whom in this session, as one string — `"<userId>:<personaId>"`
 * per seated persona, space-joined in seat order — so a `$derived` over it
 * notifies only when a persona is added, removed or changes hands.
 */
export function personaOwnersOf(
	session: AttendanceSourceSession | null | undefined
): string {
	const pairs: string[] = []
	for (const seat of session?.sessionPersonas ?? []) {
		if (seat?.removedAt) continue
		const personaId = seat.persona?.id ?? seat.personaId
		const userId = seat.persona?.userId
		if (typeof personaId === "number" && typeof userId === "number")
			pairs.push(`${userId}:${personaId}`)
	}
	return pairs.join(" ")
}

export interface AttendanceSource {
	/** The session in the route. */
	sessionId: number | null
	/** The server's last `sessions:attendance` push — any session's; only this one's counts. */
	pushed: Sockets.Sessions.Attendance.Response | null
	/** `personaOwnersOf(session)`. */
	personaOwners: string
	/** The personas typing now, by id (`typingPersonas`' keys — never the viewer's own). */
	typingPersonaIds: Iterable<number>
}

/** The section: the pushed people, each with their personas and whether one is typing. */
export function projectAttendance(src: AttendanceSource): AttendanceV1 {
	const pushed =
		src.pushed && src.pushed.sessionId === src.sessionId ? src.pushed : null
	if (!pushed) return { v: 1, people: [] }

	const personasOf = new Map<number, number[]>()
	for (const pair of src.personaOwners.split(" ")) {
		const [userId, personaId] = pair.split(":").map(Number)
		if (!Number.isInteger(userId) || !Number.isInteger(personaId)) continue
		const list = personasOf.get(userId) ?? []
		list.push(personaId)
		personasOf.set(userId, list)
	}
	const typing = new Set(src.typingPersonaIds)

	const people: AttendeeV1[] = pushed.people.map((p) => {
		const personas = personasOf.get(p.userId) ?? []
		return {
			userId: p.userId,
			name: p.name,
			role: p.role,
			personaRefs: personas.map((id) => `character:${id}` as const),
			typing: p.here && personas.some((id) => typing.has(id)),
			lastSeenAt: p.lastSeenAt,
			here: p.here
		}
	})
	return { v: 1, people }
}
