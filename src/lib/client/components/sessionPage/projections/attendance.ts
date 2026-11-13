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
import { seatRefOf, type PayloadSeat } from "./seatIdentity"

/** The session payload (`sessions:get`), as far as who writes as whom needs it. */
export interface AttendanceSourceSession {
	sessionPersonas?:
		| readonly (PayloadSeat & {
				persona?: { id?: number | null; userId?: number | null } | null
				/** 🚧 Whose seat it is — a card-less player seat's owner (★S3W-3). */
				userId?: number | null
		  })[]
		| null
}

/**
 * Who writes as whom in this session, as one string —
 * `"<userId>:<personaId>"` per seated persona, space-joined in seat order,
 * and `":<ref>"` after it when the seat's ref (`seatRefOf`, 🚧 s27 S3) is
 * not today's `character:<personaId>` (a ref holds `:`, so it is read as
 * everything after the second one). A card-less player seat (★S3W-3) is
 * `"<userId>:-:<ref>"` — its owner is the seat's own `userId`, and `-` is
 * the missing persona id (never an empty string, which reads as 0). So a
 * `$derived` over it notifies only when a persona or seat is added, removed,
 * changes hands or its seat's ref changes.
 */
export function personaOwnersOf(
	session: AttendanceSourceSession | null | undefined
): string {
	const pairs: string[] = []
	for (const seat of session?.sessionPersonas ?? []) {
		if (seat?.removedAt) continue
		const personaId = seat.persona?.id ?? seat.personaId
		if (typeof personaId !== "number") {
			const owner = seat.userId
			const own = seatRefOf(seat, "player")
			if (typeof owner === "number" && own)
				pairs.push(`${owner}:-:${own}`)
			continue
		}
		const userId = seat.persona?.userId
		if (typeof userId !== "number") continue
		// The card the seat voices is the persona's, as listed.
		const ref = seatRefOf({ ...seat, personaId }, "player")
		pairs.push(
			ref && ref !== `character:${personaId}`
				? `${userId}:${personaId}:${ref}`
				: `${userId}:${personaId}`
		)
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

	const personasOf = new Map<number, { id: number | null; ref: string }[]>()
	for (const owned of src.personaOwners.split(" ")) {
		// "<userId>:<personaId>" then, optionally, ":<ref>" — the ref's own
		// colons are kept: split on the first two only.
		const [userPart, personaPart, ...refParts] = owned.split(":")
		const userId = Number(userPart)
		// "-" is a card-less seat: no persona id, and always a ref.
		const personaId = personaPart === "-" ? null : Number(personaPart)
		if (!Number.isInteger(userId)) continue
		if (
			personaId === null ? !refParts.length : !Number.isInteger(personaId)
		)
			continue
		const list = personasOf.get(userId) ?? []
		list.push({
			id: personaId,
			// ⏳ today's `character:<personaId>` for a card-form payload with no ref.
			ref: refParts.length ? refParts.join(":") : `character:${personaId}`
		})
		personasOf.set(userId, list)
	}
	const typing = new Set(src.typingPersonaIds)

	const people: AttendeeV1[] = pushed.people.map((p) => {
		const personas = personasOf.get(p.userId) ?? []
		return {
			userId: p.userId,
			name: p.name,
			role: p.role,
			// ⏳ the SDK dist widens to ParticipantRef[] (lane s27-S3G)
			personaRefs: personas.map(
				({ ref }) => ref
			) as AttendeeV1["personaRefs"],
			typing:
				p.here &&
				personas.some(({ id }) => id !== null && typing.has(id)),
			lastSeenAt: p.lastSeenAt,
			here: p.here
		}
	})
	return { v: 1, people }
}
