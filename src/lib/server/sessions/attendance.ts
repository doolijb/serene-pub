/**
 * `sessions:attendance` — who of a session's people has it open now (W10,
 * the Who's here widget's section, `attendance.v1`).
 *
 * ## What "has it open" means
 *
 * The session page's inbox holds `sessions:attendance#<id>` for as long as
 * it shows that session (`sessionPageInbox.svelte.ts`), on every socket it
 * runs on. So a person is **here** while any connected socket of theirs
 * holds that key, and **away** otherwise — a closed tab, a navigation to
 * another page or session, a dropped connection. No second signal and no
 * heartbeat: the interest set is already kept per socket, cleared on
 * disconnect (`sockets/interest.ts`), and synced again on every reconnect.
 * A tab in the background is still here; it still has the session open.
 *
 * ## When it is pushed
 *
 * The interest module tells this one whenever a socket's set changes
 * (`observeInterestChanges`); a change that adds or drops an attendance key
 * schedules a push for that session — a trailing debounce per session, like
 * `sessions/rowPush.ts`, so a page that syncs twice on open, or a server
 * restart reconnecting every tab at once, yields one push per session. It
 * goes to the session's users through `broadcastToSessionUsers`: GATED and
 * LAZY, so with nobody holding the key (the last person left) nothing is
 * read and nothing is sent. The joiner's own sync is what sends them the
 * first frame.
 *
 * **Last seen** is the time a person's attendance key last came or went, in
 * memory: a restart forgets it, and a person not seen since reads `null`.
 * While they are here it is the frame's own time.
 *
 * ⚠ Not a cast **presence** (a cast member's dated span in the world): these
 * are accounts — the session's owner and its guests.
 */
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import {
	observeInterestChanges,
	scopesWantedAnywhere,
	type InterestIo,
	type InterestSocket
} from "$lib/server/sockets/interest"
import {
	INTEREST_SCOPE_SEPARATOR,
	type InterestKey
} from "$lib/shared/sockets/interest"
import type { AuthenticatedSocket } from "$lib/server/sockets/auth"

export const ATTENDANCE_EVENT = "sessions:attendance"

/** How long a burst of joins and leaves runs before the session's attendance is read. */
export const ATTENDANCE_PUSH_DELAY_MS = 250

type AttendanceIo = AuthenticatedSocket["io"]

const KEY_PREFIX = `${ATTENDANCE_EVENT}${INTEREST_SCOPE_SEPARATOR}`

/** The sessions a socket's interest keys hold open: each `sessions:attendance#<id>`. */
export function sessionsHeldOpen(keys: Iterable<InterestKey>): Set<number> {
	const out = new Set<number>()
	for (const key of keys) {
		if (!key.startsWith(KEY_PREFIX)) continue
		const id = Number(key.slice(KEY_PREFIX.length))
		if (Number.isInteger(id) && id > 0) out.add(id)
	}
	return out
}

/** Who has this session open now: every user with a connected socket holding its key. */
export function usersHere(io: InterestIo, sessionId: number): Set<number> {
	const here = new Set<number>()
	for (const [userId, scopes] of scopesWantedAnywhere(io, ATTENDANCE_EVENT))
		if (scopes.has(String(sessionId))) here.add(userId)
	return here
}

/** When each person last came or went, per session (ms). Memory only — a restart forgets. */
const lastSeen = new Map<number, Map<number, number>>()

function stamp(sessionId: number, userId: number, at: number): void {
	let people = lastSeen.get(sessionId)
	if (!people) lastSeen.set(sessionId, (people = new Map()))
	people.set(userId, at)
}

/**
 * The session's attendance as pushed: the owner, then the guests, each with
 * their name, whether they have it open now and when they last did. `null`
 * when there is no such session any more — `broadcastToSessionUsers`' signal
 * to send nothing.
 */
export async function sessionAttendanceFrame(
	handle: Db,
	io: InterestIo,
	sessionId: number,
	now: number = Date.now()
): Promise<Sockets.Sessions.Attendance.Response | null> {
	const [owner] = await handle
		.select({
			userId: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName
		})
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(eq(schema.sessions.id, sessionId))
	if (!owner) return null
	const guests = await handle
		.select({
			userId: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName
		})
		.from(schema.sessionGuests)
		.innerJoin(
			schema.users,
			eq(schema.users.id, schema.sessionGuests.userId)
		)
		.where(eq(schema.sessionGuests.sessionId, sessionId))

	const here = usersHere(io, sessionId)
	const seen = lastSeen.get(sessionId)
	const person = (
		row: { userId: number; username: string; displayName: string | null },
		role: "owner" | "guest"
	): Sockets.Sessions.Attendance.Person => {
		const isHere = here.has(row.userId)
		return {
			userId: row.userId,
			name: row.displayName?.trim() || row.username,
			role,
			here: isHere,
			lastSeenAt: isHere ? now : (seen?.get(row.userId) ?? null)
		}
	}
	return {
		sessionId,
		people: [
			person(owner, "owner"),
			...guests
				.filter((g) => g.userId !== owner.userId)
				.map((g) => person(g, "guest"))
		]
	}
}

/** One pending push per session. Empty between bursts. */
const pending = new Map<number, ReturnType<typeof setTimeout>>()

/**
 * Tell this session's users who has it open, once the burst settles.
 * Returns at once and never throws: it is called from inside the interest
 * sync, which must stay synchronous and quiet (`sockets/interest.ts`).
 */
export function broadcastSessionAttendance(
	io: AttendanceIo | undefined,
	sessionId: number
): void {
	if (!io || !Number.isInteger(sessionId)) return
	try {
		const existing = pending.get(sessionId)
		if (existing) clearTimeout(existing)
		const timer = setTimeout(() => {
			pending.delete(sessionId)
			try {
				void broadcastToSessionUsers(
					io,
					sessionId,
					ATTENDANCE_EVENT,
					// LAZY: the roster reads are the cost, and nobody holding the
					// key — the last person left — means nobody to tell.
					() => sessionAttendanceFrame(db, io, sessionId)
				).catch(() => {})
			} catch {
				// A stale `io`: a list one push behind is the whole of the damage.
			}
		}, ATTENDANCE_PUSH_DELAY_MS)
		;(timer as { unref?: () => void }).unref?.()
		pending.set(sessionId, timer)
	} catch {
		// As above.
	}
}

/**
 * The interest observer: a socket that took or dropped a session's
 * attendance key is a person arriving or leaving — stamp when, and push.
 */
export function noteAttendanceChange(
	socket: InterestSocket & { io?: AttendanceIo },
	before: ReadonlySet<InterestKey>,
	after: ReadonlySet<InterestKey>
): void {
	const was = sessionsHeldOpen(before)
	const is = sessionsHeldOpen(after)
	const moved = [...was, ...is].filter((id) => was.has(id) !== is.has(id))
	if (!moved.length) return
	const userId = socket.user?.id
	const at = Date.now()
	for (const sessionId of new Set(moved)) {
		if (typeof userId === "number") stamp(sessionId, userId, at)
		broadcastSessionAttendance(socket.io, sessionId)
	}
}

/** Bound from `connectSockets`: start hearing who opens and leaves a session. */
export function installAttendance(): void {
	observeInterestChanges("attendance", noteAttendanceChange)
}

/** Drop every pending push and every last-seen time. Shutdown, and the reset a test needs. */
export function __resetAttendanceForTests(): void {
	for (const timer of pending.values()) clearTimeout(timer)
	pending.clear()
	lastSeen.clear()
}

process.once("exit", () => {
	for (const timer of pending.values()) clearTimeout(timer)
	pending.clear()
})
